import { existsSync } from 'node:fs'
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'
import { brandIconPath } from './paths'
import { mainLang, tm } from './lang'
import { formatHotkey } from '../shared/i18n/index.ts'

function trayIcon(): Electron.NativeImage {
  const ico = brandIconPath()
  // Taille de la zone de notification : Windows choisit la bonne image du .ico.
  return existsSync(ico) ? nativeImage.createFromPath(ico) : nativeImage.createEmpty()
}

export type TrayController = {
  /** Crée l'icône (à appeler une fois la fenêtre prête). */
  create: (hotkey: string) => void
  /** Met à jour le menu avec le raccourci courant. */
  paint: (hotkey: string) => void
  /** Une nouvelle version est téléchargée : ajoute « Redémarrer pour mettre à jour ». */
  updateReady: (version: string, install: () => void) => void
}

/** Icône de secours quand le démarrage a échoué : au moins un moyen de quitter proprement. */
export function createFallbackTray(): Tray {
  const tray = new Tray(trayIcon())
  tray.setToolTip(tm('tray.failedTip'))
  tray.setContextMenu(Menu.buildFromTemplate([{ label: tm('tray.quit'), click: () => app.quit() }]))
  return tray
}

export function createTray(hub: BrowserWindow): TrayController {
  let tray: Tray | null = null
  let lastHotkey = ''
  let update: { version: string; install: () => void } | null = null

  function paint(hotkey: string): void {
    lastHotkey = hotkey
    if (!tray) return
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Cyphed', enabled: false },
        { label: tm('tray.hotkey', { hotkey: formatHotkey(hotkey, mainLang()) }), enabled: false },
        { type: 'separator' },
        { label: tm('tray.openHub'), click: () => hub.show() },
        ...(update ? [{ label: tm('tray.update', { version: update.version }), click: update.install }] : []),
        { type: 'separator' },
        { label: tm('tray.quit'), click: () => app.quit() }
      ])
    )
  }

  return {
    create(hotkey) {
      tray = new Tray(trayIcon())
      tray.setToolTip('Cyphed')
      paint(hotkey)
    },
    paint,
    updateReady(version, install) {
      update = { version, install }
      tray?.setToolTip(tm('tray.updateTip', { version }))
      paint(lastHotkey)
    }
  }
}
