// Mesures sur l'historique réel : latences, taux de repli, longueur des dictées.
// Usage : node --experimental-sqlite scripts/measure.mjs [--since 2026-10-15T19:30:00Z] [--json]
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const args = process.argv.slice(2)
const sinceIdx = args.indexOf('--since')
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : '1970-01-01T00:00:00Z'
const asJson = args.includes('--json')

const dbPath = join(process.env.APPDATA ?? '', 'cyphed', 'cyphed.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const rows = db
  .prepare(
    "SELECT created_at, raw_text, final_text, words, duration_ms, provenance_json FROM activities WHERE kind = 'dictation' AND source = 'v2' AND created_at >= ? ORDER BY created_at"
  )
  .all(since)

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

let withModel = 0
let fallbacks = 0
const cleanupMs = []
const sttMs = []
const lengths = []
const fallbackReasons = {}

for (const row of rows) {
  let prov = {}
  try {
    prov = JSON.parse(row.provenance_json || '{}')
  } catch {
    // ligne ancienne sans provenance exploitable
  }
  lengths.push(row.raw_text.length)
  if (typeof prov.sttLatencyMs === 'number' && prov.sttLatencyMs > 0) sttMs.push(prov.sttLatencyMs)
  const steps = Array.isArray(prov.steps) ? prov.steps : []
  if (steps.length > 1) {
    withModel++
    if (typeof prov.cleanupLatencyMs === 'number') cleanupMs.push(prov.cleanupLatencyMs)
  } else {
    fallbacks++
    const reason = prov.cleanupFallback ?? 'inconnue (avant la journalisation)'
    fallbackReasons[reason] = (fallbackReasons[reason] ?? 0) + 1
  }
}

const report = {
  since,
  dictations: rows.length,
  cleanedByModel: withModel,
  keptRaw: fallbacks,
  keptRawPercent: rows.length ? Math.round((fallbacks / rows.length) * 100) : 0,
  fallbackReasons,
  cleanupMs: { p50: percentile(cleanupMs, 50), p95: percentile(cleanupMs, 95) },
  sttFinalMs: { p50: percentile(sttMs, 50), p95: percentile(sttMs, 95) },
  rawChars: { p50: percentile(lengths, 50), p95: percentile(lengths, 95) }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Dictées depuis ${since} : ${report.dictations}`)
  console.log(`Nettoyées par le modèle : ${withModel} · texte brut gardé : ${fallbacks} (${report.keptRawPercent} %)`)
  for (const [reason, count] of Object.entries(fallbackReasons)) console.log(`  repli : ${reason} × ${count}`)
  console.log(`Nettoyage ms  p50 ${report.cleanupMs.p50 ?? '-'} · p95 ${report.cleanupMs.p95 ?? '-'}`)
  console.log(`Fin STT ms    p50 ${report.sttFinalMs.p50 ?? '-'} · p95 ${report.sttFinalMs.p95 ?? '-'}`)
  console.log(`Taille brute  p50 ${report.rawChars.p50 ?? '-'} car. · p95 ${report.rawChars.p95 ?? '-'} car.`)
}
