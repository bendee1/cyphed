import type { ActivityRecord } from '@shared/types'

/** Export des dictées : JSON (pour un autre outil) ou texte lisible, une dictée par bloc. */
export function formatExport(rows: ActivityRecord[], format: 'json' | 'text'): string {
  if (format === 'json') {
    const items = rows.map((r) => ({ date: r.createdAt, app: r.app ?? '', words: r.words ?? 0, text: r.finalText }))
    return JSON.stringify(items, null, 2) + '\n'
  }
  return rows
    .map((r) => `${r.createdAt.replace('T', ' ').slice(0, 16)}${r.app ? ` · ${r.app}` : ''}\n${r.finalText.trim()}\n`)
    .join('\n')
}
