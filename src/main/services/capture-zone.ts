export class ZoneStore {
  private png: Buffer | null = null

  put(png: Buffer): void {
    this.png = png
  }

  peek(): Buffer | null {
    return this.png
  }

  take(): Buffer | null {
    const out = this.png
    this.png = null
    return out
  }

  clear(): void {
    this.png = null
  }
}
