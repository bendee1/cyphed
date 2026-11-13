import type { DictationLanguage } from './cleanup-shared'

export function cleanupSystemPrompt(language: DictationLanguage): string {
  const lang =
    language === 'en'
      ? 'English. Keep English. Never translate.'
      : language === 'fr'
        ? 'français. Garde le français. Ne jamais traduire.'
        : 'the same language(s) as the dictation (French, English, or mixed). Never translate. If the speaker mixes languages, keep each span as spoken.'
  return [
    `You clean up a voice dictation.`,
    `Language rule: preserve ${lang}`,
    `Fix punctuation, capitalization, homophones and disfluencies.`,
    `Keep meaning and register. Invent nothing.`,
    `Reply with the cleaned text only — no quotes, no markdown, no preamble.`
  ].join('\n')
}
