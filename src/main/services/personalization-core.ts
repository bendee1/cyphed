import {
  DEFAULT_PERSONALIZATION,
  type DictionaryEntry,
  type Personalization,
  type SnippetEntry,
  type StyleCategory,
  type StyleTone,
  type TransformEntry,
  DEFAULT_TRANSFORMS,
  LEGACY_COMMAND_HOTKEY,
  LEGACY_POLISH_PROMPT
} from '../../shared/types.ts'

const TONES: StyleTone[] = ['formal', 'casual', 'very_casual']
const CATEGORIES: StyleCategory[] = ['personal', 'work', 'email', 'other']
const MAX_ENTRIES = 500

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function parsePending(raw: unknown): DictionaryEntry[] {
  const out: DictionaryEntry[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const entry = item as Partial<DictionaryEntry>
    const term = clean(entry?.term, 120)
    const replacement = clean(entry?.replacement, 240)
    if (!term || !replacement) continue
    out.push({ term, replacement })
    if (out.length >= 30) break
  }
  return out
}

/** Valide une saisie : toute entrée mal formée est ignorée, jamais rejetée en bloc. */
export function parsePersonalization(raw: unknown): Personalization {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<string, unknown>>
  const dictionary: DictionaryEntry[] = []
  for (const item of Array.isArray(input.dictionary) ? input.dictionary : []) {
    const entry = item as Partial<DictionaryEntry>
    const term = clean(entry?.term, 120)
    if (!term) continue
    const replacement = clean(entry?.replacement, 240)
    dictionary.push(replacement ? { term, replacement } : { term })
    if (dictionary.length >= MAX_ENTRIES) break
  }
  const snippets: SnippetEntry[] = []
  for (const item of Array.isArray(input.snippets) ? input.snippets : []) {
    const entry = item as Partial<SnippetEntry>
    const trigger = clean(entry?.trigger, 80)
    const text = typeof entry?.text === 'string' ? entry.text.trim().slice(0, 4000) : ''
    if (!trigger || !text) continue
    snippets.push({ trigger, text })
    if (snippets.length >= MAX_ENTRIES) break
  }
  const styles = { ...DEFAULT_PERSONALIZATION.styles }
  const given = (input.styles && typeof input.styles === 'object' ? input.styles : {}) as Record<string, unknown>
  for (const category of CATEGORIES) {
    const tone = given[category]
    if (typeof tone === 'string' && (TONES as string[]).includes(tone)) styles[category] = tone as StyleTone
  }
  const transforms: TransformEntry[] = []
  const given_t = Array.isArray(input.transforms) ? input.transforms : null
  if (given_t === null) transforms.push(...DEFAULT_TRANSFORMS)
  else {
    const seen = new Set<string>()
    for (const item of given_t) {
      const entry = item as Partial<TransformEntry>
      const id = clean(entry?.id, 60) || `t-${transforms.length + 1}`
      const name = clean(entry?.name, 60)
      const stored = clean(entry?.prompt, 2000)
      // Prompt par défaut d'une ancienne version : on le remplace par le prompt à jour (un prompt modifié par la personne reste).
      const prompt = id === 'polish' && stored === LEGACY_POLISH_PROMPT ? DEFAULT_TRANSFORMS[0].prompt : stored
      if (!name || !prompt || seen.has(id)) continue
      seen.add(id)
      const hotkey = clean(entry?.hotkey, 60)
      transforms.push({ id, name, description: clean(entry?.description, 120), prompt, ...(hotkey ? { hotkey } : {}) })
      if (transforms.length >= 50) break
    }
  }
  const commandHotkey = clean(input.commandHotkey, 60)
  const autoRaw = clean(input.autoTransform, 60)
  const autoTransform = transforms.some((t) => t.id === autoRaw) ? autoRaw : ''
  const blocked = new Set<string>()
  for (const item of Array.isArray(input.blockedApps) ? input.blockedApps : []) {
    const name = normalizeApp(typeof item === 'string' ? item : '')
    if (name) blocked.add(name)
    if (blocked.size >= 100) break
  }
  return {
    dictionary,
    snippets,
    styles,
    transforms,
    autoTransform,
    blockedApps: [...blocked],
    voiceProfile: typeof input.voiceProfile === 'string' ? input.voiceProfile.trim().slice(0, 1000) : '',
    voiceProfileEnabled: input.voiceProfileEnabled !== false,
    readContext: input.readContext !== false,
    commandHotkey: commandHotkey === LEGACY_COMMAND_HOTKEY ? DEFAULT_PERSONALIZATION.commandHotkey : commandHotkey || DEFAULT_PERSONALIZATION.commandHotkey,
    pending: parsePending(input.pending)
  }
}

/** Mots que la personne veut voir écrits exactement ainsi (pour le prompt), sans doublon. */
export function dictionaryTerms(p: Personalization): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of p.dictionary) {
    const term = (entry.replacement || entry.term).trim()
    const key = term.toLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Passe locale après nettoyage : remplacements du dictionnaire (« btw » devient « by the way »)
 * puis snippets (une dictée qui ne dit que le déclencheur devient le texte complet).
 */
export function applyPersonalization(text: string, p: Personalization): string {
  const out = replaceDictionary(text, p.dictionary)
  const spoken = normalize(out)
  for (const snippet of p.snippets) {
    if (spoken && spoken === normalize(snippet.trigger)) return snippet.text
  }
  return out
}

/**
 * Remplacements du dictionnaire en un seul passage : un mot déjà remplacé ne l'est jamais deux fois
 * (« Claude » -> « Claude Code » ne donne pas « Claude Code Code »). Un terme peut lister ses variantes
 * (« Vetraceur / V-Tracer »). Un mot pris dans un mot composé (« e-mail ») n'est pas touché.
 */
function replaceDictionary(text: string, dictionary: Personalization['dictionary']): string {
  const targets = new Map<string, string>()
  for (const entry of dictionary) {
    const replacement = entry.replacement?.trim()
    if (!replacement) continue
    for (const variant of entry.term.split(/\s*[/|]\s*/)) {
      const key = variant.trim().toLowerCase()
      if (key && !targets.has(key)) targets.set(key, replacement)
    }
  }
  if (targets.size === 0) return text
  // Le texte déjà juste se garde tel quel : il passe avant ses morceaux dans l'alternance.
  for (const replacement of new Set(targets.values())) {
    const key = replacement.toLowerCase()
    if (!targets.has(key)) targets.set(key, replacement)
  }
  const keys = [...targets.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${keys.join('|')})(?![\\p{L}\\p{N}-])`, 'giu')
  return text.replace(pattern, (match) => {
    const replacement = targets.get(match.toLowerCase()) ?? match
    // Début de phrase : « Btw » donne « By the way ».
    if (/^\p{Lu}/u.test(match) && /^\p{Ll}/u.test(replacement)) return replacement[0].toUpperCase() + replacement.slice(1)
    return replacement
  })
}

/** Nom de processus comparable : minuscules, sans chemin ni « .exe ». */
function normalizeApp(name: string): string {
  return name.trim().toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '')
}

export function isBlockedApp(p: Personalization, processName: string): boolean {
  const app = normalizeApp(processName)
  return Boolean(app) && p.blockedApps.includes(app)
}

function tokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

function bare(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Part des mots de la dictée qu'une vraie correction garde. */
const MIN_KEPT = 0.6
/** Au-delà, un bloc remplacé est une réécriture, pas un mot mal entendu. */
const MAX_BLOCK = 3

/** Nombre de mots communs, dans l'ordre, sans tenir compte de la casse. */
function keptWords(a: string[], b: string[]): number {
  const x = a.map((t) => bare(t).toLowerCase())
  const y = b.map((t) => bare(t).toLowerCase())
  let prev = new Array<number>(y.length + 1).fill(0)
  for (let i = x.length - 1; i >= 0; i--) {
    const row = new Array<number>(y.length + 1).fill(0)
    for (let j = y.length - 1; j >= 0; j--) row[j] = x[i] === y[j] ? prev[j + 1] + 1 : Math.max(prev[j], row[j + 1])
    prev = row
  }
  return prev[0]
}

/**
 * Apprend d'une correction : compare mot à mot le texte dicté et le texte corrigé.
 * Un bloc modifié avec autant de mots de chaque côté donne des paires « mal reconnu -> bon mot ».
 */
export function learnFromCorrection(original: string, corrected: string): DictionaryEntry[] {
  const a = tokens(original)
  const b = tokens(corrected)
  const n = a.length
  const m = b.length
  if (!n || !m || n * m > 250000) return []
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = bare(a[i]) === bare(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  // Une correction garde l'essentiel des mots. Sinon c'est un autre texte (message suivant tapé dans
  // un champ de chat vidé, phrase réécrite) : l'aligner donnait des paires absurdes (« pas » -> « Opus »).
  if (keptWords(a, b) < Math.max(2, Math.ceil(n * MIN_KEPT))) return []
  const out: DictionaryEntry[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (bare(a[i]) === bare(b[j])) {
      i++
      j++
      continue
    }
    const di: string[] = []
    const dj: string[] = []
    while (i < n && j < m && bare(a[i]) !== bare(b[j])) {
      if (lcs[i + 1][j] >= lcs[i][j + 1]) di.push(a[i++])
      else dj.push(b[j++])
    }
    if (di.length === dj.length && di.length <= MAX_BLOCK) {
      di.forEach((wrong, k) => {
        const from = bare(wrong)
        const to = bare(dj[k])
        if (!from || !to || from === to) return
        // Une majuscule de début de phrase n'est pas un mot appris.
        const index = i - di.length + k
        const sentenceStart = index === 0 || /[.!?]$/.test(a[index - 1])
        if (sentenceStart && from.toLowerCase() === to.toLowerCase()) return
        out.push({ term: from, replacement: to })
      })
    }
  }
  return out.slice(0, 5)
}

/** Range des mots appris en attente de validation (jamais ajoutés au dictionnaire sans accord). */
export function addPending(p: Personalization, learned: DictionaryEntry[]): { next: Personalization; added: DictionaryEntry[] } {
  const known = new Set([...p.dictionary, ...p.pending].map((e) => e.term.toLowerCase()))
  const added: DictionaryEntry[] = []
  for (const entry of learned) {
    if (!entry.replacement) continue
    const key = entry.term.toLowerCase()
    if (known.has(key)) continue
    known.add(key)
    added.push(entry)
  }
  return { next: { ...p, pending: [...added, ...p.pending].slice(0, 30) }, added }
}

/** Ajoute les entrées apprises qui n'existent pas déjà (insensible à la casse sur le mot d'origine). */
export function mergeLearned(p: Personalization, learned: DictionaryEntry[]): { next: Personalization; added: DictionaryEntry[] } {
  const known = new Set(p.dictionary.map((e) => e.term.toLowerCase()))
  const added: DictionaryEntry[] = []
  for (const entry of learned) {
    const key = entry.term.toLowerCase()
    if (known.has(key)) continue
    known.add(key)
    added.push(entry)
  }
  return { next: { ...p, dictionary: [...added, ...p.dictionary] }, added }
}
