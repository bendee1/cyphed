import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from '../paths'
import type { MouseBindings } from './mouse-bindings'
import { LineBuffer } from './uia-core'

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
