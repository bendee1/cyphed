import WebSocket from 'ws'
import { getElevenLabsKey } from '../secrets'
import { fileSession } from './file-stt'
import type { LiveSttSession, SttOpenOptions, SttProvider } from './stt'
import { audioChunk, dropFalseStarts, finalSettled, foldScribe, SCRIBE_FILE_MODEL, SCRIBE_MODEL, SCRIBE_URL, scribeError, scribeQuery, scribeText, type ScribeFold, type ScribeMessage } from './elevenlabs-core'
import { tm } from '../lang'

const CLOSE_TIMEOUT_MS = 1500
/** Après un texte validé, ce délai sans nouveau message dit que c'était le dernier. */
const SETTLE_MS = 60

/**
 * Attend le texte de la fin. Scribe valide parfois seul un segment pendant la dictée : celui qui arrive
 * juste après le commit peut être l'avant-dernier. Un texte provisoire qui suit veut dire qu'il en reste.
 */
function waitForFinal(subscribe: (l: (msg: ScribeMessage) => void) => () => void, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let seen: ScribeMessage[] = []
    let settle: NodeJS.Timeout | undefined
    const finish = (): void => {
      clearTimeout(settle)
      clearTimeout(timer)
      off()
      resolve()
    }
    const off = subscribe((msg) => {
      seen = [...seen, msg]
      clearTimeout(settle)
      if (finalSettled(seen)) settle = setTimeout(finish, SETTLE_MS)
    })
    const timer = setTimeout(finish, timeoutMs)
  })
}
/** 100 ms de silence : le dernier morceau qui porte le commit. */
const COMMIT_PAD = Buffer.alloc(3200)

function retryable(message: string): Error {
  return Object.assign(new Error(message), { retryable: true })
}

/** Erreur réseau de Node -> message lisible. */
function networkMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? ''
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|ECONNRESET|ETIMEDOUT/.test(code)) return tm('err.offline')
  return err instanceof Error && err.message ? `ElevenLabs : ${err.message.slice(0, 80)}` : tm('err.unreachable', { name: 'ElevenLabs' })
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

/** Scribe v3 Live : l'audio part pendant la dictée, le texte arrive ~150 ms après la fin. */
export class ElevenLabsSttProvider implements SttProvider {
  async open(options?: SttOpenOptions): Promise<LiveSttSession> {
    const key = getElevenLabsKey()
    if (!key) throw new Error(tm('prov.eleven.noKey'))
    const signal = options?.signal
    if (signal?.aborted) throw abortError()

    const url = `${SCRIBE_URL}?${scribeQuery(options?.language ?? 'multi', options?.keyterms ?? []).toString()}`
    const ws = new WebSocket(url, { headers: { 'xi-api-key': key } })
    let fold: ScribeFold = { committed: [], partial: '' }
    const listeners = new Set<(msg: ScribeMessage) => void>()
    let lost = false
    let closing = false

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(() => reject(retryable(tm('prov.eleven.silent')))), 8000)
      const finish = (fn: () => void): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        off()
        fn()
      }
      const onAbort = (): void => {
        try {
          ws.close()
        } catch {
          /* déjà fermé */
        }
        finish(() => reject(abortError()))
      }
      // L'audio envoyé avant « session_started » peut être perdu : on attend ce message.
      const listener = (msg: ScribeMessage): void => {
        if (msg.message_type === 'session_started') finish(() => resolve())
        else {
          const error = scribeError(msg)
          if (error) finish(() => reject(new Error(error)))
        }
      }
      listeners.add(listener)
      const off = (): void => void listeners.delete(listener)
      ws.once('unexpected-response', (_req, res) => {
        const status = res.statusCode ?? 0
        res.resume()
        const message = status === 401 || status === 403 ? tm('prov.eleven.refused') : tm('prov.eleven.down', { status })
        finish(() => reject(status === 429 || status >= 500 ? retryable(message) : new Error(message)))
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      // Écouteur permanent : un 2e « error » sans écouteur ferait planter le processus principal.
      ws.on('error', (err) => {
        lost = true
        finish(() => reject(retryable(networkMessage(err))))
      })
    })
    ws.on('close', () => {
      if (!closing) lost = true
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ScribeMessage
        fold = foldScribe(fold, msg)
        for (const listener of listeners) listener(msg)
        if (msg.message_type === 'partial_transcript' || msg.message_type === 'committed_transcript') options?.onCaption?.(scribeText(fold))
      } catch {
        // message non JSON ignoré
      }
    })

    try {
      await ready
    } catch (err) {
      try {
        ws.close()
      } catch {
        /* déjà fermé */
      }
      throw err
    }

    const subscribe = (listener: (msg: ScribeMessage) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    return {
      provider: 'elevenlabs',
      model: SCRIBE_MODEL,
      send(pcm16) {
        if (ws.readyState === WebSocket.OPEN && pcm16.length > 0) ws.send(audioChunk(pcm16, false))
      },
      lost: () => lost,
      async finalize() {
        if (ws.readyState !== WebSocket.OPEN) return scribeText(fold)
        closing = true
        const done = waitForFinal(subscribe, CLOSE_TIMEOUT_MS)
        ws.send(audioChunk(COMMIT_PAD, true))
        await done
        try {
          ws.close()
        } catch {
          /* déjà fermé */
        }
        return scribeText(fold)
      },
      close() {
        closing = true
        try {
          ws.close()
        } catch {
          /* déjà fermé */
        }
      }
    }
  }
}

/** Transcrit un fichier WAV gardé (bouton Réessayer) avec Scribe v3, en une requête. */
export async function transcribeWavScribe(
  wav: Buffer,
  options: { language: string; keyterms?: string[]; timeoutMs?: number }
): Promise<string> {
  const key = getElevenLabsKey()
  if (!key) throw new Error(tm('prov.eleven.noKeyShort'))
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'dictee.wav')
  form.append('model_id', SCRIBE_FILE_MODEL)
  form.append('tag_audio_events', 'false')
  if (options.language && options.language !== 'multi') form.append('language_code', options.language)
  for (const term of scribeQuery('multi', options.keyterms ?? []).getAll('keyterms')) form.append('keyterms', term)
  let res: Response
  try {
    res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000)
    })
  } catch (err) {
    throw retryable(networkMessage((err as { cause?: unknown })?.cause ?? err))
  }
  if (res.status === 401 || res.status === 403) throw new Error(tm('prov.eleven.refused'))
  if (res.status === 402) throw new Error(tm('prov.eleven.credit'))
  if (!res.ok) throw new Error(tm('err.unavailable', { name: 'ElevenLabs', status: String(res.status) }))
  const json = (await res.json()) as { text?: string }
  return dropFalseStarts(json.text ?? '')
}

/**
 * Scribe v3 en fichier entier : l'audio est gardé pendant la dictée et transcrit d'un coup à la fin.
 * Clé refusée ou crédit épuisé : le même audio part à Deepgram.
 */
export class ScribeFileSttProvider implements SttProvider {
  async open(options?: SttOpenOptions): Promise<LiveSttSession> {
    if (options?.signal?.aborted) throw abortError()
    if (!getElevenLabsKey()) throw new Error(tm('prov.eleven.noKey'))
    return fileSession('elevenlabs', SCRIBE_FILE_MODEL, options, transcribeWavScribe)
  }
}
