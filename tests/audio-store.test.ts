import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtempSync, readdirSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AudioStore, wavHeader } from '../src/main/services/audio-store-core.ts'

function tempStore(): { store: AudioStore; dir: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cyphed-audio-'))
  const dir = join(root, 'audio')
  return { store: new AudioStore(dir), dir, done: () => rmSync(root, { recursive: true, force: true }) }
}

describe('AudioStore', () => {
  it('écrit un WAV 16 kHz mono lisible', () => {
    const { store, done } = tempStore()
    try {
      assert.equal(store.save('abc', [Buffer.alloc(100, 1), Buffer.alloc(60, 2)]), true)
      const wav = store.read('abc')
      assert.ok(wav)
      assert.equal(wav.length, 44 + 160)
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
      assert.equal(wav.readUInt32LE(24), 16000)
      assert.equal(wav.readUInt32LE(40), 160)
      assert.deepEqual(wav.subarray(0, 44), wavHeader(160))
    } finally {
      done()
    }
  })

  it('rien à écrire : aucun fichier', () => {
    const { store, done } = tempStore()
    try {
      assert.equal(store.save('vide', []), false)
      assert.equal(store.has('vide'), false)
      assert.equal(store.read('vide'), null)
    } finally {
      done()
    }
  })

  it('un id ne sort jamais du dossier', () => {
    const { store, dir, done } = tempStore()
    try {
      store.save('../../evil', [Buffer.alloc(4)])
      assert.ok(store.path('../../evil').startsWith(dir))
      assert.equal(readdirSync(dir).length, 1)
    } finally {
      done()
    }
  })

  it('efface ce qui a plus de 7 jours, garde le reste ; « jamais » efface tout', () => {
    const { store, done } = tempStore()
    try {
      store.save('vieux', [Buffer.alloc(4)])
      store.save('recent', [Buffer.alloc(4)])
      const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000
      utimesSync(store.path('vieux'), eightDaysAgo, eightDaysAgo)
      assert.equal(store.purgeOlderThan(7), 1)
      assert.equal(store.has('vieux'), false)
      assert.equal(store.has('recent'), true)
      assert.equal(store.purgeAll(), 1)
      assert.equal(store.has('recent'), false)
    } finally {
      done()
    }
  })
})
