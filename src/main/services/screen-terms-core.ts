// Mots rares lus à l'écran (noms propres, identifiants, fichiers, @noms), donnés à Deepgram pour qu'il les reconnaisse.
// Pas d'Electron ni d'alias ici : testable avec `node --test`.
import { isSafeScreenTerm } from './secret-token-core.ts'

const MAX_SCAN = 8000
const MAX_TERM = 40

// Mots qui prennent une majuscule sans être des noms propres à retenir.
const COMMON = new Set(
  [
    'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'bonjour', 'salut', 'merci', 'cordialement', 'oui', 'non', 'mais', 'donc', 'alors', 'voici', 'voilà', 'hello', 'thanks',
    'dear', 'regards', 'the', 'and', 'but', 'this', 'that', 'les', 'des', 'une', 'ils', 'elle', 'nous', 'vous', 'mon', 'ton',
    'ok', 'api'
  ].map((w) => w.toLowerCase())
)

const EXTENSIONS = 'ts|tsx|js|jsx|mjs|py|json|md|css|html|cs|rs|go|yml|yaml|toml|sh|ps1|exe|pdf|docx|xlsx|csv|txt|sql'

function strip(token: string): string {
  return token.replace(/^[^\p{L}\p{N}@_]+|[^\p{L}\p{N}_]+$/gu, '')
}

type Hit = { term: string; count: number; last: number }

export function extractScreenTerms(text: string, options: { known?: string[]; max?: number } = {}): string[] {
  const max = options.max ?? 15
  const known = new Set((options.known ?? []).map((t) => t.toLowerCase()))
  const scan = text.length > MAX_SCAN ? text.slice(-MAX_SCAN) : text
  const hits = new Map<string, Hit>()

  const add = (raw: string, position: number): void => {
    const term = raw.trim()
    if (term.length < 3 || term.length > MAX_TERM) return
    // Un secret affiché dans un terminal (clé, jeton, hash) ne doit jamais partir vers un service tiers.
    if (!isSafeScreenTerm(term)) return
    const key = term.toLowerCase()
    if (known.has(key) || COMMON.has(key)) return
    const prev = hits.get(key)
    if (prev) {
      prev.count += 1
      prev.last = position
    } else {
      hits.set(key, { term, count: 1, last: position })
    }
  }

  // @mentions
  for (const m of scan.matchAll(/(?<![\p{L}\p{N}])@([\p{L}\p{N}_][\p{L}\p{N}_.-]{1,29})/gu)) add(m[1].replace(/[.-]+$/, ''), m.index ?? 0)
  // noms de fichiers
  for (const m of scan.matchAll(new RegExp(`\\b[\\w-]+\\.(?:${EXTENSIONS})\\b`, 'gi'))) add(m[0], m.index ?? 0)
  // identifiants : camelCase, PascalCase, snake_case
  for (const m of scan.matchAll(/\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[a-z]+(?:_[a-z0-9]+)+)\b/g)) add(m[0], m.index ?? 0)
  // sigles : 3 à 6 majuscules
  for (const m of scan.matchAll(/\b[A-Z]{3,6}\b/g)) add(m[0], m.index ?? 0)

  // noms propres en milieu de phrase, suites de mots capitalisés regroupées (« Visual Studio Code »)
  let offset = 0
  for (const sentence of scan.split(/(?<=[.!?\n])\s+/)) {
    const start = scan.indexOf(sentence, offset)
    offset = start >= 0 ? start + sentence.length : offset
    const tokens = sentence.split(/\s+/).filter(Boolean)
    let run: string[] = []
    const flush = (): void => {
      if (run.length > 0) add(run.join(' '), start)
      run = []
    }
    tokens.forEach((token, i) => {
      const word = strip(token)
      const capitalized = i > 0 && /^\p{Lu}\p{Ll}{2,}$/u.test(word) && !COMMON.has(word.toLowerCase())
      if (capitalized) {
        run.push(word)
        if (/[,;:)]$/.test(token)) flush()
      } else {
        flush()
      }
    })
    flush()
  }

  return [...hits.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, max)
    .map((h) => h.term)
}
