import type { SecretState, SecretWrite } from '../shared/types.ts'

export type StoredSecrets = {
  deepgram: string
  cerebras: string
  mistral: string
  elevenlabs: string
  anthropic: string
  /** Clé du modèle compatible OpenAI choisi pour le nettoyage (DeepSeek, OpenRouter…). Vide pour un modèle local. */
  openai: string
}

export type SecretName = keyof StoredSecrets

export function applySecretOps(
  current: StoredSecrets,
  ops: Partial<Record<SecretName, SecretWrite | undefined>>
): StoredSecrets {
  const next = { ...current }
  for (const name of ['deepgram', 'cerebras', 'mistral', 'elevenlabs', 'anthropic', 'openai'] as SecretName[]) {
    const op = ops[name]
    if (op == null) continue
    if ('clear' in op && op.clear) {
      next[name] = ''
      continue
    }
    if ('set' in op) next[name] = String(op.set ?? '').trim()
  }
  return next
}

export function parseSecretWrite(raw: unknown): SecretWrite | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as { set?: unknown; clear?: unknown }
  if (value.clear === true) return { clear: true }
  if (typeof value.set === 'string') return { set: value.set }
  return undefined
}

function secretStateFrom(stored: string, envHas: boolean): SecretState {
  if (stored) return { configured: true, source: 'stored' }
  if (envHas) return { configured: true, source: 'env' }
  return { configured: false, source: null }
}

export function publicSecretsFrom(
  stored: StoredSecrets,
  env: Record<SecretName, boolean>
): Record<SecretName, SecretState> {
  return {
    deepgram: secretStateFrom(stored.deepgram, env.deepgram),
    cerebras: secretStateFrom(stored.cerebras, env.cerebras),
    mistral: secretStateFrom(stored.mistral, env.mistral),
    elevenlabs: secretStateFrom(stored.elevenlabs, env.elevenlabs),
    anthropic: secretStateFrom(stored.anthropic, env.anthropic),
    openai: secretStateFrom(stored.openai, env.openai)
  }
}

export function publicPayloadHasRawKey(payload: Record<string, unknown>): boolean {
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some(walk)
    for (const [key, inner] of Object.entries(value)) {
      if (/(key|token|secret)/i.test(key) && typeof inner === 'string' && inner.length > 0) return true
      if (walk(inner)) return true
    }
    return false
  }
  return walk(payload)
}
