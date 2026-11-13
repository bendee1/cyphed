import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { displayLevel, PEAK_FLOOR } from '../src/renderer/bar/level.ts'

describe('displayLevel', () => {
  it('une voix douce remplit quand même les barres', () => {
    const { value } = displayLevel(0.04, PEAK_FLOOR)
    assert.ok(value > 0.9)
  })

  it('le bruit de fond reste bas', () => {
    const { value } = displayLevel(0.003, PEAK_FLOOR)
    assert.ok(value < 0.2)
  })

  it('une voix plus faible que la crête récente donne des barres plus basses', () => {
    let peak = PEAK_FLOOR
    peak = displayLevel(0.2, peak).peak
    const quiet = displayLevel(0.02, peak).value
    const loud = displayLevel(0.2, peak).value
    assert.ok(quiet < loud)
    assert.ok(loud > 0.95)
  })

  it('la crête redescend avec le temps', () => {
    let peak = displayLevel(0.3, PEAK_FLOOR).peak
    for (let i = 0; i < 600; i++) peak = displayLevel(0, peak).peak
    assert.ok(peak < 0.1)
  })
})
