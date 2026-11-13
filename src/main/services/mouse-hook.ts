import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectRoot } from '../paths'
import type { MouseBindings } from './mouse-bindings'
import { LineBuffer } from './uia-core'
import { recordFreeze } from './freeze-log'
import { parseLagLine } from './freeze-log-core'

/**
 * Crochet souris global (raccourcis Mouse3/4/5), tenu par le programme natif mouse-helper.
 * Pourquoi un processus à part : Windows attend la réponse d'un crochet WH_MOUSE_LL avant de bouger la souris
 * de tout le PC. Quand il tournait dans le fil principal d'Electron, chaque démarrage, arrêt ou mise à jour
 * de Cyphed gelait la souris une seconde. mouse-helper répond seul, à partir des règles envoyées par state().
 */
const EXE_NAME = 'mouse-helper.exe'
const MAX_RESTARTS = 3

let proc: ChildProcessWithoutNullStreams | null = null
let bound: MouseBindings | null = null
let restarts = 0
let stopped = false
const lines = new LineBuffer()

function exePath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'native', EXE_NAME) : join(projectRoot(), 'native', 'bin', EXE_NAME)
}

function send(): void {
  if (!proc || !bound) return
  try {
    proc.stdin.write(bound.state() + '\n')
  } catch {
    /* processus en train de mourir : relancé par onExit */
  }
}

function start(): boolean {
  const file = exePath()
  if (!existsSync(file)) {
    console.warn('[mouse] mouse-helper.exe introuvable : raccourcis souris indisponibles')
    return false
  }
  try {
    const child = spawn(file, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { SystemRoot: process.env.SystemRoot ?? '' } })
    lines.reset()
    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of lines.push(chunk)) {
        const [kind, value, flag] = line.trim().split(' ')
        const lag = parseLagLine(line)
        if (lag !== null) {
          recordFreeze(lag)
          continue
        }
        if (kind === 'ready') {
          restarts = 0
          continue
        }
        const button = Number(value)
        if ((kind === 'd' || kind === 'u') && button >= 4 && button <= 6) bound?.fromHook(button, kind === 'd', flag === '1')
      }
    })
    child.stderr.on('data', () => undefined)
    child.stdin.on('error', () => undefined)
    child.on('error', () => onExit(child))
    child.on('exit', () => onExit(child))
    proc = child
    send()
    return true
  } catch (err) {
    console.warn('[mouse] mouse-helper ne démarre pas :', err instanceof Error ? err.message : err)
    return false
  }
}

function onExit(child: ChildProcessWithoutNullStreams): void {
  if (proc !== child) return
  proc = null
  bound?.releaseAll()
  if (stopped || restarts >= MAX_RESTARTS) return
  restarts++
  start()
}

/** Lance le crochet souris (une seule fois). */
export function installMouseHook(bindings: MouseBindings): boolean {
  if (proc) return true
  stopped = false
  bound = bindings
  bindings.onChange(send)
  return start()
}

/** Ferme le crochet : à appeler avant de quitter (et donc avant une mise à jour). */
export function removeMouseHook(): void {
  stopped = true
  const child = proc
  proc = null
  bound?.releaseAll()
  bound?.onChange(null)
  if (!child) return
  try {
    child.stdin.end()
    child.kill()
  } catch {
    /* déjà fermé */
  }
}

/** Durée de la mesure lancée au clic sur « Redémarrer » : fermeture, installation, relancement et premières secondes. */
const UPDATE_WATCH_SECONDS = 90

/**
 * Lance la mesure de mise à jour : mouse-helper en mode --watch, copié hors du dossier d'installation
 * (l'installeur ferme tout ce qui tourne depuis ce dossier et doit pouvoir en remplacer les fichiers).
 * Détaché : il survit à la fermeture de Cyphed et écrit lui-même dans le journal des gels.
 */
export async function startUpdateWatch(logFile: string): Promise<void> {
  const sizeBefore = fileSize(logFile)
  try {
    const source = exePath()
    if (!existsSync(source)) return
    const copy = join(tmpdir(), 'cyphed-update-watch.exe')
    copyFileSync(source, copy)
    const child = spawn(copy, ['--watch', String(UPDATE_WATCH_SECONDS), logFile], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot ?? '' }
    })
    // Lancement refusé plus tard (antivirus…) : jamais une erreur non gérée qui bloquerait la mise à jour.
    child.on('error', () => undefined)
    child.unref()
  } catch (err) {
    console.warn('[mouse] mesure de mise à jour non lancée :', err instanceof Error ? err.message : err)
    return
  }
  // Prête quand elle a écrit sa première ligne dans le journal.
  for (let waited = 0; waited < 1500; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    try {
      if (readFileSync(logFile).subarray(sizeBefore).toString('utf8').includes('mesure de la mise à jour')) return
    } catch {
      /* pas encore créé */
    }
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
