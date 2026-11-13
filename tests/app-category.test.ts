import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appCategory } from '../src/main/services/app-category-core.ts'

describe('appCategory', () => {
  it('reconnaît le code et les terminaux', () => {
    for (const app of ['Cursor.exe', 'Code.exe', 'windsurf', 'WindowsTerminal.exe', 'wt', 'powershell', 'pwsh.exe', 'cmd.exe']) {
      assert.equal(appCategory(app, ''), 'code', app)
    }
  })
  it('reconnaît messageries, e-mail et assistants', () => {
    assert.equal(appCategory('slack.exe'), 'work')
    assert.equal(appCategory('Teams.exe'), 'work')
    assert.equal(appCategory('Claude.exe'), 'ai')
    assert.equal(appCategory('ChatGPT.exe'), 'ai')
    assert.equal(appCategory('Discord.exe'), 'personal')
    assert.equal(appCategory('WhatsApp.exe'), 'personal')
    assert.equal(appCategory('OUTLOOK.EXE'), 'email')
    assert.equal(appCategory('olk.exe'), 'email')
    assert.equal(appCategory('thunderbird'), 'email')
  })
  it('lit le titre pour un navigateur', () => {
    assert.equal(appCategory('chrome.exe', 'Boîte de réception - Gmail'), 'email')
    assert.equal(appCategory('msedge.exe', 'Claude'), 'ai')
    assert.equal(appCategory('chrome.exe', 'Nouvelle discussion - Gemini'), 'ai')
    assert.equal(appCategory('chrome.exe', 'Claudette - Wikipédia'), 'other')
    assert.equal(appCategory('chrome.exe', 'Une page quelconque'), 'other')
  })
})
