// Textes de l'interface côté renderer : la langue arrive par `?lang=fr|en` (posé par le main au chargement de la fenêtre).
import { DEFAULT_LANG, formatHotkey as formatHotkeyIn, langFromSearch, localeTag, translate, translatePlural, type PluralKey, type TextKey, type UiLang, type Vars } from '@shared/i18n/index'
import { DEFAULT_TRANSFORMS, type TransformEntry } from '@shared/types'

function readLang(): UiLang {
  if (typeof location === 'undefined') return DEFAULT_LANG
  return langFromSearch(location.search)
}

export const uiLang: UiLang = readLang()

if (typeof document !== 'undefined') document.documentElement.lang = uiLang

/** Tag Intl de la langue courante (`fr-FR` ou `en-US`) pour les dates et les nombres. */
export const uiLocale: string = localeTag(uiLang)

export function t(key: TextKey, vars?: Vars): string {
  return translate(uiLang, key, vars)
}

/** Pluriel : `tp('unit.word', 3)` → « 3 mots » / « 3 words ». */
export function tp(base: PluralKey, count: number, vars?: Vars): string {
  return translatePlural(uiLang, base, count, vars)
}

export function formatHotkey(hotkey: string): string {
  return formatHotkeyIn(hotkey, uiLang)
}

export function formatNumber(value: number): string {
  return value.toLocaleString(uiLocale)
}

/** Nom d'une transformation : les deux livrées avec l'appli (si la personne ne les a pas renommées) suivent la langue. */
export function transformName(entry: Pick<TransformEntry, 'id' | 'name'>): string {
  const base = DEFAULT_TRANSFORMS.find((d) => d.id === entry.id)
  if (base && base.name === entry.name) return t(`tf.default.${base.id}.name` as TextKey)
  return entry.name
}

export function transformDescription(entry: Pick<TransformEntry, 'id' | 'description'>): string {
  const base = DEFAULT_TRANSFORMS.find((d) => d.id === entry.id)
  if (base && base.description === entry.description) return t(`tf.default.${base.id}.description` as TextKey)
  return entry.description
}
