import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from '../paths'
import { isUiaFailure, isUiaPong, LineBuffer, parseUiaLine, type UiaSnapshot } from './uia-core'

const EXE_NAME = 'uia-helper.exe'
const MAX_FAST_DEATHS = 2
const DEATH_COOLDOWN_MS = 30_000

interface Pending {
  resolve: (value: UiaSnapshot | null) => void
  timer: NodeJS.Timeout
}

function exePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native', EXE_NAME)
    : join(projectRoot(), 'native', 'bin', EXE_NAME)
}

/**
 * Client du programme natif uia-helper (lecture du champ de texte au premier plan).
 * Ne lève jamais : exe absent, délai dépassé ou erreur = `null`. La dictée ne dépend pas de lui.
 */
export class UiaClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private lines = new LineBuffer()
  private pending = new Map<number, Pending>()
  private nextId = 1
  private deaths = 0
  private lastDeath = 0
  private disposed = false

  /** Lance l'exe et charge UI Automation en avance (à appeler au démarrage, sans attendre). */
  warmUp(): void {
    void this.request('ping', 1500).catch(() => undefined)
  }

  focus(timeoutMs = 700): Promise<UiaSnapshot | null> {
    return this.request('focus', timeoutMs)
  }

  read(timeoutMs = 700): Promise<UiaSnapshot | null> {
    return this.request('read', timeoutMs)
  }

  dispose(): void {
    this.disposed = true
    this.failAll()
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try {
      proc.stdin.end()
      proc.kill()
    } catch {
      /* déjà mort */
    }
  }

  private ensure(): ChildProcessWithoutNullStreams | null {
    if (this.disposed) return null
    if (this.proc) return this.proc
    if (this.deaths >= MAX_FAST_DEATHS && Date.now() - this.lastDeath < DEATH_COOLDOWN_MS) return null
    try {
      const file = exePath()
      if (!existsSync(file)) return null
      const proc = spawn(file, [], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Le lecteur d'écran n'a besoin d'aucune clé : il ne les hérite pas.
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(_API_KEY|_TOKEN|_SECRET|_KEY)$/i.test(k)))
      })
      this.lines.reset()
      proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
      proc.stderr.on('data', () => undefined) // jamais journalisé : vie privée
      proc.stdin.on('error', () => undefined)
      proc.on('error', () => this.onDeath(proc))
      proc.on('exit', () => this.onDeath(proc))
      this.proc = proc
      return proc
    } catch {
      return null
    }
  }

  private onDeath(proc: ChildProcessWithoutNullStreams): void {
    if (this.proc !== proc) return
    this.proc = null
    this.deaths++
    this.lastDeath = Date.now()
    this.failAll()
  }

  private onData(chunk: Buffer): void {
    for (const line of this.lines.push(chunk)) {
      const reply = parseUiaLine(line)
      if (typeof reply.id !== 'number') continue
      const entry = this.pending.get(reply.id)
      if (!entry) continue // réponse arrivée après le délai
      this.pending.delete(reply.id)
      clearTimeout(entry.timer)
      this.deaths = 0
      if (isUiaFailure(reply)) entry.resolve(null)
      else if (isUiaPong(reply)) entry.resolve(null)
      else entry.resolve(reply)
    }
  }

  private failAll(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve(null)
    }
    this.pending.clear()
  }

  private request(cmd: 'focus' | 'read' | 'ping', timeoutMs: number): Promise<UiaSnapshot | null> {
    return new Promise((resolve) => {
      try {
        const proc = this.ensure()
        if (!proc) return resolve(null)
        const id = this.nextId++
        const timer = setTimeout(() => {
          this.pending.delete(id)
          resolve(null)
        }, timeoutMs)
        this.pending.set(id, { resolve, timer })
        proc.stdin.write(JSON.stringify({ id, cmd }) + '\n', (err) => {
          if (!err || !this.pending.has(id)) return
          clearTimeout(timer)
          this.pending.delete(id)
          resolve(null)
        })
      } catch {
        resolve(null)
      }
    })
  }
}
