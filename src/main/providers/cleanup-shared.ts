export type DictationLanguage = 'fr' | 'en' | 'multi'

export function isTruncatedFinish(reason: string | undefined): boolean {
  return reason === 'length'
}

/** Sortie d'un modèle de nettoyage : vide ou tronquée = on garde le texte brut. */
export function outputOrFallback(
  raw: string,
  result: { text: string; finishReason?: string }
): { text: string; usedModel: boolean } {
  if (isTruncatedFinish(result.finishReason)) {
    return { text: raw, usedModel: false }
  }
  const text = result.text.trim()
  if (!text) return { text: raw, usedModel: false }
  return { text, usedModel: true }
}
