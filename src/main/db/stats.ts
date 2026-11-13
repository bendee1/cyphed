import type { HubStats } from '../../shared/types.ts'
import { ACTIVITY_STATS_PERIOD_DAYS } from '../../shared/types.ts'
import type { SqliteConn } from './sqlite.ts'

export function readActivityStats(conn: SqliteConn, periodDays = ACTIVITY_STATS_PERIOD_DAYS): HubStats {
  const days = Number.isFinite(periodDays) && periodDays > 0 ? Math.floor(periodDays) : ACTIVITY_STATS_PERIOD_DAYS
  const row =
    conn
      .prepare(
        `
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'dictation' THEN 1 ELSE 0 END), 0) AS dictations,
      COALESCE(SUM(CASE WHEN kind IN ('capture_ocr', 'capture_vision') THEN 1 ELSE 0 END), 0) AS captures,
      COALESCE(SUM(words), 0) AS words,
      COUNT(*) AS total
    FROM activities
    WHERE datetime(created_at) >= datetime('now', ?)
  `
      )
      .get(`-${days} days`) ?? {}
  return {
    dictations: Number(row.dictations ?? 0),
    captures: Number(row.captures ?? 0),
    words: Number(row.words ?? 0),
    totalActivities: Number(row.total ?? 0),
    periodDays: days,
    periodLabel: `${days} derniers jours`
  }
}
