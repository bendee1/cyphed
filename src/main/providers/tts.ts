import type { TtsVoice } from '@shared/ipc'
import { DEFAULT_ASSISTANT_VOICE, DEFAULT_LIRE_VOICE } from '@shared/voice'
import type { VoiceRef } from '@shared/types'
import { loadSettings } from '../services/settings'
import { getElevenLabsKey, getMistralKey } from '../secrets'
import { TtsSpeakGate } from './tts-playback'
import { forSpeech, MAX_SPOKEN_CHARS, splitForSpeech } from '../services/speech-core'
import { pocket, pocketAvailable } from './pocket'
import { mainLang, tm } from '../lang'
import { MISTRAL_FALLBACK_ITEMS, MISTRAL_TTS_MODEL, sortMistralVoices, type MistralVoiceItem } from './mistral-voices-core'

type TtsRole = 'lire' | 'assistant'

type TtsAudioChunk = {
  id: string
  mime: string
  data: Buffer
}

export type TtsAudioSink = {
  play(audio: TtsAudioChunk, signal: AbortSignal): Promise<void>
  stop(): void
}

export interface TtsProvider {
  speak(text: string, role?: TtsRole): Promise<void>
  stop(): void
  speaking(): boolean
}

const MISTRAL_SPEECH = 'https://api.mistral.ai/v1/audio/speech'

let audioSink: TtsAudioSink | null = null

export function setTtsAudioSink(sink: TtsAudioSink | null): void {
  audioSink?.stop()
  audioSink = sink
}

/**
 * Texte à dire, découpé : une requête de voix par morceau, rien n'est coupé au milieu.
 * La voix locale lit mieux une ou deux phrases à la fois (mesuré dans le studio voix) : morceaux courts.
 */
function spokenChunks(text: string, max = 1500): string[] {
  return splitForSpeech(forSpeech(text).slice(0, MAX_SPOKEN_CHARS), max).map((chunk) => chunk.replace(/\s+/g, ' ').trim())
}

const pocketVoices = (): TtsVoice[] => [{ id: 'estelle', name: tm('voice.estelle'), provider: 'pocket' }]

function voiceFor(role: TtsRole): VoiceRef {
  const settings = loadSettings()
  const chosen = role === 'assistant' ? settings.assistantVoice : settings.lireVoice
  if (chosen?.provider && chosen.id) return chosen
  return role === 'assistant' ? DEFAULT_ASSISTANT_VOICE : DEFAULT_LIRE_VOICE
}

async function fetchMistralMp3(text: string, voice: VoiceRef, signal: AbortSignal): Promise<Buffer> {
  const key = getMistralKey()
  if (!key) throw new Error(tm('prov.mistral.noKeyTts'))
  const res = await fetch(MISTRAL_SPEECH, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MISTRAL_TTS_MODEL,
      input: text,
      voice_id: voice.id || DEFAULT_LIRE_VOICE.id,
      response_format: 'mp3'
    })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Mistral TTS ${res.status} ${body.slice(0, 180)}`)
  }
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('json')) {
    const json = (await res.json()) as { audio_data?: string }
    if (!json.audio_data) throw new Error(tm('prov.tts.empty'))
    return Buffer.from(json.audio_data, 'base64')
  }
  return Buffer.from(await res.arrayBuffer())
}

async function fetchElevenLabsMp3(text: string, voice: VoiceRef, signal: AbortSignal): Promise<Buffer> {
  const key = getElevenLabsKey()
  if (!key) throw new Error(tm('prov.eleven.noKeyDot'))
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`, {
    method: 'POST',
    signal,
    headers: {
      'xi-api-key': key,
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.7 }
    })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ElevenLabs ${res.status} ${body.slice(0, 180)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

async function listElevenLabsVoices(): Promise<TtsVoice[]> {
  const key = getElevenLabsKey()
  if (!key) return []
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key, Accept: 'application/json' }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ElevenLabs voix ${res.status} ${body.slice(0, 120)}`)
  }
  const json = (await res.json()) as {
    voices?: Array<{ voice_id?: string; name?: string }>
  }
  return (json.voices ?? [])
    .map((voice) => ({
      id: (voice.voice_id ?? '').trim(),
      name: `${(voice.name ?? voice.voice_id ?? '').trim()} — ElevenLabs`,
      provider: 'elevenlabs' as const
    }))
    .filter((voice) => voice.id && voice.name)
}

export async function listTtsVoices(): Promise<TtsVoice[]> {
  const listed: TtsVoice[] = []
  if (getElevenLabsKey()) {
    try {
      listed.push(...(await listElevenLabsVoices()))
    } catch (err) {
      console.warn('[tts] elevenlabs voices', err instanceof Error ? err.message : err)
    }
  }
  if (pocketAvailable()) listed.push(...pocketVoices())
  listed.push(...(await listMistralVoices()))
  const seen = new Set<string>()
  return listed.filter((voice) => {
    const key = `${voice.provider}:${voice.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function listMistralVoices(): Promise<TtsVoice[]> {
  const fallback = sortMistralVoices(MISTRAL_FALLBACK_ITEMS, mainLang())
  const key = getMistralKey()
  if (!key) return fallback
  try {
    // La liste est découpée en pages (limit + offset) : on lit tout, au plus 6 pages.
    const items: MistralVoiceItem[] = []
    for (let page = 0; page < 6; page += 1) {
      const res = await fetch(`https://api.mistral.ai/v1/audio/voices?type=preset&limit=50&offset=${items.length}`, {
        headers: { Authorization: `Bearer ${key}` }
      })
      if (!res.ok) return items.length ? sortMistralVoices(items, mainLang()) : fallback
      const json = (await res.json()) as { items?: MistralVoiceItem[]; total?: number }
      const batch = json.items ?? []
      items.push(...batch)
      if (batch.length === 0 || items.length >= (json.total ?? 0)) break
    }
    return items.length ? sortMistralVoices(items, mainLang()) : fallback
  } catch {
    return fallback
  }
}

class CloudTtsProvider implements TtsProvider {
  private readonly gate = new TtsSpeakGate()

  speaking(): boolean {
    return this.gate.speaking()
  }

  stop(): void {
    this.gate.stop()
    audioSink?.stop()
  }

  async speak(text: string, role: TtsRole = 'lire'): Promise<void> {
    const voice = voiceFor(role)
    const local = voice.provider === 'pocket'
    const chunks = spokenChunks(text, local ? 260 : 1500)
    if (chunks.length === 0) return
    const { id, signal, controller } = this.gate.start()
    try {
      if (local && !pocketAvailable()) throw new Error(tm('prov.pocket.absentChoose'))
      if (voice.provider === 'elevenlabs' && !getElevenLabsKey()) {
        throw new Error(tm('prov.tts.elevenChosen'))
      }
      if (voice.provider === 'mistral' && !getMistralKey()) {
        throw new Error(tm('prov.tts.voxtralChosen'))
      }
      const sink = audioSink
      if (!sink) throw new Error(tm('prov.tts.noPlayer'))
      const fetchChunk = (chunk: string): Promise<Buffer> =>
        local
          ? pocket.speak(chunk, voice.id, signal)
          : voice.provider === 'elevenlabs'
            ? fetchElevenLabsMp3(chunk, voice, signal)
            : fetchMistralMp3(chunk, voice, signal)
      // Le morceau suivant se prépare pendant qu'on écoute le précédent : pas de blanc entre deux.
      let next = fetchChunk(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        const data = await next
        if (i + 1 < chunks.length) {
          next = fetchChunk(chunks[i + 1])
          next.catch(() => undefined)
        }
        if (!this.gate.isLive(id, controller)) return
        await sink.play({ id, mime: local ? 'audio/wav' : 'audio/mpeg', data }, signal)
        if (!this.gate.isLive(id, controller)) return
      }
    } finally {
      this.gate.finish(id, controller)
    }
  }
}

export function createTtsProvider(): TtsProvider {
  if (!getElevenLabsKey() && !getMistralKey() && !pocketAvailable()) {
    throw new Error(tm('prov.tts.noProvider'))
  }
  return new CloudTtsProvider()
}
