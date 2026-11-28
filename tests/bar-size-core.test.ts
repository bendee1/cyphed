import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BAR_BASE_HEIGHT, BAR_BASE_WIDTH, barWindowSize, captionScale } from '../src/main/services/bar-size-core.ts'

describe('Taille de la bulle selon l’écran', () => {
  it('ne change rien sur un écran 1080p ou plus petit', () => {
    assert.equal(captionScale(1080), 1)
    assert.equal(captionScale(768), 1)
    assert.deepEqual(barWindowSize(1), { width: BAR_BASE_WIDTH, height: BAR_BASE_HEIGHT })
  })

  it('agrandit un écran 1440p à 100 %, presque pas à 125 % (Windows agrandit déjà)', () => {
    assert.equal(captionScale(1440), 1.33)
    assert.equal(captionScale(1152), 1.07)
  })

  it('plafonne à 1,4 (4K à 100 %) et résiste à une valeur absurde', () => {
    assert.equal(captionScale(2160), 1.4)
    assert.equal(captionScale(0), 1)
    assert.equal(captionScale(Number.NaN), 1)
  })

  it('élargit la fenêtre pour que la bulle agrandie tienne avec ses marges', () => {
    const { width, height } = barWindowSize(1.33)
    assert.ok(width >= Math.round(300 * 1.33) + 40)
    assert.equal(height, BAR_BASE_HEIGHT)
  })
})
