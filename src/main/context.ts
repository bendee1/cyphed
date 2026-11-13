import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { IpcGate } from './ipc-gate'
import type { CaptureService } from './services/capture'
import type { DictationService } from './services/dictation'
import type { ReaderService } from './services/reader'
import type { ReaderActions } from './services/reader-actions'
import type { Hotkeys } from './hotkeys'
import type { TrayController } from './tray'

/** Ce que les modules IPC partagent : fenêtres, services, raccourcis. */
export type MainContext = {
  gate: IpcGate
  bar: BrowserWindow
  hub: BrowserWindow
  dictation: DictationService
  capture: CaptureService
  reader: ReaderService
  readerActions: ReaderActions
  hotkeys: Hotkeys
  tray: TrayController
  capturePreload: string
}

/** Dit au Hub de relire ses données (historique, réglages, personnalisation). */
export function invalidateHub(ctx: Pick<MainContext, 'hub'>): void {
  if (!ctx.hub.isDestroyed()) ctx.hub.webContents.send(IPC.hubInvalidate)
}
