import type { ActivityRecord, BarState, DictationTimings } from '../../shared/types.ts'
import { splitSendCommand } from './send-command-core.ts'
import type { BarCommand } from '../../shared/ipc.ts'
import type { LiveSttSession } from '../providers/stt.ts'
import type { CleanupInput, CleanupResult } from '../providers/text.ts'
import { joinWithContext, matchCaseToContext, type TextContext } from './context-core.ts'
import type { CommandOutcome } from './command-core.ts'
import { tm } from '../lang.ts'

export type DictationKind = 'dictation' | 'command'

/** Ce que l'écran disait autour du curseur au début de la dictée, plus de quoi vérifier le collage. */
export type ContextCapture = {
  context: TextContext
  token?: unknown
  /** Mots rares lus à l'écran, donnés à Deepgram pour mieux les reconnaître. */
  screenTerms?: string[]
  /** Champ mot de passe : la dictée n'est ni envoyée au modèle, ni gardée dans l'historique. */
  sensitive?: boolean
}
export type InsertVerdict = 'confirmed' | 'not-found' | 'unknown'

export type DictationPhase = 'idle' | 'starting' | 'listening' | 'stopping' | 'finalizing'

export type DictationTarget = {
  hwnd?: unknown
  hwndFocus?: unknown
  processName: string
  title: string
}

export type DictationHost = {
  openStt: (
    language: 'fr' | 'en' | 'multi',
    signal?: AbortSignal,
    context?: Promise<ContextCapture | null> | null
  ) => Promise<LiveSttSession>
  cleanup: (input: CleanupInput, timeoutMs: number) => Promise<CleanupResult>
  insert: (text: string, target: DictationTarget | null) => Promise<'pasted' | 'copied' | void>
  isBlocked?: (target: DictationTarget | null) => boolean
  sendState: (state: BarState, scope: 'bar' | 'all') => void
  sendCommand: (command: BarCommand) => void
  language: () => 'fr' | 'en' | 'multi'
  captureTarget: () => DictationTarget | null
  /** Lit le texte autour du curseur (UI Automation). Ne doit jamais lever ni bloquer la dictée. */
  captureContext?: () => Promise<ContextCapture | null>
  /** Mode commande : applique la consigne dictée au texte sélectionné (ou écrit au curseur). */
  command?: (input: {
    instruction: string
    app: string
    windowTitle: string
    context: TextContext | null
  }) => Promise<CommandOutcome>
  /** Dictée avec du texte sélectionné : est-ce une consigne à lui appliquer ? Doit répondre vite. */
  route?: (spoken: string, selected: string) => Promise<'command' | 'dictation'>
  /** Relit le champ après le collage pour vérifier que le texte est arrivé. */
  verifyInsert?: (text: string, capture: ContextCapture | null) => Promise<InsertVerdict>
  /** Appelé après un collage réussi (apprentissage des corrections). */
  afterInsert?: (info: { id: string; text: string; capture: ContextCapture | null; target: DictationTarget | null }) => void
  persist: (record: ActivityRecord) => void
  /** Touche Entrée après le collage (« appuie sur Entrée » dit en fin de dictée). */
  pressEnter?: () => void
  /** Délai avant le message « ça prend du temps » dans la barre (4 s par défaut). */
  slowNoticeMs?: number
  /** Garde l'audio d'une dictée (WAV local) pour pouvoir la réessayer. */
  saveAudio?: (id: string, chunks: Buffer[]) => void
  /** Ouvre à l'avance la connexion au modèle de nettoyage, pendant la fin de transcription. */
  warmUp?: () => void
  showBar: () => void
  hideBar: () => void
  now: () => number
  readyTimeoutMs: number
  stoppedTimeoutMs: number
  prebufferMaxBytes: number
}

type MicAck = 'ready' | 'stopped'

/** Une dictée oubliée en mains libres s'arrête seule (et colle ce qui a été dit). */
export const MAX_DICTATION_MS = 20 * 60 * 1000
const MAX_RECORDING_BYTES = (MAX_DICTATION_MS / 1000 + 5) * 16000 * 2
/** En dessous d'une demi-seconde d'audio, il n'y a rien à réessayer. */
const MIN_RETRY_BYTES = 16000

function isRetryable(err: unknown): boolean {
  return Boolean((err as { retryable?: boolean } | null)?.retryable)
}

/** Délai du nettoyage : plus la dictée est longue, plus Haiku a besoin de temps pour réécrire. */
export function cleanupTimeoutMs(rawLength: number): number {
  return Math.min(20000, 4000 + rawLength * 8)
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

export class PcmPrebuffer {
  private chunks: Buffer[] = []
  private bytes = 0
  private readonly maxBytes: number

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes
  }

  push(pcm: Buffer): void {
    this.chunks.push(pcm)
    this.bytes += pcm.length
    while (this.bytes > this.maxBytes && this.chunks.length) {
      const dropped = this.chunks.shift()
      this.bytes -= dropped?.length ?? 0
    }
  }

  flush(): Buffer[] {
    const out = this.chunks
    this.chunks = []
    this.bytes = 0
    return out
  }

  clear(): void {
    this.chunks = []
    this.bytes = 0
  }
}

export class DictationMachine {
  private phase: DictationPhase = 'idle'
  private generation = 0
  private hideGeneration = 0
  private stt: LiveSttSession | null = null
  private target: DictationTarget | null = null
  private contextPromise: Promise<ContextCapture | null> | null = null
  private kind: DictationKind = 'dictation'
  private pendingKind: DictationKind = 'dictation'
  private timings: DictationTimings = { hotkeyStartMs: 0 }
  private sessionId = ''
  private captureReady = false
  /** Plus fort niveau micro de la dictée : 0 = micro muet (aucun échantillon non nul). */
  private peakLevel = 0
  /** Échap pendant le traitement : rien ne sera collé. */
  private cancelled = false
  /** Audio de la dictée en cours, gardé pour « Réessayer ». */
  private recording: Buffer[] = []
  private recordingBytes = 0
  /** Deepgram injoignable : la dictée continue hors ligne, l'audio est gardé pour plus tard. */
  private offlineReason: string | null = null
  private opening: Promise<LiveSttSession> | null = null
  /** Ouverture Deepgram encore en cours quand la personne a relâché : stop() la récupère au lieu de la jeter. */
  private lateOpen: Promise<LiveSttSession> | null = null
  private abortOpen: AbortController | null = null
  private readonly prebuffer: PcmPrebuffer
  private readonly host: DictationHost
  private acks: Partial<Record<MicAck, { resolve: () => void; reject: (err: Error) => void }>> = {}

  constructor(host: DictationHost) {
    this.host = host
    this.prebuffer = new PcmPrebuffer(host.prebufferMaxBytes)
  }

  getPhase(): DictationPhase {
    return this.phase
  }

  getGeneration(): number {
    return this.generation
  }

  private failAck(kind: MicAck, err: Error): void {
    const pending = this.acks[kind]
    if (!pending) return
    delete this.acks[kind]
    pending.reject(err)
  }

  private abortReadyWait(): void {
    const pending = this.acks.ready
    if (!pending) return
    delete this.acks.ready
    pending.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  }

  private waitAck(kind: MicAck, timeoutMs: number, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // N'efface que sa propre attente : celle d'une dictée suivante doit survivre.
        if (this.acks[kind] === entry) delete this.acks[kind]
        reject(new Error(label))
      }, timeoutMs)
      const entry = {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (err: Error) => {
          clearTimeout(timer)
          reject(err)
        }
      }
      this.acks[kind] = entry
    })
  }

  onMicReady(): void {
    const pending = this.acks.ready
    if (!pending) return
    delete this.acks.ready
    pending.resolve()
  }

  onMicStopped(): void {
    const pending = this.acks.stopped
    if (!pending) return
    delete this.acks.stopped
    pending.resolve()
  }

  onMicError(message: string): void {
    const err = new Error(message || tm('mic.error'))
    this.abortHandshake()
    this.failAck('ready', err)
    this.failAck('stopped', err)
    if (this.phase === 'starting' || this.phase === 'listening') {
      this.generation += 1
      this.closeStt()
      this.prebuffer.clear()
      this.captureReady = false
      this.phase = 'idle'
      this.host.sendState({ phase: 'error', level: 0, message: err.message }, 'all')
      this.scheduleHide(2200)
    }
  }

  onAudioFrame(pcm: Buffer): void {
    if ((this.phase === 'starting' || this.phase === 'listening' || this.phase === 'stopping') && this.recordingBytes < MAX_RECORDING_BYTES) {
      this.recording.push(pcm)
      this.recordingBytes += pcm.length
    }
    if (this.phase === 'starting' || (this.phase === 'stopping' && !this.stt)) {
      this.prebuffer.push(pcm)
      return
    }
    if ((this.phase === 'listening' || this.phase === 'stopping') && this.stt) {
      this.stt.send(pcm)
    }
  }

  onAudioLevel(level: number): void {
    if (this.phase === 'starting' || this.phase === 'listening') this.peakLevel = Math.max(this.peakLevel, level)
    if (!this.captureReady) return
    if (this.phase !== 'starting' && this.phase !== 'listening') return
    this.host.sendState({ phase: 'listening', level }, 'bar')
  }

  async toggle(kind: DictationKind = 'dictation'): Promise<void> {
    if (this.phase === 'stopping' || this.phase === 'finalizing') return
    if (this.phase === 'idle') {
      this.pendingKind = kind
      await this.start()
    } else await this.stop()
  }

  /** Échap : abandonne la dictée en cours. Rien n'est collé. Renvoie false s'il n'y avait rien à annuler. */
  cancel(): boolean {
    if (this.phase === 'idle') return false
    if (this.phase === 'stopping' || this.phase === 'finalizing') {
      this.cancelled = true
      return true
    }
    this.generation += 1
    this.abortHandshake()
    this.abortReadyWait()
    this.closeStt()
    this.prebuffer.clear()
    this.captureReady = false
    this.host.sendCommand('stop-mic')
    void this.waitAck('stopped', 1500, 'Micro : arrêt après annulation').catch(() => undefined)
    this.phase = 'idle'
    this.showCancelled()
    return true
  }

  private showCancelled(): void {
    this.host.sendState({ phase: 'error', level: 0, message: tm('bar.cancelled') }, 'all')
    this.scheduleHide(1200)
  }

  private closeStt(): void {
    this.stt?.close()
    this.stt = null
  }

  private abortHandshake(): void {
    this.abortOpen?.abort()
    this.abortOpen = null
  }

  private watchOpen(gen: number, openP: Promise<LiveSttSession>): void {
    void openP.then(
      (session) => {
        if (this.opening === openP) this.opening = null
        if (this.lateOpen === openP) return
        this.adoptOrClose(gen, session)
      },
      (err) => {
        if (this.opening === openP) this.opening = null
        if (this.generation !== gen) return
        if (this.phase !== 'starting') return
        const error = err instanceof Error ? err : new Error(String(err))
        // Panne passagère : on continue d'écouter hors ligne (start() s'en charge quand le micro est prêt).
        if (isRetryable(err)) {
          this.offlineReason = error.message
          return
        }
        this.failAck('ready', error)
      }
    )
  }

  private adoptOrClose(gen: number, session: LiveSttSession): void {
    if (this.stt === session) {
      if (this.generation === gen && this.phase === 'starting') this.phase = 'listening'
      return
    }
    if (this.generation === gen && (this.phase === 'starting' || this.phase === 'listening')) {
      this.stt = session
      this.timings.sttOpenMs = this.host.now()
      for (const chunk of this.prebuffer.flush()) session.send(chunk)
      this.phase = 'listening'
      return
    }
    if (this.stt !== session) session.close()
  }

  private async start(): Promise<void> {
    const gen = ++this.generation
    this.hideGeneration += 1
    this.sessionId = `${this.host.now()}-${gen}`
    this.timings = { hotkeyStartMs: this.host.now() }
    this.target = this.host.captureTarget()
    if (this.host.isBlocked?.(this.target)) {
      this.host.sendState(
        { phase: 'error', level: 0, message: tm('bar.blockedIn', { app: this.target?.processName || tm('bar.thisApp') }) },
        'all'
      )
      this.scheduleHide(2200)
      return
    }
    this.kind = this.pendingKind
    this.peakLevel = 0
    this.cancelled = false
    this.recording = []
    this.recordingBytes = 0
    this.offlineReason = null
    this.contextPromise = this.host.captureContext ? this.host.captureContext().catch(() => null) : null
    this.phase = 'starting'
    this.captureReady = false
    this.prebuffer.clear()
    this.abortHandshake()
    const ac = new AbortController()
    this.abortOpen = ac

    this.host.showBar()
    this.timings.barShownMs = this.host.now()
    this.host.sendState({ phase: 'processing', level: 0 }, 'all')
    this.host.sendCommand('start-mic')

    const openP = this.host.openStt(this.host.language(), ac.signal, this.contextPromise)
    this.opening = openP
    this.watchOpen(gen, openP)

    try {
      await this.waitAck('ready', this.host.readyTimeoutMs, tm('prov.mic.noReady'))
      if (this.generation !== gen) return
      this.captureReady = true
      this.host.sendState({ phase: 'listening', level: 0 }, 'all')
      const limit = setTimeout(() => {
        if (this.generation === gen && (this.phase === 'listening' || this.phase === 'starting')) void this.stop()
      }, MAX_DICTATION_MS)
      limit.unref?.()

      let session: LiveSttSession
      try {
        session = await openP
      } catch (err) {
        if (!isRetryable(err) || this.generation !== gen) throw err
        // Hors ligne : la personne continue de parler, l'audio est gardé et se réessaiera depuis l'historique.
        this.offlineReason = err instanceof Error ? err.message : String(err)
        this.prebuffer.clear()
        if (this.phase === 'starting') this.phase = 'listening'
        return
      }
      this.adoptOrClose(gen, session)
    } catch (err) {
      if (this.generation !== gen) return
      this.abortHandshake()
      this.closeStt()
      this.prebuffer.clear()
      this.captureReady = false
      this.host.sendCommand('stop-mic')
      void this.waitAck('stopped', 1500, 'Micro : arrêt après échec').catch(() => undefined)
      this.phase = 'idle'
      const message = err instanceof Error ? err.message : String(err)
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      this.scheduleHide(2200)
    }
  }

  private async stop(): Promise<void> {
    if (this.phase !== 'listening' && this.phase !== 'starting') return
    // Relâché avant que Deepgram soit prêt : on garde l'ouverture en cours (et l'audio en tampon).
    this.lateOpen = this.phase === 'starting' && !this.stt ? this.opening : null
    if (this.phase === 'starting' && !this.lateOpen) this.abortHandshake()
    try {
      await this.finish()
    } catch (err) {
      // Aucune erreur ne doit laisser la dictée coincée : la barre le dit, et on revient au repos.
      console.warn('[dictation] fin de dictée en erreur', err instanceof Error ? err.message : err)
      this.closeStt()
      this.prebuffer.clear()
      this.host.sendState({ phase: 'error', level: 0, message: tm('bar.error') }, 'all')
      this.phase = 'idle'
      this.scheduleHide(2200)
    } finally {
      this.lateOpen = null
      if (this.phase !== 'idle') this.phase = 'idle'
    }
  }

  /** Attend au plus `maxMs` une ouverture Deepgram commencée avant le relâchement. */
  private async adoptLateOpen(maxMs: number): Promise<void> {
    const pending = this.lateOpen
    if (!pending || this.stt) return
    let timer: NodeJS.Timeout | undefined
    const session = await Promise.race([
      pending.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), maxMs)
      })
    ])
    clearTimeout(timer)
    this.lateOpen = null
    if (session) {
      this.stt = session
      this.timings.sttOpenMs = this.host.now()
      return
    }
    this.abortHandshake()
    void pending.then((late) => late.close(), () => undefined)
  }

  private async finish(): Promise<void> {
    this.host.warmUp?.()
    this.generation += 1
    this.phase = 'stopping'
    this.captureReady = false
    this.abortReadyWait()
    this.timings.stopMs = this.host.now()
    this.host.sendCommand('stop-mic')
    this.host.sendState({ phase: 'processing', level: 0 }, 'all')
    this.watchSlow()

    try {
      await this.waitAck('stopped', this.host.stoppedTimeoutMs, tm('prov.mic.noStop'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.closeStt()
      this.prebuffer.clear()
      this.phase = 'idle'
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      this.scheduleHide(2200)
      return
    }

    this.phase = 'finalizing'
    await this.adoptLateOpen(2500)
    for (const chunk of this.prebuffer.flush()) this.stt?.send(chunk)
    let raw = ''
    const stt = this.stt
    this.stt = null
    try {
      raw = (await stt?.finalize())?.trim() ?? ''
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (this.canKeepFailed()) {
        stt?.close()
        await this.persistFailed(message)
        return
      }
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      stt?.close()
      this.phase = 'idle'
      this.scheduleHide(2200)
      return
    }
    stt?.close()
    this.timings.sttFinalMs = this.host.now()
    const connectionLost = stt?.lost?.() ?? false

    if (this.cancelled) {
      this.showCancelled()
      return
    }
    if (!raw && (this.offlineReason || connectionLost) && this.peakLevel >= 1e-5 && this.canKeepFailed()) {
      await this.persistFailed(this.offlineReason ?? tm('bar.dgLostShort'))
      return
    }
    if (!raw) {
      const message =
        this.peakLevel < 1e-5
          ? tm('bar.mute')
          : connectionLost
            ? tm('bar.dgLost')
            : tm('bar.nothing')
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      this.phase = 'idle'
      this.scheduleHide(1400)
      return
    }

    const t0 = this.host.now()
    const capture = await this.takeContext()
    const trace: NonNullable<ActivityRecord['provenance']>['trace'] = [
      {
        stage: 'context',
        ms: this.host.now() - t0,
        note: capture ? (capture.screenTerms?.length ? `lu, ${capture.screenTerms.length} mots d’écran` : 'lu') : 'aucun'
      }
    ]
    if (capture?.sensitive) {
      await this.insertSensitive(raw)
      return
    }
    let asCommand = this.kind === 'command'
    const selected = capture?.context.selected.trim() ?? ''
    if (!asCommand && selected && raw.length <= 400 && this.host.route) {
      const t1 = this.host.now()
      asCommand = (await this.host.route(raw, selected)) === 'command'
      trace.push({ stage: 'route', ms: this.host.now() - t1, note: asCommand ? 'commande' : 'dictée' })
    }
    if (asCommand && this.host.command) {
      await this.runCommand(raw, capture, trace)
      return
    }
    // « … appuie sur Entrée » : la consigne n'est pas écrite, Entrée part après le collage.
    const send = splitSendCommand(raw)
    const cleaned = await this.host.cleanup(
      {
        rawText: send.text,
        app: this.target?.processName ?? '',
        windowTitle: this.target?.title ?? '',
        language: this.host.language(),
        ...(capture ? { context: capture.context } : {}),
        ...(capture?.screenTerms?.length ? { screenTerms: capture.screenTerms } : {})
      },
      cleanupTimeoutMs(raw.length)
    )
    this.timings.cleanupMs = this.host.now()
    const finalText = joinWithContext(
      matchCaseToContext(cleaned.text || send.text, capture?.context.before),
      capture?.context ?? null
    )

    if (this.cancelled) {
      this.showCancelled()
      return
    }
    let inserted: 'pasted' | 'copied' = 'pasted'
    try {
      this.host.hideBar()
      inserted = (await this.host.insert(finalText, this.target)) ?? 'pasted'
      this.timings.insertedMs = this.host.now()
      if (send.send && inserted === 'pasted') this.host.pressEnter?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      this.phase = 'idle'
      this.scheduleHide(2200)
      return
    }

    const record: ActivityRecord = {
      kind: 'dictation',
      id: this.sessionId,
      rawText: raw,
      finalText,
      createdAt: new Date().toISOString(),
      durationMs: (this.timings.stopMs ?? 0) - (this.timings.sttOpenMs ?? this.timings.hotkeyStartMs),
      words: wordCount(finalText),
      app: this.target?.processName ?? '',
      windowTitle: this.target?.title ?? '',
      source: 'v2',
      provenance: {
        steps: cleaned.usedModel ? [stt?.provider ?? 'deepgram', cleaned.provider ?? 'cerebras'] : [stt?.provider ?? 'deepgram'],
        sttProvider: stt?.provider ?? 'deepgram',
        sttModel: stt?.model ?? 'nova-3',
        sttLatencyMs: (this.timings.sttFinalMs ?? 0) - (this.timings.stopMs ?? 0),
        cleanupLatencyMs: cleaned.usedModel ? cleaned.latencyMs : null,
        ...(cleaned.fallback ? { cleanupFallback: cleaned.fallback } : {}),
        ...(cleaned.rejected ? { cleanupRejected: cleaned.rejected } : {}),
        ...(cleaned.transform ? { transform: cleaned.transform } : {}),
        ...(send.send ? { sent: true } : {}),
        trace: [
          ...(trace ?? []),
          {
            stage: 'format',
            ms: cleaned.latencyMs,
            ...(cleaned.provider ? { model: cleaned.provider } : {}),
            ...(cleaned.fallback ? { note: cleaned.fallback } : {})
          }
        ]
      },
      timings: this.timings
    }
    this.host.persist(record)
    this.keepAudio(record.id)
    this.phase = 'idle'
    if (inserted === 'pasted') {
      this.host.afterInsert?.({ id: record.id, text: finalText, capture, target: this.target })
      void this.checkPaste(finalText, capture)
    }
    if (inserted === 'copied') {
      this.host.sendState({ phase: 'error', level: 0, message: tm('bar.copiedPaste') }, 'all')
      this.scheduleHide(3000)
      return
    }
    if (connectionLost) {
      this.host.sendState({ phase: 'error', level: 0, message: tm('bar.lost') }, 'all')
      this.scheduleHide(3500)
      return
    }
    if (!cleaned.usedModel && cleaned.fallback) {
      // Le texte est collé, mais pas nettoyé : la personne doit le savoir.
      this.host.sendState({ phase: 'error', level: 0, message: tm('bar.rawPasted', { reason: cleaned.fallback }) }, 'all')
      this.scheduleHide(3200)
      return
    }
    this.host.sendState({ phase: 'done', level: 0 }, 'all')
    this.scheduleHide(420)
  }

  /** Après 4 s de traitement, la barre dit que ça prend du temps (le spinner seul fait croire à un blocage). */
  private watchSlow(): void {
    const id = this.sessionId
    setTimeout(() => {
      if (this.sessionId !== id || this.cancelled) return
      if (this.phase !== 'stopping' && this.phase !== 'finalizing') return
      this.host.sendState({ phase: 'processing', level: 0, message: tm('bar.slow') }, 'all')
    }, this.host.slowNoticeMs ?? 4000).unref?.()
  }

  /** Garde l'audio de la dictée (si le réglage le permet), puis libère la mémoire. */
  private keepAudio(id: string): void {
    const chunks = this.recording
    this.recording = []
    this.recordingBytes = 0
    if (!this.host.saveAudio || chunks.reduce((n, c) => n + c.length, 0) < MIN_RETRY_BYTES) return
    try {
      this.host.saveAudio(id, chunks)
    } catch (err) {
      console.warn('[dictation] audio non gardé', err instanceof Error ? err.message : err)
    }
  }

  /** Une dictée (pas une commande) avec assez de son pour être refaite plus tard. */
  private canKeepFailed(): boolean {
    return this.kind === 'dictation' && !this.cancelled && this.recordingBytes >= MIN_RETRY_BYTES
  }

  /** La dictée n'a pas abouti : rien n'est collé, mais elle reste dans l'historique avec son audio, à réessayer. */
  private async persistFailed(reason: string): Promise<void> {
    const id = this.sessionId
    // Champ mot de passe : ni historique ni audio.
    if ((await this.takeContext())?.sensitive) {
      this.recording = []
      this.recordingBytes = 0
      this.phase = 'idle'
      this.host.sendState({ phase: 'error', level: 0, message: reason }, 'all')
      this.scheduleHide(2200)
      return
    }
    this.host.persist({
      kind: 'dictation',
      id,
      rawText: '',
      finalText: '',
      createdAt: new Date().toISOString(),
      durationMs: (this.timings.stopMs ?? 0) - (this.timings.sttOpenMs ?? this.timings.hotkeyStartMs),
      words: 0,
      app: this.target?.processName ?? '',
      windowTitle: this.target?.title ?? '',
      source: 'v2',
      provenance: { steps: [this.stt?.provider ?? 'deepgram'], failed: reason.slice(0, 160) },
      timings: this.timings
    })
    const kept = Boolean(this.host.saveAudio)
    this.keepAudio(id)
    this.phase = 'idle'
    this.host.sendState(
      { phase: 'error', level: 0, message: kept ? tm('bar.keptRetry', { reason }) : reason },
      'all'
    )
    this.scheduleHide(4500)
  }

  /** Champ mot de passe : texte brut collé tel quel, rien envoyé au modèle, rien gardé. */
  private async insertSensitive(raw: string): Promise<void> {
    if (this.cancelled) {
      this.showCancelled()
      return
    }
    const inserted = (await this.host.insert(raw, this.target)) ?? 'pasted'
    this.phase = 'idle'
    if (inserted === 'copied') {
      this.host.sendState({ phase: 'error', level: 0, message: tm('bar.copiedPaste') }, 'all')
      this.scheduleHide(3000)
      return
    }
    this.host.sendState({ phase: 'done', level: 0 }, 'all')
    this.scheduleHide(420)
  }

  /** Mode commande : la dictée est une consigne. Le résultat remplace la sélection, ou s'écrit au curseur. */
  private async runCommand(
    raw: string,
    capture: ContextCapture | null,
    trace: NonNullable<ActivityRecord['provenance']>['trace']
  ): Promise<void> {
    const startedAt = this.host.now()
    let outcome: CommandOutcome
    try {
      outcome = await this.host.command!({
        instruction: raw,
        app: this.target?.processName ?? '',
        windowTitle: this.target?.title ?? '',
        context: capture?.context ?? null
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Commande impossible.'
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      this.phase = 'idle'
      this.scheduleHide(2800)
      return
    }
    this.timings.cleanupMs = this.host.now()
    if (outcome.status !== 'ok') {
      const message = outcome.status === 'unsupported' ? outcome.message : 'Rien produit, reformule.'
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      this.phase = 'idle'
      this.scheduleHide(3500)
      return
    }
    const finalText = joinWithContext(outcome.text, capture?.context ?? null)
    if (this.cancelled) {
      this.showCancelled()
      return
    }
    let inserted: 'pasted' | 'copied' = 'pasted'
    try {
      inserted = (await this.host.insert(finalText, this.target)) ?? 'pasted'
      this.timings.insertedMs = this.host.now()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.host.sendState({ phase: 'error', level: 0, message }, 'all')
      this.phase = 'idle'
      this.scheduleHide(2200)
      return
    }
    this.host.persist({
      kind: 'dictation',
      id: this.sessionId,
      rawText: raw,
      finalText,
      createdAt: new Date().toISOString(),
      durationMs: (this.timings.stopMs ?? 0) - (this.timings.sttOpenMs ?? this.timings.hotkeyStartMs),
      words: wordCount(finalText),
      app: this.target?.processName ?? '',
      windowTitle: this.target?.title ?? '',
      source: 'v2',
      provenance: {
        steps: [this.stt?.provider ?? 'deepgram', 'anthropic', 'command'],
        sttProvider: this.stt?.provider ?? 'deepgram',
        sttModel: this.stt?.model ?? 'nova-3',
        sttLatencyMs: (this.timings.sttFinalMs ?? 0) - (this.timings.stopMs ?? 0),
        cleanupLatencyMs: (this.timings.cleanupMs ?? 0) - (this.timings.sttFinalMs ?? 0),
        trace: [...(trace ?? []), { stage: 'command', ms: this.host.now() - startedAt, model: 'anthropic' }]
      },
      timings: this.timings
    })
    this.phase = 'idle'
    if (inserted === 'copied') {
      this.host.sendState({ phase: 'error', level: 0, message: tm('bar.copiedPaste') }, 'all')
      this.scheduleHide(3000)
      return
    }
    this.host.sendState({ phase: 'done', level: 0 }, 'all')
    this.scheduleHide(420)
  }

  /** Le contexte est lu pendant que la personne parle : il est prêt à la fin. On n'attend jamais longtemps. */
  private async takeContext(): Promise<ContextCapture | null> {
    const pending = this.contextPromise
    this.contextPromise = null
    if (!pending) return null
    return Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 300))])
  }

  private async checkPaste(text: string, capture: ContextCapture | null): Promise<void> {
    if (!this.host.verifyInsert) return
    try {
      const verdict = await this.host.verifyInsert(text, capture)
      if (verdict === 'not-found' && this.phase === 'idle') {
        this.host.sendState({ phase: 'error', level: 0, message: tm('bar.pasteUnconfirmed') }, 'all')
        this.scheduleHide(3500)
      }
    } catch {
      /* la vérification ne doit jamais gêner */
    }
  }

  private scheduleHide(ms: number): void {
    const token = ++this.hideGeneration
    setTimeout(() => {
      if (token !== this.hideGeneration) return
      if (this.phase !== 'idle') return
      this.host.sendState({ phase: 'hidden', level: 0 }, 'all')
      this.host.hideBar()
    }, ms)
  }
}
