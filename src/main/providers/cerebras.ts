import { getCerebrasKey } from '../secrets'
import type { CleanupInput, CleanupResult, TextCleanupProvider } from './text'
import { outputOrFallback } from './cleanup-shared'
import { cleanupSystemPrompt } from './cerebras-cleanup'
import { guardCleanup } from '../services/output-guard'
import { isSaneCleanup } from './cleanup-prompt'
import { tm } from '../lang'

const MODEL = 'gpt-oss-120b'
const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions'

/** Retire une enveloppe de guillemets, jamais ceux d'une citation (« oui », dit-il, « non »). */
function stripWrapper(text: string): string {
  const t = text.trim()
  if (!/^["«].*["»]$/s.test(t) || /["«»]/.test(t.slice(1, -1))) return t
  return t.slice(1, -1).trim()
}

export async function cerebrasComplete(
  system: string,
  user: string,
  timeoutMs: number,
  maxTokens = 800
): Promise<{ text: string; finishReason: string }> {
  const key = getCerebrasKey()
  if (!key) throw new Error(tm('prov.cerebras.noKey'))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: maxTokens,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Cerebras ${res.status} ${body.slice(0, 180)}`)
    }
    const json = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
    }
    const choice = json.choices?.[0]
    const text = stripWrapper(choice?.message?.content ?? '')
    const finishReason = choice?.finish_reason ?? ''
    if (!text) throw new Error('Cerebras: réponse vide')
    return { text, finishReason }
  } finally {
    clearTimeout(timer)
  }
}

export class CerebrasCleanupProvider implements TextCleanupProvider {
  async cleanup(input: CleanupInput, timeoutMs: number): Promise<CleanupResult> {
    const started = Date.now()
    if (!getCerebrasKey()) {
      return { text: input.rawText, usedModel: false, latencyMs: null }
    }
    try {
      const language = input.language ?? 'multi'
      // Ni appli ni titre de fenêtre : le secours ne reçoit que la dictée.
      const user = `Langue dictée : ${language}\n\nDictée :\n${input.rawText}`
      const result = await cerebrasComplete(cleanupSystemPrompt(language, input.translateTo), user, timeoutMs, 512)
      const applied = outputOrFallback(input.rawText, result)
      const base = { latencyMs: Date.now() - started, provider: 'cerebras' as const }
      if (!applied.usedModel) return { ...base, text: input.rawText, usedModel: false, fallback: tm('prov.emptyOrCut') }
      // Même contrôle que Haiku : une réponse ou une réécriture n'est jamais collée.
      const guarded = guardCleanup(input.rawText, applied.text.replace(/‑/g, '-'), input.translateTo)
      if (!guarded.ok || !isSaneCleanup(input.rawText, guarded.text)) {
        const reason = guarded.ok ? tm('prov.incoherent') : guarded.reason
        return { ...base, text: input.rawText, usedModel: false, fallback: reason, rejected: applied.text.slice(0, 2000) }
      }
      return { ...base, text: guarded.text, usedModel: true }
    } catch (err) {
      console.warn('[cerebras] fallback transcript brut:', err instanceof Error ? err.message : err)
      return {
        text: input.rawText,
        usedModel: false,
        latencyMs: Date.now() - started,
        provider: 'cerebras',
        fallback: 'secours Cerebras indisponible',
        failed: true
      }
    }
  }
}
