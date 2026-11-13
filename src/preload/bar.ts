import { contextBridge, ipcRenderer } from 'electron'
import type { BarCommand, BarPreloadApi, BarTransforms, HubView } from '../shared/ipc'
import type { BarState } from '../shared/types'

const api: BarPreloadApi = {
  onBarState(handler) {
    const listen = (_event: unknown, state: BarState): void => handler(state)
    ipcRenderer.on('bar:state', listen)
    return () => ipcRenderer.removeListener('bar:state', listen)
  },
  onBarCommand(handler) {
    const listen = (_event: unknown, command: BarCommand): void => handler(command)
    ipcRenderer.on('bar:command', listen)
    return () => ipcRenderer.removeListener('bar:command', listen)
  },
  sendAudioFrame(pcm) {
    ipcRenderer.send('audio:frame', pcm)
  },
  sendAudioLevel(level) {
    ipcRenderer.send('audio:level', level)
  },
  sendMicReady() {
    ipcRenderer.send('mic:ready')
  },
  sendMicStopped() {
    ipcRenderer.send('mic:stopped')
  },
  sendMicError(message) {
    ipcRenderer.send('mic:error', message)
  },
  setInteractive(interactive) {
    ipcRenderer.send('bar:interactive', Boolean(interactive))
  },
  setHitRect(rect) {
    ipcRenderer.send('bar:hit-rect', rect)
  },
  toggleDictation() {
    ipcRenderer.send('bar:toggle')
  },
  readAloud(action) {
    return ipcRenderer.invoke('bar:read', action) as Promise<void>
  },
  readerSpeaking() {
    return ipcRenderer.invoke('bar:reader-state') as Promise<boolean>
  },
  getMicDevice() {
    return ipcRenderer.invoke('bar:mic-device') as Promise<string>
  },
  getTransforms() {
    return ipcRenderer.invoke('bar:transforms') as Promise<BarTransforms>
  },
  setAutoTransform(id, category) {
    return ipcRenderer.invoke('bar:set-auto', id, category) as Promise<void>
  },
  openHub(view: HubView) {
    ipcRenderer.send('bar:open-hub', view)
  }
}

contextBridge.exposeInMainWorld('cyphed', api)
