import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FrameReader, findVoiceDir, pickVoiceRuntime } from '../src/main/providers/pocket-core.ts'

function frame(header: object, data = Buffer.alloc(0)): Buffer {
  const head = Buffer.from(JSON.stringify(header))
  const lens = Buffer.alloc(8)
  lens.writeUInt32LE(head.length, 0)
  lens.writeUInt32LE(data.length, 4)
  return Buffer.concat([lens, head, data])
}

describe('voix locale', () => {
  it('reconstitue les trames même coupées n’importe où', () => {
    const all = Buffer.concat([frame({ ready: true }), frame({ id: 1 }, Buffer.from('RIFFdata')), frame({ id: 2, error: 'x' })])
    const reader = new FrameReader()
    const got = []
    for (let i = 0; i < all.length; i += 3) got.push(...reader.push(all.subarray(i, i + 3)))
    assert.deepEqual(
      got.map((f) => [f.header, f.data.toString()]),
      [
        [{ ready: true }, ''],
        [{ id: 1 }, 'RIFFdata'],
        [{ id: 2, error: 'x' }, '']
      ]
    )
  })

  it('refuse une trame aberrante', () => {
    const bad = Buffer.alloc(8)
    bad.writeUInt32LE(2_000_000, 0)
    assert.throws(() => new FrameReader().push(bad))
  })

  it('trouve le Python d’un dossier de voix externe', () => {
    const root = mkdtempSync(join(tmpdir(), 'cyphed-voix-'))
    try {
      const dir = join(root, 'voix')
      assert.equal(findVoiceDir(''), null)
      assert.equal(findVoiceDir(dir), null)
      mkdirSync(join(dir, 'venv', 'Scripts'), { recursive: true })
      writeFileSync(join(dir, 'venv', 'Scripts', 'python.exe'), '')
      assert.equal(findVoiceDir(dir), dir)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('préfère la voix livrée avec Cyphed, sinon la voix externe', () => {
    const root = mkdtempSync(join(tmpdir(), 'cyphed-voix-'))
    try {
      const bundled = join(root, 'resources', 'voice')
      const studio = join(root, 'voix')
      assert.equal(pickVoiceRuntime(bundled, studio), null)
      mkdirSync(join(studio, 'venv', 'Scripts'), { recursive: true })
      writeFileSync(join(studio, 'venv', 'Scripts', 'python.exe'), '')
      assert.equal(pickVoiceRuntime(bundled, studio)?.source, 'external')
      mkdirSync(join(bundled, 'python'), { recursive: true })
      writeFileSync(join(bundled, 'python', 'python.exe'), '')
      assert.equal(pickVoiceRuntime(bundled, studio)?.source, 'external', 'sans modèle, la voix livrée est incomplète')
      mkdirSync(join(bundled, 'hf-cache'))
      assert.deepEqual(pickVoiceRuntime(bundled, studio), {
        python: join(bundled, 'python', 'python.exe'),
        hfHome: join(bundled, 'hf-cache'),
        source: 'cyphed'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
