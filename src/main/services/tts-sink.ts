import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { TtsAudioSink } from '../providers/tts'
import { tm } from '../lang'
import { loadSettings } from './settings'

export function createRendererTtsSink(
  hub: BrowserWindow,
  assertHub?: (event: { sender: { id: number } }) => void
): TtsAudioSink {
  let generation = 0
  let currentId = ''

  return {
    stop() {
      generation += 1
      const id = currentId
      currentId = ''
      if (!hub.isDestroyed()) hub.webContents.send(IPC.ttsStop, id)
    },
    play(audio, signal) {
      const token = ++generation
      currentId = audio.id
      return new Promise((resolve, reject) => {
        if (hub.isDestroyed()) {
          reject(new Error(tm('err.hubClosed')))
          return
        }

        const finish = (err?: Error): void => {
          if (token !== generation) return
          cleanup()
          if (currentId === audio.id) currentId = ''
          if (err) reject(err)
          else resolve()
        }

        const onEnded = (event: { sender: { id: number } }, id: string): void => {
          // Un émetteur refusé est ignoré : lever ici planterait un écouteur du processus principal.
          try {
            assertHub?.(event)
          } catch {
            return
          }
          if (id && id !== audio.id) return
          finish()
        }
        const onError = (event: { sender: { id: number } }, id: string, message: string): void => {
          // Un émetteur refusé est ignoré : lever ici planterait un écouteur du processus principal.
          try {
            assertHub?.(event)
          } catch {
            return
          }
          if (id && id !== audio.id) return
          finish(new Error(String(message || 'Lecture vocale impossible.')))
        }
        const onAbort = (): void => {
          cleanup()
          if (!hub.isDestroyed()) hub.webContents.send(IPC.ttsStop, audio.id)
          resolve()
        }

        function cleanup(): void {
          ipcMain.removeListener(IPC.ttsEnded, onEnded)
          ipcMain.removeListener(IPC.ttsError, onError)
          signal.removeEventListener('abort', onAbort)
        }

        ipcMain.on(IPC.ttsEnded, onEnded)
        ipcMain.on(IPC.ttsError, onError)
        signal.addEventListener('abort', onAbort, { once: true })

        const copy = audio.data.buffer.slice(audio.data.byteOffset, audio.data.byteOffset + audio.data.byteLength)
        hub.webContents.send(IPC.ttsPlay, { id: audio.id, mime: audio.mime, data: copy, rate: loadSettings().readSpeed })
      })
    }
  }
}
