import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { userDataDir } from '../paths'
import { FREEZE_LOG_MAX_BYTES, freezeLine, phaseAt, phaseLine, trimLog, type Phase } from './freeze-log-core'

// Journal des gels : `freezes.log` dans les données de Cyphed. Quelques lignes par jour, 20 Ko au plus.

/** Dernières étapes, pour retrouver celle qui était en cours au début d'un gel. */
const phases: Phase[] = [{ name: 'démarrage', at: Date.now() }]

/** Chemin du journal (aussi donné à la mesure de mise à jour, qui y écrit elle-même). */
export function freezeLogFile(): string {
  return join(userDataDir(), 'freezes.log')
}

function append(line: string): void {
  const path = freezeLogFile()
  // La mesure de mise à jour (autre processus) peut tenir le fichier un instant : 3 essais à 20 ms.
  for (let i = 0; i < 3; i++) {
    try {
      appendFileSync(path, line, 'utf8')
      break
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  try {
    // Raccourci seulement quand aucune mesure de mise à jour n'a commencé depuis 2 min, pour ne pas perdre ses lignes.
    if (statSync(path).size > FREEZE_LOG_MAX_BYTES && !watchRecent()) {
      writeFileSync(path, trimLog(readFileSync(path, 'utf8')), 'utf8')
    }
  } catch {
    /* le journal ne doit jamais gêner Cyphed */
  }
}

/** Une mesure de mise à jour a-t-elle commencé il y a moins de 2 min (d'après la dernière ligne qu'elle a écrite) ? */
function watchRecent(): boolean {
  try {
    const text = readFileSync(freezeLogFile(), 'utf8')
    const at = text.lastIndexOf('étape : mesure de la mise à jour')
    if (at < 0) return false
    const stampText = text.slice(text.lastIndexOf('\n', at) + 1, at).trim()
    const when = Date.parse(stampText.replace(' ', 'T'))
    return Number.isFinite(when) && Date.now() - when < 120_000
  } catch {
    return false
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
