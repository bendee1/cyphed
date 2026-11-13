const MODIFIERS: Record<string, number> = {
  control: 0x11,
  ctrl: 0x11,
  commandorcontrol: 0x11,
  cmdorctrl: 0x11,
  alt: 0x12,
  option: 0x12,
  shift: 0x10,
  super: 0x5b,
  meta: 0x5b,
  command: 0x5b,
  cmd: 0x5b
}

const MOUSE: Record<string, number> = { mouse3: 0x04, mouse4: 0x05, mouse5: 0x06 }

export const MOUSE_NAMES: Record<number, string> = { 0x04: 'Mouse3', 0x05: 'Mouse4', 0x06: 'Mouse5' }
export const MODIFIER_NAMES: Record<number, string> = { 0x11: 'Control', 0x12: 'Alt', 0x10: 'Shift', 0x5b: 'Super' }

/** « Control+Mouse5 » : modificateurs + bouton. null si ce n'est pas un raccourci souris. */
export function splitMouseAccelerator(accelerator: string): { mods: number[]; button: number } | null {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  const buttons = parts.filter((p) => p in MOUSE)
  if (buttons.length !== 1) return null
  const mods: number[] = []
  for (const part of parts) {
    if (part in MOUSE) continue
    const vk = MODIFIERS[part]
    if (vk === undefined) return null
    mods.push(vk)
  }
  return { mods, button: MOUSE[buttons[0]] }
}

const NAMED: Record<string, number> = {
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  insert: 0x2d,
  delete: 0x2e,
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  backspace: 0x08,
  escape: 0x1b,
  esc: 0x1b
}

/** Codes touches Windows d'un raccourci Electron (« Control+Shift+Space »). null si une touche est inconnue. */
export function acceleratorToVks(accelerator: string): number[] | null {
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const out: number[] = []
  for (const part of parts) {
    const key = part.toLowerCase()
    if (key in MODIFIERS) out.push(MODIFIERS[key])
    else if (key in MOUSE) out.push(MOUSE[key])
    else if (key in NAMED) out.push(NAMED[key])
    else if (/^[a-z]$/.test(key)) out.push(key.toUpperCase().charCodeAt(0))
    else if (/^[0-9]$/.test(key)) out.push(key.charCodeAt(0))
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) out.push(0x70 + Number(key.slice(1)) - 1)
    else if (/^num([0-9])$/.test(key)) out.push(0x60 + Number(key.slice(3)))
    else return null
  }
  return out
}
