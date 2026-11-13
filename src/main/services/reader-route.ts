import { tm } from '../lang.ts'
export type ReaderRouteAction = 'read' | 'summarize' | 'explain'

const FR_LETTERS = /[àâäéèêëïîôùûüçœæ]/i
const FR_WORDS =
  /\b(le|la|les|un|une|des|du|de|et|ou|que|qui|pas|est|sont|avec|pour|dans|sur|ce|cette|ces|je|tu|nous|vous|ils|elle|être|avoir|mais|plus|aussi|très|fait|tout|comme|une|aux|par|pas|une)\b/gi
const EN_WORDS =
  /\b(the|and|you|that|this|with|from|have|are|was|were|not|for|but|they|what|which|their|would|could|should)\b/gi

/**
 * Le texte est-il déjà en français ? Les accents comptent un peu, jamais seuls : un texte anglais
 * avec « café » ou « résumé » doit quand même être traduit.
 */
export function looksFrench(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const fr = trimmed.match(FR_WORDS)?.length ?? 0
  const en = trimmed.match(EN_WORDS)?.length ?? 0
  const accents = Math.min(2, trimmed.match(new RegExp(FR_LETTERS.source, 'gi'))?.length ?? 0)
  if (fr === 0 && en === 0) return accents > 0
  const score = fr + accents
  return score >= 2 && score > en
}

export type ReaderRoutePlan =
  | { skipLlm: true; reason: 'already-french' }
  | { skipLlm: false; reason: 'needs-llm' }

export function planReaderRoute(action: ReaderRouteAction, text: string): ReaderRoutePlan {
  if (action === 'read' && looksFrench(text)) {
    return { skipLlm: true, reason: 'already-french' }
  }
  return { skipLlm: false, reason: 'needs-llm' }
}

export function applyReaderLlm(
  raw: string,
  llm: { ok: true; text: string } | { ok: false }
): { text: string; fallback: boolean } {
  if (llm.ok) {
    const next = llm.text.trim()
    if (next) return { text: next, fallback: false }
  }
  const fallback = raw.trim()
  if (!fallback) throw new Error(tm('err.noTextToRead'))
  return { text: fallback, fallback: true }
}

export function readerNotice(result: { fallback?: boolean; inFrench?: boolean; speakError?: string }): string {
  if (result.speakError) return result.speakError
  if (result.fallback && result.inFrench === false) return tm('readerNotice.original')
  if (result.inFrench === false) return tm('readerNotice.readOriginal')
  return tm('readerNotice.french')
}
