// Voix locale (Pocket TTS) : lecture des trames du script Python et recherche de son Python.
// Pur (node:fs et node:path seulement), testable avec `node --test`.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type PocketFrame = { header: Record<string, unknown>; data: Buffer }

/** Reconstitue les trames (en-tête JSON + données) à partir des morceaux lus sur la sortie du script. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): PocketFrame[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    const frames: PocketFrame[] = []
    while (this.buffer.length >= 8) {
      const headLen = this.buffer.readUInt32LE(0)
      const dataLen = this.buffer.readUInt32LE(4)
      if (headLen > 1_000_000 || dataLen > 200_000_000) throw new Error('trame invalide')
      const total = 8 + headLen + dataLen
      if (this.buffer.length < total) break
      let header: Record<string, unknown> = {}
      try {
        header = JSON.parse(this.buffer.subarray(8, 8 + headLen).toString('utf8')) as Record<string, unknown>
      } catch {
        header = { error: 'en-tête illisible' }
      }
      frames.push({ header, data: Buffer.from(this.buffer.subarray(8 + headLen, total)) })
      this.buffer = this.buffer.subarray(total)
    }
    return frames
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
  }
}

/** Dossier de voix externe (CYPHED_VOICE_DIR) : un environnement Python déjà prêt, avec venv/ et hf-cache/. */
export function findVoiceDir(dir: string): string | null {
  if (!dir) return null
  return existsSync(join(dir, 'venv', 'Scripts', 'python.exe')) ? dir : null
}

export type VoiceRuntime = { python: string; hfHome: string; source: 'cyphed' | 'external' }

/**
 * Python de la voix : celui livré avec Cyphed (dossier voice des ressources : python/ + hf-cache/),
 * sinon celui de CYPHED_VOICE_DIR (poste de développement sans npm run build:voice).
 */
export function pickVoiceRuntime(bundledDir: string, externalDir: string): VoiceRuntime | null {
  const bundled = join(bundledDir, 'python', 'python.exe')
  if (existsSync(bundled) && existsSync(join(bundledDir, 'hf-cache'))) {
    return { python: bundled, hfHome: join(bundledDir, 'hf-cache'), source: 'cyphed' }
  }
  const external = findVoiceDir(externalDir)
  return external ? { python: join(external, 'venv', 'Scripts', 'python.exe'), hfHome: join(external, 'hf-cache'), source: 'external' } : null
}
