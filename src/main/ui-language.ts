import { app } from 'electron'
import { resolveUiLang, type UiLang } from '../shared/i18n/index.ts'
import { setMainLang } from './lang.ts'
import type { UiLanguageSetting } from '../shared/types.ts'

/** Pose la langue de l'interface d'après le réglage (« auto » = langue de Windows) et la rend. */
export function applyUiLanguage(setting: UiLanguageSetting): UiLang {
  const lang = resolveUiLang(setting, app.getLocale())
  setMainLang(lang)
  return lang
}
