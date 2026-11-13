/** Sous ce niveau de crête, le bruit de fond ne doit pas remplir les barres. */
export const PEAK_FLOOR = 0.03
/** Part de la crête gardée à chaque image (~60 Hz) : elle redescend en quelques secondes. */
const PEAK_DECAY = 0.995

/**
 * Niveau d'affichage 0..1 d'après le niveau du micro, rapporté à la crête récente.
 * Le micro est envoyé brut à Deepgram (sans volume automatique) : l'affichage s'adapte seul
 * à une voix douce ou à un micro peu sensible.
 */
export function displayLevel(level: number, peak: number): { value: number; peak: number } {
  const nextPeak = Math.max(PEAK_FLOOR, level, peak * PEAK_DECAY)
  const value = Math.min(1, Math.pow(level / nextPeak, 0.8))
  return { value, peak: nextPeak }
}
