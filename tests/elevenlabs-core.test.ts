import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { audioChunk, dropFalseStarts, finalSettled, foldScribe, scribeError, scribeQuery, scribeText } from '../src/main/providers/elevenlabs-core.ts'

describe('Scribe Realtime', () => {
  it('se connecte en français, commit manuel, mot à mot, avec les mots de la personne', () => {
    const q = scribeQuery('fr', ['Cyphed', 'Studio Nova', 'un terme bien trop long pour Scribe', 'cyphed'])
    assert.equal(q.get('model_id'), 'scribe_v2_realtime')
    assert.equal(q.get('language_code'), 'fr')
    assert.equal(q.get('commit_strategy'), 'manual')
    assert.equal(q.get('audio_format'), 'pcm_16000')
    assert.equal(q.has('no_verbatim'), false)
    assert.deepEqual(q.getAll('keyterms'), ['Cyphed', 'Studio Nova'])
  })

  it('laisse Scribe reconnaître la langue en mode multi', () => {
    assert.equal(scribeQuery('multi').has('language_code'), false)
  })

  it('limite les mots à 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => `mot${i}`)
    assert.equal(scribeQuery('fr', many).getAll('keyterms').length, 50)
  })

  it('assemble les segments validés et le provisoire', () => {
    let s = { committed: [] as string[], partial: '' }
    s = foldScribe(s, { message_type: 'partial_transcript', text: 'OK ça' })
    s = foldScribe(s, { message_type: 'committed_transcript', text: 'OK, ça peut m’aller.' })
    s = foldScribe(s, { message_type: 'partial_transcript', text: 'Et après' })
    assert.equal(scribeText(s), 'OK, ça peut m’aller. Et après')
    s = foldScribe(s, { message_type: 'committed_transcript', text: 'Et après on voit.' })
    assert.equal(scribeText(s), 'OK, ça peut m’aller. Et après on voit.')
  })

  it('n’arrête pas sur un segment validé suivi d’un provisoire (il reste du texte)', () => {
    assert.equal(finalSettled([{ message_type: 'committed_transcript', text: 'a' }]), true)
    assert.equal(finalSettled([{ message_type: 'committed_transcript', text: 'a' }, { message_type: 'partial_transcript', text: 'b' }]), false)
    assert.equal(finalSettled([{ message_type: 'partial_transcript', text: 'b' }]), false)
    assert.equal(finalSettled([]), false)
  })

  it('code l’audio en base64 avec le commit', () => {
    const msg = JSON.parse(audioChunk(Buffer.from([1, 2, 3]), true))
    assert.deepEqual(msg, { message_type: 'input_audio_chunk', audio_base_64: 'AQID', commit: true, sample_rate: 16000 })
  })

  it('traduit les erreurs du service, ignore les messages normaux', () => {
    assert.equal(scribeError({ message_type: 'partial_transcript' }), null)
    assert.equal(scribeError({ message_type: 'session_started' }), null)
    assert.match(scribeError({ message_type: 'auth_error' }) ?? '', /Clé ElevenLabs refusée/)
    assert.match(scribeError({ message_type: 'quota_exceeded' }) ?? '', /Crédit/)
    assert.match(scribeError({ message_type: 'transcriber_error', error: 'boom' }) ?? '', /boom/)
  })
})

describe('Faux départs de Scribe', () => {
  it('enlève les mots coupés marqués « -- »', () => {
    assert.equal(dropFalseStarts("C'est-à-dire jamais tu-- enfin, ouais"), "C'est-à-dire jamais enfin, ouais")
    assert.equal(dropFalseStarts('ça doit être pun-- ça doit être punitif'), 'ça doit être ça doit être punitif')
    assert.equal(dropFalseStarts('qu’est-ce-- comment ça se passe'), 'comment ça se passe')
    assert.equal(dropFalseStarts('un tiret-bas et 3 -- 4'), 'un tiret-bas et 3 -- 4')
  })
})

describe('Moteur de transcription', () => {
  it('Deepgram en fichier entier par défaut, les autres choix gardés', async () => {
    const { parseSttEngine } = await import('../src/shared/types.ts')
    assert.equal(parseSttEngine(undefined), 'deepgram_file')
    assert.equal(parseSttEngine('nimporte'), 'deepgram_file')
    assert.equal(parseSttEngine('deepgram'), 'deepgram')
    assert.equal(parseSttEngine('elevenlabs'), 'elevenlabs')
    assert.equal(parseSttEngine('voxtral'), 'voxtral')
    assert.equal(parseSttEngine('elevenlabs_live'), 'elevenlabs_live')
    assert.equal(parseSttEngine('deepgram'), 'deepgram')
  })
})
