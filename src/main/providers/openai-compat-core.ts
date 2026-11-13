// Modèle compatible OpenAI (DeepSeek, OpenRouter, Groq, Ollama, LM Studio…) : logique pure, testée sans Electron.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export type OpenAiCompatTarget = { endpoint: string; local: boolean; extra: Record<string, unknown>; headers: Record<string, string> }

/**
 * Vérifie l'adresse de base et rend l'adresse de l'appel. HTTPS obligatoire, sauf pour un modèle qui tourne sur ce PC
 * (http://localhost…) : une dictée ne part jamais en clair sur le réseau. Rend null pour une adresse refusée.
 */
export function openAiCompatTarget(baseUrl: string, model = ''): OpenAiCompatTarget | null {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  return { endpoint: `${url.origin}${path}/chat/completions`, local, extra: extraBodyFor(url.hostname, model), headers: extraHeadersFor(url.hostname) }
}

/**
 * Réglages propres à un fournisseur. DeepSeek réfléchit si on ne le coupe pas : trop lent pour un nettoyage
 * (OpenCode Go, 13 nov. 2026 : 4,1 s en moyenne avec réflexion, 2,2 s sans, même texte rendu).
 */
function extraBodyFor(hostname: string, model: string): Record<string, unknown> {
  if (hostname === 'api.deepseek.com') return { thinking: { type: 'disabled' } }
  if (hostname === 'opencode.ai' && /^deepseek/i.test(model.trim())) return { thinking: { type: 'disabled' } }
  return {}
}

/** OpenCode demande un identifiant de session : un seul par lancement de Cyphed, sans rien qui identifie la personne. */
const OPENCODE_SESSION = `cyphed-${Math.random().toString(36).slice(2, 12)}`

function extraHeadersFor(hostname: string): Record<string, string> {
  if (hostname === 'opencode.ai') return { 'x-opencode-session': OPENCODE_SESSION }
  return {}
}

/** Variable d'environnement habituelle du fournisseur, lue si la clé n'est pas dans Réglages ni dans OPENAI_COMPAT_API_KEY. */
export function providerEnvKey(baseUrl: string): string | null {
  try {
    const host = new URL(baseUrl.trim()).hostname
    if (host === 'api.deepseek.com') return 'DEEPSEEK_API_KEY'
    if (host === 'openrouter.ai') return 'OPENROUTER_API_KEY'
    if (host === 'api.groq.com') return 'GROQ_API_KEY'
    if (host === 'opencode.ai') return 'OPENCODE_GO_API_KEY'
    return null
  } catch {
    return null
  }
}

/** Texte de la réponse au format OpenAI, ou chaîne vide. */
export function readChatCompletion(json: unknown): { text: string; finishReason: string } {
  const choice = (json as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> })?.choices?.[0]
  const content = choice?.message?.content
  return { text: typeof content === 'string' ? content.trim() : '', finishReason: choice?.finish_reason ?? '' }
}
