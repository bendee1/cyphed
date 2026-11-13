import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureInit, CapturePreloadApi, CaptureRect } from '../shared/ipc'

const api: CapturePreloadApi = {
  onCaptureInit(handler) {
    const listen = (_event: unknown, payload: CaptureInit): void => handler(payload)
    ipcRenderer.on('capture:init', listen)
    return () => ipcRenderer.removeListener('capture:init', listen)
  },
  getCaptureInit() {
    return ipcRenderer.invoke('capture:payload') as Promise<CaptureInit | null>
  },
  pickCapture(rect: CaptureRect) {
    ipcRenderer.send('capture:pick', rect)
  },
  abortCapture() {
    ipcRenderer.send('capture:abort')
  }
}

contextBridge.exposeInMainWorld('cyphed', api)
