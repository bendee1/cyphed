import { app } from 'electron'
// electron-updater est en CommonJS : en ESM, autoUpdater n'est lisible que par l'export par défaut.
import updater from 'electron-updater'

const { autoUpdater } = updater

const SIX_HOURS = 6 * 60 * 60 * 1000

/**
 * Mise à jour automatique depuis les versions publiées sur GitHub (bendee1/cyphed). Seulement dans l'appli installée.
 * La nouvelle version se télécharge en fond et s'installe à la fermeture ; onReady permet de proposer de redémarrer tout de suite.
 */
export function startAutoUpdates(onReady: (version: string) => void): { installNow: () => void } {
  const installNow = (): void => autoUpdater.quitAndInstall(true, true)
  if (!app.isPackaged) return { installNow }
  autoUpdater.logger = null // ses traces complètes encombrent le journal ; la ligne [updates] suffit
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => onReady(info.version))
  // Pas de réseau, pas encore de version publiée : on réessaie plus tard, sans déranger.
  autoUpdater.on('error', (err) => console.warn('[updates]', err instanceof Error ? err.message.split('\n')[0] : err))
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined)
  setTimeout(check, 15_000)
  setInterval(check, SIX_HOURS).unref?.()
  return { installNow }
}
