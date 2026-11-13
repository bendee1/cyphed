// « Appuie sur Entrée » dit à la fin d'une dictée : le texte est collé puis envoyé (messagerie, assistant IA).
// Pur, testable avec `node --test`.

const SEND_FR = /[\s,.;:!?…-]*\b(?:et\s+)?(?:appuie|appuies|appuyer|appuyez|tape|tapes|taper|presse)\s+(?:sur\s+)?(?:la\s+touche\s+)?entr(?:é|e)e?r?\s*[.!…]*\s*$/iu
const SEND_EN = /[\s,.;:!?…-]*\b(?:and\s+)?(?:press|hit)\s+(?:the\s+)?enter(?:\s+key)?\s*[.!…]*\s*$/iu

/** Sépare la consigne d'envoi finale du texte dicté. Sans texte devant, rien n'est envoyé. */
export function splitSendCommand(raw: string): { text: string; send: boolean } {
  for (const pattern of [SEND_FR, SEND_EN]) {
    const match = pattern.exec(raw)
    if (!match) continue
    const text = raw.slice(0, match.index).trim()
    if (!text) return { text: raw, send: false }
    return { text, send: true }
  }
  return { text: raw, send: false }
}
