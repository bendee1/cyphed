const DEFAULT_FRAME_SAMPLES = 512
const DEFAULT_LEVEL_MS = 20

/** Pack 16-bit PCM into ~20–40 ms frames (512 samples @ 16 kHz = 32 ms). */
export class Pcm16Batcher {
  private chunks: Int16Array[] = []
  private samples = 0
  private readonly threshold: number
  private readonly emit: (pcm: Int16Array) => void

  constructor(emit: (pcm: Int16Array) => void, threshold = DEFAULT_FRAME_SAMPLES) {
    this.emit = emit
    this.threshold = threshold
  }

  push(pcm: Int16Array): void {
    if (pcm.length === 0) return
    this.chunks.push(pcm)
    this.samples += pcm.length
    while (this.samples >= this.threshold) {
      this.emit(this.take(this.threshold))
    }
  }

  flush(): void {
    if (this.samples === 0) return
    this.emit(this.take(this.samples))
  }

  private take(count: number): Int16Array {
    const out = new Int16Array(count)
    let offset = 0
    while (offset < count && this.chunks.length) {
      const head = this.chunks[0]
      const need = count - offset
      if (head.length <= need) {
        out.set(head, offset)
        offset += head.length
        this.chunks.shift()
      } else {
        out.set(head.subarray(0, need), offset)
        this.chunks[0] = head.subarray(need)
        offset += need
      }
    }
    this.samples -= count
    return out
  }
}

/** Peak-hold level updates at 30–60 Hz (default 50 Hz). */
export class LevelLimiter {
  private last = Number.NEGATIVE_INFINITY
  private peak = 0
  private readonly minIntervalMs: number
  private readonly emit: (level: number) => void

  constructor(emit: (level: number) => void, minIntervalMs = DEFAULT_LEVEL_MS) {
    this.emit = emit
    this.minIntervalMs = minIntervalMs
  }

  push(level: number, now: number): void {
    this.peak = Math.max(this.peak, level)
    if (now - this.last < this.minIntervalMs) return
    this.last = now
    this.emit(this.peak)
    this.peak = 0
  }

  reset(): void {
    this.peak = 0
    this.last = Number.NEGATIVE_INFINITY
  }
}

export function copyPcm16(pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(pcm.byteLength)
  new Int16Array(buffer).set(pcm)
  return buffer
}
