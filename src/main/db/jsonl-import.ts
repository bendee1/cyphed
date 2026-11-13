import { existsSync, readFileSync } from 'node:fs'
import { legacyDictationToActivity, type LegacyDictationRow } from './classify.ts'
import { insertActivity } from './migrate.ts'
import type { SqliteConn } from './sqlite.ts'

function asLegacyRow(parsed: Record<string, unknown>): LegacyDictationRow {
  if ('raw_text' in parsed || 'final_text' in parsed) return parsed
  return {
    id: parsed.id,
    raw_text: parsed.rawText,
    final_text: parsed.finalText,
    created_at: parsed.createdAt,
    duration_ms: parsed.durationMs,
    words: parsed.words,
    app: parsed.app,
    window_title: parsed.windowTitle,
    source: parsed.source,
    stt_provider: parsed.sttProvider,
    stt_model: parsed.sttModel,
    stt_latency_ms: parsed.sttLatencyMs,
    cleanup_latency_ms: parsed.cleanupLatencyMs,
    timings_json: parsed.timings ? JSON.stringify(parsed.timings) : parsed.timings_json
  }
}

export function importJsonlHistory(conn: SqliteConn, file: string): number {
  if (!existsSync(file)) return 0
  let n = 0
  const text = readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (insertActivity(conn, legacyDictationToActivity(asLegacyRow(parsed)))) n += 1
    } catch {
      /* skip bad line */
    }
  }
  return n
}
