import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildDayWave, waveTicks } from '../src/renderer/hub/shell/day-wave-core.ts'

const now = new Date(2026, 10, 13, 15, 0)
const at = (h: number, m: number, day = 13): string => new Date(2026, 10, day, h, m).toISOString()

describe('onde du jour', () => {
  it('range les mots d’aujourd’hui par tranche de 15 min, de 7 h à 23 h', () => {
    const wave = buildDayWave([{ createdAt: at(7, 0), words: 10 }, { createdAt: at(7, 14), words: 5 }, { createdAt: at(14, 32), words: 21 }], now)
    assert.equal(wave.startHour, 7)
    assert.equal(wave.endHour, 23)
    assert.equal(wave.slots.length, 64)
    assert.equal(wave.slots[0], 15)
    assert.equal(wave.slots[(14 - 7) * 4 + 2], 21)
    assert.equal(wave.total, 36)
    assert.equal(wave.max, 21)
  })

  it('ignore les autres jours et élargit l’axe pour une dictée de nuit', () => {
    const wave = buildDayWave([{ createdAt: at(5, 50), words: 8 }, { createdAt: at(10, 0, 12), words: 99 }], now)
    assert.equal(wave.startHour, 5)
    assert.equal(wave.total, 8)
    assert.equal(wave.slots[3], 8)
  })

  it('jour vide : axe par défaut, rien à afficher', () => {
    const wave = buildDayWave([], now)
    assert.equal(wave.total, 0)
    assert.equal(wave.max, 0)
    assert.deepEqual(waveTicks(wave), [7, 10, 13, 16, 19, 22])
  })
})
