import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildKeyterms } from '../src/main/providers/keyterms.ts'

describe('buildKeyterms', () => {
  it('met les mots de la personne d’abord, puis les mots de base, sans doublon', () => {
    assert.deepEqual(buildKeyterms(['Visual Studio', 'cyphed'], [], ['guillemets', 'Cyphed']), ['Visual Studio', 'cyphed', 'guillemets'])
  })

  it('place les mots de l’écran entre le dictionnaire et les mots de base', () => {
    assert.deepEqual(buildKeyterms(['Haiku'], ['Anthropic'], ['guillemets']), ['Haiku', 'Anthropic', 'guillemets'])
  })

  it('écarte les mots vides ou trop longs', () => {
    assert.deepEqual(buildKeyterms(['  ', 'x'.repeat(80), 'Anthropic'], [], []), ['Anthropic'])
  })

  it('reste sous la limite de Deepgram', () => {
    const many = Array.from({ length: 200 }, (_, i) => `terme${i}`)
    const out = buildKeyterms(many, [], [])
    assert.ok(out.length <= 40)
    assert.ok(out.join('').length <= 700)
  })
})
