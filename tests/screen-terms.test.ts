import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractScreenTerms } from '../src/main/services/screen-terms-core.ts'

describe('extractScreenTerms', () => {
  it('retient les noms propres au milieu d’une phrase et regroupe « Visual Studio »', () => {
    const terms = extractScreenTerms('On parle de Visual Studio et de Deepgram avec Anthropic.')
    assert.ok(terms.includes('Visual Studio'))
    assert.ok(terms.includes('Deepgram'))
    assert.ok(terms.includes('Anthropic'))
  })

  it('ignore le premier mot d’une phrase et les mots courants', () => {
    assert.deepEqual(extractScreenTerms('Bonjour tout le monde. Je vais bien. Merci mardi.'), [])
  })

  it('retient identifiants, fichiers, @noms et sigles', () => {
    const terms = extractScreenTerms('regarde getDictionaryContext dans index.ts avec @camille et le STT du build_native')
    assert.ok(terms.includes('getDictionaryContext'))
    assert.ok(terms.includes('index.ts'))
    assert.ok(terms.includes('camille'))
    assert.ok(terms.includes('STT'))
    assert.ok(terms.includes('build_native'))
  })

  it('écarte ce qui est déjà au dictionnaire, sans tenir compte de la casse', () => {
    const terms = extractScreenTerms('on utilise Deepgram et Haiku', { known: ['deepgram'] })
    assert.deepEqual(terms, ['Haiku'])
  })

  it('classe par fréquence et respecte la limite', () => {
    const text = 'vu Alpha puis Beta puis Gamma puis Beta puis Delta puis Beta puis Alpha'
    assert.equal(extractScreenTerms(text, { max: 2 })[0], 'Beta')
    assert.equal(extractScreenTerms(text, { max: 2 }).length, 2)
  })
})
