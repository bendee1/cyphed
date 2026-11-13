import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSuggestUser, parseSuggestions } from '../src/main/services/dictionary-suggest-core.ts'

describe('parseSuggestions', () => {
  it('lit un tableau JSON entouré de texte', () => {
    const text = 'Voilà :\n```json\n[{"heard":"vie suelle studio","correct":"Visual Studio","reason":"nom d’outil"}]\n```'
    assert.deepEqual(parseSuggestions(text, []), [{ heard: 'vie suelle studio', correct: 'Visual Studio', reason: 'nom d’outil' }])
  })

  it('ignore ce qui est déjà au dictionnaire, sans tenir compte des accents ni de la casse', () => {
    const text = '[{"heard":"","correct":"Cyphed","reason":""},{"heard":"","correct":"Knip","reason":""}]'
    assert.deepEqual(parseSuggestions(text, ['cyphed']).map((s) => s.correct), ['Knip'])
  })

  it('écarte les doublons, les entrées vides et celles où rien ne change', () => {
    const text = JSON.stringify([
      { heard: 'spars', correct: 'Notion', reason: '' },
      { heard: 'spars', correct: 'Notion', reason: '' },
      { heard: 'x', correct: 'x', reason: '' },
      { heard: '', correct: '', reason: '' },
      42
    ])
    assert.equal(parseSuggestions(text, []).length, 1)
  })

  it('ne lève jamais sur une réponse invalide', () => {
    assert.deepEqual(parseSuggestions('pas de json', []), [])
    assert.deepEqual(parseSuggestions('[{cassé', []), [])
    assert.deepEqual(parseSuggestions('{"a":1}', []), [])
  })

  it('limite à dix suggestions', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ heard: `h${i}`, correct: `Mot${i}`, reason: '' }))
    assert.equal(parseSuggestions(JSON.stringify(many), []).length, 10)
  })
})

describe('buildSuggestUser', () => {
  it('met le dictionnaire actuel et les dictées dans le message', () => {
    const msg = buildSuggestUser([{ raw: 'brut un', final: 'final un' }], ['Cyphed'])
    assert.match(msg, /Dictionnaire actuel : Cyphed/)
    assert.match(msg, /BRUT : brut un/)
    assert.match(msg, /FINAL : final un/)
  })
})

describe('suggestions sans bonne forme', () => {
  it('garde un mot déformé dont le modèle ignore la forme correcte', () => {
    const text = '[{"heard":"vie suelle studio","correct":"","reason":"revient plusieurs fois"}]'
    assert.deepEqual(parseSuggestions(text, []), [{ heard: 'vie suelle studio', correct: '', reason: 'revient plusieurs fois' }])
  })

  it('écarte une entrée sans mot déformé ni bonne forme', () => {
    assert.deepEqual(parseSuggestions('[{"heard":"","correct":"","reason":""}]', []), [])
  })
})
