import { app } from 'electron'

/** Argument posé par Windows quand il lance Cyphed à l'ouverture de session : démarrer sans ouvrir le Hub. */
export const STARTUP_ARG = '--startup'

/** Lancer ou non Cyphed à l'ouverture de la session Windows (appli installée seulement). */
export function applyOpenAtLogin(on: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: on, args: [STARTUP_ARG] })
  } catch (err) {
    console.warn('[startup] démarrage avec Windows non réglé :', err instanceof Error ? err.message : err)
  }
}

/** Vrai quand Windows a lancé Cyphed tout seul à l'ouverture de session. */
export function launchedAtLogin(): boolean {
  return process.argv.includes(STARTUP_ARG)
}
