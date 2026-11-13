import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from '../paths'
import { FrameReader, pickVoiceRuntime, type VoiceRuntime } from './pocket-core'
import { tm } from '../lang'

const SCRIPT = 'pocket-serve.py'
/** Premier chargement : environ 5 s mesurés ; large marge pour un PC occupé. */
const READY_TIMEOUT_MS = 90_000
const PHRASE_TIMEOUT_MS = 60_000
/** Sans lecture pendant 10 min, le modèle est déchargé (il garde sinon plusieurs centaines de Mo). */
const IDLE_MS = 10 * 60_000

function scriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'native', SCRIPT) : join(projectRoot(), 'native', 'pocket', SCRIPT)
}

/** Voix livrée avec Cyphed : ressources/voice une fois installé, native/voice en développement (npm run build:voice). */
function runtime(): VoiceRuntime | null {
  const bundled = app.isPackaged ? join(process.resourcesPath, 'voice') : join(projectRoot(), 'native', 'voice')
  return pickVoiceRuntime(bundled, process.env.CYPHED_VOICE_DIR ?? '')
}

/** La voix locale est-elle là (Python, modèle et script) ? */
export function pocketAvailable(): boolean {
  return Boolean(runtime()) && existsSync(scriptPath())
}

type Pending = { resolve: (wav: Buffer) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }

/**
 * Voix locale Pocket TTS (Kyutai), dans le Python livré avec Cyphed (ou celui du studio voix). Un seul processus, gardé chargé
 * entre deux phrases, arrêté après 10 min sans lecture. Rien ne sort du PC.
 */
class PocketClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private frames = new FrameReader()
  private pending = new Map<number, Pending>()
  private nextId = 1
  private idle: NodeJS.Timeout | null = null

  async speak(text: string, voice: string, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) throw new Error('aborted')
    await this.start()
    const proc = this.proc
    if (!proc) throw new Error(tm('prov.pocket.stopped'))
    this.touch()
    const id = this.nextId++
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(tm('prov.pocket.slow')))
      }, PHRASE_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      proc.stdin.write(`${JSON.stringify({ id, text, voice })}\n`)
    })
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    const voice = runtime()
    const script = scriptPath()
    if (!voice || !existsSync(script)) return Promise.reject(new Error(tm('prov.pocket.absent')))
    this.ready = new Promise<void>((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {
        // La voix n'a besoin d'aucune clé : elle n'en hérite pas. Hors ligne : le modèle est livré.
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(_API_KEY|_TOKEN|_SECRET|_KEY)$/i.test(k))),
        HF_HOME: voice.hfHome,
        HF_HUB_OFFLINE: '1',
        HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
        HF_HUB_DISABLE_TELEMETRY: '1'
      }
      const proc = spawn(voice.python, ['-I', '-X', 'utf8', script], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      })
      this.proc = proc
      this.frames.reset()
      const timer = setTimeout(() => {
        reject(new Error(tm('prov.pocket.noStart')))
        this.stop()
      }, READY_TIMEOUT_MS)
      proc.stdout.on('data', (chunk: Buffer) => {
        let frames
        try {
          frames = this.frames.push(chunk)
        } catch {
          this.stop()
          return
        }
        for (const { header, data } of frames) {
          if (header.ready) {
            clearTimeout(timer)
            resolve()
            continue
          }
          const pending = this.pending.get(Number(header.id))
          if (!pending) continue
          this.pending.delete(Number(header.id))
          clearTimeout(pending.timer)
          if (typeof header.error === 'string') pending.reject(new Error(`Voix locale : ${header.error}`))
          else pending.resolve(data)
        }
      })
      proc.stderr.on('data', () => undefined) // jamais journalisé : le texte lu peut y passer
      proc.stdin.on('error', () => undefined)
      const died = (): void => {
        clearTimeout(timer)
        if (this.proc !== proc) return
        reject(new Error(tm('prov.pocket.exited')))
        this.stop()
      }
      proc.on('error', died)
      proc.on('exit', died)
    })
    this.ready.catch(() => undefined)
    return this.ready
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.stop(), IDLE_MS)
    this.idle.unref()
  }

  stop(): void {
    const proc = this.proc
    this.proc = null
    this.ready = null
    if (this.idle) clearTimeout(this.idle)
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(tm('prov.pocket.stopped')))
    }
    this.pending.clear()
    if (!proc) return
    try {
      proc.stdin.end()
      proc.kill()
    } catch {
      /* déjà arrêté */
    }
  }
}

export const pocket = new PocketClient()
