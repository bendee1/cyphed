import { useEffect, useId, useRef, type RefObject } from 'react'
import { displayLevel, PEAK_FLOOR } from './level'

type Props = {
  level: number
  /** Écoute : les barres suivent la voix. */
  active: boolean
  /** Traitement : l'anneau tourne, les barres s'éteignent. */
  busy?: boolean
  /** Halo rouge autour de la pastille : suit la voix à l'écoute, respire pendant le traitement. */
  haloRef?: RefObject<HTMLElement | null>
}

// Logo « Le C qui parle » (cyphed-logo-kit/parle/mark.mjs) : ses 5 barres rouges servent de vumètre.
const RING = 'M63.07 28.85A25 25 0 1 0 63.07 67.15'
const BARS: Array<[number, number, number]> = [
  [42, 39.2, 17.6],
  [50.2, 33.6, 28.8],
  [58.4, 38.08, 19.84],
  [66.6, 41.28, 13.44],
  [74.8, 43.84, 8.32]
]
// Amplitude des barres à l'écoute : du repos (voix nulle) au pic, en multiple de la hauteur du logo.
const REST = 0.3
const PEAK = 1.9

export function VoiceMark({ level, active, busy = false, haloRef }: Props) {
  const uid = useId().replace(/:/g, '')
  const barsRef = useRef<Array<SVGRectElement | null>>([])
  const levelRef = useRef(level)
  const activeRef = useRef(active)
  const busyRef = useRef(busy)
  const smooth = useRef(0)
  const peak = useRef(PEAK_FLOOR)

  useEffect(() => {
    levelRef.current = level
    activeRef.current = active
    busyRef.current = busy
  }, [level, active, busy])

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const shown = displayLevel(activeRef.current ? levelRef.current : 0, peak.current)
      peak.current = shown.peak
      const target = activeRef.current ? shown.value : 0
      smooth.current += (target - smooth.current) * (target > smooth.current ? 0.5 : 0.18)
      const now = performance.now() / 1000
      const busyNow = busyRef.current && !activeRef.current
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        const [, y, h] = BARS[i]
        const jitter = 0.8 + 0.2 * Math.sin(now * 10.5 + i * 1.9)
        // Traitement : les barres ondulent une à une, de gauche à droite.
        const scale = activeRef.current
          ? REST + (PEAK - REST) * smooth.current * jitter
          : busyNow
            ? 0.45 + 0.75 * Math.max(0, Math.sin(now * 7 - i * 0.9))
            : 1
        const nextH = h * scale
        bar.setAttribute('height', nextH.toFixed(2))
        bar.setAttribute('y', (y + h / 2 - nextH / 2).toFixed(2))
      })
      const halo = haloRef?.current
      if (halo) {
        const s = smooth.current
        if (activeRef.current) {
          halo.style.boxShadow = `0 0 0 ${(2 + 7 * s).toFixed(1)}px rgba(255, 42, 42, ${(0.15 + 0.45 * s).toFixed(2)}), 0 0 ${(6 + 12 * s).toFixed(1)}px rgba(255, 42, 42, ${(0.3 * s).toFixed(2)})`
        } else if (busyNow) {
          const p = 0.5 + 0.5 * Math.sin(now * 4)
          halo.style.boxShadow = `0 0 0 ${(2 + 3 * p).toFixed(1)}px rgba(255, 42, 42, ${(0.18 + 0.12 * p).toFixed(2)})`
        } else {
          halo.style.boxShadow = ''
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <svg className={`voice-mark${busy ? ' is-busy' : ''}${active ? ' is-live' : ''}`} viewBox="0 0 96 96" aria-hidden>
      <defs>
        <linearGradient id={`vm-ivory-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#ece8e1" />
          <stop offset="1" stopColor="#a9a49c" />
        </linearGradient>
        <linearGradient id={`vm-red-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b5c" />
          <stop offset="0.55" stopColor="#ff2a2a" />
          <stop offset="1" stopColor="#b30d16" />
        </linearGradient>
      </defs>
      <path className="voice-ring" d={RING} fill="none" stroke={`url(#vm-ivory-${uid})`} strokeWidth="12" strokeLinecap="round" />
      {BARS.map(([x, y, h], i) => (
        <rect key={x} ref={(el) => { barsRef.current[i] = el }} className="voice-bar" x={x} y={y} width="5.2" height={h} rx="2.6" fill={`url(#vm-red-${uid})`} />
      ))}
    </svg>
  )
}
