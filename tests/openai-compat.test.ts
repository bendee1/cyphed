import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { openAiCompatTarget, providerEnvKey, readChatCompletion } from '../src/main/providers/openai-compat-core.ts'
import { DEFAULT_SETTINGS, parseCleanupModel } from '../src/shared/types.ts'

describe('modèle compatible OpenAI', () => {
  it('construit l’adresse de l’appel depuis l’adresse de base', () => {
    assert.equal(openAiCompatTarget('https://api.deepseek.com')?.endpoint, 'https://api.deepseek.com/chat/completions')
    assert.equal(openAiCompatTarget('https://openrouter.ai/api/v1/')?.endpoint, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(openAiCompatTarget('https://openrouter.ai/api/v1/chat/completions')?.endpoint, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(openAiCompatTarget('http://localhost:11434/v1')?.endpoint, 'http://localhost:11434/v1/chat/completions')
  })

  it('refuse le HTTP vers un autre PC et les adresses douteuses', () => {
    assert.equal(openAiCompatTarget('http://api.deepseek.com'), null)
    assert.equal(openAiCompatTarget('http://192.168.1.10:11434/v1'), null)
    assert.equal(openAiCompatTarget('https://user:pass@api.deepseek.com'), null)
    assert.equal(openAiCompatTarget('https://api.deepseek.com/?key=abc'), null)
    assert.equal(openAiCompatTarget('file:///C:/x'), null)
    assert.equal(openAiCompatTarget('pas une adresse'), null)
  })

  it('marque un modèle local et coupe la réflexion de DeepSeek seulement', () => {
    assert.equal(openAiCompatTarget('http://127.0.0.1:1234/v1')?.local, true)
    assert.equal(openAiCompatTarget('https://api.deepseek.com')?.local, false)
    assert.deepEqual(openAiCompatTarget('https://api.deepseek.com')?.extra, { thinking: { type: 'disabled' } })
    assert.deepEqual(openAiCompatTarget('https://openrouter.ai/api/v1')?.extra, {})
  })

  it('lit le texte de la réponse, ou rien', () => {
    assert.deepEqual(readChatCompletion({ choices: [{ finish_reason: 'stop', message: { content: ' Bonjour. ' } }] }), { text: 'Bonjour.', finishReason: 'stop' })
    assert.deepEqual(readChatCompletion({}), { text: '', finishReason: '' })
    assert.deepEqual(readChatCompletion({ choices: [{ message: { content: null } }] }), { text: '', finishReason: '' })
  })

  it('connaît la variable de clé habituelle de chaque fournisseur', () => {
    assert.equal(providerEnvKey('https://api.deepseek.com'), 'DEEPSEEK_API_KEY')
    assert.equal(providerEnvKey('https://openrouter.ai/api/v1'), 'OPENROUTER_API_KEY')
    assert.equal(providerEnvKey('https://opencode.ai/inference/go/openai/v1'), 'OPENCODE_GO_API_KEY')
    assert.equal(openAiCompatTarget('https://opencode.ai/inference/go/openai/v1')?.endpoint, 'https://opencode.ai/inference/go/openai/v1/chat/completions')
    assert.ok(openAiCompatTarget('https://opencode.ai/inference/go/openai/v1')?.headers['x-opencode-session'])
    assert.deepEqual(openAiCompatTarget('https://opencode.ai/inference/go/openai/v1', 'deepseek-v4.1-flash')?.extra, { thinking: { type: 'disabled' } })
    assert.deepEqual(openAiCompatTarget('https://opencode.ai/inference/go/openai/v1', 'glm-5')?.extra, {})
    assert.equal(providerEnvKey('http://localhost:11434/v1'), null)
    assert.equal(providerEnvKey(''), null)
  })

  it('lit le réglage avec tolérance (Claude par défaut)', () => {
    assert.equal(DEFAULT_SETTINGS.cleanupEngine, 'claude')
    assert.deepEqual(parseCleanupModel({}), { cleanupEngine: 'claude', openaiBaseUrl: '', openaiModel: '' })
    const parsed = parseCleanupModel({ cleanupEngine: 'openai', openaiBaseUrl: ' https://api.deepseek.com ', openaiModel: 'deepseek-flash' })
    assert.deepEqual(parsed, { cleanupEngine: 'openai', openaiBaseUrl: 'https://api.deepseek.com', openaiModel: 'deepseek-flash' })
    assert.equal(parseCleanupModel({ cleanupEngine: 'gpt' as never }).cleanupEngine, 'claude')
  })
})
