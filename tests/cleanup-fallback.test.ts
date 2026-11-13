import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cleanupSystemPrompt } from '../src/main/providers/cerebras-cleanup.ts'
import { isTruncatedFinish, outputOrFallback } from '../src/main/providers/cleanup-shared.ts'

describe('Cerebras cleanup', () => {
  it('preserves language and forbids implicit translation', () => {
    const multi = cleanupSystemPrompt('multi')
    assert.match(multi, /Never translate/i)
    assert.match(multi, /mixed/i)
    const en = cleanupSystemPrompt('en')
    assert.match(en, /English/)
    assert.match(en, /Never translate/)
    const fr = cleanupSystemPrompt('fr')
    assert.match(fr, /français/)
    assert.match(fr, /traduire/i)
  })

  it('falls back to the raw transcript when output hit the token limit', () => {
    assert.equal(isTruncatedFinish('length'), true)
    assert.equal(isTruncatedFinish('stop'), false)
    const result = outputOrFallback('hello world', {
      text: 'bonjour',
      finishReason: 'length'
    })
    assert.deepEqual(result, { text: 'hello world', usedModel: false })
  })
})
