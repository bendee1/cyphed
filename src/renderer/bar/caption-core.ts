// Bulle de texte en direct : suit les mots d'une version du texte à l'autre (logique pure, testable sans DOM).

export type CaptionWord = {
  /** Clé stable : un mot garde sa clé quand il est corrigé, il ne réapparaît pas. */
  key: number
  text: string
  /** Moment où ce mot a pris son texte actuel. */
  since: number
  /** Moment où le moteur l'a corrigé (le mot s'affiche en rouge un instant), sinon null. */
  fixedAt: number | null
}

export type Caption = {
  words: CaptionWord[]
  nextKey: number
}

export const EMPTY_CAPTION: Caption = { words: [], nextKey: 1 }

/** Un mot qui n'a pas changé depuis ce délai est montré comme sûr. */
export const SURE_AFTER_MS = 700
/** Durée du rouge sur un mot corrigé. */
export const FIXED_MS = 800

function bare(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}'’]/gu, '')
}

/**
 * Nouvelle version du texte entendu. Les mots identiques gardent leur clé et leur âge. Un mot changé
 * garde sa place : c'est une correction (rouge), sauf le dernier mot qui s'écrivait encore (« repren » ->
 * « reprendrai ») ou un simple changement de ponctuation.
 */
export function foldCaption(prev: Caption, text: string, now: number): Caption {
  const tokens = text.split(/\s+/).filter(Boolean)
  let nextKey = prev.nextKey
  const words = tokens.map((token, i): CaptionWord => {
    const old = prev.words[i]
    if (!old) return { key: nextKey++, text: token, since: now, fixedAt: null }
    if (old.text === token) return old
    const same = bare(old.text) === bare(token)
    const growing = i === prev.words.length - 1 && bare(token).startsWith(bare(old.text))
    if (same) return { ...old, text: token }
    return { key: old.key, text: token, since: now, fixedAt: growing ? old.fixedAt : now }
  })
  return { words, nextKey }
}

/** Le mot est-il sûr à cet instant ? Tout devient sûr quand la dictée est finie (`settled`). */
export function wordSure(word: CaptionWord, now: number, settled: boolean): boolean {
  return settled || now - word.since >= SURE_AFTER_MS
}

export function wordFixed(word: CaptionWord, now: number): boolean {
  return word.fixedAt !== null && now - word.fixedAt < FIXED_MS
}
