import type { ActivityRecord, AppSettings, BarState, HubStats, Insights, Personalization, ScratchNote, SecretState, SecretWrite, TermSuggestion, TransformAppCategory } from './types'

export const IPC = {
  barState: 'bar:state',
  barCommand: 'bar:command',
  barInteractive: 'bar:interactive',
  barHitRect: 'bar:hit-rect',
  barToggle: 'bar:toggle',
  barTransforms: 'bar:transforms',
  barMicDevice: 'bar:mic-device',
  barRead: 'bar:read',
  barReaderState: 'bar:reader-state',
  barSetAuto: 'bar:set-auto',
  barOpenHub: 'bar:open-hub',
  hubNavigate: 'hub:navigate',
  hubCorrect: 'hub:correct',
  hubRetry: 'hub:retry',
  hubSuggestTerms: 'hub:suggest-terms',
  hubBuildVoiceProfile: 'hub:build-voice-profile',
  hubInsights: 'hub:insights',
  hubNotes: 'hub:notes',
  hubNotesSave: 'hub:notes-save',
  hubTransformText: 'hub:transform-text',
  audioFrame: 'audio:frame',
  audioLevel: 'audio:level',
  micReady: 'mic:ready',
  micStopped: 'mic:stopped',
  micError: 'mic:error',
  ttsPlay: 'tts:play',
  ttsStop: 'tts:stop',
  ttsEnded: 'tts:ended',
  ttsError: 'tts:error',
  ttsFailed: 'tts:failed',
  hubHistory: 'hub:history',
  hubStatus: 'hub:status',
  hubInvalidate: 'hub:invalidate',
  hubInstallUpdate: 'hub:install-update',
  hubExportHistory: 'hub:export-history',
  hubGetSettings: 'hub:settings',
  hubSaveSettings: 'hub:save-settings',
  hubListVoices: 'hub:voices',
  readerRun: 'reader:run',
  readerSpeak: 'reader:speak',
  readerStop: 'reader:stop',
  voicePreview: 'voice:preview',
  captureStart: 'capture:start',
  captureCancel: 'capture:cancel',
  captureInit: 'capture:init',
  capturePick: 'capture:pick',
  captureAbort: 'capture:abort',
  capturePayload: 'capture:payload',
  hubHotkeyBegin: 'hub:hotkey-begin',
  hubHotkeyCancel: 'hub:hotkey-cancel',
  hubHotkeyResult: 'hub:hotkey-result',
  hubGetPersonalization: 'hub:personalization',
  hubSavePersonalization: 'hub:save-personalization'
} as const

export type HotkeyCaptureResult =
  | { ok: true; accelerator: string }
  | { ok: false; reason: 'cancel' }

export type BarCommand = 'start-mic' | 'stop-mic'

/** Lire depuis la barre : sélection, texte copié, résumé de la sélection, zone de l'écran, arrêt. */
export type BarReadAction = 'selection' | 'clipboard' | 'summary' | 'zone' | 'stop'

export type HubStatus = {
  hotkey: string
  language: AppSettings['language']
  cerebras: boolean
  anthropic?: boolean
  /** Modèle qui nettoie les dictées en ce moment (nom affiché), vide = texte brut. */
  cleanupModel?: string
  deepgram: boolean
  mistral: boolean
  elevenlabs: boolean
  mock: boolean
  count: number
  words: number
  stats: HubStats
  /** Version téléchargée qui attend un redémarrage (bandeau du Hub). */
  update?: string | null
}

export type HubSettings = {
  settings: AppSettings
  deepgram: SecretState
  cerebras: SecretState
  mistral: SecretState
  elevenlabs: SecretState
  anthropic: SecretState
  openai: SecretState
}

export type TtsVoice = {
  id: string
  name: string
  provider: 'elevenlabs' | 'mistral' | 'pocket'
}

export type HubSettingsSave = {
  settings: AppSettings
  deepgram?: SecretWrite
  cerebras?: SecretWrite
  mistral?: SecretWrite
  elevenlabs?: SecretWrite
  anthropic?: SecretWrite
  openai?: SecretWrite
}

export type HubSettingsResult = { ok: true } | { ok: false; error: string }

export type ReaderAction = 'read' | 'summarize' | 'explain'

export type ReaderSource = { kind: 'text'; text: string } | { kind: 'zone' }

export type ReaderResult = {
  text: string
  route: 'ocr' | 'vision' | 'text'
  model: string
  speakError?: string
  fallback?: boolean
  inFrench?: boolean
}

export type TtsPlayPayload = {
  id: string
  mime: string
  data: ArrayBuffer
  /** Vitesse de lecture (1 = normale). */
  rate?: number
}

export type CapturePreview = {
  previewDataUrl: string
  width: number
  height: number
}

export type CaptureRect = {
  displayId: number
  x: number
  y: number
  width: number
  height: number
}

export type CaptureInit = {
  displayId: number
  imageDataUrl: string
}

export type BarPreloadApi = {
  onBarState: (handler: (state: BarState) => void) => () => void
  onBarCommand: (handler: (command: BarCommand) => void) => () => void
  sendAudioFrame: (pcm: ArrayBuffer) => void
  sendAudioLevel: (level: number) => void
  sendMicReady: () => void
  sendMicStopped: () => void
  sendMicError: (message: string) => void
  setInteractive: (interactive: boolean) => void
  /** Zone active de la barre (la pilule, ou la pilule et son menu), en pixels dans la fenêtre. */
  setHitRect: (rect: { x: number; y: number; width: number; height: number } | null) => void
  toggleDictation: () => void
  getTransforms: () => Promise<BarTransforms>
  /** Micro choisi dans les Réglages (vide = micro par défaut de Windows). */
  getMicDevice: () => Promise<string>
  readAloud: (action: BarReadAction) => Promise<void>
  /** Une lecture est-elle en cours (pour proposer « Arrêter ») ? */
  readerSpeaking: () => Promise<boolean>
  setAutoTransform: (id: string, category?: TransformAppCategory) => Promise<void>
  openHub: (view: HubView) => void
}

export type HubView = 'home' | 'insights' | 'dictionary' | 'snippets' | 'style' | 'transforms' | 'scratchpad' | 'reader'

export type BarTransforms = {
  transforms: Array<{ id: string; name: string }>
  /** Transformation automatique qui s'applique dans l'appli au premier plan. */
  auto: string
  /** Présent quand ce type d'appli a son propre réglage (Transformations > Selon l'application) : la barre change celui-là. */
  category?: TransformAppCategory
}

/** Issue du clic sur « Redémarrer maintenant » : lancée (ou déjà en cours), annulée par une dictée, échouée, ou plus de version prête. */
export type InstallUpdateResult = 'started' | 'dictating' | 'failed' | 'none'

export type HubPreloadApi = {
  getInsights: () => Promise<Insights>
  getNotes: () => Promise<ScratchNote[]>
  saveNotes: (notes: ScratchNote[]) => Promise<{ ok: boolean }>
  transformText: (text: string, transformId: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  buildVoiceProfile: () => Promise<{ ok: true; text: string; analyzed: number } | { ok: false; error: string }>
  suggestTerms: () => Promise<{ ok: true; suggestions: TermSuggestion[]; analyzed: number } | { ok: false; error: string }>
  correctActivity: (id: string, text: string) => Promise<{ ok: boolean; added: Array<{ term: string; replacement?: string }> }>
  retryActivity: (id: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  onNavigate: (handler: (view: HubView) => void) => () => void
  onBarState: (handler: (state: BarState) => void) => () => void
  onTtsPlay: (handler: (payload: TtsPlayPayload) => void) => () => void
  onTtsStop: (handler: (id: string) => void) => () => void
  sendTtsEnded: (id: string) => void
  sendTtsError: (id: string, message: string) => void
  onTtsFailed: (handler: (message: string) => void) => () => void
  getHistory: (query?: string) => Promise<ActivityRecord[]>
  getStatus: () => Promise<HubStatus>
  /** Redémarre Cyphed sur la version prête. */
  installUpdate?: () => Promise<InstallUpdateResult>
  /** Enregistre toutes les dictées dans un fichier choisi (texte ou JSON). */
  exportHistory?: () => Promise<{ ok: true; count: number } | { ok: false; cancelled?: boolean; error?: string }>
  onInvalidate: (handler: () => void) => () => void
  getSettings: () => Promise<HubSettings>
  saveSettings: (payload: HubSettingsSave) => Promise<HubSettingsResult>
  listVoices: () => Promise<TtsVoice[]>
  startCapture: () => Promise<CapturePreview | null>
  cancelCapture: () => Promise<void>
  runReader: (action: ReaderAction, source: ReaderSource) => Promise<ReaderResult>
  speakText: (text: string) => Promise<void>
  stopSpeak: () => Promise<void>
  /** Lit une courte phrase avec la voix choisie (lecture ou assistant). */
  previewVoice?: (role: 'lire' | 'assistant') => Promise<void>
  beginHotkeyCapture: () => Promise<void>
  cancelHotkeyCapture: () => Promise<void>
  onHotkeyCapture: (handler: (result: HotkeyCaptureResult) => void) => () => void
  getPersonalization: () => Promise<Personalization>
  savePersonalization: (next: Personalization) => Promise<{ ok: true } | { ok: false; error: string }>
}

export type CapturePreloadApi = {
  onCaptureInit: (handler: (payload: CaptureInit) => void) => () => void
  getCaptureInit: () => Promise<CaptureInit | null>
  pickCapture: (rect: CaptureRect) => void
  abortCapture: () => void
}

export type PreloadApi = HubPreloadApi & BarPreloadApi & CapturePreloadApi

declare global {
  interface Window {
    cyphed: PreloadApi
  }
}
