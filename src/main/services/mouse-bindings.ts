import { MODIFIER_NAMES, MOUSE_NAMES, splitMouseAccelerator } from '../hotkey-keys.ts'

type Binding = { button: number; mods: number[]; onPress: () => void }

/**
 * Raccourcis à bouton de souris (Mouse3 milieu, Mouse4 précédent, Mouse5 suivant).
 * Le crochet Windows (programme mouse-helper) appelle handle() ; un bouton lié est avalé pour ne pas faire
 * « page précédente ». Le crochet décide seul de ce qu'il avale à partir de state() : la souris n'attend jamais Cyphed.
 */
export class MouseBindings {
  private bindings = new Map<string, Binding>()
  private down = new Set<number>()
  private swallowed = new Set<number>()
  private captureHandler: ((accelerator: string) => void) | null = null
  private readonly isKeyDown: (vk: number) => boolean
  private listener: (() => void) | null = null

  constructor(isKeyDown: (vk: number) => boolean) {
    this.isKeyDown = isKeyDown
  }

  set(id: string, accelerator: string, onPress: () => void): boolean {
    const parsed = splitMouseAccelerator(accelerator)
    if (!parsed) return false
    this.bindings.set(id, { button: parsed.button, mods: parsed.mods, onPress })
    this.changed()
    return true
  }

  clear(): void {
    this.bindings.clear()
    this.changed()
  }

  /** Appelé à chaque changement des boutons à avaler (liaisons ou capture). */
  onChange(listener: (() => void) | null): void {
    this.listener = listener
  }

  /** Ligne envoyée au crochet : « state <capture> <bouton>:<vk>,<vk>;... ». */
  state(): string {
    const rules = [...this.bindings.values()].map((b) => `${b.button}:${b.mods.join(',')}`)
    return `state ${this.captureHandler ? 1 : 0} ${rules.join(';')}`.trimEnd()
  }

  private changed(): void {
    this.listener?.()
  }

  hasBindings(): boolean {
    return this.bindings.size > 0
  }

  /** Le prochain bouton pressé est avalé et renvoyé comme raccourci (« Control+Mouse5 »). */
  capture(handler: (accelerator: string) => void): void {
    this.captureHandler = handler
    this.changed()
  }

  cancelCapture(): void {
    this.captureHandler = null
    this.changed()
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

  /**
   * Événement venu de mouse-helper, qui a déjà décidé d'avaler ou non : on suit sa décision au lieu de la refaire
   * (un modificateur relâché entre-temps ne doit pas donner un bouton avalé sans action).
   */
  fromHook(button: number, isDown: boolean, swallowed: boolean): void {
    if (!(button in MOUSE_NAMES)) return
    if (!isDown) {
      this.down.delete(button)
      this.swallowed.delete(button)
      return
    }
    this.down.add(button)
    if (!swallowed) return
    this.swallowed.add(button)
    if (this.captureHandler) {
      this.handleCapture(button)
      return
    }
    const held = this.heldModifiers()
    const candidates = [...this.bindings.values()].filter((b) => b.button === button)
    const binding = candidates.find((b) => b.mods.every((vk) => held.includes(vk))) ?? candidates[0]
    if (binding) setImmediate(binding.onPress)
  }

  /** Le crochet est mort ou fermé : aucun « relâché » n'arrivera, on relâche tout (sinon le maintien-pour-parler reste collé). */
  releaseAll(): void {
    this.down.clear()
    this.swallowed.clear()
  }

  private handleCapture(button: number): void {
    const handler = this.captureHandler
    if (!handler) return
    this.captureHandler = null
    this.changed()
    this.swallowed.add(button)
    const mods = this.heldModifiers().map((vk) => MODIFIER_NAMES[vk])
    setImmediate(() => handler([...mods, MOUSE_NAMES[button]].join('+')))
  }

  /** Renvoie true pour avaler l'événement (décision prise ici, utilisée par les tests). */
  handle(button: number, isDown: boolean): boolean {
    if (!(button in MOUSE_NAMES)) return false
    if (!isDown) {
      this.down.delete(button)
      return this.swallowed.delete(button)
    }
    this.down.add(button)
    if (this.captureHandler) {
      this.handleCapture(button)
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
