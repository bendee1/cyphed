/**
 * Journal des gels de souris : une ligne par gel mesuré par mouse-helper (« lag <ms> ») et une ligne par étape
 * de Cyphed (démarrage, fermeture, mise à jour, dictée). Lire les deux ensemble dit ce que Cyphed faisait
 * au moment du gel. Pur, sans Electron, pour les tests.
 */

/** Taille au-delà de laquelle on ne garde que la seconde moitié du journal. */
export const FREEZE_LOG_MAX_BYTES = 20_000

/** « 2026-11-13 23:41:07.512 » en heure locale. */
export function stamp(date: Date): string {
  const pad = (n: number, size = 2): string => String(n).padStart(size, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  )
}

export function freezeLine(date: Date, ms: number, phase: string, sincePhaseMs: number): string {
  return `${stamp(date)}  GEL ${ms} ms  (pendant : ${phase}, ${Math.round(sincePhaseMs)} ms après son début)\n`
}

export function phaseLine(date: Date, phase: string): string {
  return `${stamp(date)}  étape : ${phase}\n`
}

/** Garde la fin du journal, à partir d'une ligne entière, quand il dépasse la taille maximale. */
export function trimLog(text: string, max = FREEZE_LOG_MAX_BYTES): string {
  if (Buffer.byteLength(text, 'utf8') <= max) return text
  const tail = text.slice(Math.floor(text.length / 2))
  const cut = tail.indexOf('\n')
  return cut >= 0 ? tail.slice(cut + 1) : tail
}

export type Phase = { name: string; at: number }

/** Étape active à un instant donné (la dernière commencée avant), pour situer le DÉBUT d'un gel. */
export function phaseAt(phases: Phase[], time: number): Phase | null {
  let found: Phase | null = null
  for (const p of phases) if (p.at <= time) found = p
  return found
}

/** Lit une ligne de mouse-helper « lag 157 » : le retard en ms, ou null. */
export function parseLagLine(line: string): number | null {
  const m = /^lag (\d{1,5})$/.exec(line.trim())
  return m ? Number(m[1]) : null
}
