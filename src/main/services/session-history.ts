type Entry = { key: string; text: string; at: number }

const MAX_ENTRIES = 3
const MAX_AGE_MS = 5 * 60 * 1000
const MAX_CHARS = 400

/** Titre comparable d'une fenêtre : sans compteur « (3) », sans pastille « ● » ou « * » de modification. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\s*(?:\(\d+\)|[*●•])\s*/u, '')
    .trim()
}

function keyOf(app: string, windowTitle: string | undefined): string {
  return `${app.toLowerCase()}\u0000${normalizeTitle(windowTitle ?? '')}`
}

/**
 * Les dernières phrases écrites dans la même fenêtre (processus + titre), pour que la suite d'une dictée reste cohérente
 * (majuscule ou non, pronoms, sujet en cours). Un navigateur sur un autre site ou une autre page n'hérite de rien :
 * ce qui a été dicté ailleurs ne part pas au modèle. Sans titre fourni, retombe sur le seul processus (ancien comportement).
 * Mémoire vive seulement : rien n'est écrit sur disque.
 */
export class SessionHistory {
  private entries: Entry[] = []

  push(app: string, text: string, now: number, windowTitle?: string): void {
    const clean = text.trim()
    if (!clean) return
    this.entries.push({ key: keyOf(app, windowTitle), text: clean.slice(-MAX_CHARS), at: now })
    if (this.entries.length > 20) this.entries.splice(0, this.entries.length - 20)
  }

  recent(app: string, now: number, windowTitle?: string): string[] {
    const key = keyOf(app, windowTitle)
    return this.entries
      .filter((e) => e.key === key && now - e.at <= MAX_AGE_MS)
      .slice(-MAX_ENTRIES)
      .map((e) => e.text)
  }

  clear(): void {
    this.entries = []
  }
}
