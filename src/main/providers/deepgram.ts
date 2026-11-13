import WebSocket from 'ws'
import { getDeepgramKey } from '../secrets'
import type { LiveSttSession, SttOpenOptions, SttProvider } from './stt'
import { closeAndCollect, foldTranscript, type DeepgramLiveMessage } from './deepgram-finalize'
import { fileSession } from './file-stt'
import { tm } from '../lang'

const MODEL = 'nova-3'
const CLOSE_TIMEOUT_MS = 1500

/** Panne passagère (réseau, saturation) : la dictée continue hors ligne et se réessaie ensuite. */
function retryable(message: string): Error {
  return Object.assign(new Error(message), { retryable: true })
}

export function isRetryableSttError(err: unknown): boolean {
  return Boolean((err as { retryable?: boolean } | null)?.retryable)
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

/** Message affiché dans la barre quand Deepgram refuse la connexion (code HTTP de la poignée de main). */
export function deepgramStatusMessage(status: number): string {
  if (status === 401 || status === 403) return tm('prov.deepgram.refused')
  if (status === 402) return tm('prov.deepgram.credit')
  if (status === 429) return tm('prov.deepgram.busy')
  return `Deepgram indisponible (${status})`
}

/** Erreur réseau de Node -> message lisible. */
export function deepgramNetworkMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? ''
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|ECONNRESET|ETIMEDOUT/.test(code)) return 'Pas de connexion internet'
  return err instanceof Error && err.message ? `Deepgram : ${err.message.slice(0, 80)}` : 'Deepgram injoignable'
}

export class DeepgramSttProvider implements SttProvider {
  async open(options?: SttOpenOptions): Promise<LiveSttSession> {
    const key = getDeepgramKey()
    if (!key) {
      throw new Error(tm('prov.deepgram.noKey'))
    }

    const signal = options?.signal
    if (signal?.aborted) throw abortError()

    const language = options?.language ?? 'multi'
    const params = new URLSearchParams({
      model: MODEL,
      language,
      smart_format: 'true',
      interim_results: 'true',
      endpointing: '100',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      punctuate: 'true'
    })

    for (const term of options?.keyterms ?? []) params.append('keyterm', term)

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`
    const ws = new WebSocket(url, {
      headers: { Authorization: `Token ${key}` }
    })

    let fold = { committed: '', interim: '' }
    const listeners = new Set<(msg: DeepgramLiveMessage) => void>()

    let lost = false
    let closing = false
    const waitOpen = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(() => reject(retryable(tm('prov.deepgram.silent')))), 8000)
      const finish = (fn: () => void): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = (): void => {
        try {
          ws.close()
        } catch {
          /* already closed */
        }
        finish(() => reject(abortError()))
      }
      ws.once('open', () => finish(() => resolve()))
      ws.once('unexpected-response', (_req, res) => {
        const status = res.statusCode ?? 0
        res.resume()
        const message = deepgramStatusMessage(status)
        finish(() => reject(status === 429 || status >= 500 ? retryable(message) : new Error(message)))
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      // Écouteur permanent : un 2e « error » sans écouteur ferait planter tout le processus principal.
      ws.on('error', (err) => {
        lost = true
        finish(() => reject(retryable(deepgramNetworkMessage(err))))
      })
    })
    ws.on('close', () => {
      if (!closing) lost = true
    })

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as DeepgramLiveMessage
        fold = foldTranscript(fold, msg)
        for (const listener of listeners) listener(msg)
      } catch {
        // ignore non-JSON
      }
    })

    try {
      await waitOpen
    } catch (err) {
      try {
        ws.close()
      } catch {
        /* already closed */
      }
      throw err
    }

    const subscribe = (listener: (msg: DeepgramLiveMessage) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    const session: LiveSttSession = {
      provider: 'deepgram',
      model: MODEL,
      send(pcm16) {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm16)
      },
      lost: () => lost,
      async finalize() {
        if (ws.readyState === WebSocket.OPEN) {
          closing = true
          return closeAndCollect(
            () => {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
            },
            subscribe,
            () => `${fold.committed} ${fold.interim}`.trim(),
            CLOSE_TIMEOUT_MS
          )
        }
        return `${fold.committed} ${fold.interim}`.trim()
      },
      close() {
        closing = true
        try {
          ws.close()
        } catch {
          /* already closed */
        }
      }
    }

    return session
  }
}

/** Transcrit un fichier WAV gardé (bouton Réessayer), en une requête. */
export async function transcribeWav(
  wav: Buffer,
  options: { language: string; keyterms?: string[]; timeoutMs?: number }
): Promise<string> {
  const key = getDeepgramKey()
  if (!key) throw new Error(tm('prov.deepgram.noKeyShort'))
  const params = new URLSearchParams({ model: MODEL, language: options.language, smart_format: 'true', punctuate: 'true' })
  for (const term of options.keyterms ?? []) params.append('keyterm', term)
  let res: Response
  try {
    res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: new Uint8Array(wav),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000)
    })
  } catch (err) {
    throw retryable(deepgramNetworkMessage((err as { cause?: unknown })?.cause ?? err))
  }
  if (!res.ok) {
    const message = deepgramStatusMessage(res.status)
    throw res.status === 429 || res.status >= 500 ? retryable(message) : new Error(message)
  }
  const json = (await res.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
  }
  return (json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim()
}

/**
 * Nova-3 en fichier entier : l'audio est transcrit d'un coup à la fin. Le modèle français de fichier
 * (amélioré par Deepgram en juillet 2026) rate moins de mots que le flux : 4,0 % contre 5,9 % sur
 * l'usage réel, ~90 ms de plus en médiane.
 */
export class DeepgramFileSttProvider implements SttProvider {
  async open(options?: SttOpenOptions): Promise<LiveSttSession> {
    if (options?.signal?.aborted) throw abortError()
    if (!getDeepgramKey()) throw new Error(tm('prov.deepgram.noKey'))
    return fileSession('deepgram', `${MODEL}-fichier`, options, transcribeWav)
  }
}

export class MockSttProvider implements SttProvider {
  async open(options?: SttOpenOptions): Promise<LiveSttSession> {
    if (options?.signal?.aborted) throw abortError()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 40)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(abortError())
      }
      if (!options?.signal) return
      if (options.signal.aborted) {
        clearTimeout(timer)
        reject(abortError())
        return
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    })
    if (options?.signal?.aborted) throw abortError()
    return {
      provider: 'mock',
      model: 'mock',
      send() {},
      async finalize() {
        await new Promise((r) => setTimeout(r, 80))
        return 'test cyphed'
      },
      close() {}
    }
  }
}
