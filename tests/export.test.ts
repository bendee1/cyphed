import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatExport } from '../src/main/services/export-core.ts'

const rows = [
  { id: 'a', kind: 'dictation', createdAt: '2026-11-13T09:05:00.000Z', app: 'slack', words: 3, finalText: 'Bonjour à tous ', rawText: '' },
  { id: 'b', kind: 'dictation', createdAt: '2026-11-13T10:00:00.000Z', app: '', words: 2, finalText: 'Second texte', rawText: '' }
] as never

describe('export des dictées', () => {
  it('texte : date, appli et texte, une dictée par bloc', () => {
    assert.equal(formatExport(rows, 'text'), '2026-11-13 09:05 · slack\nBonjour à tous\n\n2026-11-13 10:00\nSecond texte\n')
  })
  it('JSON : date, appli, mots et texte', () => {
    const parsed = JSON.parse(formatExport(rows, 'json')) as Array<Record<string, unknown>>
    assert.deepEqual(parsed[0], { date: '2026-11-13T09:05:00.000Z', app: 'slack', words: 3, text: 'Bonjour à tous ' })
    assert.equal(parsed.length, 2)
  })
})
