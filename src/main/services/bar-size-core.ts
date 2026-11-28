// Taille de la barre selon l'écran (logique pure, testable sans Electron).

/** Fenêtre de la barre à l'échelle 1 : assez haute pour le menu Lire (5 lignes). */
export const BAR_BASE_WIDTH = 340
export const BAR_BASE_HEIGHT = 310
/** Bulle du texte en direct à l'échelle 1, et marge de chaque côté dans la fenêtre. */
const CAPTION_BASE_WIDTH = 300
const CAPTION_SIDE_MARGIN = 20
/** Écran de référence : 1080 pixels de haut (après l'agrandissement de Windows). */
const REFERENCE_HEIGHT = 1080
const MAX_SCALE = 1.4

/**
 * Agrandissement de la bulle selon l'écran où s'affiche la barre. Windows agrandit déjà tout quand son
 * échelle dépasse 100 % : la hauteur reçue est en pixels logiques, donc un écran 1440p à 125 % (1152)
 * ne grossit presque pas, alors qu'un 1440p à 100 % passe à 1,33. Jamais plus petit que 1, plafonné à 1,4.
 */
export function captionScale(displayHeight: number): number {
  if (!Number.isFinite(displayHeight) || displayHeight <= 0) return 1
  const scale = displayHeight / REFERENCE_HEIGHT
  return Math.round(Math.min(MAX_SCALE, Math.max(1, scale)) * 100) / 100
}

/** Fenêtre de la barre : élargie pour que la bulle agrandie tienne, jamais plus petite qu'à l'échelle 1. */
export function barWindowSize(scale: number): { width: number; height: number } {
  return {
    width: Math.max(BAR_BASE_WIDTH, Math.ceil(CAPTION_BASE_WIDTH * scale + 2 * CAPTION_SIDE_MARGIN)),
    height: BAR_BASE_HEIGHT
  }
}
