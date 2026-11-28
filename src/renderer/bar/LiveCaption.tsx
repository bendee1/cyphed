import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BarState } from '@shared/types'
import { EMPTY_CAPTION, foldCaption, wordFixed, wordSure, type Caption } from './caption-core'

/** Hauteur d'une ligne, largeur maximale de la bulle, marges intérieures (bord compris). */
const LINE = 20
/** Lignes visibles avant que les plus anciennes remontent : une dictée normale tient en entier. */
const MAX_LINES = 4
const MAX_WIDTH = 300
const MIN_WIDTH = 60
const PAD_X = 39
const PAD_Y = 21
const INNER = MAX_WIDTH - PAD_X

type Box = { width: number; lines: number; shift: number }

/**
 * Bulle au-dessus de la barre : le texte entendu s'écrit pendant la dictée (ElevenLabs).
 * Gris ivoire = mot pas encore sûr, blanc = validé, rouge un instant = mot corrigé par le moteur.
 * Une ligne : la bulle épouse le texte ; quatre lignes au plus, les plus anciennes remontent et s'effacent.
 */
export function LiveCaption({ phase }: { phase: BarState['phase'] }) {
  const [caption, setCaption] = useState<Caption>(EMPTY_CAPTION)
  const [now, setNow] = useState(() => performance.now())
  const [box, setBox] = useState<Box>({ width: MIN_WIDTH, lines: 1, shift: 0 })
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
      setBox((b) => (b.width === MIN_WIDTH && b.lines === 1 && b.shift === 0 ? b : { width: MIN_WIDTH, lines: 1, shift: 0 }))
      return
    }
    // offsetHeight ignore les transformations : un mot qui entre (décalé de 3 px) ne fait pas sauter la hauteur.
    const height = lines.offsetHeight
    const count = Math.max(1, Math.round(height / LINE))
    const oneLine = Math.ceil(measure.getBoundingClientRect().width)
    const width = count > 1 || oneLine > INNER ? MAX_WIDTH : Math.max(MIN_WIDTH, oneLine + PAD_X)
    const visible = Math.min(count, MAX_LINES)
    const shift = Math.max(0, height - visible * LINE)
    setBox((b) => (b.width === width && b.lines === visible && b.shift === shift ? b : { width, lines: visible, shift }))
  }, [caption])

  const shown = active && caption.words.length > 0
  const settled = phase === 'processing'

  return (
    <div
      className={`live-caption${shown ? '' : ' is-off'}${box.shift > 0 ? ' is-scrolled' : ''}`}
      style={{ width: box.width, height: box.lines * LINE + PAD_Y }}
      aria-hidden
    >
      <div className="live-caption-view">
        <div className="live-caption-lines" ref={linesRef} style={{ width: INNER, transform: `translateY(${-box.shift}px)` }}>
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
