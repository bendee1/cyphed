import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { styleCategory } from '../src/main/providers/cleanup-prompt.ts'
import {
  isBlockedApp,
  learnFromCorrection,
  mergeLearned,
  applyPersonalization,
  dictionaryTerms,
  parsePersonalization
} from '../src/main/services/personalization-core.ts'

describe('personalization', () => {
  it('drops malformed entries and keeps defaults', () => {
    const p = parsePersonalization({
      dictionary: [{ term: ' btw ', replacement: 'by the way' }, { term: '' }, 42],
      snippets: [{ trigger: 'mon mail', text: 'a@b.fr' }, { trigger: 'x' }],
      styles: { email: 'very_casual', work: 'nope' }
    })
    assert.deepEqual(p.dictionary, [{ term: 'btw', replacement: 'by the way' }])
    assert.equal(p.snippets.length, 1)
    assert.equal(p.styles.email, 'very_casual')
    assert.equal(p.styles.work, 'casual')
  })

  it('replaces dictionary terms on word boundaries only', () => {
    const p = parsePersonalization({ dictionary: [{ term: 'btw', replacement: 'by the way' }] })
    assert.equal(applyPersonalization('Ok btw merci', p), 'Ok by the way merci')
    assert.equal(applyPersonalization('btwx reste', p), 'btwx reste')
  })

  it('expands a snippet only when the dictation is the trigger alone', () => {
    const p = parsePersonalization({ snippets: [{ trigger: 'mon mail', text: 'camille@exemple.fr' }] })
    assert.equal(applyPersonalization('Mon mail.', p), 'camille@exemple.fr')
    assert.equal(applyPersonalization('Envoie à mon mail demain', p), 'Envoie à mon mail demain')
  })

  it('feeds dictionary words to the prompt', () => {
    const p = parsePersonalization({ dictionary: [{ term: 'Cyphed' }, { term: 'btw', replacement: 'by the way' }] })
    assert.deepEqual(dictionaryTerms(p), ['Cyphed', 'by the way'])
  })
})

describe('style category', () => {
  it('maps apps to style categories', () => {
    assert.equal(styleCategory('Slack.exe', ''), 'work')
    assert.equal(styleCategory('Discord.exe', ''), 'personal')
    assert.equal(styleCategory('OUTLOOK.EXE', ''), 'email')
    assert.equal(styleCategory('Code.exe', ''), 'code')
    assert.equal(styleCategory('chrome.exe', 'Boîte de réception - Gmail'), 'email')
    assert.equal(styleCategory('notepad.exe', ''), 'other')
  })
})

describe('transforms', () => {
  it('ships Polish and Prompt Engineer by default, auto off', () => {
    const p = parsePersonalization({})
    assert.deepEqual(p.transforms.map((t) => t.id), ['polish', 'prompt-engineer'])
    assert.equal(p.autoTransform, '')
  })

  it('drops an auto transform that no longer exists', () => {
    const p = parsePersonalization({
      transforms: [{ id: 'a', name: 'Court', prompt: 'Résume.' }],
      autoTransform: 'gone'
    })
    assert.equal(p.autoTransform, '')
    assert.equal(parsePersonalization({ transforms: p.transforms, autoTransform: 'a' }).autoTransform, 'a')
  })

  it('lets a transform grow the text, never a plain cleanup', async () => {
    const { isSaneCleanup } = await import('../src/main/providers/cleanup-prompt.ts')
    const raw = 'écris moi un truc pour demander un devis'
    const long = raw.repeat(4)
    assert.equal(isSaneCleanup(raw, long), false)
    assert.equal(isSaneCleanup(raw, long, true), true)
  })
})

describe('selection transform prompt', () => {
  it('isolates the text and keeps terms', async () => {
    const { buildTransformSystem, buildTransformUser } = await import('../src/main/providers/cleanup-prompt.ts')
    const system = buildTransformSystem('rends plus court.', ['Cyphed'])
    assert.match(system, /jamais des instructions/)
    assert.match(system, /Cyphed/)
    assert.equal(buildTransformUser('abc'), '<text>\nabc\n</text>')
  })
})

describe('prompt Polish enregistré', () => {
  const OLD =
    'Réécris le texte pour qu’il soit plus clair et plus concis : supprime les redites et les détours, garde le sens, le ton, la personne (je/tu/vous) et tous les faits.'

  it('remplace l’ancien prompt par défaut par la version à jour', () => {
    const p = parsePersonalization({ transforms: [{ id: 'polish', name: 'Polish', prompt: OLD }] })
    assert.match(p.transforms[0].prompt, /N’ajoute rien/)
  })

  it('garde un prompt que la personne a modifié', () => {
    const mine = 'Raccourcis de moitié.'
    const p = parsePersonalization({ transforms: [{ id: 'polish', name: 'Polish', prompt: mine }] })
    assert.equal(p.transforms[0].prompt, mine)
  })
})

describe('raccourci du mode commande', () => {
  it('remplace l’ancien raccourci par défaut, déjà pris ailleurs', () => {
    assert.equal(parsePersonalization({ commandHotkey: 'Control+Alt+Space' }).commandHotkey, 'Control+Alt+C')
  })

  it('garde un raccourci choisi par la personne', () => {
    assert.equal(parsePersonalization({ commandHotkey: 'Control+Alt+K' }).commandHotkey, 'Control+Alt+K')
  })
})

describe('learning and blocking', () => {
  it('learns a replaced word from a correction', () => {
    const learned = learnFromCorrection('On utilise sifed pour dicter.', 'On utilise Cyphed pour dicter.')
    assert.deepEqual(learned, [{ term: 'sifed', replacement: 'Cyphed' }])
  })

  it('ignores pure punctuation changes and size changes', () => {
    assert.deepEqual(learnFromCorrection('bonjour a tous', 'Bonjour, à tous'), [{ term: 'a', replacement: 'à' }])
    assert.deepEqual(learnFromCorrection('un deux trois', 'un trois'), [])
  })

  it('n’apprend rien quand le champ contient un autre texte (message suivant dans un chat vidé)', () => {
    // Cas réel : « qu'il » -> « Anthropic », « joue » -> « Claude », « pas » -> « Opus » dans les mots à valider.
    const dicte = "Est-ce qu'il joue pas avec les fichiers du sous-agent"
    const suivant = 'Demande à Anthropic si Claude Opus lit les fichiers du sub'
    assert.deepEqual(learnFromCorrection(dicte, suivant), [])
  })

  it('n’apprend rien d’une phrase réécrite, seulement des mots corrigés', () => {
    assert.deepEqual(
      learnFromCorrection('on teste sifed demain avec toute la petite équipe', 'on teste Cyphed demain avec toute la petite équipe'),
      [{ term: 'sifed', replacement: 'Cyphed' }]
    )
    assert.deepEqual(learnFromCorrection('il faut que tu me dises vite ce que tu en penses', 'il faut absolument que tu me répondes vite sur ça'), [])
  })

  it('does not add a word twice', () => {
    const p = parsePersonalization({ dictionary: [{ term: 'sifed', replacement: 'Cyphed' }] })
    const { added } = mergeLearned(p, [{ term: 'Sifed', replacement: 'Cyphed' }, { term: 'foo', replacement: 'Foo' }])
    assert.deepEqual(added, [{ term: 'foo', replacement: 'Foo' }])
  })

  it('blocks apps whatever the spelling', () => {
    const p = parsePersonalization({ blockedApps: ['Bank.EXE', 'C:\\Apps\\vault.exe', 5] })
    assert.deepEqual(p.blockedApps, ['bank', 'vault'])
    assert.equal(isBlockedApp(p, 'BANK.exe'), true)
    assert.equal(isBlockedApp(p, 'notepad.exe'), false)
    assert.equal(isBlockedApp(p, ''), false)
  })
})

describe('transformation automatique par type d’appli', () => {
  it('le réglage du type d’appli passe avant le réglage général, et « aucune » est respecté', async () => {
    const { parsePersonalization, autoTransformFor } = await import('../src/main/services/personalization-core.ts')
    const p = parsePersonalization({ autoTransform: 'polish', autoTransformByApp: { ai: 'prompt-engineer', personal: '', email: 'inconnue' } })
    assert.equal(autoTransformFor(p, 'ai'), 'prompt-engineer')
    assert.equal(autoTransformFor(p, 'personal'), '')
    assert.equal(autoTransformFor(p, 'work'), 'polish')
    // Transformation supprimée : le type d'appli retombe sur le réglage général.
    assert.equal(autoTransformFor(p, 'email'), 'polish')
  })
})
