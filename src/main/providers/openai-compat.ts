import { getOpenAiCompatKey } from '../secrets'
import { loadSettings } from '../services/settings'
import type { CleanupInput, CleanupResult, TextCleanupProvider } from './text'
import { outputOrFallback } from './cleanup-shared'
import { guardCleanup } from '../services/output-guard'
import { appStyle, buildCleanupSystem, buildCleanupUser, isSaneCleanup } from './cleanup-prompt'
import { openAiCompatTarget, providerEnvKey, readChatCompletion } from './openai-compat-core'
import { tm } from '../lang'

/** Clé : Réglages, sinon OPENAI_COMPAT_API_KEY, sinon la variable habituelle du fournisseur (DEEPSEEK_API_KEY…). */
export function openAiCompatKey(baseUrl: string): string {
  const own = getOpenAiCompatKey()
  if (own) return own
  const name = providerEnvKey(baseUrl)
  return name ? (process.env[name] ?? '').trim() : ''
}

/** Modèle compatible OpenAI choisi dans Réglages, s'il est utilisable (adresse valide et nom de modèle). */
export function openAiCompatConfig(): { endpoint: string; model: string; key: string; extra: Record<string, unknown>; headers: Record<string, string>; host: string } | null {
  const settings = loadSettings()
  if (settings.cleanupEngine !== 'openai' || !settings.openaiModel) return null
  const target = openAiCompatTarget(settings.openaiBaseUrl, settings.openaiModel)
  if (!target) return null
  const key = openAiCompatKey(settings.openaiBaseUrl)
  // Une clé est obligatoire hors de ce PC ; un modèle local (Ollama, LM Studio) s'en passe.
  if (!key && !target.local) return null
  return { endpoint: target.endpoint, model: settings.openaiModel, key, extra: target.extra, headers: target.headers, host: new URL(target.endpoint).host }
}

/**
 * Nettoyage par un modèle compatible OpenAI (DeepSeek, OpenRouter, Ollama…). Même consigne, mêmes entrées et même contrôle de sortie
 * que Claude Haiku : une réponse, une traduction ou un nombre changé ne sont jamais collés.
 */
export class OpenAiCompatCleanupProvider implements TextCleanupProvider {
  async cleanup(input: CleanupInput, timeoutMs: number): Promise<CleanupResult> {
    const started = Date.now()
    const config = openAiCompatConfig()
    if (!config) return { text: input.rawText, usedModel: false, latencyMs: null }
    const base = { provider: 'openai' as const }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const history = input.history ?? []
      const hasContext = Boolean(input.context && (input.context.before.trim() || input.context.after.trim()))
      const system = buildCleanupSystem({
        language: input.language ?? 'multi',
        style: appStyle(input.app, input.windowTitle),
        tone: input.tone,
        terms: input.terms,
        hasContext,
        hasHistory: history.length > 0,
        hasScreenWords: (input.screenTerms ?? []).length > 0,
        voiceProfile: input.voiceProfile,
        light: input.light
      })
      const user = buildCleanupUser(input.rawText, {
        before: input.context?.before,
        after: input.context?.after,
        history,
        screenTerms: input.screenTerms
      })
      const res = await fetch(config.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
          ...(config.key ? { Authorization: `Bearer ${config.key}` } : {})
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: Math.min(8192, Math.max(1024, Math.ceil(input.rawText.length * 0.8))),
          ...config.extra,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      })
      if (!res.ok) {
        // Jamais le corps de la réponse dans l'historique : il peut répéter la clé ou la requête.
        throw new Error(tm('prov.openai.http', { host: config.host, status: String(res.status) }))
      }
      const applied = outputOrFallback(input.rawText, readChatCompletion(await res.json()))
      if (!applied.usedModel) return { ...base, text: input.rawText, usedModel: false, latencyMs: Date.now() - started, fallback: tm('prov.emptyOrCut') }
      const guarded = guardCleanup(input.rawText, applied.text)
      if (!guarded.ok || !isSaneCleanup(input.rawText, guarded.text)) {
        const reason = guarded.ok ? tm('prov.incoherent') : guarded.reason
        return { ...base, text: input.rawText, usedModel: false, latencyMs: Date.now() - started, fallback: reason, rejected: applied.text.slice(0, 2000) }
      }
      return { ...base, text: guarded.text, usedModel: true, latencyMs: Date.now() - started }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      const httpError = err instanceof Error && err.message.includes(config.host)
      const reason = aborted ? tm('prov.openai.timeout', { host: config.host }) : httpError ? (err as Error).message : tm('prov.openai.unreachable', { host: config.host })
      console.warn('[openai-compat] transcript brut conservé :', reason)
      return { ...base, text: input.rawText, usedModel: false, latencyMs: Date.now() - started, fallback: reason, failed: true }
    } finally {
      clearTimeout(timer)
    }
  }
}
