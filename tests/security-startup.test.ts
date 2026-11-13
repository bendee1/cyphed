import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { readJsonOrQuarantine, writeJsonAtomic } from '../src/main/services/json-file.ts'
import { IpcGate, isTrustedAppUrl, sameDocument } from '../src/main/ipc-gate.ts'
import { isSafeScreenTerm, looksLikeSecretToken, maskSensitive } from '../src/main/services/secret-token-core.ts'
import { extractScreenTerms } from '../src/main/services/screen-terms-core.ts'
import { SessionHistory } from '../src/main/services/session-history.ts'
import { isTerminalApp, singleLineForTerminal } from '../src/main/services/command-core.ts'
import { openSqlite } from '../src/main/db/sqlite.ts'

// Clé d'exemple de la doc Stripe, coupée pour que les scanners de secrets ne la prennent pas pour une vraie.
const FAKE_STRIPE = 'sk_' + 'live_' + '4eC39HqLyjWDarjtT1zdp7dc'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'cyphed-sec-'))
}

describe('json-file', () => {
  it('écrit de façon atomique et relit', () => {
    const dir = tmp()
    try {
      const file = join(dir, 'a.json')
      writeJsonAtomic(file, { a: 1 })
      writeJsonAtomic(file, { a: 2 })
      assert.deepEqual(readJsonOrQuarantine(file), { status: 'ok', value: { a: 2 } })
      assert.equal(existsSync(`${file}.tmp`), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fichier absent : missing', () => {
    const dir = tmp()
    try {
      assert.deepEqual(readJsonOrQuarantine(join(dir, 'nope.json')), { status: 'missing' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('JSON illisible : renommé en .corrupt-<date>, contenu conservé, jamais écrasé', () => {
    const dir = tmp()
    try {
      const file = join(dir, 'secrets.json')
      writeFileSync(file, '{"deepgram": "abc", ', 'utf8')
      const read = readJsonOrQuarantine(file, new Date('2026-10-16T10:20:30.123Z'))
      assert.equal(read.status, 'corrupt')
      assert.ok(read.status === 'corrupt' && read.quarantinedTo?.includes('.corrupt-2026-10-16T10-20-30-123Z'))
      assert.equal(existsSync(file), false)
      const kept = readdirSync(dir).find((n) => n.includes('.corrupt-'))
      assert.ok(kept)
      assert.equal(readFileSync(join(dir, kept!), 'utf8'), '{"deepgram": "abc", ')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('IpcGate', () => {
  const frame = (url: string) => ({ sender: { id: 7 }, senderFrame: { url } })

  it('accepte la bonne surface avec une page de l’appli', () => {
    const gate = new IpcGate()
    gate.setHub(7)
    assert.equal(gate.check(frame('file:///C:/app/out/renderer/hub.html'), 'hub'), true)
  })

  it('refuse une page http(s) tierce chargée dans la fenêtre', () => {
    const gate = new IpcGate()
    gate.setHub(7)
    assert.equal(gate.check(frame('https://evil.example/hub.html'), 'hub'), false)
    assert.throws(() => gate.assert(frame('https://evil.example/'), 'hub'))
  })

  it('refuse un cadre détruit (senderFrame null) et une mauvaise surface', () => {
    const gate = new IpcGate()
    gate.setHub(7)
    assert.equal(gate.check({ sender: { id: 7 }, senderFrame: null }, 'hub'), false)
    assert.equal(gate.check(frame('file:///x.html'), 'bar'), false)
  })

  it('en dev, accepte l’origine du serveur de dev et pas une autre', () => {
    const gate = new IpcGate('http://localhost:5173')
    gate.setBar(7)
    assert.equal(gate.check(frame('http://localhost:5173/bar.html'), 'bar'), true)
    assert.equal(gate.check(frame('http://localhost:9999/bar.html'), 'bar'), false)
    assert.equal(isTrustedAppUrl('http://localhost:5173/x', null), false)
  })

  it('sans senderFrame (ancien appelant), seule la surface compte', () => {
    const gate = new IpcGate()
    gate.setHub(7)
    assert.equal(gate.check({ sender: { id: 7 } }, 'hub'), true)
  })

  it('sameDocument ignore l’ancre', () => {
    assert.equal(sameDocument('file:///a/hub.html#x', 'file:///a/hub.html#y'), true)
    assert.equal(sameDocument('file:///a/hub.html', 'https://example.com/'), false)
  })
})

describe('jetons et mots d’écran', () => {
  it('reconnaît les secrets courants', () => {
    for (const t of [
      FAKE_STRIPE,
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'xoxb-123456789012-abcdef',
      'AKIAIOSFODNN7EXAMPLE',
      'eyJhbGciOiJIUzI1NiJ9',
      'a3f9c12',
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      'Zm9vYmFyMTIzNDU2Nzg5MA==',
      'x7Kq9Lm2Pz4Rt8Vw'
    ]) {
      assert.equal(looksLikeSecretToken(t), true, t)
    }
  })

  it('laisse passer les mots ordinaires et les identifiants', () => {
    for (const t of ['Deepgram', 'getDictionaryContext', 'build_native', 'index.ts', 'Notion', 'session_history']) {
      assert.equal(looksLikeSecretToken(t), false, t)
    }
  })

  it('extractScreenTerms n’émet jamais un secret affiché dans un terminal', () => {
    const screen = [
      '$ export STRIPE_KEY=' + FAKE_STRIPE,
      'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'commit 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      'on parle de Deepgram et de getDictionaryContext'
    ].join('\n')
    const terms = extractScreenTerms(screen)
    assert.ok(terms.includes('Deepgram'))
    assert.ok(terms.includes('getDictionaryContext'))
    for (const t of terms) {
      assert.equal(isSafeScreenTerm(t), true, t)
      assert.ok(!/sk_live|ghp_|9f86d081/.test(t), t)
    }
  })

  it('rejette un terme de plus de 24 caractères par mot', () => {
    assert.equal(isSafeScreenTerm('abcdefghijklmnopqrstuvwxyz'), false)
    assert.equal(isSafeScreenTerm('Visual Studio'), true)
  })

  it('maskSensitive masque e-mails, nombres de 6 chiffres et plus, jetons', () => {
    const out = maskSensitive('écris à jean.dupont@example.com ou au 06 12 34 56 78, clé ' + FAKE_STRIPE + ', merci')
    assert.ok(!out.includes('@example.com'))
    assert.ok(!out.includes('06 12 34 56 78'))
    assert.ok(!out.includes('sk_live'))
    assert.ok(out.includes('merci'))
    assert.equal(maskSensitive('Je te vois à 14 h 30 avec 3 amis'), 'Je te vois à 14 h 30 avec 3 amis')
  })
})

describe('SessionHistory', () => {
  it('ne mélange pas deux sites dans le même navigateur', () => {
    const h = new SessionHistory()
    h.push('chrome', 'Mon mot de passe bancaire est piégé.', 1000, 'Ma banque - Google Chrome')
    h.push('chrome', 'Salut Léa.', 1100, 'Gmail - Google Chrome')
    assert.deepEqual(h.recent('chrome', 2000, 'Gmail - Google Chrome'), ['Salut Léa.'])
    assert.deepEqual(h.recent('chrome', 2000, 'Autre site - Google Chrome'), [])
  })

  it('garde l’ancien comportement sans titre (processus seul)', () => {
    const h = new SessionHistory()
    h.push('code', 'une phrase', 1000)
    assert.deepEqual(h.recent('Code', 2000), ['une phrase'])
  })

  it('ignore le compteur « (3) » et la pastille de modification dans le titre', () => {
    const h = new SessionHistory()
    h.push('chrome', 'un', 1000, '(3) Messagerie')
    assert.deepEqual(h.recent('chrome', 2000, '(4) Messagerie'), ['un'])
    assert.deepEqual(h.recent('chrome', 2000, '● Messagerie'), ['un'])
  })

  it('oublie après 5 minutes', () => {
    const h = new SessionHistory()
    h.push('chrome', 'un', 0, 't')
    assert.deepEqual(h.recent('chrome', 6 * 60 * 1000, 't'), [])
  })
})

describe('terminaux', () => {
  it('reconnaît les terminaux courants', () => {
    for (const n of ['putty', 'kitty.exe', 'ConEmu64.exe', 'conemu', 'Tabby', 'warp', 'mintty', 'alacritty', 'wezterm-gui', 'WindowsTerminal.exe', 'wt', 'cmd', 'powershell', 'pwsh', 'bash']) {
      assert.equal(isTerminalApp(n), true, n)
    }
    assert.equal(isTerminalApp('chrome'), false)
  })

  it('singleLineForTerminal remplace les retours à la ligne par des espaces', () => {
    assert.equal(singleLineForTerminal('git add .\ngit commit -m "x"\r\n  git push'), 'git add . git commit -m "x" git push')
    assert.equal(singleLineForTerminal('  ls  '), 'ls')
  })
})

describe('SQLite', () => {
  it('ouvre avec busy_timeout 3000 et journal WAL', () => {
    const dir = tmp()
    try {
      const conn = openSqlite(join(dir, 't.db'))
      assert.equal(Number(conn.prepare('PRAGMA busy_timeout').get()?.timeout), 3000)
      assert.equal(String(conn.prepare('PRAGMA journal_mode').get()?.journal_mode), 'wal')
      conn.close?.()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('un fichier qui n’est pas une base lève une erreur reconnue comme corruption, connexion fermée', () => {
    const dir = tmp()
    try {
      const file = join(dir, 'bad.db')
      writeFileSync(file, 'ceci n est pas une base sqlite, juste du texte assez long pour avoir une taille. '.repeat(40), 'utf8')
      assert.throws(() => openSqlite(file), /not a database|malformed|corrupt/i)
      rmSync(file) // la connexion a été fermée : Windows accepte de supprimer le fichier
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
