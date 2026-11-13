import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cursorOnBar, parseHitRect } from '../src/main/services/bar-hover-core.ts'

describe('survol de la barre sans crochet souris', () => {
  const win = { x: 1000, y: 800, width: 340, height: 310 }
  const pill = { x: 150, y: 280, width: 40, height: 24 }

  it('ouvre seulement sur la pilule (avec une petite marge), jamais sur le reste de la fenêtre transparente', () => {
    assert.equal(cursorOnBar({ x: 1170, y: 1090 }, win, pill), true)
    assert.equal(cursorOnBar({ x: 1148, y: 1078 }, win, pill), true)
    assert.equal(cursorOnBar({ x: 1100, y: 900 }, win, pill), false)
    assert.equal(cursorOnBar({ x: 1170, y: 1090 }, win, null), false)
  })

  it('refuse un rectangle invalide envoyé par la barre', () => {
    assert.deepEqual(parseHitRect({ x: 1, y: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 })
    assert.equal(parseHitRect({ x: 1, y: 2, width: Infinity, height: 4 }), null)
    assert.equal(parseHitRect({ x: -5, y: 2, width: 3, height: 4 }), null)
    assert.equal(parseHitRect('rect'), null)
  })
})
