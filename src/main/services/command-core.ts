import { tm } from '../lang.ts'
export type CommandOutcome =
  | { status: 'ok'; text: string }
  | { status: 'unsupported'; message: string }
  | { status: 'empty' }

const UNSUPPORTED = '[[NON_GERE]]'

/** Programmes de terminal : Ctrl+C y interrompt le programme en cours, on n'y simule jamais de copie. */
const TERMINALS = new Set([
  'windowsterminal', 'wt', 'powershell', 'pwsh', 'cmd', 'conhost', 'bash',
  'alacritty', 'wezterm', 'wezterm-gui', 'mintty', 'putty', 'kitty', 'conemu', 'conemu64', 'tabby', 'warp'
])

export function isTerminalApp(processName: string): boolean {
  return TERMINALS.has(processName.toLowerCase().replace(/\.exe$/, ''))
}

/** Une commande collée dans un terminal ne doit pas contenir de retour à la ligne : chacun lancerait la commande. */
export function singleLineForTerminal(text: string): string {
  return text
    .replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Lit la réponse du modèle de commande : texte à insérer, ou refus court d'une demande hors de portée. */
export function parseCommandOutput(raw: string): CommandOutcome {
  const text = raw.trim()
  if (!text) return { status: 'empty' }
  if (text.startsWith(UNSUPPORTED)) {
    const message = text.slice(UNSUPPORTED.length).trim().slice(0, 160)
    return { status: 'unsupported', message: message || tm('bar.cmdUnsupported') }
  }
  const unquoted = /^["«“][\s\S]*["»”]$/.test(text) ? text.slice(1, -1).trim() : text
  return unquoted ? { status: 'ok', text: unquoted } : { status: 'empty' }
}

/** Réponse A/B du petit classeur : A = consigne à appliquer au texte sélectionné. Tout le reste = dictée. */
export function parseRouteAnswer(raw: string): 'command' | 'dictation' {
  return /^\s*A\b/i.test(raw) ? 'command' : 'dictation'
}
