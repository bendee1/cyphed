export type RecordingMode = 'toggle' | 'push_to_talk'

type BarPhase = 'hidden' | 'listening' | 'processing' | 'done' | 'error' | 'tip'

export type BarState = {
  phase: BarPhase
  message?: string
  level: number
}

export type DictationTimings = {
  hotkeyStartMs: number
  barShownMs?: number
  sttOpenMs?: number
  stopMs?: number
  sttFinalMs?: number
  cleanupMs?: number
  insertedMs?: number
}

type ForegroundApp = {
  hwnd: string
  title: string
  processName: string
}

export type ActivityKind = 'dictation' | 'reader_text' | 'capture_ocr' | 'capture_vision'

export type ActivityProvenance = {
  steps?: string[]
  sttProvider?: string
  sttModel?: string
  sttLatencyMs?: number
  cleanupLatencyMs?: number | null
  /** Raison du repli sur le texte brut (délai dépassé, erreur réseau, sortie incohérente). */
  cleanupFallback?: string
  /** La dictée n'a pas abouti (réseau, Deepgram) : texte vide, l'audio gardé permet de la réessayer. */
  failed?: string
  /** « Appuie sur Entrée » dit en fin de dictée : Entrée envoyée après le collage. */
  sent?: boolean
  /** Texte refait depuis l'audio gardé ou le texte brut (bouton Réessayer). */
  retried?: boolean
  /** Sortie du modèle refusée par le contrôle (pour mesurer les faux refus). */
  cleanupRejected?: string
  /** Une ligne par étape du pipeline : contexte, aiguillage, mise en forme ou commande. */
  trace?: Array<{ stage: string; ms: number | null; model?: string; note?: string }>
  /** id de la transform appliquée après le nettoyage : le texte final est alors réécrit, pas seulement nettoyé. */
  transform?: string
  /** La personne a corrigé le texte final à la main (bouton Corriger). */
  corrected?: boolean
  /** Texte donné par le modèle avant la première correction de la personne. */
  modelText?: string
  migrated?: boolean
  legacy?: boolean
}

export type ActivityRecord = {
  kind: ActivityKind
  id: string
  createdAt: string
  rawText: string
  finalText: string
  words: number
  durationMs: number
  app: string
  windowTitle: string
  source: string
  action?: string
  route?: 'ocr' | 'vision' | 'text'
  provenance?: ActivityProvenance
  timings?: DictationTimings
}

/** pocket : voix locale (Pocket TTS, Kyutai) du studio voix, sur ce PC. */
type VoiceProvider = 'mistral' | 'elevenlabs' | 'pocket'

export type VoiceRef = {
  provider: VoiceProvider
  id: string
}

export type SecretState = {
  configured: boolean
  source: 'stored' | 'env' | null
}

export type SecretWrite = { set: string } | { clear: true }

export type AppSettings = {
  hotkey: string
  mode: RecordingMode
  language: 'multi' | 'fr' | 'en'
  lireVoice: VoiceRef
  assistantVoice: VoiceRef
  /** Garder l'audio de chaque dictée 7 jours, pour pouvoir la réessayer après une panne. */
  keepAudio: boolean
  /** Micro choisi (identifiant du navigateur) ; vide = micro par défaut de Windows. */
  micDeviceId: string
  /** Nom du micro choisi, pour l'afficher même quand il est débranché. */
  micLabel: string
  /** Force du nettoyage : aucun (texte de la transcription), léger, normal. */
  cleanupLevel: CleanupLevel
  /** Moteur qui transcrit la voix. */
  sttEngine: SttEngine
  /** Langue de l'interface : « auto » suit la langue de Windows (français, sinon anglais). */
  uiLanguage: UiLanguageSetting
  /** Modèle qui nettoie les dictées : Claude Haiku, ou n'importe quel modèle compatible OpenAI (DeepSeek, OpenRouter, Ollama…). */
  cleanupEngine: CleanupEngine
  /** Adresse de base de l'API compatible OpenAI, sans « /chat/completions » (ex. https://api.deepseek.com). */
  openaiBaseUrl: string
  /** Nom du modèle compatible OpenAI (ex. deepseek-flash). */
  openaiModel: string
}

export type CleanupEngine = 'claude' | 'openai'

/** Lecture tolérante du modèle de nettoyage (fichier ou Hub). L'adresse est vérifiée au moment de l'appel. */
export function parseCleanupModel(value: Partial<AppSettings>): Pick<AppSettings, 'cleanupEngine' | 'openaiBaseUrl' | 'openaiModel'> {
  const url = typeof value.openaiBaseUrl === 'string' ? value.openaiBaseUrl.trim().slice(0, 300) : ''
  const model = typeof value.openaiModel === 'string' ? value.openaiModel.trim().slice(0, 120) : ''
  return { cleanupEngine: value.cleanupEngine === 'openai' ? 'openai' : 'claude', openaiBaseUrl: url, openaiModel: model }
}

export type UiLanguageSetting = 'auto' | 'fr' | 'en'

/** Lecture tolérante de la langue de l'interface (fichier ou Hub) ; tout le reste = « auto ». */
export function parseUiLanguage(value: unknown): UiLanguageSetting {
  return value === 'fr' || value === 'en' ? value : 'auto'
}

/**
 * Deepgram Nova-3 en fichier entier (défaut), Deepgram en flux, ElevenLabs Scribe v2 en fichier entier à la fin,
 * Scribe en temps réel, ou Voxtral de Mistral en fichier entier.
 */
export type SttEngine = 'deepgram' | 'deepgram_file' | 'elevenlabs' | 'elevenlabs_live' | 'voxtral'
const STT_ENGINES: SttEngine[] = ['deepgram', 'deepgram_file', 'elevenlabs', 'elevenlabs_live', 'voxtral']

export function parseSttEngine(value: unknown): SttEngine {
  return STT_ENGINES.includes(value as SttEngine) ? (value as SttEngine) : 'deepgram_file'
}

export type CleanupLevel = 'none' | 'light' | 'normal'
const CLEANUP_LEVELS: CleanupLevel[] = ['none', 'light', 'normal']

/** Lecture tolérante des réglages micro et nettoyage (fichier ou Hub). */
export function parseMicAndLevel(value: Partial<AppSettings>): Pick<AppSettings, 'micDeviceId' | 'micLabel' | 'cleanupLevel'> {
  const id = typeof value.micDeviceId === 'string' && value.micDeviceId.length <= 200 ? value.micDeviceId : ''
  const label = id && typeof value.micLabel === 'string' ? value.micLabel.slice(0, 120) : ''
  const level = CLEANUP_LEVELS.includes(value.cleanupLevel as CleanupLevel) ? (value.cleanupLevel as CleanupLevel) : 'normal'
  return { micDeviceId: id, micLabel: label, cleanupLevel: level }
}

/** Durée de conservation de l'audio des dictées. */
export const AUDIO_KEEP_DAYS = 7

export const DEFAULT_SETTINGS: AppSettings = {
  hotkey: 'Control+Shift+Space',
  mode: 'toggle',
  language: 'multi',
  lireVoice: { provider: 'mistral', id: 'voice_592' },
  assistantVoice: { provider: 'mistral', id: 'en_paul_neutral' },
  keepAudio: true,
  micDeviceId: '',
  micLabel: '',
  cleanupLevel: 'normal',
  sttEngine: 'deepgram_file',
  uiLanguage: 'auto',
  cleanupEngine: 'claude',
  openaiBaseUrl: '',
  openaiModel: ''
}

export const ACTIVITY_STATS_PERIOD_DAYS = 30

export type HubStats = {
  dictations: number
  captures: number
  words: number
  totalActivities: number
  periodDays: number
  periodLabel: string
}

export function emptyHubStats(): HubStats {
  return {
    dictations: 0,
    captures: 0,
    words: 0,
    totalActivities: 0,
    periodDays: ACTIVITY_STATS_PERIOD_DAYS,
    periodLabel: '30 derniers jours'
  }
}

export type StyleTone = 'formal' | 'casual' | 'very_casual'
export type StyleCategory = 'personal' | 'work' | 'email' | 'other'

export type DictionaryEntry = { term: string; replacement?: string }
export type SnippetEntry = { trigger: string; text: string }

export type TransformEntry = { id: string; name: string; description: string; prompt: string; hotkey?: string }

export type Personalization = {
  dictionary: DictionaryEntry[]
  snippets: SnippetEntry[]
  styles: Record<StyleCategory, StyleTone>
  transforms: TransformEntry[]
  /** id de la transformation appliquée à chaque dictée ; vide = aucune */
  autoTransform: string
  /** applications (nom de processus sans .exe) où la dictée est coupée */
  blockedApps: string[]
  /** résumé du style d'écriture de la personne, ajouté aux prompts (texte modifiable) */
  voiceProfile: string
  voiceProfileEnabled: boolean
  /** lire le texte autour du curseur (UI Automation) pour mieux écrire et vérifier le collage */
  readContext: boolean
  /** raccourci du mode commande (consigne dictée appliquée à la sélection) */
  commandHotkey: string
  /** mots appris des corrections faites dans le champ, à valider dans le Dictionnaire */
  pending: DictionaryEntry[]
}

/** Première version du prompt Polish, enregistrée telle quelle chez les personnes qui l'ont déjà utilisée. */
export const LEGACY_POLISH_PROMPT =
  'Réécris le texte pour qu’il soit plus clair et plus concis : supprime les redites et les détours, garde le sens, le ton, la personne (je/tu/vous) et tous les faits.'

/** Ancien raccourci par défaut du mode commande, déjà pris par d'autres applications (Claude Desktop). */
export const LEGACY_COMMAND_HOTKEY = 'Control+Alt+Space'

export const DEFAULT_TRANSFORMS: TransformEntry[] = [
  {
    id: 'polish',
    name: 'Peaufiner',
    description: 'Améliore la clarté et la concision',
    prompt:
      'Réécris le texte pour qu’il soit plus clair et plus concis : supprime les redites et les détours, garde le sens, le ton, la personne (je/tu/vous) et tous les faits. N’ajoute rien : ni information, ni date, ni question absente du texte. Un passage obscur ou mal transcrit reste tel quel, ne le devine pas.'
  },
  {
    id: 'prompt-engineer',
    name: 'Écrire un prompt',
    description: 'Construit un prompt optimal',
    prompt:
      'Transforme le texte en un prompt clair pour une IA : objectif d’abord, puis contexte, contraintes et format de réponse attendu, en phrases courtes. N’invente aucun fait absent du texte.'
  }
]

export const DEFAULT_PERSONALIZATION: Personalization = {
  dictionary: [],
  snippets: [],
  styles: { personal: 'casual', work: 'casual', email: 'formal', other: 'casual' },
  transforms: DEFAULT_TRANSFORMS,
  autoTransform: '',
  blockedApps: [],
  voiceProfile: '',
  voiceProfileEnabled: true,
  readContext: true,
  commandHotkey: 'Control+Alt+C',
  pending: []
}

/** Mot que le moteur vocal déforme, proposé pour le Dictionnaire. */
export type TermSuggestion = { heard: string; correct: string; reason: string }

export type InsightCategoryId = 'personal' | 'work' | 'email' | 'code' | 'ai' | 'other'

export type Insights = {
  dictations: number
  totalWords: number
  wordsPerMinute: number
  currentStreak: number
  longestStreak: number
  categories: Array<{ id: InsightCategoryId; count: number; percent: number }>
  topApps: Array<{ app: string; words: number }>
  /** mots dictés par jour (AAAA-MM-JJ), 17 dernières semaines */
  days: Record<string, number>
  dictionaryEntries: number
}

export type ScratchNote = { id: string; title: string; text: string; updatedAt: string }
