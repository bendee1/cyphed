// Prépare un jeu d'entraînement local pour un futur petit modèle de mise en forme (brut -> texte final).
// Usage : node --experimental-sqlite --experimental-strip-types --no-warnings scripts/export-dataset.mts [--out chemin.jsonl] [--since 2026-10-15T21:00:00Z]
// Le fichier reste sur la machine (par défaut dans le dossier de données de Cyphed, jamais dans le dépôt).
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardCleanup } from '../src/main/services/output-guard.ts'
import { maskSensitive } from '../src/main/services/secret-token-core.ts'

const args = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const since = option('--since') ?? '1970-01-01T00:00:00Z'
const dataDir = join(process.env.APPDATA ?? '', 'cyphed')
const out = resolve(option('--out') ?? join(dataDir, 'dataset.jsonl'))

// Le jeu contient des dictées personnelles : jamais dans le dépôt Git (le dossier parent de v2/).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const rel = relative(repoRoot, out)
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
  console.error(`Refusé : --out ${out} est dans le dépôt (${repoRoot}${sep}). Choisis un dossier hors du dépôt.`)
  process.exit(1)
}

const db = new DatabaseSync(join(dataDir, 'cyphed.db'), { readOnly: true })
const rows = db
  .prepare(
    "SELECT id, created_at, raw_text, final_text, app, provenance_json FROM activities WHERE kind = 'dictation' AND source = 'v2' AND created_at >= ? ORDER BY created_at"
  )
  .all(since) as Array<Record<string, string>>

const skipped: Record<string, number> = {}
const skip = (why: string): void => {
  skipped[why] = (skipped[why] ?? 0) + 1
}

const lines: string[] = []
let gold = 0
let silver = 0
for (const row of rows) {
  let prov: Record<string, unknown> = {}
  try {
    prov = JSON.parse(row.provenance_json || '{}')
  } catch {
    skip('provenance illisible')
    continue
  }
  const steps = Array.isArray(prov.steps) ? prov.steps : []
  if (steps.length < 2) {
    skip('texte brut gardé (pas de nettoyage par le modèle)')
    continue
  }
  if (prov.transform) {
    skip('réécrit par une transform (pas un simple nettoyage)')
    continue
  }
  // E-mails, suites de 6 chiffres ou plus et jetons sont masqués avant d'écrire quoi que ce soit.
  const raw = maskSensitive(row.raw_text.trim())
  const target = maskSensitive(row.final_text.trim())
  if (raw.length < 12 || !target) {
    skip('trop court')
    continue
  }
  const corrected = prov.corrected === true
  // Une correction faite par la personne fait foi. Un texte du modèle doit passer la même garde qu'à l'usage.
  if (!corrected && !guardCleanup(raw, target).ok) {
    skip('sortie refusée par la garde')
    continue
  }
  if (corrected) gold++
  else silver++
  lines.push(
    JSON.stringify({
      id: row.id,
      raw,
      target,
      label: corrected ? 'gold' : 'silver',
      ...(corrected && typeof prov.modelText === 'string' ? { modelText: maskSensitive(prov.modelText) } : {}),
      app: row.app,
      createdAt: row.created_at
    })
  )
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8')
console.log(JSON.stringify({ file: out, dictations: rows.length, kept: lines.length, gold, silver, skipped }, null, 2))
