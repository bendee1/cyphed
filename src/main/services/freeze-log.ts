import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { userDataDir } from '../paths'
import { FREEZE_LOG_MAX_BYTES, freezeLine, phaseAt, phaseLine, trimLog, type Phase } from './freeze-log-core'

// Journal des gels : `freezes.log` dans les données de Cyphed. Quelques lignes par jour, 20 Ko au plus.

/** Dernières étapes, pour retrouver celle qui était en cours au début d'un gel. */
const phases: Phase[] = [{ name: 'démarrage', at: Date.now() }]

function file(): string {
  return join(userDataDir(), 'freezes.log')
}

function append(line: string): void {
  try {
    const path = file()
    appendFileSync(path, line, 'utf8')
    if (statSync(path).size > FREEZE_LOG_MAX_BYTES) writeFileSync(path, trimLog(readFileSync(path, 'utf8')), 'utf8')
  } catch {
    /* le journal ne doit jamais gêner Cyphed */
  }
}

/** Note l'étape en cours de Cyphed (et l'écrit, pour situer les gels qui suivent). */
export function markPhase(name: string): void {
  phases.push({ name, at: Date.now() })
  if (phases.length > 20) phases.shift()
  append(phaseLine(new Date(), name))
}

/** Gel mesuré par mouse-helper : signalé à sa fin, daté et situé à son début. */
export function recordFreeze(ms: number): void {
  const start = Date.now() - ms
  const phase = phaseAt(phases, start) ?? phases[0]
  append(freezeLine(new Date(start), ms, phase.name, start - phase.at))
  console.warn(`[freeze] souris gelée ${ms} ms (pendant : ${phase.name})`)
}
