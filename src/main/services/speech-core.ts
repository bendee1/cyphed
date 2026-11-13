// Texte préparé pour l'écoute (Lire) : sans balises, découpé en morceaux qu'une voix lit sans couper.
// Pur, testable avec `node --test`.

/** Au-delà, la lecture s'arrête (environ 25 minutes d'écoute). */
export const MAX_SPOKEN_CHARS = 30_000

/** Enlève ce qui se lit mal à voix haute : balises markdown, liens, puces, codes. */
export function forSpeech(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+|www\.\S+/g, 'lien')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+)$/gm, '$1.')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*•▪◦]|\d+[.)])[ \t]+/gm, '')
    .replace(/(\*\*|__|\*|_|`|~~)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    // Retour à la ligne au milieu d'une phrase (texte copié d'un PDF) : on recolle ; sinon (titre, puce) : une pause.
    .replace(/([^.!?:;…»"\n])\n(?=[\p{Ll}\d(«"])/gu, '$1 ')
    .replace(/([^.!?:;…»"\n])\n(?=\S)/g, '$1.\n')
    .trim()
}

function splitLong(sentence: string, max: number): string[] {
  const parts: string[] = []
  let rest = sentence
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max))
    const at = cut > max / 2 ? cut + 1 : max
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/** Morceaux de `max` caractères au plus, coupés entre paragraphes, sinon entre phrases, sinon entre mots. */
export function splitForSpeech(text: string, max = 1500): string[] {
  const chunks: string[] = []
  let current = ''
  const push = (): void => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }
  for (const paragraph of text.split(/\n{2,}/)) {
    const sentences = paragraph.match(/[^.!?…]+(?:[.!?…]+["»”)]*\s*|$)/g) ?? [paragraph]
    for (const raw of sentences) {
      for (const sentence of splitLong(raw.trim(), max)) {
        if (!sentence) continue
        if (current && current.length + sentence.length + 1 > max) push()
        current = current ? `${current} ${sentence}` : sentence
      }
    }
    // Un paragraphe finit son morceau quand il reste peu de place : la voix marque la pause au bon endroit.
    if (current.length > max * 0.6) push()
    else if (current) current += '\n\n'
  }
  push()
  return chunks
}
