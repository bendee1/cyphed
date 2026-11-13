import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DictationTimings } from '../../shared/types.ts'
import { userDataDir } from '../paths.ts'

const METRICS_USER_TEXT_KEYS = [
  'rawPreview',
  'rawText',
  'finalText',
  'text',
  'transcript',
  'ocr'
] as const

function elapsed(from?: number, to?: number): number | null {
  if (from == null || to == null) return null
  return to - from
}

export type MetricsInput = {
  sessionId: string
  timings: DictationTimings
  ramBeforeMb: number
  ramAfterMb: number
  sttProvider?: string
  sttModel?: string
}

export function formatMetricsLine(record: MetricsInput): Record<string, string | number | null> {
  return {
    t: new Date().toISOString(),
    sessionId: record.sessionId,
    hotkeyToBarMs: elapsed(record.timings.hotkeyStartMs, record.timings.barShownMs),
    sttOpenMs: elapsed(record.timings.hotkeyStartMs, record.timings.sttOpenMs),
    stopToFinalMs: elapsed(record.timings.stopMs, record.timings.sttFinalMs),
    cleanupMs: elapsed(record.timings.sttFinalMs, record.timings.cleanupMs),
    finalToInsertMs: elapsed(record.timings.cleanupMs ?? record.timings.sttFinalMs, record.timings.insertedMs),
    hotkeyToInsertMs: elapsed(record.timings.hotkeyStartMs, record.timings.insertedMs),
    ramBeforeMb: record.ramBeforeMb,
    ramAfterMb: record.ramAfterMb,
    sttProvider: record.sttProvider ?? null,
    sttModel: record.sttModel ?? null
  }
}

export function logMetrics(record: MetricsInput): void {
  const line = formatMetricsLine(record)
  console.log('[metrics]', JSON.stringify(line))
  appendFileSync(join(userDataDir(), 'metrics.jsonl'), JSON.stringify(line) + '\n', 'utf8')
}

export function metricsHasUserText(line: Record<string, unknown>): boolean {
  return METRICS_USER_TEXT_KEYS.some((key) => key in line)
}

function stripUserTextFromMetricsLine(
  line: Record<string, unknown>
): { clean: Record<string, unknown>; stripped: boolean } {
  const clean: Record<string, unknown> = { ...line }
  let stripped = false
  for (const key of METRICS_USER_TEXT_KEYS) {
    if (key in clean) {
      delete clean[key]
      stripped = true
    }
  }
  return { clean, stripped }
}

export function sanitizeMetricsFile(filePath: string): { rewritten: boolean; strippedLines: number } {
  if (!existsSync(filePath)) return { rewritten: false, strippedLines: 0 }
  const raw = readFileSync(filePath, 'utf8')
  if (!raw) return { rewritten: false, strippedLines: 0 }
  const newline = raw.includes('\r\n') ? '\r\n' : '\n'
  const parts = raw.split(/\r?\n/)
  let strippedLines = 0
  const out: string[] = []
  for (const part of parts) {
    if (part === '') {
      out.push('')
      continue
    }
    try {
      const parsed: unknown = JSON.parse(part)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        out.push(part)
        continue
      }
      const { clean, stripped } = stripUserTextFromMetricsLine(parsed as Record<string, unknown>)
      if (stripped) strippedLines += 1
      out.push(stripped ? JSON.stringify(clean) : part)
    } catch {
      out.push(part)
    }
  }
  if (strippedLines === 0) return { rewritten: false, strippedLines: 0 }
  writeFileSync(filePath, out.join(newline), 'utf8')
  return { rewritten: true, strippedLines }
}
