import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fr } from '../src/shared/i18n/fr.ts'
import { en } from '../src/shared/i18n/en.ts'
import {
  formatHotkey,
  langFromSearch,
  localeTag,
  pluralCategory,
  resolveUiLang,
  translate,
  translatePlural,
  type PluralKey,
  type TextKey
} from '../src/shared/i18n/index.ts'
import { mainLang, setMainLang, tm } from '../src/main/lang.ts'

const FR = fr as Record<string, string>
const EN = en as Record<string, string>

const variables = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('textes fr et en', () => {
  it('ont exactement les mêmes clés', () => {
    assert.deepEqual(Object.keys(EN).sort(), Object.keys(FR).sort())
  })

  it('n’ont aucune valeur vide', () => {
    for (const [key, value] of Object.entries(FR)) assert.ok(value.trim(), `fr ${key} vide`)
    for (const [key, value] of Object.entries(EN)) assert.ok(value.trim(), `en ${key} vide`)
  })

  it('gardent les mêmes variables {…} dans chaque traduction', () => {
    for (const key of Object.keys(FR)) {
      assert.deepEqual(variables(EN[key]), variables(FR[key]), `variables de ${key}`)
    }
  })

  it('chaque clé .one a son .other, dans les deux langues', () => {
    for (const dict of [FR, EN]) {
      for (const key of Object.keys(dict)) {
        if (key.endsWith('.one')) assert.ok(`${key.slice(0, -4)}.other` in dict, `${key} sans .other`)
      }
    }
  })

  it('n’emploient plus les anciens noms anglais des pages', () => {
    const banned = /(?<![\p{L}])(insights?|snippets?|scratchpad|transforms?)(?![\p{L}])/iu
    for (const dict of [FR, EN]) {
      for (const [key, value] of Object.entries(dict)) {
        if (key.startsWith('tf.default.') || key.startsWith('guard.')) continue
        assert.equal(banned.test(value), false, `${key} : ${value}`)
      }
    }
  })

  it('nomment les pages comme décidé', () => {
    const nav = (lang: 'fr' | 'en'): string[] =>
      ['home', 'insights', 'dictionary', 'snippets', 'style', 'transforms', 'scratchpad', 'reader', 'settings'].map((id) =>
        translate(lang, `nav.${id}` as TextKey)
      )
    assert.deepEqual(nav('fr'), ['Dictées', 'Stats', 'Dictionnaire', 'Abréviations', 'Style', 'Transformations', 'Brouillon', 'Lire', 'Réglages'])
    assert.deepEqual(nav('en'), ['Dictations', 'Stats', 'Dictionary', 'Expansions', 'Style', 'Rewrites', 'Notes', 'Read', 'Settings'])
    assert.equal(translate('fr', 'page.insights'), 'Statistiques')
    assert.equal(translate('en', 'page.reader'), 'Read aloud')
  })

  it('n’ont aucun tiret long dans l’anglais', () => {
    for (const [key, value] of Object.entries(EN)) assert.equal(value.includes('—'), false, key)
  })
})

describe('translate', () => {
  it('remplace les variables {nom}', () => {
    assert.equal(translate('fr', 'status.readyWith', { hotkey: 'Ctrl + Maj + Espace' }), 'Prêt : Ctrl + Maj + Espace')
    assert.equal(translate('en', 'status.readyWith', { hotkey: 'Ctrl + Shift + Space' }), 'Ready: Ctrl + Shift + Space')
  })

  it('laisse une variable inconnue telle quelle', () => {
    assert.equal(translate('fr', 'status.readyWith', {}), 'Prêt : {hotkey}')
  })

  it('accepte les nombres comme variables', () => {
    assert.equal(translate('en', 'dict.analyzed', { n: 40 }), 'Analyzed: your last 40 dictations.')
  })
})

describe('pluriels', () => {
  it('français : singulier pour 0 et 1', () => {
    assert.equal(pluralCategory('fr', 0), 'one')
    assert.equal(pluralCategory('fr', 1), 'one')
    assert.equal(pluralCategory('fr', 2), 'other')
    assert.equal(translatePlural('fr', 'unit.dictation', 0), '0 dictée')
    assert.equal(translatePlural('fr', 'unit.dictation', 1), '1 dictée')
    assert.equal(translatePlural('fr', 'unit.dictation', 2), '2 dictées')
  })

  it('anglais : singulier seulement pour 1', () => {
    assert.equal(pluralCategory('en', 0), 'other')
    assert.equal(pluralCategory('en', 1), 'one')
    assert.equal(pluralCategory('en', 2), 'other')
    assert.equal(translatePlural('en', 'unit.dictation', 0), '0 dictations')
    assert.equal(translatePlural('en', 'unit.dictation', 1), '1 dictation')
    assert.equal(translatePlural('en', 'unit.dictation', 5), '5 dictations')
  })

  it('les séries de jours', () => {
    assert.equal(translatePlural('fr', 'ins.record', 0), 'RECORD : 0 JOUR')
    assert.equal(translatePlural('fr', 'ins.record', 31), 'RECORD : 31 JOURS')
    assert.equal(translatePlural('en', 'ins.streak', 12), '12 days in a row')
    const base: PluralKey = 'unit.word'
    assert.equal(translatePlural('en', base, 1), '1 word')
  })
})

describe('langue automatique', () => {
  it('auto : français si la langue de Windows commence par fr, sinon anglais', () => {
    assert.equal(resolveUiLang('auto', 'fr'), 'fr')
    assert.equal(resolveUiLang('auto', 'fr-FR'), 'fr')
    assert.equal(resolveUiLang('auto', 'fr-CA'), 'fr')
    assert.equal(resolveUiLang('auto', 'FR_be'), 'fr')
    assert.equal(resolveUiLang('auto', 'en-US'), 'en')
    assert.equal(resolveUiLang('auto', 'de'), 'en')
    assert.equal(resolveUiLang('auto', 'frisian'), 'en')
    assert.equal(resolveUiLang('auto', ''), 'en')
  })

  it('un choix explicite passe avant la langue de Windows', () => {
    assert.equal(resolveUiLang('fr', 'en-US'), 'fr')
    assert.equal(resolveUiLang('en', 'fr-FR'), 'en')
  })

  it('une valeur inconnue se comporte comme auto', () => {
    assert.equal(resolveUiLang(undefined, 'fr-FR'), 'fr')
    assert.equal(resolveUiLang('klingon', 'en-GB'), 'en')
  })

  it('lit la langue dans la query string, repli sur le français', () => {
    assert.equal(langFromSearch('?lang=en'), 'en')
    assert.equal(langFromSearch('?phase=listening&lang=fr'), 'fr')
    assert.equal(langFromSearch('?lang=de'), 'fr')
    assert.equal(langFromSearch(''), 'fr')
  })

  it('balise Intl de chaque langue', () => {
    assert.equal(localeTag('fr'), 'fr-FR')
    assert.equal(localeTag('en'), 'en-US')
  })
})

describe('raccourcis affichés', () => {
  it('noms de touches de la langue', () => {
    assert.equal(formatHotkey('Control+Shift+Space', 'fr'), 'Ctrl + Maj + Espace')
    assert.equal(formatHotkey('Control+Shift+Space', 'en'), 'Ctrl + Shift + Space')
    assert.equal(formatHotkey('Control+Escape', 'fr'), 'Ctrl + Échap')
    assert.equal(formatHotkey('Control+Escape', 'en'), 'Ctrl + Esc')
    assert.equal(formatHotkey('Alt+Enter', 'fr'), 'Alt + Entrée')
    assert.equal(formatHotkey('Alt+Enter', 'en'), 'Alt + Enter')
    assert.equal(formatHotkey('Mouse4', 'fr'), 'Souris 4')
    assert.equal(formatHotkey('Mouse4', 'en'), 'Mouse 4')
    assert.equal(formatHotkey('Control+Alt+C', 'en'), 'Ctrl + Alt + C')
  })
})

describe('langue du main', () => {
  it('démarre en français puis suit le réglage', () => {
    assert.equal(mainLang(), 'fr')
    assert.equal(tm('tray.quit'), 'Quitter')
    setMainLang('en')
    assert.equal(tm('tray.quit'), 'Quit')
    setMainLang('fr')
    assert.equal(tm('tray.quit'), 'Quitter')
  })
})
