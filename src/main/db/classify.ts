import type { ActivityKind, ActivityProvenance, ActivityRecord, DictationTimings } from '../../shared/types.ts'

export type LegacyDictationRow = {
  id?: unknown
  raw_text?: unknown
  final_text?: unknown
  created_at?: unknown
  duration_ms?: unknown
  words?: unknown
  app?: unknown
  window_title?: unknown
  source?: unknown
  stt_provider?: unknown
  stt_model?: unknown
  stt_latency_ms?: unknown
  cleanup_latency_ms?: unknown
  timings_json?: unknown
}

export function classifyLegacyKind(app: string, windowTitle: string, source: string): {
  kind: ActivityKind
  source: string
  route?: ActivityRecord['route']
} {
  const src = source.trim()
  const appKey = app.trim().toLowerCase()
  const title = windowTitle.trim().toLowerCase()
  if (src === 'python-v1' || appKey === 'python-v1') {
    return { kind: 'dictation', source: 'python-v1' }
  }
  if (appKey === 'capture') {
    if (title === 'vision') return { kind: 'capture_vision', source: src || 'v2', route: 'vision' }
    if (title === 'text') return { kind: 'reader_text', source: src || 'v2', route: 'text' }
    if (title === 'ocr') return { kind: 'capture_ocr', source: src || 'v2', route: 'ocr' }
    return { kind: 'capture_ocr', source: src || 'v2' }
  }
  return { kind: 'dictation', source: src || 'v2' }
}

export function legacyDictationToActivity(row: LegacyDictationRow): ActivityRecord {
  const rawText = String(row.raw_text ?? '')
  const finalText = String(row.final_text ?? '')
  const app = String(row.app ?? '')
  const windowTitle = String(row.window_title ?? '')
  const source = String(row.source ?? '')
  const classified = classifyLegacyKind(app, windowTitle, source)
  const readerLike = classified.kind !== 'dictation'
  const provenance: ActivityProvenance = {
    migrated: true,
    legacy: readerLike && rawText === finalText,
    sttProvider: row.stt_provider == null ? undefined : String(row.stt_provider),
    sttModel: row.stt_model == null ? undefined : String(row.stt_model),
    sttLatencyMs: row.stt_latency_ms == null ? undefined : Number(row.stt_latency_ms),
    cleanupLatencyMs: row.cleanup_latency_ms == null ? null : Number(row.cleanup_latency_ms)
  }
  let timings: DictationTimings | undefined
  if (typeof row.timings_json === 'string' && row.timings_json) {
    try {
      timings = JSON.parse(row.timings_json) as DictationTimings
    } catch {
      timings = undefined
    }
  }
  return {
    kind: classified.kind,
    id: String(row.id ?? ''),
    createdAt: String(row.created_at ?? ''),
    rawText,
    finalText,
    words: Number(row.words ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    app,
    windowTitle,
    source: classified.source,
    route: classified.route,
    provenance,
    timings
  }
}
