import { existsSync, renameSync } from 'node:fs'
import { stampForFile } from '../services/json-file.ts'
import { join } from 'node:path'
import type { ActivityRecord, HubStats } from '../../shared/types.ts'
import { ACTIVITY_STATS_PERIOD_DAYS } from '../../shared/types.ts'
import { userDataDir } from '../paths.ts'
import { importJsonlHistory } from './jsonl-import'
import { importLegacyHistory } from './legacy'
import { activityBind, INSERT_ACTIVITY_SQL, migrateToActivities } from './migrate'
import { readActivityStats } from './stats'
import { openSqlite, type SqliteConn } from './sqlite'
import { tm } from '../lang.ts'

export type ActivitiesDb = {
  insertActivity: (row: ActivityRecord) => void
  listActivities: (query?: string, limit?: number) => ActivityRecord[]
  stats: (periodDays?: number) => HubStats
  getActivity: (id: string) => ActivityRecord | null
  dictationRows: () => Array<{ createdAt: string; words: number; durationMs: number; app: string; windowTitle: string }>
  updateFinalText: (id: string, text: string) => boolean
  /** Texte refait par le bouton Réessayer. */
  updateRetry: (id: string, next: Pick<ActivityRecord, 'rawText' | 'finalText' | 'words' | 'provenance'>) => boolean
  /** Efface l'historique plus ancien que cette date (ISO). Rend le nombre de lignes effacées. */
  deleteBefore: (isoDate: string) => number
  /** Toutes les dictées réussies, de la plus ancienne à la plus récente (export). */
  exportDictations: () => ActivityRecord[]
}

let db: ActivitiesDb | null = null
let conn: SqliteConn | null = null

function rowToActivity(row: Record<string, unknown>): ActivityRecord {
  let provenance: ActivityRecord['provenance']
  if (typeof row.provenance_json === 'string' && row.provenance_json) {
    try {
      provenance = JSON.parse(row.provenance_json) as ActivityRecord['provenance']
    } catch {
      provenance = undefined
    }
  }
  let timings: ActivityRecord['timings']
  if (typeof row.timings_json === 'string' && row.timings_json) {
    try {
      timings = JSON.parse(row.timings_json) as ActivityRecord['timings']
    } catch {
      timings = undefined
    }
  }
  const route = row.route
  return {
    kind: row.kind as ActivityRecord['kind'],
    id: String(row.id),
    createdAt: String(row.created_at ?? ''),
    rawText: String(row.raw_text ?? ''),
    finalText: String(row.final_text ?? ''),
    words: Number(row.words ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    app: String(row.app ?? ''),
    windowTitle: String(row.window_title ?? ''),
    source: String(row.source ?? ''),
    action: row.action == null ? undefined : String(row.action),
    route: route === 'ocr' || route === 'vision' || route === 'text' ? route : undefined,
    provenance,
    timings
  }
}

/** Ouvre la base ; en cas d'échec la connexion est fermée (sinon Windows refuse de renommer un fichier abîmé). */
function openActivitiesDb(path: string): { api: ActivitiesDb; conn: SqliteConn } {
  const sqlite = openSqlite(path)
  try {
    return buildActivitiesDb(sqlite)
  } catch (err) {
    try {
      sqlite.close?.()
    } catch {
      /* déjà fermée */
    }
    throw err
  }
}

function buildActivitiesDb(sqlite: SqliteConn): { api: ActivitiesDb; conn: SqliteConn } {
  const migrated = migrateToActivities(sqlite)
  if (migrated.copied) console.log(`[db] migration dictations → activities: ${migrated.copied}`)
  try {
    const imported = importLegacyHistory(sqlite)
    if (imported) console.log(`[db] import python-v1: ${imported} dictées`)
  } catch (err) {
    console.warn('[db] legacy import skipped', err)
  }
  const jsonl = join(userDataDir(), 'dictations.jsonl')
  try {
    const n = importJsonlHistory(sqlite, jsonl)
    if (n) console.log(`[db] import jsonl: ${n} depuis ${jsonl}`)
  } catch (err) {
    console.warn('[db] jsonl import skipped', err)
  }

  const insert = sqlite.prepare(INSERT_ACTIVITY_SQL)
  const list = sqlite.prepare(`
    SELECT * FROM activities
    WHERE (
      ? = '' OR final_text LIKE ? ESCAPE '!' OR raw_text LIKE ? ESCAPE '!' OR app LIKE ? ESCAPE '!'
      OR window_title LIKE ? ESCAPE '!' OR kind LIKE ? ESCAPE '!' OR source LIKE ? ESCAPE '!'
    )
    ORDER BY created_at DESC
    LIMIT ?
  `)
  const rows = sqlite.prepare("SELECT created_at, words, duration_ms, app, window_title FROM activities WHERE kind = 'dictation' ORDER BY created_at DESC LIMIT 50000")
  const getOne = sqlite.prepare('SELECT * FROM activities WHERE id = ?')
  const deleteOld = sqlite.prepare('DELETE FROM activities WHERE created_at < ?')
  const exportAll = sqlite.prepare("SELECT * FROM activities WHERE kind = 'dictation' AND final_text <> '' ORDER BY created_at ASC")
  const updateText = sqlite.prepare('UPDATE activities SET final_text = ?, words = ? WHERE id = ?')
  const updateProvenance = sqlite.prepare('UPDATE activities SET provenance_json = ? WHERE id = ?')
  const updateRetried = sqlite.prepare(
    'UPDATE activities SET raw_text = ?, final_text = ?, words = ?, provenance_json = ? WHERE id = ?'
  )
  return {
    conn: sqlite,
    api: {
      insertActivity(row) {
        insert.run(...activityBind(row))
      },
      deleteBefore(isoDate) {
        return Number(deleteOld.run(isoDate).changes ?? 0)
      },
      exportDictations() {
        return exportAll.all().map(rowToActivity)
      },
      listActivities(query = '', limit = 40) {
        const q = query.trim()
        // « 100% » ou « a_b » se cherchent tels quels : % et _ ne sont pas des jokers.
        const like = `%${q.replace(/[!%_]/g, (c) => '!' + c)}%`
        return list.all(q, like, like, like, like, like, like, limit).map(rowToActivity)
      },
      dictationRows() {
        return rows.all().map((r) => ({
          createdAt: String((r as Record<string, unknown>).created_at ?? ''),
          words: Number((r as Record<string, unknown>).words ?? 0),
          durationMs: Number((r as Record<string, unknown>).duration_ms ?? 0),
          app: String((r as Record<string, unknown>).app ?? ''),
          windowTitle: String((r as Record<string, unknown>).window_title ?? '')
        }))
      },
      getActivity(id) {
        const row = getOne.get(id)
        return row ? rowToActivity(row as Record<string, unknown>) : null
      },
      updateFinalText(id, text) {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0
        const row = getOne.get(id) as Record<string, unknown> | undefined
        const changed = Number(updateText.run(text, words, id).changes) > 0
        if (changed && row) {
          // Garde le texte du modèle avant la première correction : c'est la paire (modèle, personne) qui sert à entraîner.
          let prov: NonNullable<ActivityRecord['provenance']> = { steps: [] }
          try {
            if (typeof row.provenance_json === 'string' && row.provenance_json) prov = JSON.parse(row.provenance_json)
          } catch {
            /* provenance illisible : on repart d'une base vide */
          }
          if (!prov.corrected) prov.modelText = String(row.final_text ?? '')
          prov.corrected = true
          updateProvenance.run(JSON.stringify(prov), id)
        }
        return changed
      },
      updateRetry(id, next) {
        const changes = updateRetried.run(next.rawText, next.finalText, next.words, JSON.stringify(next.provenance ?? {}), id).changes
        return Number(changes) > 0
      },
      stats(periodDays = ACTIVITY_STATS_PERIOD_DAYS) {
        return readActivityStats(sqlite, periodDays)
      }
    }
  }
}

let recovery: string | null = null

/** Message à montrer une fois si la base a été jugée corrompue et remplacée (puis oublié). */
export function takeDbRecovery(): string | null {
  const message = recovery
  recovery = null
  return message
}

/** Vrai seulement pour une base abîmée, pas pour un module SQLite absent ou un bogue de migration. */
export function isCorruptionError(message: string): boolean {
  return /malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB|disk image/i.test(message)
}

function quarantineDb(path: string): string {
  const target = `${path}.corrupt-${stampForFile()}`
  renameSync(path, target)
  for (const suffix of ['-wal', '-shm']) {
    try {
      if (existsSync(path + suffix)) renameSync(path + suffix, target + suffix)
    } catch {
      /* fichier annexe verrouillé : la base neuve repart de toute façon sans lui */
    }
  }
  return target
}

export function getDb(): ActivitiesDb {
  if (db) return db
  const dir = userDataDir()
  const path = join(dir, 'cyphed.db')
  try {
    const opened = openActivitiesDb(path)
    db = opened.api
    conn = opened.conn
    return db
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (existsSync(path) && isCorruptionError(message)) {
      // Base illisible : on la met de côté (jamais supprimée) et on repart d'une base neuve.
      const moved = quarantineDb(path)
      recovery = tm('notice.dbUnreadable', { path: moved })
      console.error('[db] base illisible, renommée en', moved)
      try {
        const opened = openActivitiesDb(path)
        db = opened.api
        conn = opened.conn
        return db
      } catch (err2) {
        const m2 = err2 instanceof Error ? err2.message : String(err2)
        throw new Error(`SQLite indisponible (${m2}). Pas de fallback JSONL.`)
      }
    }
    throw new Error(`SQLite indisponible (${message}). Pas de fallback JSONL.`)
  }
}
