import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicKey } from '../secrets'
import type { CleanupInput, CleanupResult, TextCleanupProvider } from './text'
import { outputOrFallback } from './cleanup-shared'
import { guardCleanup, guardTransform } from '../services/output-guard'
import { buildProfileSystem, buildProfileUser, parseProfileOutput } from '../services/voice-profile-core'
import { parseCommandOutput, parseRouteAnswer, type CommandOutcome } from '../services/command-core'
import {
  appStyle,
  buildCleanupSystem,
  buildCleanupUser,
  buildCommandSystem,
  buildCommandUser,
  buildRouteSystem,
  buildRouteUser,
  buildTransformSystem,
  buildTransformUser,
  isSaneCleanup
} from './cleanup-prompt'

import {
  buildSuggestSystem,
  buildSuggestUser,
  parseSuggestions,
  type SuggestSample,
  type TermSuggestion
} from '../services/dictionary-suggest-core'
import { tm } from '../lang'

const MODEL = 'claude-haiku-5-5'

let client: Anthropic | null = null
let clientKey = ''

/** Raison lisible d'un échec d'appel, pour l'historique et la barre. */
export function describeApiError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status
  if (status === 401 || status === 403) return tm('prov.anthropic.refused')
  if (status === 429) return tm('prov.anthropic.busy')
  if (status === 529 || (status && status >= 500)) return tm('prov.anthropic.down')
  const name = (err as { name?: string } | null)?.name ?? ''
  const message = err instanceof Error ? err.message : String(err)
  if (/timeout|timed out/i.test(name + message)) return tm('prov.anthropic.slow')
  if (/connection|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i.test(name + message)) return tm('prov.noConnection')
  return message.slice(0, 120) || tm('prov.error')
}

/** Un seul nouvel essai, et seulement pour une panne passagère (saturé, indisponible, coupure). */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  if (status === 429 || status === 529 || (status !== undefined && status >= 500)) return true
  const name = (err as { name?: string } | null)?.name ?? ''
  return status === undefined && /Connection/i.test(name) && !/Timeout/i.test(name)
}

function getClient(key: string): Anthropic {
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, baseURL: 'https://api.anthropic.com', maxRetries: 0 })
    clientKey = key
  }
  return client
}

let lastWarm = 0

export class AnthropicCleanupProvider implements TextCleanupProvider {
  /**
   * Ouvre la connexion (DNS, TLS) pendant que Deepgram finit la transcription : l'appel de nettoyage
   * qui suit la réutilise. Appel gratuit (liste des modèles), sans texte de la personne.
   */
  warmUp(): void {
    const key = getAnthropicKey()
    if (!key || Date.now() - lastWarm < 2000) return
    lastWarm = Date.now()
    void getClient(key)
      .models.list({ limit: 1 }, { timeout: 3000 })
      .catch(() => undefined)
  }

  /** Mode commande : applique une consigne dictée au texte sélectionné, ou écrit au curseur. */
  async command(
    input: { instruction: string; selected?: string; before?: string; after?: string; terms?: string[]; voiceProfile?: string },
    timeoutMs: number
  ): Promise<CommandOutcome> {
    const key = getAnthropicKey()
    if (!key) throw new Error(tm('prov.anthropic.noKey'))
    const hasSelection = Boolean(input.selected?.trim())
    const message = await getClient(key).messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        system: buildCommandSystem({ terms: input.terms, voiceProfile: input.voiceProfile, hasSelection }),
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: buildCommandUser(input) }]
      },
      { timeout: timeoutMs }
    )
    if (message.stop_reason === 'max_tokens') throw new Error(tm('prov.anthropic.tooLong'))
    return parseCommandOutput(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
  }

  /** Quand du texte est sélectionné : consigne (commande) ou texte nouveau (dictée) ? Toute erreur = dictée. */
  async routeSelection(selected: string, spoken: string, timeoutMs: number): Promise<'command' | 'dictation'> {
    const key = getAnthropicKey()
    if (!key) return 'dictation'
    try {
      const message = await getClient(key).messages.create(
        {
          model: MODEL,
          max_tokens: 4,
          system: buildRouteSystem(),
          thinking: { type: 'disabled' },
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: buildRouteUser(selected, spoken) }]
        },
        { timeout: timeoutMs }
      )
      return parseRouteAnswer(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    } catch {
      return 'dictation'
    }
  }

  /** Résume le style d'écriture de la personne d'après ses dictées. */
  async buildVoiceProfile(samples: string[], timeoutMs: number): Promise<string> {
    const key = getAnthropicKey()
    if (!key) throw new Error(tm('prov.anthropic.noKey'))
    const message = await getClient(key).messages.create(
      {
        model: MODEL,
        max_tokens: 1024,
        system: buildProfileSystem(),
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: buildProfileUser(samples) }]
      },
      { timeout: timeoutMs }
    )
    const out = parseProfileOutput(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    if (!out) throw new Error(tm('prov.anthropic.emptyProfile'))
    return out
  }

  /** Repère dans des dictées les mots déformés par le moteur vocal. Lève une erreur lisible si ça échoue. */
  async suggestTerms(samples: SuggestSample[], existing: string[], timeoutMs: number): Promise<TermSuggestion[]> {
    const key = getAnthropicKey()
    if (!key) throw new Error(tm('prov.anthropic.noKey'))
    const message = await getClient(key).messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        system: buildSuggestSystem(),
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: buildSuggestUser(samples, existing) }]
      },
      { timeout: timeoutMs }
    )
    const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    return parseSuggestions(text, existing)
  }

  /** Applique une transformation à un texte sélectionné. Lève une erreur lisible si ça échoue. */
  async transform(text: string, prompt: string, terms: string[], timeoutMs: number, voiceProfile = ''): Promise<string> {
    const key = getAnthropicKey()
    if (!key) throw new Error(tm('prov.anthropic.noKey'))
    const message = await getClient(key).messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        system: buildTransformSystem(prompt, terms, voiceProfile),
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: buildTransformUser(text) }]
      },
      { timeout: timeoutMs }
    )
    if (message.stop_reason === 'max_tokens') throw new Error(tm('prov.anthropic.tfTooLong'))
    const out = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    const guarded = guardTransform(text, out)
    if (!guarded.ok || !isSaneCleanup(text, guarded.text, true)) throw new Error(tm('prov.anthropic.incoherent'))
    return guarded.text
  }

  async cleanup(input: CleanupInput, timeoutMs: number): Promise<CleanupResult> {
    const started = Date.now()
    const key = getAnthropicKey()
    if (!key) return { text: input.rawText, usedModel: false, latencyMs: null }
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
      const request = {
        model: MODEL,
        max_tokens: Math.min(8192, Math.max(1024, Math.ceil(input.rawText.length * 0.8))),
        system,
        thinking: { type: 'disabled' as const },
        output_config: { effort: 'low' as const },
        messages: [
          {
            role: 'user' as const,
            content: buildCleanupUser(input.rawText, {
              before: input.context?.before,
              after: input.context?.after,
              history,
              screenTerms: input.screenTerms
            })
          }
        ]
      }
      const deadline = started + timeoutMs
      let message: Anthropic.Message
      try {
        message = await getClient(key).messages.create(request, { timeout: timeoutMs })
      } catch (err) {
        // Une panne passagère ne doit pas coller du texte brut : un nouvel essai, s'il reste le temps.
        const left = deadline - Date.now()
        if (!isTransient(err) || left < 1500) throw err
        await new Promise((r) => setTimeout(r, 250))
        message = await getClient(key).messages.create(request, { timeout: left - 250 })
      }
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
      const applied = outputOrFallback(input.rawText, {
        text,
        finishReason: message.stop_reason === 'max_tokens' ? 'length' : (message.stop_reason ?? '')
      })
      let finalText = applied.text
      let transformed = false
      if (applied.usedModel) {
        // Le nettoyage reste toujours contrôlé. La transformation (Polish…) passe ensuite par sa propre étape.
        const guarded = guardCleanup(input.rawText, applied.text)
        const sane = guarded.ok && isSaneCleanup(input.rawText, guarded.text)
        if (!guarded.ok || !sane) {
          const reason = guarded.ok ? tm('prov.incoherent') : guarded.reason
          console.warn('[anthropic] transcript brut conservé :', reason)
          return {
            text: input.rawText,
            usedModel: false,
            latencyMs: Date.now() - started,
            provider: 'anthropic',
            fallback: reason,
            rejected: applied.text.slice(0, 2000)
          }
        }
        finalText = guarded.text
        if (input.transform) {
          try {
            finalText = await this.transform(finalText, input.transform, input.terms ?? [], timeoutMs, input.voiceProfile ?? '')
            transformed = true
          } catch (err) {
            console.warn('[anthropic] transformation ignorée :', err instanceof Error ? err.message : err)
          }
        }
      }
      return {
        text: finalText,
        usedModel: applied.usedModel,
        latencyMs: Date.now() - started,
        provider: 'anthropic',
        ...(transformed ? { transformed } : {}),
        ...(applied.usedModel ? {} : { fallback: tm('prov.emptyOrCut') })
      }
    } catch (err) {
      console.warn('[anthropic] fallback transcript brut:', err instanceof Error ? err.message : err)
      return {
        text: input.rawText,
        usedModel: false,
        latencyMs: Date.now() - started,
        provider: 'anthropic',
        fallback: describeApiError(err),
        failed: true
      }
    }
  }
}
