import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { brandIconPath, projectRoot } from './paths'
import { mainLang } from './lang'
import { IPC } from '@shared/ipc'
import { BAR_BASE_HEIGHT, BAR_BASE_WIDTH, barWindowSize, captionScale } from './services/bar-size-core'

let quitting = false

/** Posé quand l'appli s'arrête vraiment (menu Quitter, installeur, arrêt ou fermeture de session Windows). */
export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

/** Origine du serveur de dev, seulement hors appli construite. */
export function devRendererOrigin(): string | null {
  const base = process.env.ELECTRON_RENDERER_URL
  if (is.dev && base) return base
  return null
}

function brandIco(): string {
  return brandIconPath()
}

function rendererUrl(page: 'bar' | 'hub' | 'capture'): string | null {
  const base = process.env.ELECTRON_RENDERER_URL
  if (is.dev && base) return `${base}/${page}.html`
  return null
}

function rendererFile(page: 'bar' | 'hub' | 'capture'): string {
  return join(__dirname, `../renderer/${page}.html`)
}

/** Fenêtres de l'appli et la page qu'elles affichent : pour les recharger quand la langue change. */
const openPages = new Map<BrowserWindow, 'bar' | 'hub' | 'capture'>()

/** La langue part dans la query string (`?lang=fr|en`) : les renderers la lisent au chargement. */
async function loadPage(win: BrowserWindow, page: 'bar' | 'hub' | 'capture'): Promise<void> {
  openPages.set(win, page)
  win.once('closed', () => openPages.delete(win))
  await loadPageNow(win, page)
}

async function loadPageNow(win: BrowserWindow, page: 'bar' | 'hub' | 'capture'): Promise<void> {
  const lang = mainLang()
  const url = rendererUrl(page)
  if (url) await win.loadURL(`${url}?lang=${lang}`)
  else await win.loadFile(rendererFile(page), { query: { lang } })
}

/** Recharge les fenêtres ouvertes avec la langue courante (changement de langue dans les Réglages). */
export function reloadOpenWindows(): void {
  for (const [win, page] of openPages) {
    if (win.isDestroyed()) {
      openPages.delete(win)
      continue
    }
    void loadPageNow(win, page).catch((err) => console.error('[windows] rechargement impossible', err instanceof Error ? err.message : err))
  }
}

export async function createBarWindow(preload: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    // Assez haute pour le menu Lire (5 lignes), élargie selon l'écran à chaque affichage (placeBar) ;
    // la fenêtre laisse passer les clics hors de la pilule.
    width: BAR_BASE_WIDTH,
    height: BAR_BASE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // Sans `forward` : Electron poserait un crochet souris global dans le fil principal (gel de la souris
  // dès que Cyphed est occupé). Le survol est suivi par ipc/bar.ts.
  win.setIgnoreMouseEvents(true)
  // Page rechargée (langue, plantage) : elle reprend l'échelle de l'écran courant.
  win.webContents.on('did-finish-load', () => {
    if (lastScale) win.webContents.send(IPC.barScale, lastScale)
  })
  await loadPage(win, 'bar')
  return win
}

let lastScale = 0

function placeBar(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  // La bulle du texte en direct grandit avec l'écran où la barre s'affiche (recalculé à chaque affichage).
  const scale = captionScale(display.size.height)
  const { width, height } = barWindowSize(scale)
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height - height - 4)
  win.setBounds({ x, y, width, height }, false)
  if (scale !== lastScale) {
    lastScale = scale
    win.webContents.send(IPC.barScale, scale)
  }
}

export function showBar(win: BrowserWindow): void {
  placeBar(win)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.showInactive()
}

export async function createCaptureWindow(
  preload: string,
  bounds: Electron.Rectangle
): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    thickFrame: false,
    icon: existsSync(brandIco()) ? brandIco() : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  await loadPage(win, 'capture')
  win.setBounds(bounds)
  win.show()
  win.focus()
  return win
}

export async function createHubWindow(preload: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Cyphed',
    backgroundColor: '#f5f4f0',
    autoHideMenuBar: true,
    icon: existsSync(brandIco()) ? brandIco() : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  await loadPage(win, 'hub')
  // Fermer la fenêtre la cache (l'appli reste dans la zone de notification), sauf quand l'appli s'arrête vraiment :
  // sinon Windows ne peut ni éteindre la machine ni lancer l'installeur.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('session-end', markQuitting)
  return win
}
