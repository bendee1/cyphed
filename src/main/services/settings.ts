import { DEFAULT_SETTINGS, parseMicAndLevel, parseSttEngine, parseUiLanguage, parseCleanupModel, parseOutputLanguage, parseReadSpeed, parseHistoryDays, type AppSettings } from '@shared/types'
import { parseVoiceRef } from '@shared/voice'
import { join } from 'node:path'
import { userDataDir } from '../paths'
import { readJsonOrQuarantine, writeJsonAtomic } from './json-file'

const FILE = () => join(userDataDir(), 'settings.json')

export function loadSettings(): AppSettings {
  const read = readJsonOrQuarantine(FILE())
  if (read.status === 'missing') return { ...DEFAULT_SETTINGS }
  if (read.status === 'corrupt') {
    console.warn(`[settings] settings.json illisible${read.quarantinedTo ? `, renommé en ${read.quarantinedTo}` : ''} : réglages par défaut`)
    return { ...DEFAULT_SETTINGS }
  }
  if (!read.value || typeof read.value !== 'object') return { ...DEFAULT_SETTINGS }
  const parsed = read.value as Partial<AppSettings>
  const mode = parsed.mode === 'push_to_talk' ? 'push_to_talk' : DEFAULT_SETTINGS.mode
  const language =
    parsed.language === 'fr' || parsed.language === 'en' || parsed.language === 'multi'
      ? parsed.language
      : DEFAULT_SETTINGS.language
  const hotkey = typeof parsed.hotkey === 'string' && parsed.hotkey.trim() ? parsed.hotkey.trim() : DEFAULT_SETTINGS.hotkey
  return {
    hotkey,
    mode,
    language,
    lireVoice: parseVoiceRef(parsed.lireVoice, DEFAULT_SETTINGS.lireVoice),
    assistantVoice: parseVoiceRef(parsed.assistantVoice, DEFAULT_SETTINGS.assistantVoice),
    keepAudio: parsed.keepAudio !== false,
    openAtLogin: parsed.openAtLogin === true,
    readSpeed: parseReadSpeed(parsed.readSpeed),
    outputLanguage: parseOutputLanguage(parsed.outputLanguage),
    historyDays: parseHistoryDays(parsed.historyDays),
    ...parseMicAndLevel(parsed),
    sttEngine: parseSttEngine(parsed.sttEngine),
    liveCaption: parsed.liveCaption !== false,
    uiLanguage: parseUiLanguage(parsed.uiLanguage),
    ...parseCleanupModel(parsed)
  }
}

export function saveSettings(settings: AppSettings): void {
  writeJsonAtomic(FILE(), settings)
}
