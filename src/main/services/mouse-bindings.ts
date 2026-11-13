import { MODIFIER_NAMES, MOUSE_NAMES, splitMouseAccelerator } from '../hotkey-keys.ts'

type Binding = { button: number; mods: number[]; onPress: () => void }

/**
 * Raccourcis à bouton de souris (Mouse3 milieu, Mouse4 précédent, Mouse5 suivant).
 * Le crochet Windows appelle handle() ; un bouton lié est avalé pour ne pas faire « page précédente ».
 */
export class MouseBindings {
  private bindings = new Map<string, Binding>()
  private down = new Set<number>()
  private swallowed = new Set<number>()
  private captureHandler: ((accelerator: string) => void) | null = null
  private readonly isKeyDown: (vk: number) => boolean

  constructor(isKeyDown: (vk: number) => boolean) {
    this.isKeyDown = isKeyDown
  }

  set(id: string, accelerator: string, onPress: () => void): boolean {
    const parsed = splitMouseAccelerator(accelerator)
    if (!parsed) return false
    this.bindings.set(id, { button: parsed.button, mods: parsed.mods, onPress })
    return true
  }

  clear(): void {
    this.bindings.clear()
  }

  hasBindings(): boolean {
    return this.bindings.size > 0
  }

  /** Le prochain bouton pressé est avalé et renvoyé comme raccourci (« Control+Mouse5 »). */
  capture(handler: (accelerator: string) => void): void {
    this.captureHandler = handler
  }

  cancelCapture(): void {
    this.captureHandler = null
  }

  isCapturing(): boolean {
    return this.captureHandler !== null
  }

  isButtonDown(vk: number): boolean {
    return this.down.has(vk)
  }

  private heldModifiers(): number[] {
    return Object.keys(MODIFIER_NAMES)
      .map(Number)
      .filter((vk) => this.isKeyDown(vk))
  }

  /** Renvoie true pour avaler l'événement. */
  handle(button: number, isDown: boolean): boolean {
    if (!(button in MOUSE_NAMES)) return false
    if (!isDown) {
      this.down.delete(button)
      return this.swallowed.delete(button)
    }
    this.down.add(button)
    if (this.captureHandler) {
      const handler = this.captureHandler
      this.captureHandler = null
      this.swallowed.add(button)
      const mods = this.heldModifiers().map((vk) => MODIFIER_NAMES[vk])
      setImmediate(() => handler([...mods, MOUSE_NAMES[button]].join('+')))
      return true
    }
    const held = this.heldModifiers()
    for (const binding of this.bindings.values()) {
      if (binding.button !== button) continue
      if (!binding.mods.every((vk) => held.includes(vk))) continue
      this.swallowed.add(button)
      setImmediate(binding.onPress)
      return true
    }
    return false
  }
}
