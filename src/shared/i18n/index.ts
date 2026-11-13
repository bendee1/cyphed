// Internationalisation maison (français + anglais) : aucune dépendance, aucun Electron, aucun alias,
// pour être utilisable aussi bien par le main, les renderers et `node --test`.
import { fr, type TextKey } from './fr.ts'
import { en } from './en.ts'

export type { TextKey } from './fr.ts'

export type UiLang = 'fr' | 'en'
export type UiLanguageSetting = 'auto' | UiLang

export const DEFAULT_LANG: UiLang = 'fr'

const DICTS: Record<UiLang, Record<TextKey, string>> = { fr, en }

/** Balise Intl de chaque langue (dates, nombres). */
const LOCALE_TAG: Record<UiLang, string> = { fr: 'fr-FR', en: 'en-US' }

export type Vars = Record<string, string | number>

/** Clés « base » qui ont des variantes `.one` et `.other`. */
export type PluralKey = { [K in TextKey]: K extends `${infer Base}.one` ? Base : never }[TextKey]

export function isUiLang(value: unknown): value is UiLang {
  return value === 'fr' || value === 'en'
}

/** `?lang=fr|en` d'une query string ; repli sur le français. */
export function langFromSearch(search: string): UiLang {
  const value = new URLSearchParams(search).get('lang')
  return isUiLang(value) ? value : DEFAULT_LANG
}

/** Langue réelle d'après le réglage : « auto » = français si la langue du système commence par « fr », sinon anglais. */
export function resolveUiLang(setting: UiLanguageSetting | string | undefined, systemLocale: string): UiLang {
  if (isUiLang(setting)) return setting
  return /^fr(?:[-_]|$)/i.test(systemLocale.trim()) ? 'fr' : 'en'
}

export function localeTag(lang: UiLang): string {
  return LOCALE_TAG[lang]
}

function interpolate(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

export function translate(lang: UiLang, key: TextKey, vars?: Vars): string {
  const text = DICTS[lang][key] ?? fr[key]
  return vars ? interpolate(text, vars) : text
}

/**
 * Catégorie de pluriel : le français met le singulier pour 0 et 1, l'anglais seulement pour 1.
 */
export function pluralCategory(lang: UiLang, count: number): 'one' | 'other' {
  if (lang === 'fr') return Math.abs(count) < 2 ? 'one' : 'other'
  return count === 1 ? 'one' : 'other'
}

/** Pluriel : `unit.word` donne `unit.word.one` ou `unit.word.other` ; `{count}` est fourni. */
export function translatePlural(lang: UiLang, base: PluralKey, count: number, vars?: Vars): string {
  const key = `${base}.${pluralCategory(lang, count)}` as TextKey
  return translate(lang, key, { count, ...vars })
}

const HOTKEY_PART: Record<string, TextKey> = {
  Control: 'key.ctrl',
  Shift: 'key.shift',
  Space: 'key.space',
  Escape: 'key.escape',
  Enter: 'key.enter',
  Return: 'key.enter',
  Backspace: 'key.backspace',
  Delete: 'key.delete',
  Tab: 'key.tab'
}

/** Affichage seul d'un raccourci, avec les noms de touches de la langue (jamais utilisé pour l'enregistrer). */
export function formatHotkey(hotkey: string, lang: UiLang): string {
  return hotkey
    .split('+')
    .map((part) => {
      const mouse = /^Mouse(\d)$/.exec(part)
      if (mouse) return translate(lang, 'key.mouse', { n: mouse[1] })
      const key = HOTKEY_PART[part]
      return key ? translate(lang, key) : part
    })
    .join(' + ')
}
