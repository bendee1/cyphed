import { join } from 'node:path'
import { app, dialog, globalShortcut, Notification, session, type BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { DEFAULT_SETTINGS } from '@shared/types'
import { loadDotEnv, migrateUserDataToAppData, userDataDir } from './paths'
import { sanitizeMetricsFile } from './services/usage'
import { IpcGate, sameDocument } from './ipc-gate'
import { getCerebrasKey, getDeepgramKey } from './secrets'
import { loadSettings } from './services/settings'
import { DictationService, logIdleResources } from './services/dictation'
import { ReaderActions } from './services/reader-actions'
import { pocket } from './providers/pocket'
import { CaptureService } from './services/capture'
import { ReaderService } from './services/reader'
import { TransformService } from './services/transform'
import { createBarWindow, createHubWindow, devRendererOrigin, markQuitting, showBar } from './windows'
import { removeMouseHook } from './services/mouse-hook'
import { getDb, takeDbRecovery } from './db'
import { setTtsAudioSink } from './providers/tts'
import { createRendererTtsSink } from './services/tts-sink'
import { createHotkeys } from './hotkeys'
import { createFallbackTray, createTray } from './tray'
import { startAutoUpdates } from './updates'
import { tm } from './lang'
import { IPC } from '@shared/ipc'
import { applyUiLanguage } from './ui-language'
import type { MainContext } from './context'
import { registerBarIpc } from './ipc/bar'
import { registerDataIpc } from './ipc/data'
import { registerReaderIpc } from './ipc/reader'
import { registerSettingsIpc } from './ipc/settings'

loadDotEnv()

// Un incident imprévu ne doit pas tuer la dictée : on le journalise (type et message seulement, jamais de texte dicté) et on continue.
function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 300)
  return String(err).slice(0, 300)
}
process.on('uncaughtException', (err) => console.error('[main] exception non rattrapée', describeError(err)))
process.on('unhandledRejection', (reason) => console.error('[main] promesse rejetée', describeError(reason)))

const devOrigin = devRendererOrigin()

// Aucune fenêtre ne navigue ailleurs ni n'en ouvre une autre : l'appli n'affiche que ses propres pages.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (!sameDocument(contents.getURL(), url)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let hubWindow: BrowserWindow | null = null
let booted = false

app.on('before-quit', markQuitting)

// Deuxième lancement : on montre le Hub de l'instance déjà ouverte.
app.on('second-instance', () => {
  const hub = hubWindow
  if (!hub || hub.isDestroyed()) return
  if (hub.isMinimized()) hub.restore()
  hub.show()
  hub.focus()
})

/** Démarrage raté : message lisible et une icône pour quitter, au lieu d'un processus invisible. */
function reportStartupFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[cyphed] démarrage échoué', describeError(err))
  try {
    applyUiLanguage(loadSettings().uiLanguage)
  } catch {
    /* langue de départ conservée */
  }
  try {
    createFallbackTray()
  } catch {
    /* pas d'icône : la boîte de dialogue suffit */
  }
  dialog.showErrorBox('Cyphed', tm('dialog.startFail', { message: message.slice(0, 600) }))
}

let updateNote: Notification | null = null

async function boot(): Promise<void> {
  electronApp.setAppUserModelId('app.cyphed.desktop') // = appId de l'installateur : même icône et même groupe dans la barre des tâches
  app.commandLine.appendSwitch('js-flags', '--experimental-sqlite')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const copied = migrateUserDataToAppData()
  if (copied.length) console.log(`[data] AppData migration: ${copied.join(', ')}`)
  // La langue d'abord : la base et les fenêtres l'utilisent dès leur ouverture.
  applyUiLanguage(loadSettings().uiLanguage)
  const metricsScrub = sanitizeMetricsFile(join(userDataDir(), 'metrics.jsonl'))
  if (metricsScrub.rewritten) {
    console.log(`[data] metrics sanitized: ${metricsScrub.strippedLines} line(s)`)
  }
  getDb()

  const gate = new IpcGate(devOrigin)
  const sess = session.defaultSession
  sess.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' && gate.allowMedia(wc.id))
  })
  sess.setPermissionCheckHandler((wc, permission) => {
    return permission === 'media' && Boolean(wc && (gate.allowMedia(wc.id) || gate.allowDeviceList(wc.id)))
  })

  const bar = await createBarWindow(join(__dirname, '../preload/bar.js'))
  const hub = await createHubWindow(join(__dirname, '../preload/hub.js'))
  hubWindow = hub
  gate.setBar(bar.webContents.id)
  gate.setHub(hub.webContents.id)

  const dictation = new DictationService(bar, hub)
  const capture = new CaptureService({
    add: (id) => gate.registerCapture(id),
    remove: (id) => gate.unregisterCapture(id)
  })
  const reader = new ReaderService(() => capture.takeZone())
  setTtsAudioSink(createRendererTtsSink(hub, (event) => gate.assert(event, 'hub')))

  app.on('will-quit', () => {
    dictation.dispose()
    pocket.stop()
  })
  const capturePreload = join(__dirname, '../preload/capture.js')
  const readerActions = new ReaderActions({ reader, capture, dictation, hub, capturePreload })
  const hotkeys = createHotkeys({ hub, dictation, transformer: new TransformService(bar), readQuick: () => void readerActions.quick() })
  const tray = createTray(hub)
  const updates = startAutoUpdates((version) => {
    tray.updateReady(version, () => {
      if (!dictation.isActive()) updates.installNow() // jamais au milieu d'une dictée
    })
    if (!hub.isDestroyed()) hub.webContents.send(IPC.hubInvalidate) // le Hub affiche son bandeau
    // Une seule notification par version : sans elle, rien ne dit qu'une mise à jour attend.
    if (Notification.isSupported()) {
      const note = new Notification({ title: tm('update.notifyTitle'), body: tm('update.notifyBody', { version }), silent: true })
      updateNote = note // gardée : sans référence, le clic peut se perdre sous Windows
      note.on('click', () => {
        updateNote = null
        if (hub.isDestroyed()) return
        if (hub.isMinimized()) hub.restore()
        hub.show()
        hub.focus()
      })
      note.on('close', () => {
        updateNote = null
      })
      note.show()
    }
  })

  const ctx: MainContext = {
    gate,
    bar,
    hub,
    dictation,
    capture,
    reader,
    readerActions,
    hotkeys,
    tray,
    capturePreload
  }
  registerBarIpc(ctx)
  registerDataIpc(ctx)
  registerSettingsIpc(ctx)
  registerReaderIpc(ctx)

  const boot = loadSettings()
  if (!hotkeys.bind(boot.hotkey)) {
    console.error(`[hotkey] impossible d'enregistrer ${boot.hotkey}`)
    hotkeys.bind(DEFAULT_SETTINGS.hotkey)
  } else {
    console.log(`[hotkey] ${boot.hotkey} — toggle dictée`)
  }

  // Contrôle de bout en bout du preload : utile en développement seulement. Une appli construite ne s'arrête jamais pour ça.
  if (!app.isPackaged) {
    try {
      const barApi = await bar.webContents.executeJavaScript(
        `Boolean(window.cyphed && typeof window.cyphed.sendAudioFrame === 'function')`
      )
      const hubApiOk = await hub.webContents.executeJavaScript(
        `Boolean(window.cyphed && typeof window.cyphed.getStatus === 'function' && typeof window.cyphed.getSettings === 'function' && typeof window.cyphed.getHistory === 'function')`
      )
      if (!barApi || !hubApiOk) {
        console.error(`[preload] window.cyphed missing (bar=${barApi} hub=${hubApiOk})`)
      } else {
        const hubLive = await hub.webContents.executeJavaScript(
          `Promise.all([window.cyphed.getStatus(), window.cyphed.getSettings(), window.cyphed.getHistory('')]).then(([status, settings, history]) => ({
            deepgram: Boolean(status.deepgram),
            hotkey: settings.settings.hotkey,
            history: Array.isArray(history)
          }))`
        )
        console.log(`[preload] bar ok · hub ok · status/settings/history ${JSON.stringify(hubLive)}`)
      }
    } catch (err) {
      console.error('[preload] contrôle de développement échoué', describeError(err))
    }
  }
  if (!hub.isDestroyed()) hub.show()
  showBar(bar)
  booted = true

  tray.create(loadSettings().hotkey)

  logIdleResources('ready')
  setTimeout(() => logIdleResources('idle+3s'), 3000)
  console.log(`[cyphed] vertical slice prêt. Toggle pour dicter. Cerebras=${getCerebrasKey() ? 'on' : 'off'} Deepgram=${getDeepgramKey() ? 'on' : 'off'}`)

  const recovered = takeDbRecovery()
  if (recovered) {
    // Pas de canal de message dans le Hub : une boîte de dialogue, sans bloquer le démarrage.
    void dialog.showMessageBox({ type: 'warning', title: 'Cyphed', message: recovered })
  }
}

if (gotLock) {
  app.whenReady().then(() => boot()).catch((err) => {
    if (!booted) reportStartupFailure(err)
    else console.error('[cyphed] erreur après le démarrage', describeError(err))
  })
}

app.on('will-quit', () => {
  removeMouseHook()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // stay in tray
})
