import { detectLanguage } from './language-detect.ts'
import { tm } from '../lang.ts'

export type GuardResult = { ok: true; text: string } | { ok: false; reason: string }

const REPLY_OPENERS = /^(bien sûr|voici|certainement|désolé|je suis désolé|je ne peux pas|de rien|avec plaisir|as an ai|sure[,!]|of course|here is|here's)/i
/**
 * En traduction, une formule en tête de sortie est la traduction d'une formule dite si la dictée
 * commence par une formule du même sens (« I can't » → « Je ne peux pas »). Groupes fr et en, mots entiers.
 */
const OPENER_GROUPS = [
  "bien sûr|bien entendu|évidemment|certainement|absolument|of course|sure|certainly|absolutely|obviously",
  "voici|voilà|here is|here's|here are",
  "désolée?|je suis désolée?|navrée?|je suis navrée?|pardon|sorry|i'm sorry|i am sorry",
  "je ne peux pas|je peux pas|je ne pourrai pas|je pourrai pas|impossible de|i can't|i cannot|i can not|can't|i couldn't|i could not|i won't be able|i will not be able|i'm not able|i am not able|i'm unable|i am unable",
  "de rien|avec plaisir|je t'en prie|je vous en prie|pas de souci|pas de problème|you're welcome|with pleasure|my pleasure|no problem|no worries"
].map((words) => new RegExp(`^(?:${words})(?![\\p{L}])`, 'iu'))

function openerGroup(text: string): number {
  const start = text.trim().replace(/’/g, "'")
  return OPENER_GROUPS.findIndex((re) => re.test(start))
}

/** Nos balises recopiées dans la sortie : le modèle a rendu son entrée au lieu du texte. */
const TAG_ECHO = /<\/?\s*(dictation|before|after|previous|screen_words|selected|instruction|spoken|text)\b/i

/** Écritures qu'on ne dicte pas : si le moteur vocal en a produit, c'est du bruit, à ne jamais « corriger ». */
const FOREIGN_SCRIPT = /[Ѐ-ӿ؀-ۿ぀-ヿ㐀-鿿가-힯]/

/**
 * Mots qui disparaissent normalement au nettoyage : commandes parlées (« virgule », « guillemets »),
 * nombres dits en lettres (écrits en chiffres ensuite), tics. Ils ne comptent pas dans la reprise.
 */
const VANISHING = new Set([
  'virgule', 'point', 'points', 'guillemet', 'guillemets', 'parenthese', 'parentheses', 'ligne', 'paragraphe',
  'interrogation', 'exclamation', 'ouvrez', 'fermez', 'ouvre', 'ferme', 'arobase', 'slash', 'tiret', 'nouveau',
  'nouvelle', 'zero', 'deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf', 'onze', 'douze', 'treize',
  'quatorze', 'quinze', 'seize', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'cent', 'cents', 'mille',
  'million', 'millions', 'euro', 'euros', 'heure', 'heures', 'minute', 'minutes', 'pourcent', 'genre', 'voila',
  'enfin', 'quoi', 'bref', 'style', 'hein', 'caetera', 'cetera'
])

const SMALL_NUMBERS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf', 'vingt'
]

/** Petits nombres en lettres anglaises : une dictée traduite en anglais écrit « five » pour « 5 ». */
const SMALL_NUMBERS_EN = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'
]

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w))
}

/** Racines de 4 lettres des mots pleins (sans les mots qui disparaissent normalement). */
function stems(text: string): string[] {
  return normalizedWords(text)
    .filter((w) => !VANISHING.has(w))
    .map((w) => w.slice(0, 4))
}

/** Part des mots pleins de la dictée qui se retrouvent dans la sortie (racines de 4 lettres). */
export function retention(raw: string, cleaned: string): number {
  const wanted = stems(raw)
  if (wanted.length < 5) return 1
  const have = new Set(stems(cleaned))
  return wanted.filter((w) => have.has(w)).length / wanted.length
}

/** Racines de la sortie absentes de la dictée : ce que le modèle a ajouté de son cru. */
function novelStems(raw: string, cleaned: string): string[] {
  const had = new Set(stems(raw))
  return stems(cleaned).filter((w) => !had.has(w))
}

// Un nettoyage garde presque tous les mots de la dictée. En dessous, le modèle a écrit autre chose
// (souvent une réponse à ce qu'il a lu dans le contexte). Mesuré sur l'historique réel : les vrais
// nettoyages sont au-dessus de 0,7 ; les réponses et réécritures, en dessous.
const MIN_RETENTION = 0.7
// Part de mots nouveaux au-delà de laquelle une dictée de 8 mots pleins ou plus a été réécrite.
const MAX_NOVELTY = 0.3

function stripWrappingQuotes(text: string, raw: string): string {
  const t = text.trim()
  const quoted = /^["«“].*["»”]$/s.test(t)
  const rawQuoted = /^["«“].*["»”]$/s.test(raw.trim())
  // « Oui », dit-il, « non » : les guillemets ne sont pas une enveloppe.
  if (!quoted || rawQuoted || /["«»“”]/.test(t.slice(1, -1))) return t
  return t.slice(1, -1).trim()
}

const SEPARATORS = /[\s.,  ]/g

function digitRuns(text: string): string[] {
  return text.match(/\d[\d\s.,  ]*\d|\d/g) ?? []
}

/** Un nombre de la dictée est-il encore là (en chiffres, ou en lettres pour les petits) ? */
function numberKept(run: string, text: string, outRuns: Set<string>, english = false): boolean {
  if (outRuns.has(run) || text.replace(SEPARATORS, '').includes(run)) return true
  const n = Number(run)
  if (run.length <= 2 && n <= 20) {
    // « j'ai 1 chat » → « I have a cat » ; « 1 hour » → « une heure ».
    const word = n === 1 ? (english ? '(?:one|an?)' : '(?:une?)') : (english ? SMALL_NUMBERS_EN : SMALL_NUMBERS)[n]
    return new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, 'iu').test(text)
  }
  return false
}

function linkTokens(text: string): string[] {
  return text.match(/https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
}

/**
 * Contrôle de la sortie du modèle de nettoyage, sans appel réseau.
 * Un échec = on garde le texte brut. Un succès rend le texte, éventuellement allégé de guillemets ajoutés.
 */
export function guardCleanup(raw: string, cleaned: string, translateTo?: 'fr' | 'en'): GuardResult {
  const text = stripWrappingQuotes(cleaned, raw)
  if (!text) return { ok: false, reason: tm('guard.emptyOutput') }

  if (TAG_ECHO.test(text) && !TAG_ECHO.test(raw)) return { ok: false, reason: tm('guard.tags') }

  if (FOREIGN_SCRIPT.test(raw) && text !== raw.trim()) {
    return { ok: false, reason: tm('guard.script') }
  }

  const sameOpener = (): boolean => {
    const group = openerGroup(text)
    return group >= 0 && group === openerGroup(raw)
  }
  if (REPLY_OPENERS.test(text) && !REPLY_OPENERS.test(raw.trim()) && !(translateTo && sameOpener())) {
    return { ok: false, reason: tm('guard.answered') }
  }

  const rawLang = detectLanguage(raw)
  const outLang = detectLanguage(text)
  if (translateTo) {
    // Traduction voulue : les mots changent, donc ni reprise ni nouveauté. Le texte doit être dans la langue visée.
    // Un texte resté dans l'autre langue n'a pas été traduit (souvent une réponse) ; « mixed » (noms propres) passe.
    if (outLang === (translateTo === 'fr' ? 'en' : 'fr')) return { ok: false, reason: tm('guard.translated') }
    // Une question dictée reste une question : « tu peux m'envoyer le devis ? » → « Yes, I'll send it » est une réponse.
    if (raw.includes('?') && !text.includes('?')) return { ok: false, reason: tm('guard.answered') }
  } else if ((rawLang === 'fr' && outLang === 'en') || (rawLang === 'en' && outLang === 'fr')) {
    return { ok: false, reason: tm('guard.translated') }
  }

  const wanted = stems(raw)
  const novel = novelStems(raw, text)
  if (translateTo) {
    // Même longueur à peu près : une réponse ajoute des phrases, une traduction non.
    if (stems(text).length > Math.max(6, wanted.length * 1.8)) return { ok: false, reason: tm('guard.addedContent') }
  } else if (wanted.length < 5) {
    // Dictée courte : la reprise ne dit rien. Une réponse (« De rien, content d'avoir aidé ») ajoute des mots.
    if (novel.length > 2) return { ok: false, reason: tm('guard.addedContent') }
  } else if (retention(raw, text) < MIN_RETENTION) {
    return { ok: false, reason: tm('guard.dropped') }
  }
  if (!translateTo && wanted.length >= 8 && novel.length / Math.max(1, stems(text).length) > MAX_NOVELTY) {
    return { ok: false, reason: tm('guard.rewritten') }
  }

  const outDigits = new Set(digitRuns(text).map((run) => run.replace(SEPARATORS, '')))
  for (const run of digitRuns(raw)) {
    if (numberKept(run.replace(SEPARATORS, ''), text, outDigits, translateTo === 'en')) continue
    // « le 4 1 peu » : le moteur a écrit « un » en chiffre ; chaque nombre se vérifie alors seul.
    const parts = run.split(/[\s,]+/).filter(Boolean)
    if (parts.length > 1 && parts.every((part) => numberKept(part.replace(SEPARATORS, ''), text, outDigits, translateTo === 'en'))) continue
    return { ok: false, reason: tm('guard.number') }
  }

  for (const link of linkTokens(raw)) {
    if (!text.includes(link.replace(/[.,;:!?]+$/, ''))) return { ok: false, reason: tm('guard.link') }
  }

  return { ok: true, text }
}

/**
 * Contrôle d'une transformation (Polish, prompt…) : elle peut reformuler, mais pas répondre,
 * refuser, recopier nos balises ni parler d'autre chose que le texte reçu.
 */
export function guardTransform(input: string, output: string): GuardResult {
  const text = stripWrappingQuotes(output, input)
  if (!text) return { ok: false, reason: tm('guard.emptyOutput') }
  if (TAG_ECHO.test(text) && !TAG_ECHO.test(input)) return { ok: false, reason: tm('guard.tags') }
  if (REPLY_OPENERS.test(text) && !REPLY_OPENERS.test(input.trim())) {
    return { ok: false, reason: tm('guard.answeredTransform') }
  }
  const wanted = stems(input)
  if (wanted.length >= 5) {
    const have = new Set(stems(text))
    if (wanted.filter((w) => have.has(w)).length / wanted.length < 0.35) {
      return { ok: false, reason: tm('guard.offTopic') }
    }
  }
  return { ok: true, text }
}
