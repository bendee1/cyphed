import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TtsArbiter, TtsSpeakGate } from '../src/main/providers/tts-playback.ts'

class MemoryTtsSink {
  plays: string[] = []
  stops: string[] = []
  private waiting: { resolve: () => void } | null = null

  play(audio: { id: string; mime: string; data: Buffer }, signal: AbortSignal): Promise<void> {
    this.plays.push(audio.id)
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', onAbort)
        this.waiting = null
        resolve()
      }
      const onAbort = (): void => {
        this.stops.push(audio.id)
        finish()
      }
      this.waiting = { resolve: finish }
      signal.addEventListener('abort', onAbort)
    })
  }

  stop(): void {
    this.stops.push(this.plays[this.plays.length - 1] ?? 'stop')
    this.waiting?.resolve()
  }
}

describe('TTS arbiter and sink', () => {
  it('keeps a single current playback id', () => {
    const arbiter = new TtsArbiter()
    const first = arbiter.begin()
    const second = arbiter.begin()
    assert.equal(arbiter.isCurrent(first), false)
    assert.equal(arbiter.isCurrent(second), true)
    arbiter.release(second)
    assert.equal(arbiter.currentId(), null)
  })

  it('clears speaking after an error before playback', () => {
    const gate = new TtsSpeakGate()
    const { id, controller } = gate.start()
    assert.equal(gate.speaking(), true)
    try {
      throw new Error('clé manquante')
    } catch {
      gate.finish(id, controller)
    }
    assert.equal(gate.speaking(), false)
  })

  it('stop aborts the in-flight sink play', async () => {
    const sink = new MemoryTtsSink()
    const gate = new TtsSpeakGate()
    const { id, signal, controller } = gate.start()
    const playing = sink.play({ id, mime: 'audio/mpeg', data: Buffer.from([1, 2, 3]) }, signal)
    gate.stop()
    sink.stop()
    await playing
    gate.finish(id, controller)
    assert.equal(sink.plays[0], id)
    assert.ok(sink.stops.includes(id))
    assert.equal(gate.speaking(), false)
  })
})
