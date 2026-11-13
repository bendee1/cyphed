import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { freezeLine, parseLagLine, phaseAt, phaseLine, trimLog } from '../src/main/services/freeze-log-core.ts'

describe('journal des gels', () => {
  it('lit les lignes « lag » de mouse-helper, rien d’autre', () => {
    assert.equal(parseLagLine('lag 157'), 157)
    assert.equal(parseLagLine('lag 157\r'), 157)
    assert.equal(parseLagLine('d 4 1'), null)
    assert.equal(parseLagLine('lag abc'), null)
  })

  it('écrit le gel avec l’étape en cours', () => {
    const at = new Date(2026, 10, 13, 23, 41, 7, 512)
    assert.equal(freezeLine(at, 157, 'démarrage de Cyphed', 340.4), '2026-11-13 23:41:07.512  GEL 157 ms  (pendant : démarrage de Cyphed, 340 ms après son début)\n')
    assert.equal(phaseLine(at, 'Cyphed prêt'), '2026-11-13 23:41:07.512  étape : Cyphed prêt\n')
  })

  it('garde la fin du journal, en lignes entières, quand il est trop gros', () => {
    const text = Array.from({ length: 100 }, (_, i) => `ligne ${i}\n`).join('')
    const kept = trimLog(text, 200)
    assert.ok(kept.length < text.length)
    assert.ok(kept.endsWith('ligne 99\n'))
    assert.ok(/^ligne \d+\n/.test(kept))
    assert.equal(trimLog('court\n', 200), 'court\n')
  })

  it('situe un gel à son début : l’étape d’avant s’il a commencé avant la suivante', () => {
    const phases = [{ name: 'démarrage', at: 1000 }, { name: 'prêt', at: 1500 }]
    assert.equal(phaseAt(phases, 1400)?.name, 'démarrage')
    assert.equal(phaseAt(phases, 1600)?.name, 'prêt')
    assert.equal(phaseAt(phases, 900), null)
  })
})
