import type { ScratchNote } from '../../shared/types.ts'

const MAX_NOTES = 500

/** Valide le contenu du fichier de notes : une note mal formée est ignorée. */
export function parseNotes(raw: unknown): ScratchNote[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ScratchNote[] = []
  for (const item of raw) {
    const note = item as Partial<ScratchNote>
    const id = typeof note?.id === 'string' ? note.id.trim().slice(0, 60) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const updated =
      typeof note.updatedAt === 'string' && !Number.isNaN(Date.parse(note.updatedAt))
        ? note.updatedAt
        : new Date(0).toISOString()
    out.push({
      id,
      title: typeof note.title === 'string' ? note.title.slice(0, 120) : '',
      text: typeof note.text === 'string' ? note.text.slice(0, 100000) : '',
      updatedAt: updated
    })
    if (out.length >= MAX_NOTES) break
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Titre affiché : le titre saisi, sinon la première ligne du texte. */
export function noteTitle(note: Pick<ScratchNote, 'title' | 'text'>): string {
  const title = note.title.trim()
  if (title) return title
  const first = note.text.split('\n').find((line) => line.trim())
  return first ? first.trim().slice(0, 60) : 'Sans titre'
}
