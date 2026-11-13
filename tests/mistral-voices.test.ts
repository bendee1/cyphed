import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isVoxtral3, MISTRAL_FALLBACK_ITEMS, MISTRAL_TTS_MODEL, sortMistralVoices, toMistralVoice } from '../src/main/providers/mistral-voices-core.ts'

describe('voix Mistral', () => {
  it('utilise Voxtral 3, qui lit les nouvelles voix', () => {
    assert.equal(MISTRAL_TTS_MODEL, 'voxtral-mini-tts-3-0')
    assert.ok(isVoxtral3('voice_592'))
    assert.ok(!isVoxtral3('fr_marie_neutral'))
  })

  it('nomme une voix avec sa langue, et marque les anciennes', () => {
    assert.deepEqual(toMistralVoice({ slug: 'voice_3137', id: 'uuid', name: 'Manon', languages: ['fr_fr'] }), { id: 'voice_3137', name: 'Manon (FR)', provider: 'mistral' })
    assert.equal(toMistralVoice({ slug: 'fr_marie_sad', name: 'Marie - Sad', languages: ['fr_fr'] })?.name, 'Marie, Sad (FR), Voxtral 2')
    assert.equal(toMistralVoice({ name: 'Sans id' }), null)
  })

  it('met les voix de la langue de l’interface et Voxtral 3 en tête', () => {
    const ids = sortMistralVoices(MISTRAL_FALLBACK_ITEMS, 'fr').map((v) => v.id)
    assert.deepEqual(ids.slice(0, 5), ['voice_3141', 'voice_589', 'voice_3137', 'voice_592', 'fr_marie_neutral'])
    assert.equal(sortMistralVoices(MISTRAL_FALLBACK_ITEMS, 'en')[0].id, 'voice_3150')
  })
})
