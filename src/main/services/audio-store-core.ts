// Audio des dictées gardé en local pour « Réessayer » : WAV PCM 16 bits, 16 kHz, mono.
// Pur (node:fs seulement), testable avec `node --test`.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SAMPLE_RATE = 16000
const HEADER_BYTES = 44

/** En-tête WAV d'un flux PCM 16 bits mono. */
export function wavHeader(dataBytes: number, sampleRate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(HEADER_BYTES)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + dataBytes, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(dataBytes, 40)
  return h
}

/** Un identifiant de dictée devient un nom de fichier sûr (jamais de chemin). */
function fileName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
  if (!safe) throw new Error('identifiant de dictée vide')
  return `${safe}.wav`
}

export class AudioStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  path(id: string): string {
    return join(this.dir, fileName(id))
  }

  /** Écrit l'audio d'une dictée (écriture atomique). Rien à écrire : rien n'est créé. */
  save(id: string, chunks: Buffer[]): boolean {
    const bytes = chunks.reduce((n, c) => n + c.length, 0)
    if (bytes === 0) return false
    mkdirSync(this.dir, { recursive: true })
    const target = this.path(id)
    const tmp = `${target}.tmp`
    writeFileSync(tmp, Buffer.concat([wavHeader(bytes), ...chunks]))
    renameSync(tmp, target)
    return true
  }

  has(id: string): boolean {
    return existsSync(this.path(id))
  }

  /** Le fichier WAV complet, ou null s'il n'existe plus. */
  read(id: string): Buffer | null {
    const file = this.path(id)
    return existsSync(file) ? readFileSync(file) : null
  }

  remove(id: string): void {
    const file = this.path(id)
    if (existsSync(file)) unlinkSync(file)
  }

  /** Efface l'audio plus vieux que `days` jours. Rend le nombre de fichiers effacés. */
  purgeOlderThan(days: number, now = Date.now()): number {
    if (!existsSync(this.dir)) return 0
    let removed = 0
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.wav') && !name.endsWith('.wav.tmp')) continue
      const file = join(this.dir, name)
      try {
        if (now - statSync(file).mtimeMs > days * 86_400_000) {
          unlinkSync(file)
          removed++
        }
      } catch {
        /* fichier pris ailleurs : on réessaiera au prochain passage */
      }
    }
    return removed
  }

  /** Réglage « ne jamais garder » : tout l'audio est effacé. */
  purgeAll(): number {
    return this.purgeOlderThan(-1)
  }
}
