import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActivityRecord } from '../../shared/types.ts'
import { projectRoot } from '../paths.ts'
import { insertActivity } from './migrate.ts'
import type { SqliteConn } from './sqlite.ts'

type LegacyEntry = {
  ts?: string
  text?: string
  words?: number
  duration_s?: number
  mode?: string
}

const MIN_WORDS = 8
const COMMAND =
  /^(drop|envoie|slide|enter|entrez|no|ok|okay|merci|thank you|touche entr[ée]e|wasabi|europe|on voit)\.?$/i
const MIC_TEST =
  /est-ce que tu (m['’ ]?entends|vois|arrives|retranscri)|tu m['’]?entends ou pas|all[oô],?\s*est-ce que|retranscri(s|re) ce que/i
const LLM_DUMP =
  /^(voici une |il semble que vous |pour changer ["«]|#{1,3} )/i
const LLM_BODY =
  /\*\*Contexte|\blorem ipsum\b|je comprends que vous souhaitez/i

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function dropReason(text: string, words: number): string | null {
  const t = text.trim()
  if (!t) return 'empty'
  if (words < MIN_WORDS) return `short<${MIN_WORDS}`
  if (COMMAND.test(t)) return 'command'
  if (MIC_TEST.test(t) && words < 28) return 'mic-test'
  if (LLM_DUMP.test(t) || LLM_BODY.test(t)) return 'llm-dump'
  if (t.split('\n').length >= 7 && (t.includes('```') || (t.match(/#/g) ?? []).length >= 3)) {
    return 'markdown-dump'
  }
  if ((t.match(/\|/g) ?? []).length >= 6) return 'markdown-dump'
  return null
}

export function filterLegacyHistory(entries: LegacyEntry[]): ActivityRecord[] {
  const seen = new Set<string>()
  const kept: ActivityRecord[] = []
  for (const e of entries) {
    const text = (e.text ?? '').trim()
    const words = e.words || wordCount(text)
    if (dropReason(text, words)) continue
    const key = text.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    const ts = e.ts || new Date().toISOString()
    kept.push({
      kind: 'dictation',
      id: `v1-${ts}`,
      rawText: text,
      finalText: text,
      createdAt: ts,
      durationMs: Math.round((e.duration_s || 0) * 1000),
      words,
      app: 'python-v1',
      windowTitle: e.mode || 'Vocal',
      source: 'python-v1',
      provenance: { steps: ['python-v1'] },
      timings: { hotkeyStartMs: 0 }
    })
  }
  return kept
}

export function importLegacyHistory(conn: SqliteConn, historyFile?: string): number {
  const file = historyFile ?? join(projectRoot(), '..', 'history.json')
  if (!existsSync(file)) return 0
  let parsed: { history?: LegacyEntry[] }
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as { history?: LegacyEntry[] }
  } catch {
    return 0
  }
  let n = 0
  for (const row of filterLegacyHistory(parsed.history ?? [])) {
    if (insertActivity(conn, row)) n += 1
  }
  return n
}
