import { ipcMain } from 'electron'
import { IPC, type CaptureRect, type ReaderAction, type ReaderSource } from '@shared/ipc'
import { listTtsVoices } from '../providers/tts'
import { invalidateHub, type MainContext } from '../context'
import { tm } from '../lang'

const READER_ACTIONS = new Set<ReaderAction>(['read', 'summarize', 'explain'])
/** Plafond du texte envoyé à un modèle ou à une voix. */
const MAX_TEXT_CHARS = 20_000

function parseReaderSource(raw: unknown): ReaderSource | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as { kind?: unknown; text?: unknown }
  if (value.kind === 'zone') return { kind: 'zone' }
  if (value.kind === 'text' && typeof value.text === 'string' && value.text.trim() && value.text.length <= MAX_TEXT_CHARS) {
    return { kind: 'text', text: value.text }
  }
  return null
}

function parseCaptureRect(raw: unknown): CaptureRect | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const nums = [v.displayId, v.x, v.y, v.width, v.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const { displayId, x, y, width, height } = v as Record<'displayId' | 'x' | 'y' | 'width' | 'height', number>
  if (width <= 0 || height <= 0 || width > 20_000 || height > 20_000) return null
  if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return null
  return { displayId, x, y, width, height }
}

/** Lire : voix, lecture, capture de zone d'écran. */
export function registerReaderIpc(ctx: MainContext): void {
  const { gate, hub, reader, capture, capturePreload } = ctx

  function surfaceTtsError(err: unknown): string {
    const speakError = err instanceof Error ? err.message : String(err)
    console.warn('[tts]', speakError)
    if (!hub.isDestroyed()) hub.webContents.send(IPC.ttsFailed, speakError)
    return speakError
  }

  ipcMain.handle(IPC.hubListVoices, async (event) => {
    gate.assert(event, 'hub')
    try {
      return await listTtsVoices()
    } catch (err) {
      console.warn('[tts] voix', err instanceof Error ? err.message : err)
      return []
    }
  })
  ipcMain.handle(IPC.readerRun, async (event, rawAction: unknown, rawSource: unknown) => {
    gate.assert(event, 'hub')
    const action = rawAction as ReaderAction
    const source = parseReaderSource(rawSource)
    if (!READER_ACTIONS.has(action)) throw new Error('Action de lecture inconnue.')
    if (!source) throw new Error(tm('err.readerMissing'))
    const result = await reader.run(action, source)
    invalidateHub(ctx)
    void reader.speak(result.text).catch((err) => {
      surfaceTtsError(err)
    })
    return result
  })
  ipcMain.handle(IPC.readerSpeak, async (event, text: unknown) => {
    gate.assert(event, 'hub')
    if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS) throw new Error(tm('err.readerTooLong'))
    try {
      await reader.speak(text)
    } catch (err) {
      throw new Error(surfaceTtsError(err))
    }
  })
  ipcMain.handle(IPC.readerStop, (event) => {
    gate.assert(event, 'hub')
    reader.stopSpeak()
  })

  ipcMain.handle(IPC.captureStart, async (event) => {
    gate.assert(event, 'hub')
    const preview = await capture.start(capturePreload, hub)
    if (!hub.isDestroyed()) {
      hub.show()
      hub.focus()
    }
    return preview
  })
  ipcMain.handle(IPC.captureCancel, (event) => {
    gate.assert(event, 'hub')
    capture.cancel(hub)
  })
  ipcMain.on(IPC.capturePick, (event, raw: unknown) => {
    if (!gate.check(event, 'capture')) return
    const rect = parseCaptureRect(raw)
    if (!rect) return
    capture.pick(rect)
  })
  ipcMain.on(IPC.captureAbort, (event) => {
    if (!gate.check(event, 'capture')) return
    capture.cancel(hub)
  })
  ipcMain.handle(IPC.capturePayload, (event) => {
    gate.assert(event, 'capture')
    return capture.initFor(event.sender.id)
  })
}
