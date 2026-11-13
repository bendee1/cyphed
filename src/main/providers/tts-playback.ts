export type TtsPlayId = string

/** Single current playback. S4 can add another consumer only through this gate. */
export class TtsArbiter {
  private current: string | null = null
  private seq = 0

  begin(): TtsPlayId {
    this.seq += 1
    this.current = `tts-${this.seq}`
    return this.current
  }

  isCurrent(id: string): boolean {
    return this.current === id
  }

  currentId(): string | null {
    return this.current
  }

  release(id: string): void {
    if (this.current === id) this.current = null
  }

  stopAll(): string | null {
    const id = this.current
    this.current = null
    return id
  }
}

export class TtsSpeakGate {
  private abort: AbortController | null = null
  private readonly arbiter: TtsArbiter

  constructor(arbiter?: TtsArbiter) {
    this.arbiter = arbiter ?? new TtsArbiter()
  }

  speaking(): boolean {
    return Boolean(this.abort)
  }

  start(): { id: string; signal: AbortSignal; controller: AbortController } {
    this.stop()
    const controller = new AbortController()
    this.abort = controller
    const id = this.arbiter.begin()
    return { id, signal: controller.signal, controller }
  }

  isLive(id: string, controller: AbortController): boolean {
    return this.abort === controller && this.arbiter.isCurrent(id)
  }

  finish(id: string, controller: AbortController): void {
    if (this.abort === controller) this.abort = null
    this.arbiter.release(id)
  }

  stop(): string | null {
    const controller = this.abort
    this.abort = null
    const id = this.arbiter.stopAll()
    controller?.abort()
    return id
  }
}
