import { getDeepgramKey } from '../secrets'
import { transcribeWav } from './deepgram'
import { wavHeader } from '../services/audio-store-core'
import type { LiveSttSession, SttOpenOptions } from './stt'

export type FileTranscriber = (wav: Buffer, options: { language: string; keyterms?: string[]; timeoutMs?: number }) => Promise<string>

/** Délai d'une transcription en fichier entier : ~0,5 s + ~35 ms par seconde d'audio mesurés, large marge. */
export function fileTimeoutMs(pcmBytes: number): number {
  return Math.min(30_000, 6000 + Math.round((pcmBytes / 32000) * 150))
}

/**
 * Session « fichier entier » : l'audio est gardé pendant la dictée et transcrit d'un coup à la fin.
 * Clé refusée ou crédit épuisé : le même audio part à Deepgram. Panne réseau : l'erreur remonte
 * (la dictée est gardée pour Réessayer).
 */
export function fileSession(provider: string, model: string, options: SttOpenOptions | undefined, transcribe: FileTranscriber): LiveSttSession {
  const chunks: Buffer[] = []
  let bytes = 0
  const language = options?.language ?? 'multi'
  const keyterms = options?.keyterms ?? []
  return {
    provider,
    model,
    send(pcm16) {
      chunks.push(pcm16)
      bytes += pcm16.length
    },
    async finalize() {
      if (bytes === 0) return ''
      const wav = Buffer.concat([wavHeader(bytes), ...chunks])
      try {
        return await transcribe(wav, { language, keyterms, timeoutMs: fileTimeoutMs(bytes) })
      } catch (err) {
        if (provider === 'deepgram' || (err as { retryable?: boolean })?.retryable || !getDeepgramKey()) throw err
        console.warn(`[stt] ${provider} refusé, relais Deepgram :`, err instanceof Error ? err.message : err)
        return transcribeWav(wav, { language, keyterms })
      }
    },
    close() {
      chunks.length = 0
    }
  }
}
