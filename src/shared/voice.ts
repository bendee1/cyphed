import { DEFAULT_SETTINGS, type VoiceRef } from './types'

const VOICE_PROVIDERS = ['mistral', 'elevenlabs'] as const

export const DEFAULT_LIRE_VOICE: VoiceRef = DEFAULT_SETTINGS.lireVoice
export const DEFAULT_ASSISTANT_VOICE: VoiceRef = DEFAULT_SETTINGS.assistantVoice

const KNOWN_MISTRAL_IDS = new Set([
  'fr_marie_neutral',
  'en_paul_neutral',
  'gb_oliver_neutral',
  'gb_jane_sarcasm'
])

export function voiceKey(voice: VoiceRef): string {
  return `${voice.provider}:${voice.id}`
}

export function parseVoiceKey(value: string): VoiceRef | null {
  const sep = value.indexOf(':')
  if (sep <= 0) return null
  const provider = value.slice(0, sep)
  const id = value.slice(sep + 1).trim()
  if (provider !== 'mistral' && provider !== 'elevenlabs' && provider !== 'pocket') return null
  if (!id || id.length > 80) return null
  return { provider, id }
}

function asVoiceRef(value: unknown): VoiceRef | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { provider?: unknown; id?: unknown }
  if (raw.provider !== 'mistral' && raw.provider !== 'elevenlabs' && raw.provider !== 'pocket') return null
  if (typeof raw.id !== 'string') return null
  const id = raw.id.trim()
  if (!id || id.length > 80) return null
  return { provider: raw.provider, id }
}

/** Accepts `{provider,id}` or a legacy string id saved before R0. Never uses includes('_'). */
export function parseVoiceRef(value: unknown, fallback: VoiceRef): VoiceRef {
  const explicit = asVoiceRef(value)
  if (explicit) return explicit
  if (typeof value === 'string') {
    const keyed = parseVoiceKey(value)
    if (keyed) return keyed
    const id = value.trim()
    if (!id || id.length > 80) return fallback
    if (KNOWN_MISTRAL_IDS.has(id)) return { provider: 'mistral', id }
    return { provider: 'elevenlabs', id }
  }
  return fallback
}

export function sameVoice(a: VoiceRef | null | undefined, b: VoiceRef | null | undefined): boolean {
  return Boolean(a && b && a.provider === b.provider && a.id === b.id)
}
