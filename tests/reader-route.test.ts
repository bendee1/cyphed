import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyReaderLlm, looksFrench, planReaderRoute, readerNotice } from '../src/main/services/reader-route.ts'

describe('Reader routing', () => {
  it('does not send already-French Lire text to Cerebras', () => {
    const text = 'Le texte à l’écran est déjà en français, prêt à être lu.'
    assert.equal(looksFrench(text), true)
    assert.deepEqual(planReaderRoute('read', text), { skipLlm: true, reason: 'already-french' })
  })

  it('still asks Cerebras to summarize or translate English source', () => {
    const text = 'The settings panel is empty and the button does not work.'
    assert.equal(looksFrench(text), false)
    assert.deepEqual(planReaderRoute('read', text), { skipLlm: false, reason: 'needs-llm' })
    assert.deepEqual(planReaderRoute('summarize', 'Le résumé doit passer par le modèle.'), {
      skipLlm: false,
      reason: 'needs-llm'
    })
  })

  it('un texte anglais avec un mot accentué est quand même traduit', () => {
    assert.equal(looksFrench('Send me your résumé and we will meet at the café to discuss the role.'), false)
    assert.equal(looksFrench('Pokémon is a game that the kids would play with their friends.'), false)
    assert.equal(looksFrench('Le contrat est signé par les deux parties.'), true)
    assert.equal(looksFrench('Merci pour ton retour, je regarde ça demain.'), true)
  })

  it('falls back to raw OCR when Cerebras fails', () => {
    const raw = 'Bouton Enregistrer — texte OCR brut'
    const result = applyReaderLlm(raw, { ok: false })
    assert.deepEqual(result, { text: raw, fallback: true })
  })

  it('keeps the LLM text when Cerebras succeeds', () => {
    const result = applyReaderLlm('raw', { ok: true, text: 'Texte lu à voix haute.' })
    assert.deepEqual(result, { text: 'Texte lu à voix haute.', fallback: false })
  })

  it('never announces French when the fallback text is not French', () => {
    const notice = readerNotice({ fallback: true, inFrench: false })
    assert.equal(notice, 'Texte original — traduction impossible.')
    assert.equal(notice.includes('En français'), false)
  })
})
