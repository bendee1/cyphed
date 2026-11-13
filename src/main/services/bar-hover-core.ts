/**
 * Survol de la barre sans crochet souris. Electron, pour `setIgnoreMouseEvents(true, { forward: true })`, pose un
 * crochet WH_MOUSE_LL dans le fil principal de Cyphed : dès que ce fil est occupé (lancement de l'installeur d'une
 * mise à jour, démarrage, fermeture), Windows fait attendre la souris de tout le PC. On regarde plutôt où est le
 * curseur quelques fois par seconde. Pur, sans Electron, pour les tests.
 */
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

/** Marge autour de la pilule, en pixels : la barre s'ouvre un peu avant que le curseur la touche. */
export const HOVER_MARGIN = 4
/** Fréquence du regard sur le curseur : assez pour que la barre réponde, rien pour le processeur. */
export const HOVER_POLL_MS = 80

/** Le curseur (écran) est-il sur la zone active de la barre (coordonnées dans la fenêtre) ? */
export function cursorOnBar(cursor: Point, windowBounds: Rect, hit: Rect | null, margin = HOVER_MARGIN): boolean {
  if (!hit || hit.width <= 0 || hit.height <= 0) return false
  const left = windowBounds.x + hit.x - margin
  const top = windowBounds.y + hit.y - margin
  return cursor.x >= left && cursor.x <= left + hit.width + 2 * margin && cursor.y >= top && cursor.y <= top + hit.height + 2 * margin
}

/** Rectangle envoyé par la barre : quatre nombres finis, dans la fenêtre, sinon rien. */
export function parseHitRect(value: unknown, max = 4000): Rect | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const nums = [r.x, r.y, r.width, r.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max)) return null
  return { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }
}
