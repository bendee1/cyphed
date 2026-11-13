import { desktopCapturer, screen, type BrowserWindow, type NativeImage } from 'electron'
import { IPC, type CaptureInit, type CapturePreview, type CaptureRect } from '@shared/ipc'
import { createCaptureWindow } from '../windows'
import { ZoneStore } from './capture-zone'
import { rememberOverlayId } from './capture-overlay'
import { tm } from '../lang'

type Shot = {
  displayId: number
  bounds: Electron.Rectangle
  image: NativeImage
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class CaptureService {
  private windows: BrowserWindow[] = []
  private shots = new Map<number, Shot>()
  private payloads = new Map<number, CaptureInit>()
  private readonly zone = new ZoneStore()
  private lastPreview: CapturePreview | null = null
  private pending: {
    resolve: (value: CapturePreview | null) => void
  } | null = null
  private readonly overlays?: { add: (id: number) => void; remove: (id: number) => void }

  constructor(overlays?: { add: (id: number) => void; remove: (id: number) => void }) {
    this.overlays = overlays
  }

  initFor(webContentsId: number): CaptureInit | null {
    return this.payloads.get(webContentsId) ?? null
  }

  takeZone(): Buffer | null {
    return this.zone.take()
  }

  preview(): CapturePreview | null {
    return this.lastPreview
  }

  clearZone(): void {
    this.zone.clear()
    this.lastPreview = null
  }

  async start(preload: string, hub: BrowserWindow): Promise<CapturePreview | null> {
    this.zone.clear()
    this.cancel()
    if (!hub.isDestroyed()) hub.hide()
    await sleep(90)

    const displays = screen.getAllDisplays()
    const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)))
    const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)))
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.max(maxW, 1), height: Math.max(maxH, 1) }
    })

    this.shots.clear()
    for (const display of displays) {
      const source =
        sources.find((item) => item.display_id === String(display.id)) ??
        sources.find((item) => item.id.includes(String(display.id))) ??
        sources[0]
      if (!source || source.thumbnail.isEmpty()) continue
      this.shots.set(display.id, {
        displayId: display.id,
        bounds: display.bounds,
        image: source.thumbnail
      })
    }
    if (this.shots.size === 0) {
      if (!hub.isDestroyed()) hub.show()
      throw new Error(tm('err.screenCapture'))
    }

    return new Promise((resolve) => {
      this.pending = { resolve }
      void this.openOverlays(preload).catch((err) => {
        console.error('[capture]', err)
        this.finish(null, hub)
      })
    })
  }

  pick(rect: CaptureRect): void {
    const shot = this.shots.get(rect.displayId)
    if (!shot || !this.pending) return
    if (rect.width < 12 || rect.height < 12) return

    const size = shot.image.getSize()
    const scaleX = size.width / shot.bounds.width
    const scaleY = size.height / shot.bounds.height
    const crop = shot.image.crop({
      x: Math.max(0, Math.round(rect.x * scaleX)),
      y: Math.max(0, Math.round(rect.y * scaleY)),
      width: Math.max(1, Math.round(rect.width * scaleX)),
      height: Math.max(1, Math.round(rect.height * scaleY))
    })
    if (crop.isEmpty()) return

    this.zone.put(crop.toPNG())
    const jpeg = crop.resize({ width: Math.min(720, crop.getSize().width) }).toJPEG(78)
    this.lastPreview = {
      previewDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      width: crop.getSize().width,
      height: crop.getSize().height
    }
    this.closeOverlays()
    const done = this.lastPreview
    const pending = this.pending
    this.pending = null
    this.shots.clear()
    pending.resolve(done)
  }

  cancel(hub?: BrowserWindow): void {
    this.zone.clear()
    this.closeOverlays()
    this.shots.clear()
    const pending = this.pending
    this.pending = null
    pending?.resolve(null)
    if (hub && !hub.isDestroyed()) hub.show()
  }

  private finish(value: CapturePreview | null, hub: BrowserWindow): void {
    this.closeOverlays()
    this.shots.clear()
    const pending = this.pending
    this.pending = null
    if (!hub.isDestroyed()) hub.show()
    pending?.resolve(value)
  }

  private async openOverlays(preload: string): Promise<void> {
    const created: BrowserWindow[] = []
    for (const shot of this.shots.values()) {
      const win = await createCaptureWindow(preload, shot.bounds)
      const jpeg = shot.image.toJPEG(62)
      const payload: CaptureInit = {
        displayId: shot.displayId,
        imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`
      }
      this.payloads.set(win.webContents.id, payload)
      rememberOverlayId(win, this.overlays)
      if (win.isDestroyed()) continue
      const captureApi = await win.webContents.executeJavaScript(
        `Boolean(window.cyphed && typeof window.cyphed.pickCapture === 'function')`
      )
      if (!captureApi) throw new Error('[preload] capture: window.cyphed missing')
      console.log('[preload] capture ok')
      if (!win.isDestroyed()) win.webContents.send(IPC.captureInit, payload)
      created.push(win)
    }
    this.windows = created
  }

  private closeOverlays(): void {
    const windows = this.windows
    this.windows = []
    this.payloads.clear()
    for (const win of windows) {
      try {
        if (!win.isDestroyed()) win.destroy()
      } catch {
        /* already gone */
      }
    }
  }
}
