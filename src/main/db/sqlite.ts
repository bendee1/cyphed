import { createRequire } from 'node:module'

type SqliteStatement = {
  run: (...args: unknown[]) => { changes?: number }
  all: (...args: unknown[]) => Record<string, unknown>[]
  get: (...args: unknown[]) => Record<string, unknown> | undefined
}

export type SqliteConn = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close?: () => void
}

export function openSqlite(path: string): SqliteConn {
  const require = createRequire(import.meta.url)
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (file: string) => SqliteConn
  }
  const conn = new DatabaseSync(path)
  // Plusieurs lecteurs (Hub, import, scripts) : attendre un verrou plutôt que lever tout de suite ; WAL pour ne pas bloquer les lectures.
  try {
    conn.exec('PRAGMA busy_timeout = 3000')
    conn.exec('PRAGMA journal_mode = WAL')
  } catch (err) {
    try {
      conn.close?.()
    } catch {
      /* déjà fermée */
    }
    throw err
  }
  return conn
}

export function tableExists(conn: SqliteConn, name: string): boolean {
  const row = conn.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name)
  return Boolean(row)
}

export function userVersion(conn: SqliteConn): number {
  const row = conn.prepare('PRAGMA user_version').get() ?? {}
  return Number(row.user_version ?? 0)
}

export function setUserVersion(conn: SqliteConn, version: number): void {
  conn.exec(`PRAGMA user_version = ${Number(version)}`)
}
