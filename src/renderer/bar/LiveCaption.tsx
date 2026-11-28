import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BarState } from '@shared/types'
import { EMPTY_CAPTION, foldCaption, wordFixed, wordSure, type Caption } from './caption-core'

/** Lignes visibles avant que les plus anciennes remontent : une dictée normale tient en entier. */
const MAX_LINES = 4
const BORDER = 1.5

/**
 * Mesures de la bulle à une échelle donnée (1 = écran de 1080 px de haut) : police, ligne, marges, largeurs.
 * Valeurs arrondies au pixel pour garder un texte net.
 */
function captionSize(scale: number) {
  const line = Math.round(20 * scale)
  const padY = Math.round(9 * scale)
  const padX = Math.round(18 * scale)
  const maxWidth = Math.round(300 * scale)
  return {
    font: Math.round(14 * scale * 2) / 2,
    line,
    padY,
    padX,
    radius: Math.round(20 * scale),
    maxWidth,
    minWidth: Math.round(60 * scale),
    /** Marges et bords en largeur et en hauteur. */
    extraX: 2 * padX + 2 * BORDER,
    extraY: 2 * padY + 2 * BORDER,
    inner: maxWidth - 2 * padX - 2 * BORDER
  }
}

type Box = { width: number; lines: number; shift: number }

/**
 * Bulle au-dessus de la barre : le texte entendu s'écrit pendant la dictée (ElevenLabs).
 * Gris ivoire = mot pas encore sûr, blanc = validé, rouge un instant = mot corrigé par le moteur.
 * Une ligne : la bulle épouse le texte ; quatre lignes au plus, les plus anciennes remontent et s'effacent.
 */
export function LiveCaption({ phase }: { phase: BarState['phase'] }) {
  const [caption, setCaption] = useState<Caption>(EMPTY_CAPTION)
  const [now, setNow] = useState(() => performance.now())
  const [scale, setScale] = useState(1)
  const size = captionSize(scale)
  const [box, setBox] = useState<Box>({ width: size.minWidth, lines: 1, shift: 0 })
  const linesRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const active = phase === 'listening' || phase === 'processing'

  useEffect(
    () =>
      window.cyphed.onBarCaption((text) => {
        const at = performance.now()
        setCaption((prev) => (text ? foldCaption(prev, text, at) : EMPTY_CAPTION))
        setNow(at)
      }),
    []
  )

  useEffect(() => window.cyphed.onBarScale(setScale), [])

  // Les mots passent de « pas sûr » à « sûr » avec le temps, et le rouge s'éteint : petite horloge pendant la dictée.
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(performance.now()), 150)
    return () => window.clearInterval(id)
  }, [active])

  // Dictée finie : la bulle s'efface, puis on vide le texte (pas pendant le fondu).
  useEffect(() => {
    if (active) return
    const id = window.setTimeout(() => setCaption(EMPTY_CAPTION), 260)
    return () => window.clearTimeout(id)
  }, [active])

  useLayoutEffect(() => {
    const lines = linesRef.current
    const measure = measureRef.current
    if (!lines || !measure) return
    if (caption.words.length === 0) {
      // Bulle vide (cachée) : elle repart petite pour la prochaine dictée.
      setBox((b) => (b.width === size.minWidth && b.lines === 1 && b.shift === 0 ? b : { width: size.minWidth, lines: 1, shift: 0 }))
      return
    }
    // offsetHeight ignore les transformations : un mot qui entre (décalé de 3 px) ne fait pas sauter la hauteur.
    const height = lines.offsetHeight
    const count = Math.max(1, Math.round(height / size.line))
    const oneLine = Math.ceil(measure.getBoundingClientRect().width)
    const width = count > 1 || oneLine > size.inner ? size.maxWidth : Math.max(size.minWidth, Math.ceil(oneLine + size.extraX))
    const visible = Math.min(count, MAX_LINES)
    const shift = Math.max(0, height - visible * size.line)
    setBox((b) => (b.width === width && b.lines === visible && b.shift === shift ? b : { width, lines: visible, shift }))
  }, [caption, scale])

  const shown = active && caption.words.length > 0
  const settled = phase === 'processing'

  return (
    <div
      className={`live-caption${shown ? '' : ' is-off'}${box.shift > 0 ? ' is-scrolled' : ''}`}
      style={{
        width: box.width,
        height: box.lines * size.line + size.extraY,
        padding: `${size.padY}px ${size.padX}px`,
        borderRadius: size.radius,
        fontSize: size.font,
        lineHeight: `${size.line}px`
      }}
      aria-hidden
    >
      <div className="live-caption-view">
        <div className="live-caption-lines" ref={linesRef} style={{ width: size.inner, transform: `translateY(${-box.shift}px)` }}>
          {caption.words.map((word, i) => (
            <span key={`${word.key}:${word.text}`}>
              {i > 0 ? ' ' : null}
              <span className={`lc-word${wordFixed(word, now) ? ' is-fixed' : wordSure(word, now, settled) ? ' is-sure' : ''}`}>{word.text}</span>
            </span>
          ))}
        </div>
        <div className="live-caption-fade" />
      </div>
      <span className="live-caption-measure" ref={measureRef}>
        {caption.words.map((w) => w.text).join(' ')}
      </span>
    </div>
  )
}
