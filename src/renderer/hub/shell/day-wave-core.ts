/** « Onde du jour » : les mots dictés aujourd'hui, par tranche de 15 minutes, de 7 h à 23 h (élargie si on dicte plus tôt ou plus tard). */

export type WaveInput = { createdAt: string; words: number }
export type DayWave = { startHour: number; endHour: number; slots: number[]; total: number; max: number }

const SLOT_MIN = 15

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function buildDayWave(rows: WaveInput[], now: Date = new Date()): DayWave {
  const today = rows
    .map((row) => ({ at: new Date(row.createdAt), words: Math.max(0, row.words || 0) }))
    .filter((row) => !Number.isNaN(row.at.getTime()) && sameDay(row.at, now))
  let startHour = 7
  let endHour = 23
  for (const row of today) {
    startHour = Math.min(startHour, row.at.getHours())
    endHour = Math.max(endHour, row.at.getHours() + 1)
  }
  const perHour = 60 / SLOT_MIN
  const slots = new Array<number>((endHour - startHour) * perHour).fill(0)
  let total = 0
  for (const row of today) {
    const index = (row.at.getHours() - startHour) * perHour + Math.floor(row.at.getMinutes() / SLOT_MIN)
    slots[index] += row.words
    total += row.words
  }
  return { startHour, endHour, slots, total, max: Math.max(0, ...slots) }
}

/** Graduations de l'axe : toutes les 3 heures depuis le début. */
export function waveTicks(wave: DayWave): number[] {
  const ticks: number[] = []
  for (let h = wave.startHour; h <= wave.endHour; h += 3) ticks.push(h)
  return ticks
}
