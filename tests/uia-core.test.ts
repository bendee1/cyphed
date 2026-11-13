import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LineBuffer,
  isUiaFailure,
  isUiaPong,
  parseUiaLine,
  trimContext,
  verifyInsert,
  type UiaSnapshot
} from '../src/main/services/uia-core.ts'

function snap(over: Partial<UiaSnapshot> = {}): UiaSnapshot {
  return {
    id: 1,
    process: 'chrome',
    controlType: 'Edit',
    editable: true,
    readOnly: false,
    password: false,
    supported: true,
    caret: true,
    before: '',
    selected: '',
    after: '',
    length: 0,
    ...over
  }
}

describe('parseUiaLine', () => {
  it('lit une réponse focus', () => {
    const line = JSON.stringify({
      id: 7,
      ok: true,
      process: 'chrome',
      controlType: 'Edit',
      editable: true,
      readOnly: false,
      password: false,
      supported: true,
      caret: true,
      before: 'Bonjour ',
      selected: '',
      after: 'monde',
      length: 13
    })
    const r = parseUiaLine(line)
    assert.ok(!isUiaFailure(r) && !isUiaPong(r))
    const s = r as UiaSnapshot
    assert.equal(s.id, 7)
    assert.equal(s.process, 'chrome')
    assert.equal(s.before, 'Bonjour ')
    assert.equal(s.after, 'monde')
    assert.equal(s.length, 13)
    assert.equal(s.text, undefined)
  })

  it("garde le texte de la commande read et l'id texte", () => {
    const r = parseUiaLine(
      '{"id":"a","ok":true,"process":"notepad","controlType":"Document","text":"\\u00e9\\u00e9 ok"}'
    ) as UiaSnapshot
    assert.equal(r.id, 'a')
    assert.equal(r.text, 'éé ok')
    assert.equal(r.supported, false)
  })

  it('reconnaît ping et les erreurs', () => {
    const pong = parseUiaLine('{"id":3,"ok":true}')
    assert.ok(isUiaPong(pong))
    const err = parseUiaLine('{"id":4,"ok":false,"error":"timeout"}')
    assert.ok(isUiaFailure(err))
    assert.equal((err as { error: string }).error, 'timeout')
    assert.equal(err.id, 4)
  })

  it('ne lève pas sur du JSON invalide', () => {
    for (const bad of ['', 'nope', '[1]', 'null', '{"id":1']) {
      assert.ok(isUiaFailure(parseUiaLine(bad)), bad)
    }
  })

  it("champ mot de passe : aucun texte, même si l'exe en envoyait", () => {
    const r = parseUiaLine(
      JSON.stringify({
        id: 1,
        ok: true,
        process: 'chrome',
        controlType: 'Edit',
        password: true,
        supported: true,
        before: 'secret',
        selected: 'x',
        after: 'y',
        text: 'secret',
        length: 6
      })
    ) as UiaSnapshot
    assert.equal(r.password, true)
    assert.equal(r.before, '')
    assert.equal(r.selected, '')
    assert.equal(r.after, '')
    assert.equal(r.text, '')
    assert.equal(r.supported, false)
  })

  it('plafonne les champs', () => {
    const r = parseUiaLine(
      JSON.stringify({
        id: 1,
        ok: true,
        process: 'p',
        before: 'a'.repeat(5000),
        after: 'b'.repeat(5000),
        text: 'c'.repeat(50000)
      })
    ) as UiaSnapshot
    assert.equal(r.before.length, 1500)
    assert.equal(r.after.length, 500)
    assert.equal(r.text?.length, 20000)
  })
})

describe('LineBuffer', () => {
  it('assemble des lignes coupées au milieu', () => {
    const b = new LineBuffer()
    assert.deepEqual(b.push('{"id":1,'), [])
    assert.deepEqual(b.push('"ok":true}\n{"id":2'), ['{"id":1,"ok":true}'])
    assert.deepEqual(b.push(',"ok":true}\r\n'), ['{"id":2,"ok":true}'])
  })

  it('plusieurs lignes dans un chunk, lignes vides ignorées', () => {
    const b = new LineBuffer()
    assert.deepEqual(b.push('a\n\nb\nc'), ['a', 'b'])
    assert.deepEqual(b.push('\n'), ['c'])
  })

  it('recolle un caractère accentué coupé entre deux octets', () => {
    const b = new LineBuffer()
    const bytes = Buffer.from('{"t":"é à €"}\n', 'utf8')
    const out: string[] = []
    for (let i = 0; i < bytes.length; i++) out.push(...b.push(bytes.subarray(i, i + 1)))
    assert.deepEqual(out, ['{"t":"é à €"}'])
  })

  it('abandonne une ligne démesurée sans fin', () => {
    const b = new LineBuffer(10)
    assert.deepEqual(b.push('x'.repeat(50)), [])
    assert.deepEqual(b.push('ok\n'), ['ok'])
  })
})

describe('verifyInsert', () => {
  const inserted = 'Bonjour Marie, je reviens vers vous demain matin.'

  it('confirmed : le texte est apparu dans le champ', () => {
    const before = snap({ text: 'Objet : rendez-vous\n\n' })
    const after = snap({ text: 'Objet : rendez-vous\n\nBonjour Marie, je reviens vers vous demain matin.' })
    assert.equal(verifyInsert(before, after, inserted), 'confirmed')
  })

  it('confirmed malgré espaces et casse différents', () => {
    const after = snap({ text: 'bonjour   marie, je reviens\nvers vous demain MATIN.' })
    assert.equal(verifyInsert(snap({ text: '' }), after, inserted), 'confirmed')
  })

  it('confirmed avec seulement les 40 derniers caractères', () => {
    const long = 'Intro tronquée par le champ. ' + inserted
    const after = snap({ text: 'xxx ' + inserted })
    assert.equal(verifyInsert(snap({ text: 'xxx ' }), after, long), 'confirmed')
  })

  it("confirmed avec before/after d'un focus (sans text)", () => {
    const before = snap({ before: 'Salut ', after: '' })
    const after = snap({ before: 'Salut ' + inserted, after: '' })
    assert.equal(verifyInsert(before, after, inserted), 'confirmed')
  })

  it('not-found : le champ est lisible mais sans le texte', () => {
    assert.equal(verifyInsert(snap({ text: 'abc' }), snap({ text: 'abc' }), inserted), 'not-found')
  })

  it("not-found : le texte était déjà là avant et n'a pas été ajouté", () => {
    const t = 'avant ' + inserted
    assert.equal(verifyInsert(snap({ text: t }), snap({ text: t }), inserted), 'not-found')
  })

  it("confirmed si le texte est présent une fois de plus qu'avant", () => {
    const t = 'avant ' + inserted
    assert.equal(verifyInsert(snap({ text: t }), snap({ text: t + ' ' + inserted }), inserted), 'confirmed')
  })

  it('unknown : champ illisible', () => {
    assert.equal(verifyInsert(snap(), null, inserted), 'unknown')
    assert.equal(verifyInsert(snap(), snap({ supported: false }), inserted), 'unknown')
    assert.equal(verifyInsert(snap(), snap({ password: true, text: inserted }), inserted), 'unknown')
  })

  it('unknown : rien à chercher', () => {
    assert.equal(verifyInsert(snap(), snap({ text: 'abc' }), '  \n '), 'unknown')
  })

  it('sans lecture avant, confirmed si le texte est présent', () => {
    assert.equal(verifyInsert(null, snap({ text: inserted }), inserted), 'confirmed')
  })
})

describe('trimContext', () => {
  it('ne touche pas un texte court et unifie les fins de ligne', () => {
    assert.equal(trimContext('a\r\nb'), 'a\nb')
  })

  it('coupe côté curseur sans garder un mot cassé', () => {
    assert.equal(trimContext('alpha beta gamma', 9, 'end'), 'gamma')
    assert.equal(trimContext('alpha beta gamma', 10, 'end'), 'beta gamma')
    assert.equal(trimContext('alpha beta gamma', 7, 'start'), 'alpha')
    assert.equal(trimContext('alpha beta gamma', 10, 'start'), 'alpha beta')
  })
})
