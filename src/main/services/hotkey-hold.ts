/** Au-delà, un maintien est considéré comme perdu (relâchement jamais vu). */
const MAX_HOLD_MS = 10 * 60 * 1000

export type HoldDeps = {
  vks: () => number[] | null
  isDown: (vk: number) => boolean
  now: () => number
  /** active : une dictée est en cours (démarrage ou écoute) */
  isActive: () => boolean
  /** démarre si au repos, arrête sinon */
  toggle: () => Promise<void> | void
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  tapMs?: number
  pollMs?: number
  /** Appelé au relâchement d'un maintien qui a arrêté la dictée (durée tenue). */
  onHeld?: (heldMs: number) => void
}

/**
 * Maintenir pour parler : tu tiens le raccourci, la dictée tourne ; tu lâches, elle s'arrête.
 * Un appui bref (moins de tapMs) bascule en mains libres : la dictée continue jusqu'au prochain appui.
 */
export class HoldController {
  private handle: unknown = null
  private pressedAt = 0
  private readonly deps: HoldDeps

  constructor(deps: HoldDeps) {
    this.deps = deps
  }

  onPress(): void {
    if (this.handle !== null) return // répétition clavier pendant l'appui
    if (this.deps.isActive()) {
      void this.deps.toggle() // mains libres : cet appui arrête
      return
    }
    const vks = this.deps.vks()
    void this.deps.toggle()
    if (!vks) return // touche inconnue : on reste en mode bascule
    this.pressedAt = this.deps.now()
    this.handle = this.deps.setInterval(() => {
      // Plafond : si Windows ne rapporte jamais le relâchement, on ne bloque pas les appuis suivants.
      const stuck = this.deps.now() - this.pressedAt > MAX_HOLD_MS
      if (!stuck && vks.every((vk) => this.deps.isDown(vk))) return
      this.deps.clearInterval(this.handle)
      this.handle = null
      const held = this.deps.now() - this.pressedAt
      if (held >= (this.deps.tapMs ?? 350) && this.deps.isActive()) {
        void this.deps.toggle()
        this.deps.onHeld?.(held)
      }
    }, this.deps.pollMs ?? 10)
  }
}
