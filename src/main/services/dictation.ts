import { app, globalShortcut } from 'electron'
import { AUDIO_KEEP_DAYS, type BarState, type SttEngine } from '@shared/types'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { DeepgramFileSttProvider, DeepgramSttProvider, isRetryableSttError, MockSttProvider, transcribeWav } from '../providers/deepgram'
import { ElevenLabsSttProvider, ScribeFileSttProvider, transcribeWavScribe } from '../providers/elevenlabs'
import { withLiveCaption } from '../providers/live-caption-core'
import { transcribeWavVoxtral, VoxtralFileSttProvider } from '../providers/voxtral'
import { buildKeyterms } from '../providers/keyterms'
import { extractScreenTerms } from './screen-terms-core'
import { repairDroppedWords } from './dropped-words-core'
import { AnthropicCleanupProvider } from '../providers/anthropic'
import { CerebrasCleanupProvider } from '../providers/cerebras'
import { OpenAiCompatCleanupProvider, openAiCompatConfig } from '../providers/openai-compat'
import type { SttProvider } from '../providers/stt'
import { styleCategory } from '../providers/cleanup-prompt'
import { getDb } from '../db'
import { applyPersonalization, dictionaryTerms, isBlockedApp, loadPersonalization } from './personalization'
import { autoTransformFor } from './personalization-core'
import { getAnthropicKey, getCerebrasKey, getDeepgramKey, getElevenLabsKey, getMistralKey, useMockStt } from '../secrets'
import { captureForeground } from './context'
import { copyPrivate, copySelection, insertText, pressEnter, undoLastInsert } from './insertion'
import { isTerminalApp, singleLineForTerminal } from './command-core'
import { loadSettings } from './settings'
import { logMetrics } from './usage'
import { showBar } from '../windows'
import { cleanupTimeoutMs, DictationMachine, wordCount, type DictationHost } from './dictation-machine'
import { AudioStore } from './audio-store-core'
import { canShowTip, countChatDictation, parseTipsState, recordTip, SEND_TIP_AFTER, type TipId, type TipsState } from './tips-core'
import { readJsonOrQuarantine, writeJsonAtomic } from './json-file'
import { appStyle } from '../providers/cleanup-prompt'
import { userDataDir } from '../paths'
import { boundContext } from './context-core'
import { UiaClient } from './uia'
import { UIA_MAX_TEXT, verifyInsert } from './uia-core'
import { EditWatcher } from './edit-watch'
import { SessionHistory } from './session-history'
import { detectLanguage } from './language-detect'
import type { BrowserWindow } from 'electron'
import { tm } from '../lang'

/** En mode « multi », choisit la règle de langue d'après la dictée elle-même (français, anglais, ou mélange). */
function effectiveLanguage(setting: 'fr' | 'en' | 'multi' | undefined, raw: string): 'fr' | 'en' | 'multi' {
  if (setting && setting !== 'multi') return setting
  const detected = detectLanguage(raw)
  return detected === 'fr' || detected === 'en' ? detected : 'multi'
}

function ramMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10
}

export class DictationService {
  /** Nouvelle dictée : efface la bulle et rend la fonction qui y écrit, valable pour cette dictée seulement. */
  private captionSink(): (text: string) => void {
    const gen = ++this.captionGen
    this.sendCaption('')
    return (text) => {
      if (gen === this.captionGen) this.sendCaption(text)
    }
  }

  private sendCaption(text: string): void {
    if (!this.bar.isDestroyed()) this.bar.webContents.send(IPC.barCaption, text)
  }

  private readonly machine: DictationMachine
  private readonly provider: SttProvider
  private readonly scribeLive = new ElevenLabsSttProvider()
  private readonly scribeFile = new ScribeFileSttProvider()
  private readonly voxtral = new VoxtralFileSttProvider()
  private readonly deepgramFile = new DeepgramFileSttProvider()
  private lastText = ''
  /** Numéro de la dictée dont le texte en direct a droit à la barre : un message en retard d'une dictée finie est ignoré. */
  private captionGen = 0
  private readonly anthropic = new AnthropicCleanupProvider()
  private readonly cerebras = new CerebrasCleanupProvider()
  private readonly openai = new OpenAiCompatCleanupProvider()
  private readonly uia = new UiaClient()
  private readonly history = new SessionHistory()
  private readonly editWatcher: EditWatcher
  private readonly audio = new AudioStore(join(userDataDir(), 'audio'))

  constructor(
    private bar: BrowserWindow,
    private hub: BrowserWindow
  ) {
    this.provider = useMockStt() ? new MockSttProvider() : new DeepgramSttProvider()
    this.uia.warmUp()
    this.editWatcher = new EditWatcher(this.uia, (added) => {
      if (!this.hub.isDestroyed()) this.hub.webContents.send(IPC.hubInvalidate)
      const first = added[0]
      if (first?.replacement) {
        this.tip('learned', tm('tip.learned', { replacement: first.replacement, term: first.term }))
      }
    })
    this.purgeAudio()
    setInterval(() => this.purgeAudio(), 6 * 3600_000).unref()
    const ramBefore = { mb: 0 }
    this.machine = new DictationMachine({
      openStt: async (language, signal, context) => {
        const engine = useMockStt() ? 'deepgram' : sttEngineWithKey(loadSettings().sttEngine)
        if (!useMockStt() && (engine === 'deepgram' || engine === 'deepgram_file') && !getDeepgramKey()) {
          throw new Error(tm('prov.deepgram.noKeyDictation'))
        }
        // La lecture de l'écran (quelques dizaines de ms) passe avant l'ouverture, plafonnée : le micro démarre pendant ce temps.
        const screen = context ? await Promise.race([context, new Promise<null>((r) => setTimeout(() => r(null), 250))]).catch(() => null) : null
        // Chaque dictée vide la bulle et invalide les messages en retard de la précédente, même sans texte en direct.
        const sink = this.captionSink()
        const caption = (engine === 'elevenlabs' || engine === 'elevenlabs_live') && loadSettings().liveCaption ? sink : undefined
        const options = { language, signal, keyterms: buildKeyterms(dictionaryTerms(loadPersonalization()), screen?.screenTerms ?? []), onCaption: caption }
        if (engine === 'deepgram') return this.provider.open(options)
        if (engine === 'deepgram_file') return this.deepgramFile.open(options)
        try {
          if (engine === 'elevenlabs' && caption) {
            // Le texte collé vient du fichier entier ; Scribe en direct ne sert qu'à afficher les mots pendant la dictée.
            const base = await this.scribeFile.open(options)
            return withLiveCaption(base, () => this.scribeLive.open(options), (m) => console.warn('[caption]', m))
          }
          const other = engine === 'elevenlabs_live' ? this.scribeLive : engine === 'voxtral' ? this.voxtral : this.scribeFile
          return await other.open(options)
        } catch (err) {
          // Clé refusée ou crédit épuisé : la dictée passe par Deepgram plutôt que de rater.
          if ((err as Error)?.name === 'AbortError' || isRetryableSttError(err) || !getDeepgramKey()) throw err
          console.warn(`[stt] ${engine} refusé, relais Deepgram :`, err instanceof Error ? err.message : err)
          return this.provider.open(options)
        }
      },
      cleanup: (input, timeoutMs) => this.cleanup(input, timeoutMs),
      saveAudio: (id, chunks) => {
        if (loadSettings().keepAudio) this.audio.save(id, chunks)
      },
      keepsAudio: () => loadSettings().keepAudio,
      // Plus d'attente fixe : insertText relâche lui-même les touches encore tenues avant Ctrl+V.
      insert: (text, target) => insertText(text, target?.hwnd, target?.hwndFocus),
      pressEnter: () => pressEnter(),
      isBlocked: (target) => isBlockedApp(loadPersonalization(), target?.processName ?? ''),
      warmUp: () => this.anthropic.warmUp(),
      sendState: (state: BarState, scope) => {
        this.syncEscape(state.phase)
        const wins = scope === 'bar' ? [this.bar] : [this.bar, this.hub]
        for (const win of wins) {
          if (win.isDestroyed()) continue
          win.webContents.send(IPC.barState, state)
        }
      },
      sendCommand: (command) => {
        if (this.bar.isDestroyed()) return
        this.bar.webContents.send(IPC.barCommand, command)
      },
      language: () => loadSettings().language,
      captureTarget: () => {
        ramBefore.mb = ramMb()
        return captureForeground()
      },
      command: async ({ instruction, app, context }) => {
        const personal = loadPersonalization()
        let selected = context?.selected ?? ''
        // Sans lecture UI Automation, on tente une copie de la sélection (jamais dans un terminal : Ctrl+C y interrompt).
        if (!selected.trim() && !context && !isTerminalApp(app)) selected = (await copySelection()).trim()
        // Terminal : le texte affiché (sortie de commandes) n'est jamais donné au modèle, et le résultat tient
        // sur une ligne, pour qu'aucune commande ne s'exécute toute seule au collage.
        const terminal = isTerminalApp(app)
        const outcome = await this.anthropic.command(
          {
            instruction,
            selected: terminal ? '' : selected,
            before: terminal ? undefined : context?.before,
            after: terminal ? undefined : context?.after,
            terms: dictionaryTerms(personal),
            voiceProfile: personal.voiceProfileEnabled ? personal.voiceProfile : ''
          },
          20000
        )
        return terminal && outcome.status === 'ok' ? { ...outcome, text: singleLineForTerminal(outcome.text) } : outcome
      },
      route: (spoken, selected) => this.anthropic.routeSelection(selected, spoken, 2500),
      captureContext: async () => {
        // Le champ mot de passe se reconnaît toujours (rien ne part ni n'est gardé), même si la lecture du contexte est coupée.
        const snap = await this.uia.focus(700)
        if (snap?.password) return { context: { before: '', selected: '', after: '' }, sensitive: true }
        if (!loadPersonalization().readContext) return null
        if (!snap || !snap.supported) return null
        const known = dictionaryTerms(loadPersonalization())
        const screenTerms = extractScreenTerms(snap.text ?? `${snap.before}${snap.selected}${snap.after}`, { known })
        return {
          context: boundContext({ before: snap.before, selected: snap.selected, after: snap.after }),
          token: snap,
          screenTerms
        }
      },
      verifyInsert: async (text, capture) => {
        if (!capture?.token) return 'unknown'
        await new Promise((r) => setTimeout(r, 250))
        const after = await this.uia.read(700)
        if (!after || after.length >= UIA_MAX_TEXT) return 'unknown'
        return verifyInsert(capture.token as Parameters<typeof verifyInsert>[0], after, text)
      },
      afterInsert: ({ text, capture, target }) => {
        this.editWatcher.watch({ text, capture, target })
      },
      persist: (record) => {
        if (record.finalText) {
          this.lastText = record.finalText
          this.history.push(record.app, record.finalText, Date.now(), record.windowTitle)
          this.countForSendTip(record.app, record.windowTitle, Boolean(record.provenance?.sent))
        }
        try {
          getDb().insertActivity(record)
        } catch (err) {
          console.warn('[db] insert failed', err)
        }
        if (!this.hub.isDestroyed()) this.hub.webContents.send(IPC.hubInvalidate)
        try {
          logMetrics({
            sessionId: record.id,
            timings: record.timings ?? { hotkeyStartMs: 0 },
            ramBeforeMb: ramBefore.mb,
            ramAfterMb: ramMb(),
            sttProvider: record.provenance?.sttProvider,
            sttModel: record.provenance?.sttModel
          })
        } catch (err) {
          console.warn('[metrics] écriture impossible', err instanceof Error ? err.message : err)
        }
      },
      showBar: () => showBar(this.bar),
      // La barre reste affichée au repos (petite pilule) ; l'état 'hidden' la réduit.
      hideBar: () => undefined,
      now: () => Date.now(),
      readyTimeoutMs: 8000,
      stoppedTimeoutMs: 4000,
      // 10 s d'audio : ce qu'on dit avant l'ouverture de Deepgram (réseau lent) n'est jamais perdu.
      prebufferMaxBytes: 16000 * 2 * 10
    })
  }

  /** Nettoyage d'une dictée : Haiku, relais Cerebras, puis dictionnaire et snippets. */
  private cleanup: DictationHost['cleanup'] = async (input, timeoutMs) => {
    const personal = loadPersonalization()
    const settings = loadSettings()
    const level = settings.cleanupLevel
    // Réglage « Aucun » : le texte de la transcription, avec seulement dictionnaire et snippets.
    if (level === 'none') return { text: applyPersonalization(input.rawText, personal), usedModel: false, latencyMs: null }
    const category = styleCategory(input.app, input.windowTitle)
    const transformId = autoTransformFor(personal, category)
    const started = Date.now()
    const language = effectiveLanguage(input.language, input.rawText)
    const full = {
      ...input,
      // Petits mots que Deepgram avale en français et que Haiku ne remet pas (« , vois » → « , tu vois »).
      rawText: language === 'fr' ? repairDroppedWords(input.rawText) : input.rawText,
      language,
      history: this.history.recent(input.app, Date.now(), input.windowTitle),
      terms: dictionaryTerms(personal),
      tone: category === 'code' || category === 'ai' ? undefined : personal.styles[category],
      transform: personal.transforms.find((t) => t.id === transformId)?.prompt,
      voiceProfile: personal.voiceProfileEnabled ? personal.voiceProfile : '',
      light: level === 'light',
      // « Écrire en » : traduire seulement si la langue dite n'est pas déjà celle voulue.
      ...(settings.outputLanguage && settings.outputLanguage !== language ? { translateTo: settings.outputLanguage } : {})
    }
    // Modèle choisi dans Réglages : un modèle compatible OpenAI (DeepSeek, Ollama…) s'il est configuré, sinon Claude Haiku, sinon Cerebras.
    const useOpenAi = Boolean(openAiCompatConfig())
    const primary = useOpenAi ? this.openai : getAnthropicKey() ? this.anthropic : this.cerebras
    let result = await primary.cleanup(useOpenAi ? { ...full, transform: undefined } : full, timeoutMs)
    // Panne d'appel (pas un refus du contrôle) : le secours Cerebras prend le relais s'il reste du temps.
    const left = timeoutMs - (Date.now() - started)
    if (result.failed && result.provider !== 'cerebras' && getCerebrasKey() && left > 1500) {
      const backup = await this.cerebras.cleanup(full, left)
      if (backup.usedModel) result = backup
    }
    // La transformation automatique (Peaufiner…) reste faite par Claude quand le nettoyage vient d'un autre modèle.
    if (useOpenAi && full.transform && result.usedModel && getAnthropicKey()) {
      const left2 = timeoutMs - (Date.now() - started)
      if (left2 > 1500) {
        try {
          result = { ...result, text: await this.anthropic.transform(result.text, full.transform, full.terms ?? [], left2, full.voiceProfile ?? ''), transformed: true }
        } catch (err) {
          console.warn('[openai-compat] transformation ignorée :', err instanceof Error ? err.message : err)
        }
      }
    }
    return {
      ...result,
      text: applyPersonalization(result.text, personal),
      ...(result.transformed ? { transform: transformId } : {})
    }
  }

  private purgeAudio(): void {
    try {
      if (loadSettings().keepAudio) this.audio.purgeOlderThan(AUDIO_KEEP_DAYS)
      else this.audio.purgeAll()
    } catch (err) {
      console.warn('[audio] purge impossible', err instanceof Error ? err.message : err)
    }
    this.purgeHistory()
  }

  /** Réglage « garder l'historique N jours » : ce qui est plus ancien est effacé. */
  private purgeHistory(): void {
    const days = loadSettings().historyDays
    if (!days) return
    try {
      const removed = getDb().deleteBefore(new Date(Date.now() - days * 86_400_000).toISOString())
      if (removed) console.log(`[history] ${removed} dictées de plus de ${days} jours effacées`)
    } catch (err) {
      console.warn('[history] purge impossible', err instanceof Error ? err.message : err)
    }
  }

  /** Après un changement de durée de l'historique ou de l'audio. */
  purgeOld(): void {
    this.purgeAudio()
  }

  /** Réglage « ne pas garder l'audio » : tout ce qui est sur le disque part. */
  forgetAudio(): void {
    this.purgeAudio()
  }

  /**
   * Bouton Réessayer : dictée ratée -> transcrite depuis l'audio gardé ; texte brut gardé -> renettoyé.
   * Le résultat va dans l'historique et le presse-papiers (Ctrl+V ou Ctrl+Alt+V pour le coller).
   */
  async retry(id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const row = getDb().getActivity(id)
    if (!row || row.kind !== 'dictation') return { ok: false, error: tm('err.notFound') }
    const failed = Boolean(row.provenance?.failed)
    let raw = row.rawText.trim()
    let engine = row.provenance?.steps?.[0] ?? 'deepgram'
    try {
      if (failed) {
        const wav = this.audio.read(id)
        if (!wav) return { ok: false, error: tm('err.audioGone', { days: AUDIO_KEEP_DAYS }) }
        const sttOptions = { language: loadSettings().language, keyterms: buildKeyterms(dictionaryTerms(loadPersonalization()), []) }
        const chosen = sttEngineWithKey(loadSettings().sttEngine)
        engine = chosen === 'voxtral' ? 'mistral' : chosen === 'deepgram' || chosen === 'deepgram_file' ? 'deepgram' : 'elevenlabs'
        raw =
          engine === 'elevenlabs'
            ? await transcribeWavScribe(wav, sttOptions)
            : engine === 'mistral'
              ? await transcribeWavVoxtral(wav, sttOptions)
              : await transcribeWav(wav, sttOptions)
        if (!raw) return { ok: false, error: tm('err.nothingHeard') }
      } else if (!raw || !row.provenance?.cleanupFallback) {
        return { ok: false, error: tm('err.nothingToRedo') }
      }
      const started = Date.now()
      const cleaned = await this.cleanup(
        { rawText: raw, app: row.app, windowTitle: row.windowTitle, language: loadSettings().language },
        cleanupTimeoutMs(raw.length)
      )
      if (!failed && !cleaned.usedModel) {
        return { ok: false, error: cleaned.fallback ? tm('err.stillNot', { reason: cleaned.fallback }) : tm('err.cleanupFail') }
      }
      const text = cleaned.text || raw
      const { failed: _failed, cleanupFallback: _fallback, ...rest } = row.provenance ?? {}
      getDb().updateRetry(id, {
        rawText: raw,
        finalText: text,
        words: wordCount(text),
        provenance: {
          ...rest,
          steps: cleaned.usedModel ? [engine, cleaned.provider ?? 'cerebras'] : [engine],
          cleanupLatencyMs: cleaned.usedModel ? Date.now() - started : null,
          ...(cleaned.fallback ? { cleanupFallback: cleaned.fallback } : {}),
          ...(cleaned.transform ? { transform: cleaned.transform } : {}),
          retried: true
        }
      })
      this.lastText = text
      copyPrivate(text)
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : tm('err.retryFail') }
    }
  }

  private tipsFile(): string {
    return join(userDataDir(), 'tips.json')
  }

  private loadTips(): TipsState {
    const read = readJsonOrQuarantine(this.tipsFile())
    return parseTipsState(read.status === 'ok' ? read.value : null)
  }

  private saveTips(state: TipsState): void {
    try {
      writeJsonAtomic(this.tipsFile(), state)
    } catch (err) {
      console.warn('[tips] écriture impossible', err instanceof Error ? err.message : err)
    }
  }

  /**
   * Conseil dans la barre, juste après la dictée : un seul à la fois, limité par conseil et dans le temps.
   * Jamais pendant une dictée : il attend qu'elle soit finie.
   */
  tip(id: TipId, message: string): void {
    const state = this.loadTips()
    if (!canShowTip(state, id, Date.now())) return
    const started = Date.now()
    const show = (): void => {
      if (this.bar.isDestroyed()) return
      // Dictée en cours : on attend sa fin (30 s au plus), puis un court temps pour laisser lire le résultat.
      if (this.isActive()) {
        if (Date.now() - started < 30_000) setTimeout(show, 500)
        return
      }
      const now = Date.now()
      const fresh = this.loadTips()
      if (!canShowTip(fresh, id, now)) return
      this.saveTips(recordTip(fresh, id, now))
      this.barMessage({ phase: 'tip', level: 0, message })
      setTimeout(() => {
        if (!this.isActive()) this.barMessage({ phase: 'hidden', level: 0 })
      }, 6500)
    }
    setTimeout(show, 1500)
  }

  /** Après quelques messages dictés sans l'envoyer à la voix, on propose « appuie sur Entrée ». */
  private countForSendTip(app: string, title: string, sent: boolean): void {
    const style = appStyle(app, title)
    if (style !== 'chat' && style !== 'ai') return
    const next = countChatDictation(this.loadTips(), sent)
    this.saveTips(next)
    if (!sent && next.chatDictations >= SEND_TIP_AFTER) {
      this.tip('send-enter', tm('bar.tipSend'))
    }
  }

  /** État de la barre hors dictée (Lire, conseils). */
  showBarState(state: BarState): void {
    this.barMessage(state)
  }

  private barMessage(state: BarState): void {
    if (this.bar.isDestroyed()) return
    if (state.phase !== 'hidden') showBar(this.bar)
    this.bar.webContents.send(IPC.barState, state)
  }

  /** Message court dans la barre, hors dictée (ex. raccourci refusé par Windows). */
  notify(message: string): void {
    if (this.isActive() || this.bar.isDestroyed()) return
    showBar(this.bar)
    this.bar.webContents.send(IPC.barState, { phase: 'error', level: 0, message })
    setTimeout(() => {
      if (!this.isActive() && !this.bar.isDestroyed()) this.bar.webContents.send(IPC.barState, { phase: 'hidden', level: 0 })
    }, 5000)
  }

  private escapeBound = false

  /** Échap annule la dictée : la touche n'est prise à Windows que pendant une dictée, puis rendue. */
  private syncEscape(phase: BarState['phase']): void {
    const busy = phase === 'listening' || phase === 'processing'
    if (busy && !this.escapeBound) {
      this.escapeBound = globalShortcut.register('Escape', () => {
        this.machine.cancel()
      })
    } else if (!busy && this.escapeBound) {
      globalShortcut.unregister('Escape')
      this.escapeBound = false
    }
  }

  /** À appeler à la fermeture de l'app. */
  dispose(): void {
    this.editWatcher.stop()
    this.uia.dispose()
  }

  onMicReady(): void {
    this.machine.onMicReady()
  }

  onMicStopped(): void {
    this.machine.onMicStopped()
  }

  onMicError(message: string): void {
    this.machine.onMicError(message)
  }

  onAudioFrame(pcm: Buffer): void {
    this.machine.onAudioFrame(pcm)
  }

  onAudioLevel(level: number): void {
    this.machine.onAudioLevel(level)
  }

  isActive(): boolean {
    return this.machine.getPhase() !== 'idle'
  }

  /** Recolle la dernière dictée dans l'application active. */
  async pasteLast(): Promise<void> {
    const latest = getDb().listActivities('', 40).find((r) => r.kind === 'dictation')
    // Dernière dictée ratée (réseau) : Ctrl+Alt+V la refait depuis l'audio gardé, puis la colle.
    if (latest?.provenance?.failed && !this.isActive()) {
      this.barMessage({ phase: 'processing', level: 0, message: tm('bar.redo') })
      const result = await this.retry(latest.id)
      if (!result.ok) {
        this.notify(result.error)
        return
      }
      this.barMessage({ phase: 'hidden', level: 0 })
      await insertText(result.text)
      return
    }
    const text = this.lastText || latest?.finalText || ''
    if (!text) return
    await new Promise((r) => setTimeout(r, 150))
    await insertText(text)
  }

  /** Annule la dernière insertion (dictée ou transform) avec Ctrl+Z. */
  undoLast(): Promise<void> {
    return undoLastInsert()
  }

  /** Appelé quand une dictée démarre (coupe la lecture à voix haute : le micro l'entendrait). */
  onStart: (() => void) | null = null

  toggle(kind: 'dictation' | 'command' = 'dictation'): Promise<void> {
    if (!this.isActive()) this.onStart?.()
    return this.machine.toggle(kind)
  }

  idleRamMb(): number {
    return ramMb()
  }

  cpuIdle(): number {
    return Math.round(process.getCPUUsage().percentCPUUsage * 10) / 10
  }

  snapshot(): { ramMb: number; cpu: number; uptimeS: number } {
    return {
      ramMb: ramMb(),
      cpu: this.cpuIdle(),
      uptimeS: Math.round(process.uptime())
    }
  }
}

export function logIdleResources(tag: string): void {
  const mem = process.memoryUsage()
  console.log(
    `[perf] ${tag} rss=${(mem.rss / 1048576).toFixed(1)}MB heap=${(mem.heapUsed / 1048576).toFixed(1)}MB cpu=${process.getCPUUsage().percentCPUUsage.toFixed(1)}% uptime=${process.uptime().toFixed(0)}s electron=${process.versions.electron}`
  )
  void app.getAppMetrics?.()
}

/** Moteur choisi dans Réglages, ou Deepgram si sa clé manque. */
function sttEngineWithKey(engine: SttEngine): SttEngine {
  if ((engine === 'elevenlabs' || engine === 'elevenlabs_live') && !getElevenLabsKey()) return 'deepgram'
  if (engine === 'voxtral' && !getMistralKey()) return 'deepgram'
  return engine
}
