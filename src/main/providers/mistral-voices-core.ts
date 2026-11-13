// Voix Mistral (Voxtral 3) : nom affiché et ordre de la liste. Logique pure, testée sans Electron.

export type MistralVoiceItem = { id?: string; slug?: string; name?: string; languages?: string[] }
export type MistralVoice = { id: string; name: string; provider: 'mistral' }

/** Modèle de voix : Voxtral 3 lit ses propres voix (voice_589…) et accepte encore les voix Voxtral 2 (fr_marie_neutral…). */
export const MISTRAL_TTS_MODEL = 'voxtral-mini-tts-3-0'

/** « fr_fr » → « FR », « en_GB » → « EN ». */
function langLabel(languages: string[] | undefined): string {
  const code = (languages?.[0] ?? '').slice(0, 2).toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : ''
}

/** Une voix Voxtral 3 a un identifiant voice_NNN ; les voix Voxtral 2 portent leur émotion dans le nom (fr_marie_sad). */
export function isVoxtral3(id: string): boolean {
  return /^voice_\d+$/.test(id)
}

export function toMistralVoice(item: MistralVoiceItem): MistralVoice | null {
  const id = (item.slug || item.id || '').trim()
  if (!id) return null
  const lang = langLabel(item.languages)
  const name = (item.name || id).trim().replace(/\s+-\s+/, ', ')
  return { id, name: `${name}${lang ? ` (${lang})` : ''}${isVoxtral3(id) ? '' : ', Voxtral 2'}`, provider: 'mistral' }
}

/** Les voix de la langue de l'interface d'abord, Voxtral 3 avant Voxtral 2, puis par nom. */
export function sortMistralVoices(items: MistralVoiceItem[], uiLang: string): MistralVoice[] {
  const lang = uiLang.slice(0, 2).toLowerCase()
  const rank = (item: MistralVoiceItem, voice: MistralVoice): number =>
    ((item.languages ?? []).some((l) => l.toLowerCase().startsWith(lang)) ? 0 : 2) + (isVoxtral3(voice.id) ? 0 : 1)
  return items
    .map((item) => ({ item, voice: toMistralVoice(item) }))
    .filter((entry): entry is { item: MistralVoiceItem; voice: MistralVoice } => entry.voice !== null)
    .sort((a, b) => rank(a.item, a.voice) - rank(b.item, b.voice) || a.voice.name.localeCompare(b.voice.name))
    .map((entry) => entry.voice)
}

/** Voix proposées sans clé ou sans réseau : les voix françaises Voxtral 3, puis quelques voix anglaises. */
export const MISTRAL_FALLBACK_ITEMS: MistralVoiceItem[] = [
  { slug: 'voice_592', name: 'Marie', languages: ['fr_fr'] },
  { slug: 'voice_3137', name: 'Manon', languages: ['fr_fr'] },
  { slug: 'voice_589', name: 'Lea', languages: ['fr_fr'] },
  { slug: 'voice_3141', name: 'Camille', languages: ['fr_fr'] },
  { slug: 'fr_marie_neutral', name: 'Marie - Neutral', languages: ['fr_fr'] },
  { slug: 'voice_478', name: 'Sheila', languages: ['en_us'] },
  { slug: 'voice_3150', name: 'James', languages: ['en_us'] },
  { slug: 'en_paul_neutral', name: 'Paul - Neutral', languages: ['en_us'] }
]
