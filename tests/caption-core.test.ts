import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMPTY_CAPTION, FIXED_MS, foldCaption, SURE_AFTER_MS, wordFixed, wordSure } from '../src/renderer/bar/caption-core.ts'
import { withLiveCaption } from '../src/main/providers/live-caption-core.ts'
import type { LiveSttSession } from '../src/main/providers/stt.ts'

describe('Bulle de texte en direct', () => {
  it('garde les mots déjà affichés et en ajoute de nouveaux', () => {
    const a = foldCaption(EMPTY_CAPTION, 'Écoute, on', 0)
    const b = foldCaption(a, 'Écoute, on va', 300)
    assert.deepEqual(b.words.map((w) => w.text), ['Écoute,', 'on', 'va'])
    assert.equal(b.words[0], a.words[0])
    assert.equal(b.words[2].since, 300)
  })

  it('montre un mot corrigé en rouge, à la même place et avec la même clé', () => {
    const a = foldCaption(EMPTY_CAPTION, 'Mais juste un jour', 0)
    const b = foldCaption(a, 'Mets juste à jour', 500)
    assert.equal(b.words[0].key, a.words[0].key)
    assert.equal(wordFixed(b.words[0], 600), true)
    assert.equal(wordFixed(b.words[0], 500 + FIXED_MS), false)
    assert.equal(wordFixed(b.words[1], 600), false)
    assert.equal(wordFixed(b.words[2], 600), true)
  })

  it('ne compte pas comme correction le dernier mot qui s’écrit ni la ponctuation', () => {
    const a = foldCaption(EMPTY_CAPTION, 'je repren', 0)
    const b = foldCaption(a, 'je reprendrai', 200)
    assert.equal(b.words[1].fixedAt, null)
    const c = foldCaption(b, 'je reprendrai.', 400)
    assert.equal(c.words[1].fixedAt, null)
    assert.equal(c.words[1].since, 200)
  })

  it('rend un mot sûr quand il n’a pas changé depuis un moment, ou à la fin', () => {
    const a = foldCaption(EMPTY_CAPTION, 'demain', 0)
    assert.equal(wordSure(a.words[0], SURE_AFTER_MS - 1, false), false)
    assert.equal(wordSure(a.words[0], SURE_AFTER_MS, false), true)
    assert.equal(wordSure(a.words[0], 10, true), true)
  })

  it('retire les mots que le moteur a enlevés', () => {
    const a = foldCaption(EMPTY_CAPTION, 'on va va', 0)
    const b = foldCaption(a, 'on va', 100)
    assert.equal(b.words.length, 2)
  })
})

function fakeSession(name: string, log: string[]): LiveSttSession {
  return {
    provider: name,
    model: name,
    send: (pcm) => void log.push(`${name}:send:${pcm.length}`),
    finalize: async () => {
      log.push(`${name}:finalize`)
      return `${name} text`
    },
    close: () => void log.push(`${name}:close`)
  }
}

describe('Fichier entier + texte en direct', () => {
  it('le texte collé vient du fichier, l’audio arrivé avant le direct lui est rejoué', async () => {
    const log: string[] = []
    let ready: (s: LiveSttSession) => void = () => {}
    const session = withLiveCaption(fakeSession('file', log), () => new Promise((r) => (ready = r)))
    session.send(Buffer.alloc(10))
    ready(fakeSession('live', log))
    await Promise.resolve()
    session.send(Buffer.alloc(20))
    assert.equal(await session.finalize(), 'file text')
    assert.deepEqual(log, ['file:send:10', 'live:send:10', 'file:send:20', 'live:send:20', 'live:finalize', 'file:finalize'])
  })

  it('une panne du direct ne touche pas la dictée', async () => {
    const log: string[] = []
    const warnings: string[] = []
    const session = withLiveCaption(fakeSession('file', log), () => Promise.reject(new Error('quota')), (m) => warnings.push(m))
    await Promise.resolve()
    session.send(Buffer.alloc(5))
    assert.equal(await session.finalize(), 'file text')
    assert.deepEqual(warnings, ['quota'])
  })

  it('un direct prêt après la fin est refermé', async () => {
    const log: string[] = []
    let ready: (s: LiveSttSession) => void = () => {}
    const session = withLiveCaption(fakeSession('file', log), () => new Promise((r) => (ready = r)))
    session.close()
    ready(fakeSession('live', log))
    await Promise.resolve()
    assert.deepEqual(log, ['file:close', 'live:close'])
  })
})
