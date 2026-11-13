export type DetectedLanguage = 'fr' | 'en' | 'mixed' | 'unknown'

// Mots fréquents qui ne sont PAS des mots de l'autre langue (on évite « a », « on », « me », « son », « as »…).
const FR = new Set([
  'le', 'la', 'les', 'des', 'du', 'une', 'et', 'est', 'que', 'qui', 'pas', 'pour', 'dans', 'ce', 'cette', 'il', 'elle',
  'je', 'tu', 'nous', 'vous', 'mais', 'avec', 'sur', 'ne', 'se', 'ça', 'au', 'aux', 'ces', 'mon', 'ma', 'mes', 'ton',
  'ta', 'tes', 'très', 'oui', 'non', 'suis', 'sont', 'était', 'faut', 'fait', 'aussi', 'donc', 'alors', 'quoi', 'comme',
  'plus', 'moi', 'toi', 'lui', 'leur', 'leurs', 'où', 'quand', 'comment', 'pourquoi', 'tout', 'tous', 'si', 'bien', 'peu'
])
const EN = new Set([
  'the', 'an', 'and', 'is', 'are', 'to', 'of', 'in', 'that', 'it', 'for', 'with', 'you', 'this', 'was', 'be', 'have',
  'not', 'they', 'we', 'i', 'my', 'your', 'our', 'their', 'what', 'which', 'would', 'could', 'should', 'there', 'here',
  'from', 'about', 'just', 'like', 'so', 'if', 'then', 'than', 'been', 'will', 'can', 'do', 'does', 'did', 'im', "i'm",
  "it's", "don't", "that's", 'really', 'because', 'when', 'how', 'why', 'also', 'very'
])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^a-zàâäçéèêëîïôöùûüÿœ']+/)
    .filter(Boolean)
}

/**
 * Langue dominante d'une dictée, sans appel modèle : compte des mots-outils français et anglais.
 * « mixed » quand les deux comptent vraiment (dictée en français avec des phrases en anglais).
 */
export function detectLanguage(text: string): DetectedLanguage {
  let fr = 0
  let en = 0
  for (const word of words(text)) {
    if (FR.has(word)) fr++
    if (EN.has(word)) en++
  }
  const total = fr + en
  if (total < 3) return 'unknown'
  const frShare = fr / total
  if (frShare >= 0.8) return 'fr'
  if (frShare <= 0.2) return 'en'
  return 'mixed'
}
