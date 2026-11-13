import type { ActivityRecord } from '../../shared/types.ts'
import { legacyDictationToActivity } from './classify.ts'
import { setUserVersion, tableExists, userVersion, type SqliteConn } from './sqlite.ts'

export const ACTIVITIES_SCHEMA_VERSION = 1

const CREATE_ACTIVITIES_SQL = `
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  final_text TEXT NOT NULL,
  words INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  app TEXT,
  window_title TEXT,
  source TEXT NOT NULL,
  action TEXT,
  route TEXT,
  provenance_json TEXT,
  timings_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_activities_kind ON activities(kind);
`

export const INSERT_ACTIVITY_SQL = `
INSERT OR IGNORE INTO activities (
  id, kind, created_at, raw_text, final_text, words, duration_ms,
  app, window_title, source, action, route, provenance_json, timings_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

export function activityBind(row: ActivityRecord): unknown[] {
  return [
    row.id,
    row.kind,
    row.createdAt,
    row.rawText,
    row.finalText,
    row.words,
    row.durationMs,
    row.app,
    row.windowTitle,
    row.source,
    row.action ?? null,
    row.route ?? null,
    row.provenance ? JSON.stringify(row.provenance) : null,
    row.timings ? JSON.stringify(row.timings) : null
  ]
}

export function insertActivity(conn: SqliteConn, row: ActivityRecord): boolean {
  const result = conn.prepare(INSERT_ACTIVITY_SQL).run(...activityBind(row))
  return Boolean(result?.changes)
}

export function migrateToActivities(conn: SqliteConn): { copied: number; version: number } {
  conn.exec(CREATE_ACTIVITIES_SQL)
  let copied = 0
  if (userVersion(conn) < ACTIVITIES_SCHEMA_VERSION && tableExists(conn, 'dictations')) {
    const rows = conn.prepare('SELECT * FROM dictations').all()
    for (const row of rows) {
      if (insertActivity(conn, legacyDictationToActivity(row))) copied += 1
    }
  }
  setUserVersion(conn, ACTIVITIES_SCHEMA_VERSION)
  return { copied, version: ACTIVITIES_SCHEMA_VERSION }
}
