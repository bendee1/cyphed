import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { splitSendCommand } from '../src/main/services/send-command-core.ts'

describe('splitSendCommand', () => {
  it('retire « appuie sur Entrée » à la fin et demande l’envoi', () => {
    assert.deepEqual(splitSendCommand('Je serai là à 15 h, appuie sur Entrée.'), { text: 'Je serai là à 15 h', send: true })
    assert.deepEqual(splitSendCommand('ok ça marche et appuie sur entrée'), { text: 'ok ça marche', send: true })
    assert.deepEqual(splitSendCommand('Fix the build, press enter'), { text: 'Fix the build', send: true })
  })

  it('ne touche à rien ailleurs qu’à la fin, ni sans texte devant', () => {
    assert.deepEqual(splitSendCommand('appuie sur entrée puis attends'), { text: 'appuie sur entrée puis attends', send: false })
    assert.deepEqual(splitSendCommand('Appuie sur Entrée.'), { text: 'Appuie sur Entrée.', send: false })
    assert.deepEqual(splitSendCommand('La porte d’entrée est ouverte'), { text: 'La porte d’entrée est ouverte', send: false })
  })
})
