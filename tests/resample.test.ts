import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { floatToPcm16, Pcm16Resampler } from '../src/shared/resample.ts'

function sine(rate: number, seconds: number, freq = 440): Float32Array {
  const n = Math.round(rate * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate)
  return out
}

function join(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('Pcm16Resampler', () => {
  it('keeps 16 kHz samples as PCM16 without dropping frames', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1])
    const resampler = new Pcm16Resampler(16000)
    const out = resampler.push(input)
    assert.equal(out.length, input.length)
    assert.equal(out[0], 0)
    assert.equal(out[1], floatToPcm16(0.5))
    assert.equal(out[3], floatToPcm16(1))
    assert.equal(resampler.flush().length, 0)
  })

  it('carries leftover samples across 48 kHz chunks', () => {
    const whole = new Pcm16Resampler(48000)
    const split = new Pcm16Resampler(48000)
    const input = sine(48000, 0.02)
    const expected = join([whole.push(input), whole.flush()])
    const mid = Math.floor(input.length / 2) + 1
    const got = join([split.push(input.subarray(0, mid)), split.push(input.subarray(mid)), split.flush()])
    assert.equal(got.length, expected.length)
    let maxDelta = 0
    for (let i = 0; i < got.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(got[i] - expected[i]))
    }
    assert.ok(maxDelta <= 1, `stateful split drifted by ${maxDelta}`)
  })

  it('resamples 44.1 kHz → 16 kHz in 128-sample chunks over several seconds', () => {
    const inRate = 44100
    const seconds = 3
    const chunk = 128
    const input = sine(inRate, seconds)
    const expectedTotal = Math.round(input.length * 16000 / inRate)
    assert.equal(expectedTotal, 48000)

    const whole = new Pcm16Resampler(inRate)
    const wholeOut = join([whole.push(input), whole.flush()])

    const split = new Pcm16Resampler(inRate)
    const parts: Int16Array[] = []
    for (let i = 0; i < input.length; i += chunk) {
      parts.push(split.push(input.subarray(i, Math.min(input.length, i + chunk))))
    }
    parts.push(split.flush())
    const splitOut = join(parts)

    assert.equal(splitOut.length, wholeOut.length)
    assert.ok(Math.abs(wholeOut.length - expectedTotal) <= 1, `count ${wholeOut.length} vs ${expectedTotal}`)
    let maxDelta = 0
    for (let i = 0; i < splitOut.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(splitOut[i] - wholeOut[i]))
    }
    assert.ok(maxDelta <= 1, `44.1 kHz split drifted by ${maxDelta}`)
  })
})
