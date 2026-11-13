export type Surface = 'bar' | 'hub' | 'capture'

export type SenderIds = {
  bar: number | null
  hub: number | null
  capture: Set<number>
}

export type SenderLike = { sender: { id: number }; senderFrame?: { url: string } | null }

/** Même document ? (ignore l'ancre `#…` : un changement d'ancre n'est pas une navigation.) */
export function sameDocument(current: string, target: string): boolean {
  const strip = (url: string): string => url.split('#')[0]
  return strip(current) === strip(target)
}

/** Page de l'appli : un fichier local (app construite) ou l'origine du serveur de dev. */
export function isTrustedAppUrl(url: string, devOrigin: string | null): boolean {
  if (url.startsWith('file://')) return true
  if (!devOrigin) return false
  try {
    return new URL(url).origin === new URL(devOrigin).origin
  } catch {
    return false
  }
}

export class IpcGate {
  private bar: number | null = null
  private hub: number | null = null
  private capture = new Set<number>()

  /** `devOrigin` : origine du serveur de dev (jamais renseignée dans l'appli construite). */
  private readonly devOrigin: string | null

  constructor(devOrigin: string | null = null) {
    this.devOrigin = devOrigin
  }

  setBar(id: number | null): void {
    this.bar = id
  }

  setHub(id: number | null): void {
    this.hub = id
  }

  registerCapture(id: number): void {
    this.capture.add(id)
  }

  unregisterCapture(id: number): void {
    this.capture.delete(id)
  }

  snapshot(): SenderIds {
    return { bar: this.bar, hub: this.hub, capture: new Set(this.capture) }
  }

  surfaceOf(id: number): Surface | 'unknown' {
    if (this.bar === id) return 'bar'
    if (this.hub === id) return 'hub'
    if (this.capture.has(id)) return 'capture'
    return 'unknown'
  }

  /** Vrai si l'émetteur est la bonne surface ET que sa page est bien celle de l'appli (pas une page tierce chargée dans la fenêtre). */
  check(event: SenderLike, allowed: Surface | Surface[]): boolean {
    const want = Array.isArray(allowed) ? allowed : [allowed]
    const surface = this.surfaceOf(event.sender.id)
    if (!want.includes(surface as Surface)) return false
    if ('senderFrame' in event) {
      const url = event.senderFrame?.url
      if (typeof url !== 'string' || !isTrustedAppUrl(url, this.devOrigin)) return false
    }
    return true
  }

  assert(event: SenderLike, allowed: Surface | Surface[]): void {
    if (this.check(event, allowed)) return
    const want = Array.isArray(allowed) ? allowed.join('|') : allowed
    throw new Error(`IPC forbidden: expected ${want}, sender is ${this.surfaceOf(event.sender.id)}`)
  }

  allowMedia(webContentsId: number): boolean {
    return this.bar !== null && this.bar === webContentsId
  }

  /** Le Hub lit la liste des micros (Réglages) ; il n'ouvre jamais le micro (allowMedia reste à la barre). */
  allowDeviceList(webContentsId: number): boolean {
    return this.hub !== null && this.hub === webContentsId
  }
}
