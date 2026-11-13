/** Texte autour du curseur au moment où la dictée commence (lu par UI Automation). */
export type TextContext = {
  before: string
  selected: string
  after: string
}

export const EMPTY_CONTEXT: TextContext = { before: '', selected: '', after: '' }

// Après ces signes, le mot suivant se colle : « l’ami », « @paul », « #tag », « file_name ».
const OPENERS = /[\s(\[{«“"'‘’\n\r\t/\\\-@#_–—]$/
const CLOSERS_OR_PUNCT = /^[\s.,;:!?)\]}»”"'…%]/

/**
 * Espaces à ajouter autour d'un texte inséré pour qu'il se raccorde au texte existant :
 * « Bonjour|» + « monde » ne doit pas donner « Bonjourmonde ».
 * Ne retire jamais rien : une espace déjà présente suffit.
 */
export function joinWithContext(text: string, context: TextContext | null): string {
  if (!context || !text) return text
  let out = text
  if (context.selected === '' && context.before !== '' && !OPENERS.test(context.before) && !CLOSERS_OR_PUNCT.test(out)) {
    out = ` ${out}`
  }
  if (context.after !== '' && /^[\p{L}\p{N}]/u.test(context.after) && !/[\s(\[{«“"'‘’\n\r\t/\\\-@#_–—]$/.test(out)) {
    out = `${out} `
  }
  return out
}

// Mots-outils seulement : un nom propre ne doit jamais perdre sa majuscule.
const LOWERABLE = new Set([
  'je', 'j', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'le', 'la', 'les', 'l', 'un', 'une', 'de', 'du', 'des',
  'd', 'et', 'mais', 'ou', 'donc', 'que', 'qu', 'qui', 'ce', 'ça', 'c', 'si', 'se', 's', 'ne', 'n', 'me', 'm', 'te', 't',
  'en', 'au', 'aux', 'à', 'dans', 'pour', 'avec', 'sans', 'sur', 'par', 'the', 'we', 'you', 'it', 'an', 'and', 'but', 'so'
])

// Une dictée qui commence par l'un d'eux prolonge la phrase d'avant (« on a vu » + « Et ensuite »).
const CONJUNCTIONS = new Set(['et', 'mais', 'ou', 'donc', 'puis', 'car', 'and', 'but', 'so'])

/**
 * Quand le texte avant s'arrête en milieu de phrase (virgule, lettre…), le premier mot-outil de la dictée
 * perd sa majuscule : « Salut Paul, » + « Je voulais » donne « je voulais ». Un nom propre ou un sigle ne bouge pas.
 */
export function matchCaseToContext(text: string, before: string | undefined): string {
  if (!before || /[\n\r]\s*$/.test(before)) return text
  const prior = before.trimEnd()
  if (!prior) return text
  // On ne baisse la majuscule que si la phrase d'avant continue vraiment : virgule, ou mot de liaison
  // (« je pense que » + « Il faut »). « Merci » sans point est un message fini : « Je voulais » la garde.
  const lastWord = prior.match(/(\p{L}+)[’']?$/u)?.[1]?.toLowerCase() ?? ''
  const match = text.match(/^(\p{Lu})(\p{Ll}*)(?!\p{L})/u)
  if (!match) return text
  const word = (match[1] + match[2]).toLowerCase()
  const continues = /[,;]$/.test(prior) || LOWERABLE.has(lastWord) || (/\p{L}$/u.test(prior) && CONJUNCTIONS.has(word))
  if (!continues) return text
  if (!LOWERABLE.has(word)) return text
  return match[1].toLowerCase() + text.slice(1)
}

const MAX_BEFORE = 1200
const MAX_AFTER = 400
const MAX_SELECTED = 3000

/** Borne la taille envoyée au modèle : le début lointain et la fin lointaine n'aident pas. */
export function boundContext(context: TextContext): TextContext {
  return {
    before: context.before.slice(-MAX_BEFORE),
    selected: context.selected.slice(0, MAX_SELECTED),
    after: context.after.slice(0, MAX_AFTER)
  }
}

export function hasContext(context: TextContext | null | undefined): context is TextContext {
  return Boolean(context && (context.before.trim() || context.selected.trim() || context.after.trim()))
}
