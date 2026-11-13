// Langue courante des textes que le main montre à la personne (barre, menu, dialogues, erreurs).
// Sans Electron : les fichiers purs et testés peuvent l'importer ; le français est la langue de départ.
import { DEFAULT_LANG, translate, translatePlural, type PluralKey, type TextKey, type UiLang, type Vars } from '../shared/i18n/index.ts'

let current: UiLang = DEFAULT_LANG

export function setMainLang(lang: UiLang): void {
  current = lang
}

export function mainLang(): UiLang {
  return current
}

/** Texte visible dans la langue courante. */
export function tm(key: TextKey, vars?: Vars): string {
  return translate(current, key, vars)
}

/** Pluriel dans la langue courante. */
export function tmp(base: PluralKey, count: number, vars?: Vars): string {
  return translatePlural(current, base, count, vars)
}
