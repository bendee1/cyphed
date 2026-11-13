import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  closeAndCollect,
  foldTranscript,
  isCloseAck,
  isFinalizeResult,
  waitUntil,
  type DeepgramLiveMessage
} from '../src/main/providers/deepgram-finalize.ts'

describe('Deepgram finalize', () => {
  it('folds interim then final transcripts', () => {
    let state = { committed: '', interim: '' }
    state = foldTranscript(state, {
      type: 'Results',
      is_final: false,
      channel: { alternatives: [{ transcript: 'bonjour' }] }
    })
    assert.deepEqual(state, { committed: '', interim: 'bonjour' })
    state = foldTranscript(state, {
      type: 'Results',
      is_final: true,
      channel: { alternatives: [{ transcript: 'bonjour camille' }] }
    })
    assert.deepEqual(state, { committed: 'bonjour camille', interim: '' })
  })

  it('treats only from_finalize as a Finalize ack, never a lone is_final', () => {
    assert.equal(isFinalizeResult({ type: 'Results', from_finalize: true }), true)
    assert.equal(isFinalizeResult({ type: 'Results', is_final: true }), false)
    assert.equal(isFinalizeResult({ type: 'Results', is_final: true, from_finalize: false }), false)
    assert.equal(isFinalizeResult({ type: 'Results', is_final: false }), false)
    assert.equal(isCloseAck({ type: 'Metadata' }), true)
    assert.equal(isCloseAck({ type: 'Results' }), false)
  })

  it('does not treat a post-request is_final:true from_finalize:false as a Finalize ack', async () => {
    const listeners = new Set<(msg: DeepgramLiveMessage) => void>()
    const subscribe = (listener: (msg: DeepgramLiveMessage) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const pending = waitUntil(subscribe, isFinalizeResult, 60)
    queueMicrotask(() => {
      for (const listener of listeners) {
        listener({ type: 'Results', is_final: true, from_finalize: false })
      }
    })
    const got = await pending
    assert.equal(got, undefined)
  })

  it('does not wait seconds when from_finalize never arrives', async () => {
    let fold = { committed: '', interim: '' }
    const listeners = new Set<(msg: DeepgramLiveMessage) => void>()
    const subscribe = (listener: (msg: DeepgramLiveMessage) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const started = Date.now()
    const pending = closeAndCollect(
      () => {
        const result: DeepgramLiveMessage = {
          type: 'Results',
          is_final: true,
          from_finalize: false,
          channel: { alternatives: [{ transcript: 'bonjour' }] }
        }
        fold = foldTranscript(fold, result)
        for (const listener of listeners) listener(result)
        for (const listener of listeners) listener({ type: 'Metadata' })
      },
      subscribe,
      () => `${fold.committed} ${fold.interim}`.trim(),
      1500
    )
    const text = await pending
    const elapsed = Date.now() - started
    assert.equal(text, 'bonjour')
    assert.ok(elapsed < 500, `waited ${elapsed}ms — must not block on missing from_finalize`)
  })

  it('resolves waitUntil on Metadata instead of sleeping a fixed 500ms', async () => {
    const listeners = new Set<(msg: DeepgramLiveMessage) => void>()
    const subscribe = (listener: (msg: DeepgramLiveMessage) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const started = Date.now()
    const pending = waitUntil(subscribe, isCloseAck, 4000)
    setTimeout(() => {
      for (const listener of listeners) {
        listener({ type: 'Metadata' })
      }
    }, 20)
    const got = await pending
    const elapsed = Date.now() - started
    assert.ok(got)
    assert.equal(got.type, 'Metadata')
    assert.ok(elapsed < 500, `waited ${elapsed}ms — must not be a sleep(500)`)
  })
})
