const TARGET_RATE = 16000

export function floatToPcm16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample))
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
}

/** Linear resampler. Output index × step is the only cursor — continuous for 44.1 kHz. */
export class Pcm16Resampler {
  private readonly inRate: number
  private readonly outRate: number
  private readonly step: number
  private hold = new Float32Array(0)
  private holdStart = 0
  private produced = 0

  constructor(inRate: number, outRate = TARGET_RATE) {
    if (inRate <= 0 || outRate <= 0) {
      throw new Error('Resampler: sample rate invalide')
    }
    this.inRate = inRate
    this.outRate = outRate
    this.step = inRate / outRate
  }

  push(input: Float32Array): Int16Array {
    if (input.length === 0) return new Int16Array(0)
    if (this.inRate === this.outRate) {
      const out = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) out[i] = floatToPcm16(input[i])
      this.produced += input.length
      return out
    }

    const merged = new Float32Array(this.hold.length + input.length)
    merged.set(this.hold)
    merged.set(input, this.hold.length)
    const absEnd = this.holdStart + merged.length

    const out: number[] = []
    while (this.produced * this.step + 1 < absEnd) {
      const pos = this.produced * this.step
      const local = pos - this.holdStart
      const i = Math.floor(local)
      const frac = local - i
      out.push(floatToPcm16(merged[i] * (1 - frac) + merged[i + 1] * frac))
      this.produced += 1
    }

    const keepFrom = Math.floor(this.produced * this.step)
    const consumed = Math.max(0, Math.min(merged.length, keepFrom - this.holdStart))
    this.hold = merged.slice(consumed)
    this.holdStart += consumed
    return Int16Array.from(out)
  }

  flush(): Int16Array {
    if (this.inRate === this.outRate || this.hold.length === 0) {
      this.hold = new Float32Array(0)
      this.holdStart = 0
      this.produced = 0
      return new Int16Array(0)
    }
    const last = this.hold[this.hold.length - 1] ?? 0
    const absEnd = this.holdStart + this.hold.length
    const padded = new Float32Array(this.hold.length + 1)
    padded.set(this.hold)
    padded[padded.length - 1] = last
    const out: number[] = []
    while (this.produced * this.step < absEnd) {
      const pos = this.produced * this.step
      const local = pos - this.holdStart
      const i = Math.floor(local)
      const frac = local - i
      out.push(floatToPcm16((padded[i] ?? last) * (1 - frac) + (padded[i + 1] ?? last) * frac))
      this.produced += 1
    }
    this.hold = new Float32Array(0)
    this.holdStart = 0
    this.produced = 0
    return Int16Array.from(out)
  }
}
