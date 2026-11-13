import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { classifyLegacyKind, legacyDictationToActivity } from '../src/main/db/classify.ts'
import { importJsonlHistory } from '../src/main/db/jsonl-import.ts'
import { filterLegacyHistory, importLegacyHistory } from '../src/main/db/legacy.ts'
import { insertActivity, migrateToActivities, ACTIVITIES_SCHEMA_VERSION } from '../src/main/db/migrate.ts'
import { openSqlite, userVersion } from '../src/main/db/sqlite.ts'
import { migrateLegacyUserFiles } from '../src/main/db/user-files.ts'
import { readActivityStats } from '../src/main/db/stats.ts'
import { IpcGate } from '../src/main/ipc-gate.ts'
import { applySecretOps, publicPayloadHasRawKey, publicSecretsFrom } from '../src/main/secrets-ops.ts'
import { ZoneStore } from '../src/main/services/capture-zone.ts'
import { formatMetricsLine, metricsHasUserText, sanitizeMetricsFile } from '../src/main/services/usage.ts'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function seedDictations(path: string): void {
  const conn = openSqlite(path)
  conn.exec(`
    CREATE TABLE dictations (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      final_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      words INTEGER NOT NULL,
      app TEXT,
      window_title TEXT,
      stt_provider TEXT,
      stt_model TEXT,
      stt_latency_ms INTEGER,
      cleanup_latency_ms INTEGER,
      timings_json TEXT,
      source TEXT NOT NULL DEFAULT 'v2'
    );
  `)
  const insert = conn.prepare(`
    INSERT INTO dictations (
      id, raw_text, final_text, created_at, duration_ms, words,
      app, window_title, stt_provider, stt_model, stt_latency_ms,
      cleanup_latency_ms, timings_json, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run(
    'd1', 'bonjour brut', 'Bonjour.', '2026-09-01T10:00:00.000Z', 1200, 1,
    'Code', 'index.ts', 'deepgram', 'nova-3', 80, 20, '{}', 'v2'
  )
  insert.run(
    'v1-old', 'ancienne dictée python assez longue pour passer', 'ancienne dictée python assez longue pour passer',
    '2024-01-01T00:00:00.000Z', 900, 8, 'python-v1', 'Vocal', 'python-v1', '', 0, null, '{}', 'python-v1'
  )
  insert.run(
    'c-ocr', 'texte ocr', 'texte ocr', '2026-09-03T12:00:00.000Z', 400, 2,
    'Capture', 'ocr', 'mistral-ocr', 'mistral-ocr', 400, null, '{}', 'v2'
  )
  insert.run(
    'c-vis', '', 'explication vision', '2026-09-03T13:00:00.000Z', 500, 2,
    'Capture', 'vision', 'mistral-vision', 'mistral-vision', 500, null, '{}', 'v2'
  )
  insert.run(
    'c-txt', 'collé', 'collé', '2026-09-03T14:00:00.000Z', 200, 1,
    'Capture', 'text', 'paste', 'paste', 200, null, '{}', 'v2'
  )
  conn.close?.()
}

describe('R1 activities migration', () => {
  it('migrates dictations to activities without loss', () => {
    const dir = tempDir('cyphed-mig-')
    const path = join(dir, 'cyphed.db')
    seedDictations(path)
    const conn = openSqlite(path)
    const result = migrateToActivities(conn)
    assert.equal(result.version, ACTIVITIES_SCHEMA_VERSION)
    assert.equal(userVersion(conn), 1)
    assert.equal(result.copied, 5)
    const rows = conn.prepare('SELECT id, kind, source, route, raw_text, final_text, provenance_json FROM activities ORDER BY id').all()
    assert.equal(rows.length, 5)
    const byId = Object.fromEntries(rows.map((row) => [String(row.id), row]))
    assert.equal(byId.d1.kind, 'dictation')
    assert.equal(byId['v1-old'].kind, 'dictation')
    assert.equal(byId['v1-old'].source, 'python-v1')
    assert.equal(byId['c-ocr'].kind, 'capture_ocr')
    assert.equal(byId['c-ocr'].route, 'ocr')
    assert.equal(byId['c-ocr'].raw_text, byId['c-ocr'].final_text)
    assert.equal(JSON.parse(String(byId['c-ocr'].provenance_json)).legacy, true)
    assert.equal(byId['c-vis'].kind, 'capture_vision')
    assert.equal(byId['c-txt'].kind, 'reader_text')
    const again = migrateToActivities(conn)
    assert.equal(again.copied, 0)
    assert.equal(conn.prepare('SELECT COUNT(*) AS n FROM activities').get()?.n, 5)
    conn.close?.()
  })

  it('classifies Capture rows from the stored route', () => {
    assert.deepEqual(classifyLegacyKind('Capture', 'ocr', 'v2'), { kind: 'capture_ocr', source: 'v2', route: 'ocr' })
    assert.deepEqual(classifyLegacyKind('Capture', 'vision', 'v2'), { kind: 'capture_vision', source: 'v2', route: 'vision' })
    assert.deepEqual(classifyLegacyKind('Capture', 'text', 'v2'), { kind: 'reader_text', source: 'v2', route: 'text' })
    assert.equal(classifyLegacyKind('python-v1', 'Vocal', '').kind, 'dictation')
    const migrated = legacyDictationToActivity({
      id: 'x',
      raw_text: 'same',
      final_text: 'same',
      app: 'Capture',
      window_title: 'ocr',
      source: 'v2'
    })
    assert.equal(migrated.provenance?.legacy, true)
    assert.equal(migrated.provenance?.migrated, true)
  })

  it('keeps imported Python history as dictation + python-v1', () => {
    const text = 'hier on a décidé de garder le moteur dictée dans cyphed'
    const kept = filterLegacyHistory([
      { ts: '2023-05-01T00:00:00.000Z', text, words: 11 },
      { ts: '2023-05-01T00:00:01.000Z', text: 'ok', words: 1 }
    ])
    assert.equal(kept.length, 1)
    assert.equal(kept[0].kind, 'dictation')
    assert.equal(kept[0].source, 'python-v1')
    const dir = tempDir('cyphed-v1-')
    const dbPath = join(dir, 'cyphed.db')
    const history = join(dir, 'history.json')
    writeFileSync(history, JSON.stringify({ history: [{ ts: '2023-05-01T00:00:00.000Z', text, words: 11 }] }))
    const conn = openSqlite(dbPath)
    migrateToActivities(conn)
    const n = importLegacyHistory(conn, history)
    assert.equal(n, 1)
    const row = conn.prepare('SELECT kind, source FROM activities WHERE id = ?').get('v1-2023-05-01T00:00:00.000Z')
    assert.equal(row?.kind, 'dictation')
    assert.equal(row?.source, 'python-v1')
    assert.equal(importLegacyHistory(conn, history), 0)
    conn.close?.()
  })
})

describe('R1 reader raw/final and stats', () => {
  it('stores distinct raw and final for a reader activity', () => {
    const dir = tempDir('cyphed-reader-')
    const path = join(dir, 'cyphed.db')
    const conn = openSqlite(path)
    migrateToActivities(conn)
    insertActivity(conn, {
      kind: 'capture_ocr',
      id: 'r1',
      createdAt: new Date().toISOString(),
      rawText: 'Hello world from OCR',
      finalText: 'Bonjour le monde.',
      words: 3,
      durationMs: 100,
      app: 'Capture',
      windowTitle: 'ocr',
      source: 'v2',
      route: 'ocr',
      provenance: { steps: ['mistral-ocr', 'cerebras'] }
    })
    const row = conn.prepare('SELECT raw_text, final_text, kind FROM activities WHERE id = ?').get('r1')
    assert.equal(row?.kind, 'capture_ocr')
    assert.equal(row?.raw_text, 'Hello world from OCR')
    assert.equal(row?.final_text, 'Bonjour le monde.')
    conn.close?.()
  })

  it('computes stats by kind for the last 30 days', () => {
    const dir = tempDir('cyphed-stats-')
    const conn = openSqlite(join(dir, 'cyphed.db'))
    migrateToActivities(conn)
    const now = new Date().toISOString()
    insertActivity(conn, {
      kind: 'dictation',
      id: 's-d',
      createdAt: now,
      rawText: 'a',
      finalText: 'a b c',
      words: 3,
      durationMs: 1,
      app: 'Code',
      windowTitle: 'x',
      source: 'v2'
    })
    insertActivity(conn, {
      kind: 'capture_ocr',
      id: 's-c',
      createdAt: now,
      rawText: 'z',
      finalText: 'z',
      words: 1,
      durationMs: 1,
      app: 'Capture',
      windowTitle: 'ocr',
      source: 'v2',
      route: 'ocr'
    })
    insertActivity(conn, {
      kind: 'dictation',
      id: 's-old',
      createdAt: '2020-01-01T00:00:00.000Z',
      rawText: 'old',
      finalText: 'old',
      words: 10,
      durationMs: 1,
      app: 'Code',
      windowTitle: 'x',
      source: 'v2'
    })
    insertActivity(conn, {
      kind: 'reader_text',
      id: 's-rt',
      createdAt: now,
      rawText: 'collé',
      finalText: 'résumé',
      words: 5,
      durationMs: 1,
      app: 'Capture',
      windowTitle: 'text',
      source: 'v2',
      route: 'text'
    })
    insertActivity(conn, {
      kind: 'capture_vision',
      id: 's-v',
      createdAt: now,
      rawText: '',
      finalText: 'vue',
      words: 2,
      durationMs: 1,
      app: 'Capture',
      windowTitle: 'vision',
      source: 'v2',
      route: 'vision'
    })
    const stats = readActivityStats(conn, 30)
    assert.equal(stats.dictations, 1)
    assert.equal(stats.captures, 2)
    assert.equal(stats.words, 11)
    assert.equal(stats.totalActivities, 4)
    assert.equal(stats.periodDays, 30)
    assert.equal(stats.periodLabel, '30 derniers jours')
    conn.close?.()
  })
})

describe('R1 secrets', () => {
  it('does not change secrets when a settings save omits them', () => {
    const current = { deepgram: 'DG', cerebras: 'CB', mistral: 'MI', elevenlabs: 'EL' }
    const next = applySecretOps(current, {})
    assert.deepEqual(next, current)
    const languageOnly = applySecretOps(current, { deepgram: undefined, cerebras: undefined })
    assert.deepEqual(languageOnly, current)
  })

  it('applies explicit set and clear', () => {
    const current = { deepgram: 'DG', cerebras: 'CB', mistral: '', elevenlabs: '' }
    const set = applySecretOps(current, { deepgram: { set: ' NEW ' } })
    assert.equal(set.deepgram, 'NEW')
    assert.equal(set.cerebras, 'CB')
    const cleared = applySecretOps(current, { cerebras: { clear: true } })
    assert.equal(cleared.cerebras, '')
    assert.equal(cleared.deepgram, 'DG')
  })

  it('exposes only configured/source, never a stored key', () => {
    const payload = publicSecretsFrom(
      { deepgram: 'sk-secret-value', cerebras: '', mistral: '', elevenlabs: '' },
      { deepgram: false, cerebras: true, mistral: false, elevenlabs: false }
    )
    assert.deepEqual(payload.deepgram, { configured: true, source: 'stored' })
    assert.deepEqual(payload.cerebras, { configured: true, source: 'env' })
    assert.equal(publicPayloadHasRawKey(payload as unknown as Record<string, unknown>), false)
    assert.notEqual(JSON.stringify(payload).includes('sk-secret-value'), true)
  })
})

describe('R1 IPC gate', () => {
  it('rejects a Bar sender on Settings/Reader and a Hub sender on audioFrame', () => {
    const gate = new IpcGate()
    gate.setBar(1)
    gate.setHub(2)
    gate.registerCapture(3)
    assert.throws(() => gate.assert({ sender: { id: 1 } }, 'hub'), /IPC forbidden/)
    assert.throws(() => gate.assert({ sender: { id: 2 } }, 'bar'), /IPC forbidden/)
    assert.doesNotThrow(() => gate.assert({ sender: { id: 2 } }, 'hub'))
    assert.doesNotThrow(() => gate.assert({ sender: { id: 1 } }, 'bar'))
    assert.equal(gate.allowMedia(1), true)
    assert.equal(gate.allowMedia(2), false)
  })

  it('rejects a fake window on capturePick', () => {
    const gate = new IpcGate()
    gate.setHub(2)
    gate.registerCapture(3)
    assert.throws(() => gate.assert({ sender: { id: 99 } }, 'capture'), /unknown/)
    assert.doesNotThrow(() => gate.assert({ sender: { id: 3 } }, 'capture'))
  })
})

describe('R1 capture / metrics / AppData', () => {
  it('takeZone() returns the PNG then clears it', () => {
    const zone = new ZoneStore()
    zone.put(Buffer.from('png'))
    assert.equal(zone.peek()?.toString(), 'png')
    assert.equal(zone.take()?.toString(), 'png')
    assert.equal(zone.take(), null)
    assert.equal(zone.peek(), null)
  })

  it('metrics lines contain no user text', () => {
    const line = formatMetricsLine({
      sessionId: 'abc',
      timings: { hotkeyStartMs: 1, barShownMs: 2, insertedMs: 9 },
      ramBeforeMb: 10,
      ramAfterMb: 12,
      sttProvider: 'deepgram',
      sttModel: 'nova-3'
    })
    assert.equal(metricsHasUserText(line), false)
    assert.equal('rawPreview' in line, false)
    assert.equal(line.sessionId, 'abc')
    assert.equal(line.sttProvider, 'deepgram')
  })

  it('strips rawPreview and user text from metrics.jsonl and stays idempotent', () => {
    const dir = tempDir('cyphed-metrics-')
    const file = join(dir, 'metrics.jsonl')
    const dirty = [
      JSON.stringify({
        sessionId: '1',
        ramBeforeMb: 10,
        rawPreview: 'bonjour la dictée',
        rawText: 'bonjour la dictée'
      }),
      JSON.stringify({ sessionId: '2', sttProvider: 'deepgram' }),
      '{not-json'
    ].join('\n') + '\n'
    writeFileSync(file, dirty)
    const missing = sanitizeMetricsFile(join(dir, 'absent.jsonl'))
    assert.deepEqual(missing, { rewritten: false, strippedLines: 0 })
    const first = sanitizeMetricsFile(file)
    assert.equal(first.rewritten, true)
    assert.equal(first.strippedLines, 1)
    const after = readFileSync(file, 'utf8')
    assert.equal(after.includes('rawPreview'), false)
    assert.equal(after.includes('bonjour'), false)
    assert.ok(after.includes('"sessionId":"1"'))
    assert.ok(after.includes('"ramBeforeMb":10'))
    assert.ok(after.includes('{not-json'))
    const second = sanitizeMetricsFile(file)
    assert.deepEqual(second, { rewritten: false, strippedLines: 0 })
    assert.equal(readFileSync(file, 'utf8'), after)
  })

  it('copies legacy user-data to AppData once and stays idempotent', () => {
    const src = tempDir('cyphed-src-')
    const dest = tempDir('cyphed-dest-')
    writeFileSync(join(src, 'settings.json'), '{"hotkey":"Control+Shift+Space"}')
    writeFileSync(join(src, 'secrets.json'), '{"deepgram":"DG"}')
    writeFileSync(join(src, 'metrics.jsonl'), '{"sessionId":"1"}\n')
    writeFileSync(join(src, 'cyphed.db'), 'sqlite')
    const first = migrateLegacyUserFiles(src, dest)
    assert.ok(first.includes('cyphed.db'))
    assert.ok(first.includes('settings.json'))
    assert.ok(first.includes('secrets.json'))
    assert.equal(readFileSync(join(dest, 'secrets.json'), 'utf8'), '{"deepgram":"DG"}')
    writeFileSync(join(src, 'secrets.json'), '{"deepgram":"CHANGED"}')
    const second = migrateLegacyUserFiles(src, dest)
    assert.deepEqual(second, [])
    assert.equal(readFileSync(join(dest, 'secrets.json'), 'utf8'), '{"deepgram":"DG"}')
    assert.equal(existsSync(join(src, 'secrets.json')), true)
  })

  it('imports leftover jsonl into activities without using it as a live DB', () => {
    const dir = tempDir('cyphed-jsonl-')
    const dbPath = join(dir, 'cyphed.db')
    const jsonl = join(dir, 'dictations.jsonl')
    writeFileSync(
      jsonl,
      `${JSON.stringify({
        id: 'jl1',
        rawText: 'from jsonl',
        finalText: 'from jsonl',
        createdAt: '2026-08-01T00:00:00.000Z',
        durationMs: 1,
        words: 2,
        app: 'Code',
        windowTitle: 'x',
        source: 'v2'
      })}\n`
    )
    const conn = openSqlite(dbPath)
    migrateToActivities(conn)
    assert.equal(importJsonlHistory(conn, jsonl), 1)
    assert.equal(importJsonlHistory(conn, jsonl), 0)
    const row = conn.prepare('SELECT kind FROM activities WHERE id = ?').get('jl1')
    assert.equal(row?.kind, 'dictation')
    conn.close?.()
  })
})
