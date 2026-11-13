export type HotkeyInput = {
  type?: string
  key: string
  code: string
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'])

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'Plus',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadDecimal: '.'
}

export function isModifierKey(input: Pick<HotkeyInput, 'key' | 'code'>): boolean {
  return MODIFIER_KEYS.has(input.key) || /^(Control|Shift|Alt|Meta)/.test(input.code)
}

export function isHotkeyCancel(input: Pick<HotkeyInput, 'key' | 'code'>): boolean {
  return input.key === 'Escape' || input.code === 'Escape'
}

export function codeToAcceleratorKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

export function inputToAccelerator(input: HotkeyInput): string | null {
  if (input.type && input.type !== 'keyDown') return null
  if (isModifierKey(input) || isHotkeyCancel(input)) return null
  const parts: string[] = []
  if (input.control) parts.push('Control')
  if (input.alt) parts.push('Alt')
  if (input.shift) parts.push('Shift')
  if (input.meta) parts.push('Super')
  if (parts.length === 0) return null
  const key = codeToAcceleratorKey(input.code)
  if (!key) return null
  parts.push(key)
  return parts.join('+')
}

export function applyHotkeyChange(
  previous: string,
  next: string,
  register: (accelerator: string) => boolean
): { hotkey: string; ok: boolean; error?: string } {
  if (!next || next === previous) return { hotkey: previous, ok: true }
  if (register(next)) return { hotkey: next, ok: true }
  register(previous)
  return { hotkey: previous, ok: false, error: `Raccourci ${next} refusé par Windows.` }
}
