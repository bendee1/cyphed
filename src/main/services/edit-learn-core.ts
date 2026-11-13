const ANCHOR = 40

/**
 * Retrouve dans le champ relu la zone où la dictée avait été insérée, grâce au texte qui la précédait
 * et à celui qui la suivait. Rend null si on ne la retrouve pas sûrement.
 */
export function extractEditedSegment(
  fieldText: string,
  beforeTail: string,
  afterHead: string,
  inserted: string
): string | null {
  const before = beforeTail.slice(-ANCHOR)
  const after = afterHead.slice(0, ANCHOR)
  let start = 0
  if (before) {
    const at = fieldText.lastIndexOf(before)
    if (at < 0) return null
    start = at + before.length
  }
  const slack = Math.ceil(inserted.length * 1.6) + 40
  let end = Math.min(fieldText.length, start + slack)
  if (after) {
    const at = fieldText.indexOf(after, start)
    if (at < 0) return null
    end = at
  }
  const segment = fieldText.slice(start, end).trim()
  if (!segment) return null
  const ratio = segment.length / Math.max(1, inserted.trim().length)
  if (ratio < 0.5 || ratio > 1.6) return null
  return segment
}
