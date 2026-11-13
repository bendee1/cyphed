// Faux pont Electron pour l'aperçu : données d'exemple, aucune clé, rien n'est enregistré.
// La langue vient de la query (`?lang=fr|en`), lue par `@/lib/i18n` comme dans l'appli.
import { DEFAULT_PERSONALIZATION, DEFAULT_SETTINGS, emptyHubStats, type ActivityRecord, type BarState, type Insights } from '@shared/types'
import { t as text } from '@/lib/i18n'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark') document.body.classList.add('dark')
const now = new Date()
const at = (h: number, m: number, daysAgo = 0): string => {
  const d = new Date(now)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const SAMPLES: Array<[number, number, number, string, string]> = [
  [0, 14, 32, 'slack', 'Ok pour la réunion de jeudi, je t’envoie le lien juste après. Tu peux ajouter Camille dans l’invitation ?'],
  [0, 14, 5, 'outlook', 'Bonjour Madame Roux, je vous confirme la livraison des fichiers vendredi, avec les deux variantes de couverture que nous avions évoquées.'],
  [0, 11, 48, 'claude', 'Ajoute un test pour le cas où la liste est vide, et renomme la fonction en parseHotkey.'],
  [0, 10, 20, 'code', 'Le collage échoue quand la fenêtre perd le focus : on garde le texte dans le presse-papiers et on prévient.'],
  [0, 9, 12, 'notion', 'Idées pour la semaine : refaire la page d’accueil, écrire le guide d’installation, tester le micro USB.'],
  [1, 18, 20, 'whatsapp', 'Penser à rappeler le garage pour le contrôle technique, et décaler le rendez-vous de lundi.'],
  [1, 16, 2, 'chrome', 'Comparer les deux devis et garder celui qui inclut la maintenance.']
]
const EN = params.get('lang') === 'en'
const SAMPLES_EN = [
  'Sounds good for Thursday, I’ll send the link right after. Can you add Camille to the invite?',
  'Hi Ms. Roux, I confirm the files will be delivered on Friday, with the two cover options we discussed.',
  'Add a test for the empty list case, and rename the function to parseHotkey.',
  'Paste fails when the window loses focus: we keep the text in the clipboard and tell the user.',
  'Ideas for the week: redo the home page, write the install guide, test the USB mic.',
  'Remember to call the garage about the inspection, and move Monday’s appointment.',
  'Compare both quotes and keep the one that includes maintenance.'
]
const EXTRA_EN = [
  'Thanks for the feedback, I’ll fix both points and send you a clean version.',
  'Reminder: the demo moved to 4 pm, same link as usual.',
  'Can you check that the nightly backup runs on the test server?',
  'I prefer the second mockup, easier to read on a small screen.',
  'Let’s keep the release notes short: three fixes and the new badge.',
  'Booked the room for the team meeting, Friday 10 am.'
]
const rows: ActivityRecord[] = SAMPLES.map(([daysAgo, h, m, app, frText], i) => {
  const text = EN ? SAMPLES_EN[i] : frText
  const words = text.split(/\s+/).length
  return { id: `ex${i}`, kind: 'dictation', app, finalText: text, rawText: text, createdAt: at(h, m, daysAgo), words, durationMs: Math.round((words / 140) * 60000) } as unknown as ActivityRecord
})
// Quelques dictées de plus aujourd'hui pour l'onde du jour.
const EXTRA = [
  'Merci pour ton retour, je corrige les deux points et je te renvoie la version propre.',
  'Rappel : la démo est décalée à 16 h, même lien que d’habitude.',
  'Peux-tu vérifier que la sauvegarde de nuit tourne bien sur le serveur de test ?',
  'Je préfère la deuxième maquette, plus lisible sur petit écran.',
  'On garde des notes de version courtes : trois corrections et le nouveau badge.',
  'J’ai réservé la salle pour le point d’équipe, vendredi 10 h.'
]
for (const [i, [h, m, w]] of [[8, 40, 30], [9, 30, 55], [10, 50, 80], [15, 10, 60], [16, 20, 90], [17, 0, 40]].entries()) {
  rows.push({ id: `bg${i}`, kind: 'dictation', app: 'slack', finalText: (EN ? EXTRA_EN : EXTRA)[i % EXTRA.length], createdAt: at(h, m), words: w, durationMs: 20000 } as unknown as ActivityRecord)
}
rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
const visibleRows = params.get('empty') ? [] : rows

const days: Record<string, number> = {}
for (let i = 0; i < 119; i++) {
  const d = new Date(now)
  d.setDate(d.getDate() - i)
  if ((i * 7) % 5 !== 0) days[d.toISOString().slice(0, 10)] = 200 + ((i * 137) % 1400)
}
const insights: Insights = {
  dictations: 1842,
  totalWords: 96410,
  wordsPerMinute: 142,
  currentStreak: 12,
  longestStreak: 31,
  categories: [
    { id: 'work', count: 820, percent: 45 },
    { id: 'personal', count: 520, percent: 28 },
    { id: 'email', count: 300, percent: 16 },
    { id: 'other', count: 202, percent: 11 }
  ] as Insights['categories'],
  topApps: [
    { app: 'slack', words: 30210 },
    { app: 'code', words: 21004 },
    { app: 'outlook', words: 15880 }
  ],
  days,
  dictionaryEntries: 38
}

const noop = (): void => undefined
const phase = (params.get('phase') ?? 'hidden') as BarState['phase'] | 'processing-msg' | 'listening-mute'

const api: Record<string, unknown> = {
  getStatus: async () => ({ hotkey: 'Control+Shift+Space', language: 'multi', cerebras: true, anthropic: true, deepgram: true, mistral: false, elevenlabs: false, mock: false, count: rows.length, words: 0, stats: emptyHubStats(), update: params.get('update') }),
  getHistory: async (query?: string) => (query ? visibleRows.filter((r) => `${r.finalText} ${r.app}`.toLowerCase().includes(query.toLowerCase())) : visibleRows),
  getInsights: async () => insights,
  getSettings: async () => ({ settings: params.get('engine') === 'openai' ? { ...DEFAULT_SETTINGS, cleanupEngine: 'openai', openaiBaseUrl: 'https://api.deepseek.com', openaiModel: 'deepseek-flash' } : DEFAULT_SETTINGS, openai: { configured: false, source: null }, deepgram: { set: true }, cerebras: { set: true }, mistral: { set: false }, elevenlabs: { set: false }, anthropic: { set: true } }),
  getPersonalization: async () => DEFAULT_PERSONALIZATION,
  savePersonalization: async () => ({ ok: true }),
  getNotes: async () => [],
  saveNotes: async () => ({ ok: true }),
  listVoices: async () => [],
  previewVoice: async () => new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
  // `?barcat=email` : l'appli au premier plan a son propre réglage (la barre l'indique).
  getTransforms: async () => ({
    transforms: DEFAULT_PERSONALIZATION.transforms.map((t) => ({ id: t.id, name: t.name })),
    auto: params.get('barcat') ? DEFAULT_PERSONALIZATION.transforms[0]?.id ?? '' : '',
    ...(params.get('barcat') ? { category: params.get('barcat') as 'email' } : {})
  }),
  getMicDevice: async () => '',
  readerSpeaking: async () => false,
  setInteractive: noop,
  onBarState: (handler: (s: BarState) => void) => {
    if (phase === 'hidden') return noop
    if (phase === 'processing-msg') {
      handler({ phase: 'processing', level: 0, message: text('bar.slow') })
      return noop
    }
    if ((phase as string) === 'listening-mute') {
      handler({ phase: 'listening', level: 0, message: text('bar.muteLive') })
      return noop
    }
    if (phase === 'error') {
      handler({ phase: 'error', level: 0, message: text('bar.mute') })
      return noop
    }
    let t = 0
    const timer = window.setInterval(() => {
      t += 1
      // Voix simulée : syllabes et mots, avec une pause toutes les 4 secondes environ.
      const s = t * 0.06
      const speech = s % 4.2 > 3.3 ? 0.004 : 0.12 * Math.max(0, Math.sin(s * 13) * 0.5 + 0.5) * Math.max(0, Math.sin(s * 2.7 + 1) * 0.5 + 0.6)
      handler({ phase, level: phase === 'listening' ? speech : 0 })
    }, 60)
    return () => window.clearInterval(timer)
  }
}

window.cyphed = new Proxy(api, {
  get(target, key: string) {
    if (key in target) return target[key]
    if (key.startsWith('on')) return () => noop
    return async () => null
  }
}) as unknown as Window['cyphed']
