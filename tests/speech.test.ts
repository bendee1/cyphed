import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { forSpeech, splitForSpeech } from '../src/main/services/speech-core.ts'

describe('texte pour l’écoute', () => {
  it('enlève le markdown, les liens et les puces, garde le texte', () => {
    const out = forSpeech('# Titre\n\n- **Premier** point\n- Voir [la doc](https://x.io/a)\n\nSite : https://exemple.com/page')
    assert.equal(out, 'Titre.\n\nPremier point.\nVoir la doc\n\nSite : lien')
  })

  it('recolle les lignes coupées d’un PDF, sans point au milieu d’une phrase', () => {
    assert.equal(forSpeech('Le contrat prend effet\nà la signature des deux\nparties.'), 'Le contrat prend effet à la signature des deux parties.')
  })

  it('découpe un long texte sans rien perdre ni couper un mot', () => {
    const sentence = 'Ceci est une phrase de test assez longue pour remplir un morceau. '
    const text = sentence.repeat(120) + '\n\n' + 'Dernier paragraphe.'
    const chunks = splitForSpeech(text, 1500)
    assert.ok(chunks.length > 4)
    for (const chunk of chunks) assert.ok(chunk.length <= 1500, `morceau de ${chunk.length}`)
    const words = (s: string): string[] => s.split(/\s+/).filter(Boolean)
    assert.deepEqual(words(chunks.join(' ')), words(text))
  })

  it('coupe une phrase géante entre deux mots', () => {
    const chunks = splitForSpeech('mot '.repeat(1000), 500)
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 500)
      assert.match(chunk, /^(mot ?)+$/)
    }
  })
})
