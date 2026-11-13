import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LevelLimiter, Pcm16Batcher } from '../src/shared/pcm-batch.ts'

describe('Pcm16Batcher', () => {
  it('emits ~32 ms frames then a flush tail', () => {
    const frames: number[] = []
    const batcher = new Pcm16Batcher((pcm) => frames.push(pcm.length), 512)
    batcher.push(new Int16Array(400))
    assert.deepEqual(frames, [])
    batcher.push(new Int16Array(400))
    assert.deepEqual(frames, [512])
    batcher.flush()
    assert.deepEqual(frames, [512, 288])
  })
})

describe('LevelLimiter', () => {
  it('caps updates at the interval and keeps the peak', () => {
    const levels: number[] = []
    const limiter = new LevelLimiter((level) => levels.push(level), 20)
    limiter.push(0.1, 0)
    limiter.push(0.9, 5)
    limiter.push(0.2, 10)
    limiter.push(0.4, 20)
    assert.deepEqual(levels, [0.1, 0.9])
  })
})
