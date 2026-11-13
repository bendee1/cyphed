import { tm } from '../lang.ts'
// Scribe v2 Realtime d'ElevenLabs : logique pure (paramètres, messages), testable sans réseau.

export const SCRIBE_MODEL = 'scribe_v2_realtime'
export const SCRIBE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
/** Limites de Scribe Realtime pour les mots à mieux reconnaître. */
const MAX_KEYTERMS = 50
const MAX_KEYTERM_LENGTH = 20

export type ScribeMessage = {
  message_type?: string
  text?: string
  error?: string
}

export type ScribeFold = {
  committed: string[]
  partial: string
}

/** Paramètres de connexion. `multi` laisse Scribe reconnaître la langue. */
export function scribeQuery(language: string, keyterms: string[] = []): URLSearchParams {
  const params = new URLSearchParams({
    model_id: SCRIBE_MODEL,
    audio_format: 'pcm_16000',
    // Transcription mot à mot : « no_verbatim » retirait aussi les « tu vois » et changeait des mots
    // (« qui joue peu » -> « qui ne joue plus »). Les « euh » partent au nettoyage.
    commit_strategy: 'manual'
  })
  if (language && language !== 'multi') params.set('language_code', language)
  const seen = new Set<string>()
  for (const raw of keyterms) {
    const term = raw.replace(/\s+/g, ' ').trim()
    const key = term.toLowerCase()
    if (!term || term.length > MAX_KEYTERM_LENGTH || seen.has(key)) continue
    seen.add(key)
    params.append('keyterms', term)
    if (seen.size >= MAX_KEYTERMS) break
  }
  return params
}

/** Morceau d'audio à envoyer (PCM 16 bits, 16 kHz). `commit` clôt la dictée. */
export function audioChunk(pcm16: Buffer, commit: boolean): string {
  return JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm16.toString('base64'), commit, sample_rate: 16000 })
}

export function foldScribe(state: ScribeFold, msg: ScribeMessage): ScribeFold {
  const text = (msg.text ?? '').trim()
  if (msg.message_type === 'committed_transcript') {
    return { committed: text ? [...state.committed, text] : state.committed, partial: '' }
  }
  if (msg.message_type === 'partial_transcript') return { committed: state.committed, partial: text }
  return state
}

export function scribeText(state: ScribeFold): string {
  return dropFalseStarts([...state.committed, state.partial].filter(Boolean).join(' '))
}

/** Scribe marque un mot coupé par « -- » (« tu-- enfin ») : c'est un faux départ, on l'enlève. */
export function dropFalseStarts(text: string): string {
  return text
    .replace(/(^|\s)[\p{L}'’-]*\p{L}--(?=\s|$)/gu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Message d'erreur du service (clé, quota…), ou null pour un message normal. */
export function scribeError(msg: ScribeMessage): string | null {
  const type = msg.message_type ?? ''
  if (['session_started', 'partial_transcript', 'committed_transcript', 'committed_transcript_with_timestamps'].includes(type)) return null
  if (type === 'auth_error') return tm('prov.eleven.refused')
  if (type === 'quota_exceeded') return tm('prov.eleven.credit')
  if (type === 'rate_limited' || type === 'resource_exhausted' || type === 'queue_overflow') return tm('prov.eleven.busy')
  if (type === 'insufficient_audio_activity') return null
  if (type === 'warning') return null
  if (type.endsWith('error') || type === 'invalid_request' || type === 'session_time_limit_exceeded') {
    return `ElevenLabs : ${(msg.error ?? type).slice(0, 80)}`
  }
  return null
}

/** Messages reçus depuis le commit : le dernier est un texte validé (rien de provisoire après lui). */
export function finalSettled(sinceCommit: ScribeMessage[]): boolean {
  const relevant = sinceCommit.filter((m) => m.message_type === 'committed_transcript' || m.message_type === 'partial_transcript')
  return relevant.length > 0 && relevant[relevant.length - 1].message_type === 'committed_transcript'
}
