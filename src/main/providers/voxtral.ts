import { getMistralKey } from '../secrets'
import { fileSession } from './file-stt'
import type { LiveSttSession, SttOpenOptions, SttProvider } from './stt'
import { tm } from '../lang'

const MODEL = 'voxtral-mini-latest'
/** Limite de Mistral pour les mots à mieux reconnaître (context_bias). */
const MAX_BIAS = 100

function retryable(message: string): Error {
  return Object.assign(new Error(message), { retryable: true })
}

/** Transcrit un WAV avec Voxtral Mini Transcribe (Mistral), en une requête. */
export async function transcribeWavVoxtral(
  wav: Buffer,
  options: { language: string; keyterms?: string[]; timeoutMs?: number }
): Promise<string> {
  const key = getMistralKey()
  if (!key) throw new Error(tm('prov.mistral.noKey'))
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'dictee.wav')
  form.append('model', MODEL)
  if (options.language && options.language !== 'multi') form.append('language', options.language)
  for (const term of (options.keyterms ?? []).slice(0, MAX_BIAS)) form.append('context_bias', term)
  let res: Response
  try {
    res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000)
    })
  } catch {
    throw retryable(tm('err.unreachable', { name: 'Mistral' }))
  }
  if (res.status === 401 || res.status === 403) throw new Error(tm('prov.mistral.refused'))
  if (res.status === 429 || res.status >= 500) throw retryable(tm('err.unavailable', { name: 'Mistral', status: String(res.status) }))
  if (!res.ok) throw new Error(tm('prov.mistral.audio', { status: res.status }))
  const json = (await res.json()) as { text?: string }
  return (json.text ?? '').trim()
}

/** Voxtral en fichier entier : transcrit à la fin de la dictée. */
export class VoxtralFileSttProvider implements SttProvider {
  async open(options?: SttOpenOptions): Promise<LiveSttSession> {
    if (options?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (!getMistralKey()) throw new Error(tm('prov.mistral.noKeyMissing'))
    return fileSession('mistral', MODEL, options, transcribeWavVoxtral)
  }
}
