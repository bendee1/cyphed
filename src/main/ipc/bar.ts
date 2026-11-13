import { ipcMain } from 'electron'
import { IPC, type BarReadAction, type HubView } from '@shared/ipc'
import { loadPersonalization, savePersonalization } from '../services/personalization'
import { invalidateHub, type MainContext } from '../context'
import { loadSettings } from '../services/settings'
import { tm } from '../lang'

/** Une trame audio fait ~1 Ko (32 ms de PCM 16 bits) : au-delà de 64 Ko ce n'est pas notre micro. */
const MAX_AUDIO_FRAME_BYTES = 64 * 1024

/** Vues que la barre peut ouvrir (le type force à tenir cette liste à jour). */
const HUB_VIEWS: Record<HubView, true> = {
  home: true,
  insights: true,
  dictionary: true,
  snippets: true,
  style: true,
  transforms: true,
  scratchpad: true,
  reader: true
}

/** Canaux de la barre de dictée : micro, audio, pilule, menu Transforms. */
export function registerBarIpc(ctx: MainContext): void {
  const { gate, bar, hub, dictation } = ctx

  // Les canaux `on` n'ont pas de réponse : un émetteur refusé ou une entrée invalide est ignoré, jamais une exception dans le main.
  ipcMain.on(IPC.audioFrame, (event, payload: unknown) => {
    if (!gate.check(event, 'bar')) return
    let buf: Buffer
    if (Buffer.isBuffer(payload)) buf = payload
    else if (payload instanceof ArrayBuffer) buf = Buffer.from(payload)
    else if (ArrayBuffer.isView(payload)) buf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
    else return
    if (buf.byteLength === 0 || buf.byteLength > MAX_AUDIO_FRAME_BYTES) return
    dictation.onAudioFrame(buf)
  })
  ipcMain.on(IPC.audioLevel, (event, level: unknown) => {
    if (!gate.check(event, 'bar')) return
    dictation.onAudioLevel(typeof level === 'number' && Number.isFinite(level) ? level : 0)
  })
  ipcMain.on(IPC.micReady, (event) => {
    if (!gate.check(event, 'bar')) return
    dictation.onMicReady()
  })
  ipcMain.on(IPC.micStopped, (event) => {
    if (!gate.check(event, 'bar')) return
    dictation.onMicStopped()
  })
  ipcMain.on(IPC.micError, (event, message: unknown) => {
    if (!gate.check(event, 'bar')) return
    const text = (typeof message === 'string' ? message : '').slice(0, 300)
    console.error('[mic]', text)
    dictation.onMicError(text || tm('mic.error'))
  })

  ipcMain.on(IPC.barInteractive, (event, interactive: unknown) => {
    if (!gate.check(event, 'bar')) return
    if (bar.isDestroyed()) return
    if (interactive) bar.setIgnoreMouseEvents(false)
    else bar.setIgnoreMouseEvents(true, { forward: true })
  })
  ipcMain.on(IPC.barToggle, (event) => {
    if (!gate.check(event, 'bar')) return
    void dictation.toggle()
  })
  const READ_ACTIONS = new Set<BarReadAction>(['selection', 'clipboard', 'summary', 'zone', 'stop'])
  ipcMain.handle(IPC.barRead, (event, action: unknown) => {
    gate.assert(event, 'bar')
    if (!READ_ACTIONS.has(action as BarReadAction)) return
    // Pas d'attente : la lecture peut durer des minutes, la barre reste libre.
    void ctx.readerActions.run(action as BarReadAction)
  })
  ipcMain.handle(IPC.barReaderState, (event) => {
    gate.assert(event, 'bar')
    return ctx.readerActions.speaking()
  })
  ipcMain.handle(IPC.barMicDevice, (event) => {
    gate.assert(event, 'bar')
    return loadSettings().micDeviceId
  })
  ipcMain.handle(IPC.barTransforms, (event) => {
    gate.assert(event, 'bar')
    const p = loadPersonalization()
    return { transforms: p.transforms.map((t) => ({ id: t.id, name: t.name })), auto: p.autoTransform }
  })
  ipcMain.handle(IPC.barSetAuto, (event, id: unknown) => {
    gate.assert(event, 'bar')
    const p = loadPersonalization()
    savePersonalization({ ...p, autoTransform: typeof id === 'string' ? id : '' })
    invalidateHub(ctx)
  })
  ipcMain.on(IPC.barOpenHub, (event, view: unknown) => {
    if (!gate.check(event, 'bar')) return
    if (typeof view !== 'string' || !Object.prototype.hasOwnProperty.call(HUB_VIEWS, view)) return
    if (hub.isDestroyed()) return
    hub.show()
    hub.focus()
    hub.webContents.send(IPC.hubNavigate, view)
  })
}
