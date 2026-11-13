import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { boundContext, hasContext, joinWithContext } from '../src/main/services/context-core.ts'
import { detectLanguage } from '../src/main/services/language-detect.ts'
import { guardCleanup } from '../src/main/services/output-guard.ts'
import { SessionHistory } from '../src/main/services/session-history.ts'

describe('detectLanguage', () => {
  it('reconnaît le français, l’anglais, le mélange', () => {
    assert.equal(detectLanguage('Je pense que tu as raison, mais il faut tout vérifier avant de lancer.'), 'fr')
    assert.equal(detectLanguage('I think that you are right, but we should check everything before the launch.'), 'en')
    assert.equal(
      detectLanguage('Je pense que ce plan est bon, but we should check the thumbnail and the title before you publish it.'),
      'mixed'
    )
  })

  it('ne se prononce pas sur un texte trop court', () => {
    assert.equal(detectLanguage('ok'), 'unknown')
    assert.equal(detectLanguage('Merci'), 'unknown')
  })

  it('un mot anglais isolé dans une phrase française ne la rend pas anglaise', () => {
    assert.equal(detectLanguage('Il faut que le thumbnail soit bien visible sur mobile pour les gens.'), 'fr')
  })
})

describe('guardCleanup : réponse au contexte', () => {
  it('refuse un texte qui répond à ce qui est lu à l’écran au lieu de nettoyer', () => {
    const raw =
      'Mais là ça ça a, enfin tu vois il y a eu 2 là le le précédent message que je t’ai envoyé, moi je n’ai pas dit tout ça, tu vois c’est un truc qui a été rajouté dedans.'
    const answer =
      'Tu n’as pas écrit ça : le passage sur Word, Slack et le champ de mot de passe a été ajouté dans le message que tu me transmets, pas dans ta dictée.'
    const r = guardCleanup(raw, answer)
    assert.equal(r.ok, false)
  })

  it('garde un nettoyage normal malgré les hésitations retirées', () => {
    const raw = 'Donc là euh le le test que je voulais faire c’est de vérifier que le collage marche dans Slack'
    const r = guardCleanup(raw, 'Donc le test que je voulais faire, c’est de vérifier que le collage marche dans Slack.')
    assert.equal(r.ok, true)
  })
})

describe('guardCleanup', () => {
  it('accepte un nettoyage normal', () => {
    const r = guardCleanup('euh je pense que que ça marche', 'Je pense que ça marche.')
    assert.deepEqual(r, { ok: true, text: 'Je pense que ça marche.' })
  })

  it('refuse une traduction', () => {
    const r = guardCleanup('Je pense que tu as raison, il faut tout vérifier avant le lancement.', 'I think that you are right, we should check everything before the launch.')
    assert.equal(r.ok, false)
  })

  it('accepte la traduction voulue (« Écrire en »), refuse une réponse ou un texte non traduit', () => {
    const raw = 'euh je pense que tu as raison il faut tout vérifier avant le lancement de mardi'
    const ok = guardCleanup(raw, 'I think you are right, we need to check everything before Tuesday’s launch.', 'en')
    assert.equal(ok.ok, true)
    assert.equal(guardCleanup(raw, 'Je pense que tu as raison, il faut tout vérifier avant le lancement de mardi.', 'en').ok, false)
    assert.equal(guardCleanup('écris un mail pour dire que je suis en retard', 'Sure! Here is an email for you.', 'en').ok, false)
    assert.equal(
      guardCleanup('le budget est de 12500 euros pour le projet de mardi', 'The budget is 12 euros for Tuesday’s project.', 'en').ok,
      false
    )
    // Une question dictée qui revient sans « ? » est une réponse ; un petit nombre peut s'écrire en lettres anglaises.
    assert.equal(guardCleanup('Tu peux m’envoyer le devis demain ?', 'Yes, I’ll send the quote tomorrow.', 'en').ok, false)
    assert.equal(guardCleanup('Tu peux m’envoyer le devis demain ?', 'Can you send me the quote tomorrow?', 'en').ok, true)
    assert.equal(guardCleanup('J’ai 5 chats à la maison avec ma sœur.', 'I have five cats at home with my sister.', 'en').ok, true)
    // Un nom qui se traduit (Londres, vendredi) ne bloque pas ; « 1 » peut devenir « a ».
    assert.equal(guardCleanup('Demain je pars en Allemagne avec Marc pour le salon.', 'Tomorrow I’m going to Germany with Marc for the trade show.', 'en').ok, true)
    assert.equal(guardCleanup('I can’t join the meeting, I need 1 hour for the client.', 'Je ne peux pas rejoindre la réunion, j’ai besoin d’une heure pour le client.', 'fr').ok, true)
    assert.equal(guardCleanup('le budget du projet est validé pour mardi', 'Je ne peux pas valider ce budget pour mardi.', 'fr').ok, false)
    // Formule traduite = même sens au début de la dictée ; sinon c'est une réponse.
    for (const [raw, out] of [
      ['I’m not able to come tomorrow, the train is cancelled.', 'Je ne peux pas venir demain, le train est annulé.'],
      ['I won’t be able to join the call this afternoon.', 'Je ne pourrai pas rejoindre l’appel cet après-midi.'],
      ['Can’t do Friday, let’s say Monday instead.', 'Je ne peux pas vendredi, disons plutôt lundi.'],
      ['Sorry, I sent the wrong file this morning.', 'Désolé, j’ai envoyé le mauvais fichier ce matin.']
    ]) assert.equal(guardCleanup(raw, out, 'fr').ok, true, raw)
    assert.equal(guardCleanup('Voilà le fichier pour la réunion de demain.', 'Here’s the file for tomorrow’s meeting.', 'en').ok, true)
    assert.equal(guardCleanup('Sorry, send me the file for the meeting.', 'Bien sûr, voici le fichier pour la réunion.', 'fr').ok, false)
    assert.equal(guardCleanup('Surely we can ship the update on Friday.', 'Bien sûr, nous livrons la mise à jour vendredi.', 'fr').ok, false)
    assert.equal(guardCleanup('J’ai 1 chatte et 1 chien.', 'J’ai une chatte et un chien.').ok, true)
    assert.equal(guardCleanup('J’ai 1 chat qui dort toute la journée.', 'I have a cat that sleeps all day.', 'en').ok, true)
    const long = guardCleanup('je suis en retard', 'I am running late. I will be there in ten minutes, sorry about that, please start without me and keep me posted.', 'en')
    assert.equal(long.ok, false)
  })

  it('refuse une réponse au lieu d’un nettoyage', () => {
    const r = guardCleanup('écris un mail pour dire que je suis en retard', 'Bien sûr ! Voici un mail pour vous.')
    assert.equal(r.ok, false)
  })

  it('refuse un nombre perdu ou changé, accepte un nombre remis en forme', () => {
    assert.equal(guardCleanup('le budget est de 12500 euros', 'Le budget est de 12 euros.').ok, false)
    assert.equal(guardCleanup('le budget est de 12500 euros', 'Le budget est de 12 500 euros.').ok, true)
  })

  it('refuse un lien ou un e-mail modifié', () => {
    assert.equal(guardCleanup('écris à jean@gmail.com demain', 'Écris à jean@gmail.fr demain.').ok, false)
    assert.equal(guardCleanup('écris à jean@gmail.com demain', 'Écris à jean@gmail.com demain.').ok, true)
  })

  it('retire des guillemets ajoutés par le modèle', () => {
    const r = guardCleanup('bonjour tout le monde', '"Bonjour tout le monde."')
    assert.deepEqual(r, { ok: true, text: 'Bonjour tout le monde.' })
  })

  it('refuse une sortie vide', () => {
    assert.equal(guardCleanup('bonjour', '   ').ok, false)
  })
})

describe('SessionHistory', () => {
  it('rend les dernières phrases de la même appli, récentes seulement', () => {
    const h = new SessionHistory()
    h.push('Slack.exe', 'Salut, tu as vu le dossier ?', 1000)
    h.push('Slack.exe', 'Dis-moi quand tu peux.', 2000)
    h.push('chrome.exe', 'Autre appli', 2500)
    assert.deepEqual(h.recent('slack.exe', 3000), ['Salut, tu as vu le dossier ?', 'Dis-moi quand tu peux.'])
    assert.deepEqual(h.recent('slack.exe', 1000 + 6 * 60 * 1000), [])
  })

  it('garde trois entrées au plus', () => {
    const h = new SessionHistory()
    for (let i = 0; i < 6; i++) h.push('a', `phrase ${i}`, i)
    assert.equal(h.recent('a', 10).length, 3)
    assert.equal(h.recent('a', 10)[2], 'phrase 5')
  })
})

describe('joinWithContext', () => {
  const ctx = (before: string, after = '', selected = '') => ({ before, selected, after })

  it('ajoute une espace quand on colle contre un mot', () => {
    assert.equal(joinWithContext('monde', ctx('Bonjour')), ' monde')
  })

  it('n’ajoute rien après une espace, une parenthèse ou un retour à la ligne', () => {
    assert.equal(joinWithContext('monde', ctx('Bonjour ')), 'monde')
    assert.equal(joinWithContext('monde', ctx('Bonjour (')), 'monde')
    assert.equal(joinWithContext('monde', ctx('Bonjour\n')), 'monde')
  })

  it('n’ajoute pas d’espace avant une ponctuation', () => {
    assert.equal(joinWithContext(', puis voilà', ctx('Bonjour')), ', puis voilà')
    assert.equal(joinWithContext('.', ctx('Bonjour')), '.')
  })

  it('ajoute une espace finale quand un mot suit directement', () => {
    assert.equal(joinWithContext('Bonjour ', ctx('', 'monde')), 'Bonjour ')
    assert.equal(joinWithContext('Bonjour', ctx('', 'monde')), 'Bonjour ')
  })

  it('ne touche à rien sans contexte ou sur un champ vide', () => {
    assert.equal(joinWithContext('Bonjour', null), 'Bonjour')
    assert.equal(joinWithContext('Bonjour', ctx('')), 'Bonjour')
  })

  it('ne rajoute pas d’espace initiale quand une sélection va être remplacée', () => {
    assert.equal(joinWithContext('nouveau', ctx('avant', '', 'ancien')), 'nouveau')
  })
})

describe('boundContext', () => {
  it('garde la fin du texte avant, le début du texte après', () => {
    const c = boundContext({ before: 'a'.repeat(5000) + 'FIN', selected: '', after: 'DEBUT' + 'b'.repeat(5000) })
    assert.ok(c.before.endsWith('FIN') && c.before.length === 1200)
    assert.ok(c.after.startsWith('DEBUT') && c.after.length === 400)
  })

  it('hasContext ignore le vide', () => {
    assert.equal(hasContext({ before: ' ', selected: '', after: '' }), false)
    assert.equal(hasContext({ before: 'x', selected: '', after: '' }), true)
    assert.equal(hasContext(null), false)
  })
})

import { extractEditedSegment } from '../src/main/services/edit-learn-core.ts'

describe('extractEditedSegment', () => {
  it('retrouve la dictée corrigée entre le texte avant et le texte après', () => {
    const field = 'Salut Paul, je pense que Cyphed est prêt. À demain.'
    const seg = extractEditedSegment(field, 'Salut Paul, ', ' À demain.', 'je pense que sifed est prêt.')
    assert.equal(seg, 'je pense que Cyphed est prêt.')
  })

  it('sans texte après, prend la fin du champ', () => {
    const field = 'Bonjour. Je teste Cyphed ici'
    assert.equal(extractEditedSegment(field, 'Bonjour. ', '', 'Je teste sifed ici'), 'Je teste Cyphed ici')
  })

  it('rend null quand le texte avant a disparu ou que la zone n’a plus la même taille', () => {
    assert.equal(extractEditedSegment('autre chose', 'Salut Paul, ', '', 'bonjour'), null)
    assert.equal(extractEditedSegment('Salut Paul, x', 'Salut Paul, ', '', 'une longue phrase dictée ici'), null)
  })
})

import { isTerminalApp, parseCommandOutput, parseRouteAnswer } from '../src/main/services/command-core.ts'

describe('command-core', () => {
  it('lit un texte à insérer, retire des guillemets ajoutés', () => {
    assert.deepEqual(parseCommandOutput('Version courte.'), { status: 'ok', text: 'Version courte.' })
    assert.deepEqual(parseCommandOutput('"Version courte."'), { status: 'ok', text: 'Version courte.' })
  })

  it('reconnaît une demande hors de portée et une sortie vide', () => {
    assert.deepEqual(parseCommandOutput('[[NON_GERE]] Je ne peux pas envoyer de mails.'), {
      status: 'unsupported',
      message: 'Je ne peux pas envoyer de mails.'
    })
    assert.deepEqual(parseCommandOutput('   '), { status: 'empty' })
  })

  it('le classeur ne dit « commande » que sur un A net', () => {
    assert.equal(parseRouteAnswer('A'), 'command')
    assert.equal(parseRouteAnswer(' a.'), 'command')
    assert.equal(parseRouteAnswer('B'), 'dictation')
    assert.equal(parseRouteAnswer('Aucune idée'), 'dictation')
    assert.equal(parseRouteAnswer(''), 'dictation')
  })

  it('repère les terminaux', () => {
    assert.equal(isTerminalApp('WindowsTerminal.exe'), true)
    assert.equal(isTerminalApp('chrome.exe'), false)
  })
})

import { matchCaseToContext } from '../src/main/services/context-core.ts'

describe('matchCaseToContext', () => {
  it('met en minuscule un mot-outil quand la phrase continue', () => {
    assert.equal(matchCaseToContext('Je voulais te dire', 'Salut Paul, '), 'je voulais te dire')
    assert.equal(matchCaseToContext("J'ai fini", 'Salut Paul, '), "j'ai fini")
    assert.equal(matchCaseToContext('Et ensuite', 'on a vu'), 'et ensuite')
  })

  it('ne touche ni aux noms propres, ni aux sigles, ni à une nouvelle phrase', () => {
    assert.equal(matchCaseToContext('Paul arrive', 'Salut, '), 'Paul arrive')
    assert.equal(matchCaseToContext('ON arrive', 'Salut, '), 'ON arrive')
    assert.equal(matchCaseToContext('Je voulais', 'Merci. '), 'Je voulais')
    assert.equal(matchCaseToContext('Je voulais', 'Merci !'), 'Je voulais')
    assert.equal(matchCaseToContext('Je voulais', 'Titre\n'), 'Je voulais')
    assert.equal(matchCaseToContext('Je voulais', ''), 'Je voulais')
    assert.equal(matchCaseToContext('Je voulais', undefined), 'Je voulais')
  })
})
