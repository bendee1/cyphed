import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { repairDroppedWords } from '../src/main/services/dropped-words-core.ts'

describe('Petits mots avalés par Deepgram', () => {
  it('remet « tu » devant « vois » en début de proposition', () => {
    assert.equal(repairDroppedWords("c'est peut-être déjà trop, vois. Sur un stickman"), "c'est peut-être déjà trop, tu vois. Sur un stickman")
    assert.equal(repairDroppedWords('Vois, c’est quoi ces actions'), 'Tu vois, c’est quoi ces actions')
  })
  it('ne touche pas « je vois », « tu vois », « on voit »', () => {
    for (const t of ['je vois un truc', 'tu vois, ça va', 'on voit bien', 'ce que tu vois']) assert.equal(repairDroppedWords(t), t)
  })
  it('remet « a » dans « il y a » et « je sais pas » pour « je ne pas »', () => {
    assert.equal(repairDroppedWords("j'ai l'impression qu'il y des trous"), "j'ai l'impression qu'il y a des trous")
    assert.equal(repairDroppedWords('Il y un souci'), 'Il y a un souci')
    assert.equal(repairDroppedWords('je ne pas quoi'), 'je sais pas quoi')
    assert.equal(repairDroppedWords('il y a des trous'), 'il y a des trous')
  })
})
