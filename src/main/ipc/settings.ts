import { ipcMain } from 'electron'
import { IPC, type HubSettingsSave } from '@shared/ipc'
import { DEFAULT_SETTINGS, parseMicAndLevel, parseSttEngine, parseUiLanguage, parseCleanupModel, type AppSettings, type RecordingMode } from '@shared/types'
import { applyHotkeyChange } from '@shared/hotkey'
import { parseVoiceRef } from '@shared/voice'
import {
  applySecretOps,
  getCerebrasKey,
  getDeepgramKey,
  getElevenLabsKey,
  getMistralKey,
  loadStoredSecrets,
  parseSecretWrite,
  publicSecrets,
  saveStoredSecrets
} from '../secrets'
import { loadSettings, saveSettings } from '../services/settings'
import { invalidateHub, type MainContext } from '../context'
import { applyUiLanguage } from '../ui-language'
import { reloadOpenWindows } from '../windows'
import { openAiCompatKey } from '../providers/openai-compat'
import { mainLang, tm } from '../lang'
import { formatHotkey } from '../../shared/i18n/index.ts'

const MODES = new Set<RecordingMode>(['toggle', 'push_to_talk'])
const LANGS = new Set<AppSettings['language']>(['multi', 'fr', 'en'])

function parseSettings(raw: unknown): AppSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<AppSettings>
  const hotkey = typeof value.hotkey === 'string' ? value.hotkey.trim() : ''
  if (!hotkey || hotkey.length > 80) return null
  if (!MODES.has(value.mode as RecordingMode)) return null
  if (!LANGS.has(value.language as AppSettings['language'])) return null
  return {
    hotkey,
    mode: value.mode as RecordingMode,
    language: value.language as AppSettings['language'],
    lireVoice: parseVoiceRef(value.lireVoice, DEFAULT_SETTINGS.lireVoice),
    assistantVoice: parseVoiceRef(value.assistantVoice, DEFAULT_SETTINGS.assistantVoice),
    keepAudio: value.keepAudio !== false,
    ...parseMicAndLevel(value),
    sttEngine: parseSttEngine(value.sttEngine),
    uiLanguage: parseUiLanguage(value.uiLanguage),
    ...parseCleanupModel(value)
  }
}

/** Réglages et état des clés ; la clé du modèle compatible OpenAI compte aussi la variable du fournisseur (DEEPSEEK_API_KEY…). */
function settingsWithModelKey() {
  const settings = loadSettings()
  const secrets = publicSecrets()
  if (!secrets.openai.configured && openAiCompatKey(settings.openaiBaseUrl)) secrets.openai = { configured: true, source: 'env' }
  return { settings, ...secrets }
}

/** Réglages, clés API et capture d'un nouveau raccourci. */
export function registerSettingsIpc(ctx: MainContext): void {
  const { gate, hotkeys, tray } = ctx

  ipcMain.handle(IPC.hubGetSettings, (event) => {
    gate.assert(event, 'hub')
    return {
      ...settingsWithModelKey()
    }
  })
  ipcMain.handle(IPC.hubSaveSettings, (event, payload: HubSettingsSave) => {
    gate.assert(event, 'hub')
    try {
      const next = parseSettings(payload?.settings)
      if (!next) return { ok: false as const, error: tm('err.settingsInvalid') }
      const previous = loadSettings()
      const storedKeep = loadStoredSecrets()
      // Clés d'abord : si secrets.json était illisible, la sauvegarde refuse (erreur lisible) sans toucher aux réglages.
      saveStoredSecrets(
        applySecretOps(storedKeep, {
          deepgram: parseSecretWrite(payload?.deepgram),
          cerebras: parseSecretWrite(payload?.cerebras),
          mistral: parseSecretWrite(payload?.mistral),
          elevenlabs: parseSecretWrite(payload?.elevenlabs),
          anthropic: parseSecretWrite(payload?.anthropic),
          openai: parseSecretWrite(payload?.openai)
        })
      )
      saveSettings(next)
      if (next.uiLanguage !== previous.uiLanguage) {
        // Nouvelle langue : les fenêtres ouvertes se rechargent (après la réponse, sinon le Hub s'interrompt avant de la lire),
        // et le menu de la zone de notification est repeint plus bas avec le bon texte.
        applyUiLanguage(next.uiLanguage)
        setTimeout(reloadOpenWindows, 200)
      }
      if (next.hotkey !== previous.hotkey) {
        const rebound = applyHotkeyChange(previous.hotkey, next.hotkey, hotkeys.bind)
        if (!rebound.ok) {
          saveSettings({ ...next, hotkey: previous.hotkey })
          tray.paint(previous.hotkey)
          invalidateHub(ctx)
          return { ok: false as const, error: tm('err.hotkeyRefused', { hotkey: formatHotkey(next.hotkey, mainLang()) }) }
        }
      }
      if (previous.keepAudio && !next.keepAudio) ctx.dictation.forgetAudio()
      tray.paint(next.hotkey)
      invalidateHub(ctx)
      console.log(`[settings] ${next.hotkey} ${next.language} ${next.mode} dg=${Boolean(getDeepgramKey())} cb=${Boolean(getCerebrasKey())} mi=${Boolean(getMistralKey())} el=${Boolean(getElevenLabsKey())}`)
      return { ok: true as const }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : tm('err.writeFiles')
      }
    }
  })

  ipcMain.handle(IPC.hubHotkeyBegin, (event) => {
    gate.assert(event, 'hub')
    hotkeys.beginCapture()
  })
  ipcMain.handle(IPC.hubHotkeyCancel, (event) => {
    gate.assert(event, 'hub')
    hotkeys.cancelCapture()
  })
}
