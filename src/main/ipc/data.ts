import { ipcMain } from 'electron'
import { openAiCompatConfig } from '../providers/openai-compat'
import { IPC } from '@shared/ipc'
import { getDb } from '../db'
import { AnthropicCleanupProvider } from '../providers/anthropic'
import {
  dictionaryTerms,
  learnFromCorrection,
  loadPersonalization,
  mergeLearned,
  savePersonalization
} from '../services/personalization'
import { computeInsights } from '../services/insights'
import { loadNotes, saveNotes } from '../services/notes'
import { pickProfileSamples } from '../services/voice-profile-core'
import { getAnthropicKey, getCerebrasKey, getDeepgramKey, getElevenLabsKey, getMistralKey, useMockStt } from '../secrets'
import { loadSettings } from '../services/settings'
import { invalidateHub, type MainContext } from '../context'
import { mainLang, tm } from '../lang'
import { formatHotkey } from '../../shared/i18n/index.ts'

/** Canaux de données du Hub : historique, statistiques, notes, personnalisation, corrections. */
export function registerDataIpc(ctx: MainContext): void {
  const { gate, hotkeys } = ctx

  ipcMain.handle(IPC.hubHistory, (event, query?: string) => {
    gate.assert(event, 'hub')
    return getDb().listActivities(typeof query === 'string' ? query : '')
  })
  ipcMain.handle(IPC.hubStatus, (event) => {
    gate.assert(event, 'hub')
    const current = loadSettings()
    const stats = getDb().stats()
    return {
      hotkey: current.hotkey,
      language: current.language,
      cerebras: Boolean(getCerebrasKey()),
      anthropic: Boolean(getAnthropicKey()),
      cleanupModel: openAiCompatConfig()?.model ?? (getAnthropicKey() ? 'Claude Haiku 5.5' : getCerebrasKey() ? 'Cerebras' : ''),
      deepgram: Boolean(getDeepgramKey()),
      mistral: Boolean(getMistralKey()),
      elevenlabs: Boolean(getElevenLabsKey()),
      mock: useMockStt(),
      count: stats.dictations,
      words: stats.words,
      stats
    }
  })
  ipcMain.handle(IPC.hubInsights, (event) => {
    gate.assert(event, 'hub')
    return computeInsights(getDb().dictationRows(), loadPersonalization().dictionary.length)
  })

  ipcMain.handle(IPC.hubNotes, (event) => {
    gate.assert(event, 'hub')
    return loadNotes()
  })
  ipcMain.handle(IPC.hubNotesSave, (event, notes: unknown) => {
    gate.assert(event, 'hub')
    try {
      saveNotes(notes)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })
  ipcMain.handle(IPC.hubTransformText, async (event, text: unknown, transformId: unknown) => {
    gate.assert(event, 'hub')
    const personal = loadPersonalization()
    const transform = personal.transforms.find((t) => t.id === transformId)
    if (typeof text !== 'string' || !text.trim() || !transform) return { ok: false as const, error: tm('err.nothingToTransform') }
    if (text.length > 20_000) return { ok: false as const, error: tm('err.textTooLong') }
    try {
      const out = await new AnthropicCleanupProvider().transform(
        text,
        transform.prompt,
        dictionaryTerms(personal),
        20000,
        personal.voiceProfileEnabled ? personal.voiceProfile : ''
      )
      return { ok: true as const, text: out }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Transformation impossible.' }
    }
  })

  ipcMain.handle(IPC.hubSuggestTerms, async (event) => {
    gate.assert(event, 'hub')
    const personal = loadPersonalization()
    const samples = getDb()
      .listActivities('', 80)
      .filter((a) => a.kind === 'dictation' && a.rawText.trim().length > 20)
      .slice(0, 40)
      .map((a) => ({ raw: a.rawText, final: a.finalText }))
    if (samples.length < 3) return { ok: false as const, error: tm('err.notEnoughSuggest') }
    try {
      const suggestions = await new AnthropicCleanupProvider().suggestTerms(samples, dictionaryTerms(personal), 30000)
      return { ok: true as const, suggestions, analyzed: samples.length }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Analyse impossible.' }
    }
  })
  ipcMain.handle(IPC.hubBuildVoiceProfile, async (event) => {
    gate.assert(event, 'hub')
    const samples = pickProfileSamples(
      getDb()
        .listActivities('', 120)
        .filter((a) => a.kind === 'dictation')
        .map((a) => ({ raw: a.rawText, final: a.finalText }))
    )
    if (samples.length < 8) return { ok: false as const, error: tm('err.notEnoughStyle') }
    try {
      const text = await new AnthropicCleanupProvider().buildVoiceProfile(samples, 30000)
      return { ok: true as const, text, analyzed: samples.length }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Analyse impossible.' }
    }
  })
  ipcMain.handle(IPC.hubCorrect, (event, id: unknown, text: unknown) => {
    gate.assert(event, 'hub')
    if (typeof id !== 'string' || typeof text !== 'string' || !text.trim()) return { ok: false, added: [] }
    const row = getDb().getActivity(id)
    if (!row) return { ok: false, added: [] }
    getDb().updateFinalText(id, text.trim())
    const { next, added } = mergeLearned(loadPersonalization(), learnFromCorrection(row.finalText, text.trim()))
    if (added.length > 0) savePersonalization(next)
    invalidateHub(ctx)
    return { ok: true, added }
  })

  ipcMain.handle(IPC.hubRetry, async (event, id: unknown) => {
    gate.assert(event, 'hub')
    if (typeof id !== 'string' || !id) return { ok: false as const, error: tm('err.notFound') }
    const result = await ctx.dictation.retry(id)
    invalidateHub(ctx)
    return result
  })

  ipcMain.handle(IPC.hubGetPersonalization, (event) => {
    gate.assert(event, 'hub')
    return loadPersonalization()
  })
  ipcMain.handle(IPC.hubSavePersonalization, (event, payload: unknown) => {
    gate.assert(event, 'hub')
    try {
      savePersonalization(payload)
      const refused = hotkeys.rebind()
      if (refused.length > 0) {
        return { ok: false as const, error: tm('err.hotkeyTaken', { list: refused.map((a) => formatHotkey(a, mainLang())).join(', '), page: tm('page.transforms') }) }
      }
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : tm('err.writeFile') }
    }
  })
}
