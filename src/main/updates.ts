import { app } from 'electron'
// electron-updater est en CommonJS : en ESM, autoUpdater n'est lisible que par l'export par défaut.
import updater from 'electron-updater'
import { freezeLogFile, markPhase } from './services/freeze-log'
import { startUpdateWatch } from './services/mouse-hook'
import type { InstallUpdateResult } from '@shared/ipc'

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

/** Demande d'installation en cours ou lancée : partagée par l'icône et le Hub. */
let pending: Promise<InstallUpdateResult> | null = null

/** Ferme Cyphed, installe la version prête (fenêtre de progression seule) et relance. Ne fait rien si aucune n'est prête.
 * `stillOk` est relu après l'attente de la mesure : une dictée lancée entre-temps annule le redémarrage.
 * Le Hub lit l'issue : il ne garde « Redémarrage… » que si l'installation part (ou est déjà partie). */
export function installUpdate(stillOk: () => boolean = () => true): Promise<InstallUpdateResult> {
  // Déjà demandée (icône et Hub en même temps) : le second appelant reçoit la même issue, annulation comprise.
  if (pending) return pending
  if (!ready) return Promise.resolve('none')
  const run = runInstall(ready, stillOk)
  pending = run
  // Lancée, Cyphed se ferme : on garde la promesse pour qu'un nouveau clic ne relance rien. Sinon on la libère.
  void run.then((result) => {
    if (result !== 'started') pending = null
  })
  return run
}

async function runInstall(version: string, stillOk: () => boolean): Promise<InstallUpdateResult> {
  // Pas silencieux : l'installeur montre sa barre de progression (scripts/installer.nsh saute les autres pages) puis relance Cyphed.
  try {
    markPhase(`mise à jour ${version} : clic sur Redémarrer`)
    // Le gel ressenti au clic n'apparaît qu'en vraie mise à jour : on le mesure, hors de Cyphed, et on attend
    // que la mesure soit en place (1,5 s au plus) pour ne pas rater le début.
    await startUpdateWatch(freezeLogFile())
    if (!stillOk()) return 'dictating'
    autoUpdater.quitAndInstall(false, true)
    return 'started'
  } catch (err) {
    console.warn('[updates] installation non lancée :', err instanceof Error ? err.message : err)
    return 'failed'
  }
}

export function startAutoUpdates(onReady: (version: string) => void): { installNow: typeof installUpdate } {
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
