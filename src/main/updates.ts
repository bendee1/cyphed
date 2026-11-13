import { app } from 'electron'
// electron-updater est en CommonJS : en ESM, autoUpdater n'est lisible que par l'export par défaut.
import updater from 'electron-updater'

const { autoUpdater } = updater

const SIX_HOURS = 6 * 60 * 60 * 1000

/**
 * Mise à jour automatique depuis les versions publiées sur GitHub (bendee1/cyphed). Seulement dans l'appli installée.
 * La nouvelle version se télécharge en fond et s'installe à la fermeture ; onReady permet de proposer de redémarrer tout de suite.
 */
let ready: string | null = null

/** Version téléchargée qui attend un redémarrage, ou null. */
export function readyUpdate(): string | null {
  return ready
}

/** Ferme Cyphed, installe la version prête (fenêtre de progression seule) et relance. Ne fait rien si aucune n'est prête. */
export function installUpdate(): void {
  // Pas silencieux : l'installeur montre sa barre de progression (scripts/installer.nsh saute les autres pages) puis relance Cyphed.
  if (ready) autoUpdater.quitAndInstall(false, true)
}

export function startAutoUpdates(onReady: (version: string) => void): { installNow: () => void } {
  const installNow = installUpdate
  if (!app.isPackaged) return { installNow }
  autoUpdater.logger = null // ses traces complètes encombrent le journal ; la ligne [updates] suffit
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    const first = ready !== info.version
    ready = info.version
    if (first) onReady(info.version)
  })
  // Pas de réseau, pas encore de version publiée : on réessaie plus tard, sans déranger.
  autoUpdater.on('error', (err) => console.warn('[updates]', err instanceof Error ? err.message.split('\n')[0] : err))
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined)
  setTimeout(check, 15_000)
  setInterval(check, SIX_HOURS).unref?.()
  return { installNow }
}
