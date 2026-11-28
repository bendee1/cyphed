import { join } from 'node:path'
import type { SecretState, SecretWrite } from '@shared/types'
import { userDataDir } from './paths'
import { readJsonOrQuarantine, writeJsonAtomic } from './services/json-file'
import {
  applySecretOps as applyOps,
  parseSecretWrite as parseWrite,
  publicSecretsFrom,
  type StoredSecrets as OpSecrets
} from './secrets-ops'
import { tm } from './lang'

export type StoredSecrets = {
  deepgram: string
  cerebras: string
  mistral: string
  elevenlabs: string
  anthropic: string
  openai: string
}

export type SecretName = keyof StoredSecrets

const EMPTY: StoredSecrets = { deepgram: '', cerebras: '', mistral: '', elevenlabs: '', anthropic: '', openai: '' }

const ENV_KEYS: Record<SecretName, string> = {
  deepgram: 'DEEPGRAM_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_COMPAT_API_KEY'
}

function secretsPath(): string {
  return join(userDataDir(), 'secrets.json')
}

function envHas(name: SecretName): boolean {
  return Boolean((process.env[ENV_KEYS[name]] ?? '').trim())
}

/** Posé quand secrets.json était illisible (renommé) : la prochaine sauvegarde refuse d'écrire une fois, pour ne pas faire croire que les autres clés ont survécu. */
let unreadableNotice: string | null = null

export function loadStoredSecrets(): StoredSecrets {
  const read = readJsonOrQuarantine(secretsPath())
  if (read.status === 'missing') return { ...EMPTY }
  if (read.status === 'corrupt' || !read.value || typeof read.value !== 'object' || Array.isArray(read.value)) {
    const where = read.status === 'corrupt' ? read.quarantinedTo : null
    unreadableNotice = tm('notice.secretsUnreadable', { where: where ? tm('notice.renamedTo', { path: where }) : '' })
    console.warn('[secrets] secrets.json illisible' + (where ? ', renommé' : ''))
    return { ...EMPTY }
  }
  const parsed = read.value as Partial<StoredSecrets>
  return {
    deepgram: typeof parsed.deepgram === 'string' ? parsed.deepgram.trim() : '',
    cerebras: typeof parsed.cerebras === 'string' ? parsed.cerebras.trim() : '',
    mistral: typeof parsed.mistral === 'string' ? parsed.mistral.trim() : '',
    elevenlabs: typeof parsed.elevenlabs === 'string' ? parsed.elevenlabs.trim() : '',
    anthropic: typeof parsed.anthropic === 'string' ? parsed.anthropic.trim() : '',
    openai: typeof parsed.openai === 'string' ? parsed.openai.trim() : ''
  }
}

export function saveStoredSecrets(next: StoredSecrets): void {
  if (unreadableNotice) {
    const message = unreadableNotice
    unreadableNotice = null
    throw new Error(message)
  }
  writeJsonAtomic(secretsPath(), {
    deepgram: next.deepgram.trim(),
    cerebras: next.cerebras.trim(),
    mistral: next.mistral.trim(),
    elevenlabs: next.elevenlabs.trim(),
    anthropic: next.anthropic.trim(),
    openai: next.openai.trim()
  })
}

export function applySecretOps(
  current: StoredSecrets,
  ops: Partial<Record<SecretName, SecretWrite | undefined>>
): StoredSecrets {
  return applyOps(current as OpSecrets, ops)
}

export function parseSecretWrite(raw: unknown): SecretWrite | undefined {
  return parseWrite(raw)
}

export function publicSecrets(stored = loadStoredSecrets()): Record<SecretName, SecretState> {
  return publicSecretsFrom(stored, {
    deepgram: envHas('deepgram'),
    cerebras: envHas('cerebras'),
    mistral: envHas('mistral'),
    elevenlabs: envHas('elevenlabs'),
    anthropic: envHas('anthropic'),
    openai: envHas('openai')
  })
}

function resolvedKey(name: SecretName): string {
  const file = loadStoredSecrets()[name]
  if (file) return file
  return (process.env[ENV_KEYS[name]] ?? '').trim()
}

export function getDeepgramKey(): string {
  return resolvedKey('deepgram')
}

export function getCerebrasKey(): string {
  return resolvedKey('cerebras')
}

/** Clé Anthropic : Réglages d'abord, sinon variable d'environnement ANTHROPIC_API_KEY. */
export function getAnthropicKey(): string {
  return resolvedKey('anthropic')
}

/** Clé du modèle compatible OpenAI : Réglages d'abord, sinon OPENAI_COMPAT_API_KEY. Peut être vide (modèle local). */
export function getOpenAiCompatKey(): string {
  return resolvedKey('openai')
}

export function getMistralKey(): string {
  return resolvedKey('mistral')
}

export function getElevenLabsKey(): string {
  // Une clé ElevenLabs commence par « sk_ ». Un identifiant de clé collé par erreur dans Réglages
  // masquait la vraie clé de l'environnement Windows (refus « api_key_id_used_as_api_key »).
  const stored = loadStoredSecrets().elevenlabs
  const env = (process.env[ENV_KEYS.elevenlabs] ?? '').trim()
  if (stored && !stored.startsWith('sk_') && env.startsWith('sk_')) return env
  return resolvedKey('elevenlabs')
}

export function useMockStt(): boolean {
  return process.env.CYPHED_STT_MOCK === '1'
}
