// Mots donnés à Deepgram (Nova-3, paramètre `keyterm`) pour qu'il les reconnaisse mieux.
// Limite de Deepgram : 500 jetons au total ; on reste largement en dessous.
const MAX_TERMS = 40
const MAX_TERM_LENGTH = 50
const MAX_TOTAL_CHARS = 700

/** Mots toujours utiles à la dictée, quel que soit le dictionnaire de la personne. */
export const BUILTIN_KEYTERMS = ['guillemets', 'Cyphed']

/** Ordre de priorité : mots de la personne, puis mots vus à l'écran, puis mots de base. */
export function buildKeyterms(personal: string[], screen: string[] = [], builtin: string[] = BUILTIN_KEYTERMS): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  let total = 0
  for (const raw of [...personal, ...screen, ...builtin]) {
    const term = raw.replace(/\s+/g, ' ').trim()
    if (!term || term.length > MAX_TERM_LENGTH) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    if (total + term.length > MAX_TOTAL_CHARS || out.length >= MAX_TERMS) break
    seen.add(key)
    total += term.length
    out.push(term)
  }
  return out
}
