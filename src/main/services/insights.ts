import type { InsightCategoryId, Insights } from '../../shared/types.ts'
import { appCategory } from './app-category-core.ts'

export type InsightRow = { createdAt: string; words: number; durationMs: number; app: string; windowTitle: string }

const INSIGHT_WEEKS = 17

function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

function previousDay(date: Date): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() - 1)
  return copy
}

/** Statistiques de l'onglet Insights, calculées sur toutes les dictées. */
export function computeInsights(rows: InsightRow[], dictionaryEntries: number, now = new Date()): Insights {
  let totalWords = 0
  let timedWords = 0
  let timedMs = 0
  const perDay = new Map<string, number>()
  const perCategory = new Map<InsightCategoryId, number>()
  const perApp = new Map<string, number>()

  for (const row of rows) {
    const created = new Date(row.createdAt)
    if (Number.isNaN(created.getTime())) continue
    totalWords += row.words
    if (row.durationMs > 0 && row.words > 0) {
      timedWords += row.words
      timedMs += row.durationMs
    }
    const key = dayKey(created)
    perDay.set(key, (perDay.get(key) ?? 0) + row.words)
    const app = row.app.replace(/\.exe$/i, '').trim()
    // L'historique importé de la version Python ne dit pas dans quelle appli on dictait : hors de la répartition.
    if (!app || app === 'python-v1') continue
    const category = appCategory(row.app, row.windowTitle)
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1)
    perApp.set(app, (perApp.get(app) ?? 0) + row.words)
  }

  let currentStreak = 0
  for (let cursor = new Date(now); perDay.has(dayKey(cursor)); cursor = previousDay(cursor)) currentStreak += 1
  // Aujourd'hui sans dictée n'efface pas la série d'hier.
  if (currentStreak === 0) {
    for (let cursor = previousDay(now); perDay.has(dayKey(cursor)); cursor = previousDay(cursor)) currentStreak += 1
  }

  let longestStreak = 0
  let run = 0
  let last: Date | null = null
  for (const key of [...perDay.keys()].sort()) {
    const [y, m, d] = key.split('-').map(Number)
    const current = new Date(y, m - 1, d)
    run = last && dayKey(previousDay(current)) === dayKey(last) ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    last = current
  }

  const ids: InsightCategoryId[] = ['personal', 'work', 'email', 'code', 'ai', 'other']
  const total = rows.length || 1
  const categories = ids.map((id) => {
    const count = perCategory.get(id) ?? 0
    return { id, count, percent: Math.round((count / total) * 100) }
  })

  const days: Record<string, number> = {}
  for (let i = 0; i < INSIGHT_WEEKS * 7; i++) {
    const cursor = new Date(now)
    cursor.setDate(cursor.getDate() - i)
    const key = dayKey(cursor)
    if (perDay.has(key)) days[key] = perDay.get(key) as number
  }

  return {
    dictations: rows.length,
    totalWords,
    wordsPerMinute: timedMs > 0 ? Math.round(timedWords / (timedMs / 60000)) : 0,
    currentStreak,
    longestStreak,
    categories,
    topApps: [...perApp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([app, words]) => ({ app, words })),
    days,
    dictionaryEntries
  }
}
