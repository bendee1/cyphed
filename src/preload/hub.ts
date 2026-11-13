import { contextBridge, ipcRenderer } from 'electron'
import type {
  CapturePreview,
  HotkeyCaptureResult,
  HubPreloadApi,
  HubSettings,
  HubSettingsResult,
  HubSettingsSave,
  HubStatus,
  HubView,
  ReaderAction,
  ReaderResult,
  ReaderSource,
  TtsPlayPayload,
  TtsVoice
} from '../shared/ipc'
import type { ActivityRecord, BarState, Insights, Personalization, ScratchNote } from '../shared/types'

const api: HubPreloadApi = {
  getInsights() {
    return ipcRenderer.invoke('hub:insights') as Promise<Insights>
  },
  getNotes() {
    return ipcRenderer.invoke('hub:notes') as Promise<ScratchNote[]>
  },
  saveNotes(notes) {
    return ipcRenderer.invoke('hub:notes-save', notes) as Promise<{ ok: boolean }>
  },
  transformText(text, transformId) {
    return ipcRenderer.invoke('hub:transform-text', text, transformId) as Promise<{ ok: true; text: string } | { ok: false; error: string }>
  },
  buildVoiceProfile() {
    return ipcRenderer.invoke('hub:build-voice-profile') as ReturnType<HubPreloadApi['buildVoiceProfile']>
  },
  suggestTerms() {
    return ipcRenderer.invoke('hub:suggest-terms') as ReturnType<HubPreloadApi['suggestTerms']>
  },
  correctActivity(id, text) {
    return ipcRenderer.invoke('hub:correct', id, text) as Promise<{ ok: boolean; added: Array<{ term: string; replacement?: string }> }>
  },
  retryActivity(id) {
    return ipcRenderer.invoke('hub:retry', id) as ReturnType<HubPreloadApi['retryActivity']>
  },
  onNavigate(handler) {
    const listen = (_event: unknown, view: HubView): void => handler(view)
    ipcRenderer.on('hub:navigate', listen)
    return () => ipcRenderer.removeListener('hub:navigate', listen)
  },
  onBarState(handler) {
    const listen = (_event: unknown, state: BarState): void => handler(state)
    ipcRenderer.on('bar:state', listen)
    return () => ipcRenderer.removeListener('bar:state', listen)
  },
  onTtsPlay(handler) {
    const listen = (_event: unknown, payload: TtsPlayPayload): void => handler(payload)
    ipcRenderer.on('tts:play', listen)
    return () => ipcRenderer.removeListener('tts:play', listen)
  },
  onTtsStop(handler) {
    const listen = (_event: unknown, id: string): void => handler(String(id || ''))
    ipcRenderer.on('tts:stop', listen)
    return () => ipcRenderer.removeListener('tts:stop', listen)
  },
  sendTtsEnded(id) {
    ipcRenderer.send('tts:ended', id)
  },
  sendTtsError(id, message) {
    ipcRenderer.send('tts:error', id, message)
  },
  onTtsFailed(handler) {
    const listen = (_event: unknown, message: string): void => handler(String(message || ''))
    ipcRenderer.on('tts:failed', listen)
    return () => ipcRenderer.removeListener('tts:failed', listen)
  },
  getHistory(query) {
    return ipcRenderer.invoke('hub:history', query) as Promise<ActivityRecord[]>
  },
  getStatus() {
    return ipcRenderer.invoke('hub:status') as Promise<HubStatus>
  },
  onInvalidate(handler) {
    const listen = (): void => handler()
    ipcRenderer.on('hub:invalidate', listen)
    return () => ipcRenderer.removeListener('hub:invalidate', listen)
  },
  getSettings() {
    return ipcRenderer.invoke('hub:settings') as Promise<HubSettings>
  },
  saveSettings(payload: HubSettingsSave) {
    return ipcRenderer.invoke('hub:save-settings', payload) as Promise<HubSettingsResult>
  },
  listVoices() {
    return ipcRenderer.invoke('hub:voices') as Promise<TtsVoice[]>
  },
  startCapture() {
    return ipcRenderer.invoke('capture:start') as Promise<CapturePreview | null>
  },
  cancelCapture() {
    return ipcRenderer.invoke('capture:cancel') as Promise<void>
  },
  runReader(action: ReaderAction, source: ReaderSource) {
    return ipcRenderer.invoke('reader:run', action, source) as Promise<ReaderResult>
  },
  speakText(text) {
    return ipcRenderer.invoke('reader:speak', text) as Promise<void>
  },
  stopSpeak() {
    return ipcRenderer.invoke('reader:stop') as Promise<void>
  },
  beginHotkeyCapture() {
    return ipcRenderer.invoke('hub:hotkey-begin') as Promise<void>
  },
  cancelHotkeyCapture() {
    return ipcRenderer.invoke('hub:hotkey-cancel') as Promise<void>
  },
  getPersonalization() {
    return ipcRenderer.invoke('hub:personalization') as Promise<Personalization>
  },
  savePersonalization(next) {
    return ipcRenderer.invoke('hub:save-personalization', next) as Promise<{ ok: true } | { ok: false; error: string }>
  },
  onHotkeyCapture(handler) {
    const listen = (_event: unknown, result: HotkeyCaptureResult): void => handler(result)
    ipcRenderer.on('hub:hotkey-result', listen)
    return () => ipcRenderer.removeListener('hub:hotkey-result', listen)
  }
}

contextBridge.exposeInMainWorld('cyphed', api)
