import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeInsights, type InsightRow } from '../src/main/services/insights.ts'
import { noteTitle, parseNotes } from '../src/main/services/notes-core.ts'

const NOW = new Date(2026, 9, 15, 12, 0, 0)

function row(daysAgo: number, words: number, durationMs: number, app = 'Code.exe'): InsightRow {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  return { createdAt: d.toISOString(), words, durationMs, app, windowTitle: '' }
}

describe('insights', () => {
  it('counts words, wpm and categories', () => {
    const out = computeInsights([row(0, 60, 30000), row(0, 30, 30000, 'Slack.exe'), row(1, 10, 0, 'OUTLOOK.EXE')], 3, NOW)
    assert.equal(out.totalWords, 100)
    assert.equal(out.dictations, 3)
    assert.equal(out.wordsPerMinute, 90)
    assert.equal(out.categories.find((c) => c.id === 'code')?.count, 1)
    assert.equal(out.categories.find((c) => c.id === 'work')?.count, 1)
    assert.equal(out.categories.find((c) => c.id === 'email')?.count, 1)
    assert.equal(out.dictionaryEntries, 3)
    assert.deepEqual(out.topApps[0], { app: 'Code', words: 60 })
  })

  it('computes current and longest streaks', () => {
    const out = computeInsights([row(0, 5, 1000), row(1, 5, 1000), row(2, 5, 1000), row(5, 5, 1000), row(6, 5, 1000)], 0, NOW)
    assert.equal(out.currentStreak, 3)
    assert.equal(out.longestStreak, 3)
  })

  it('keeps yesterday streak alive when nothing was dictated yet today', () => {
    const out = computeInsights([row(1, 5, 1000), row(2, 5, 1000)], 0, NOW)
    assert.equal(out.currentStreak, 2)
  })

  it('handles an empty history', () => {
    const out = computeInsights([], 0, NOW)
    assert.equal(out.wordsPerMinute, 0)
    assert.equal(out.currentStreak, 0)
    assert.deepEqual(out.days, {})
  })
})

describe('scratchpad notes', () => {
  it('drops bad notes, de-duplicates ids and sorts by recency', () => {
    const notes = parseNotes([
      { id: 'a', title: 'Vieux', text: 'x', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', title: 'Récent', text: 'y', updatedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'a', title: 'Doublon', text: 'z', updatedAt: '2026-12-01T00:00:00.000Z' },
      { title: 'Sans id' },
      7
    ])
    assert.deepEqual(notes.map((n) => n.id), ['b', 'a'])
    assert.equal(parseNotes('nope').length, 0)
  })

  it('falls back to the first line for the title', () => {
    assert.equal(noteTitle({ title: '', text: '\n  Liste de courses\nlait' }), 'Liste de courses')
    assert.equal(noteTitle({ title: 'Idée', text: 'abc' }), 'Idée')
    assert.equal(noteTitle({ title: '', text: '' }), 'Sans titre')
  })
})
