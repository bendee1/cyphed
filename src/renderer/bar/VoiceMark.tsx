import { useEffect, useId, useRef } from 'react'
import { displayLevel, PEAK_FLOOR } from './level'

type Props = {
  level: number
  /** Écoute : les barres suivent la voix. */
  active: boolean
  /** Traitement : l'anneau tourne, les barres s'éteignent. */
  busy?: boolean
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
const REST = 0.42

export function VoiceMark({ level, active, busy = false }: Props) {
  const uid = useId().replace(/:/g, '')
  const barsRef = useRef<Array<SVGRectElement | null>>([])
  const levelRef = useRef(level)
  const activeRef = useRef(active)
  const smooth = useRef(0)
  const peak = useRef(PEAK_FLOOR)

  useEffect(() => {
    levelRef.current = level
    activeRef.current = active
  }, [level, active])

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const shown = displayLevel(activeRef.current ? levelRef.current : 0, peak.current)
      peak.current = shown.peak
      const target = activeRef.current ? shown.value : 0
      smooth.current += (target - smooth.current) * (target > smooth.current ? 0.5 : 0.18)
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        const [, y, h] = BARS[i]
        const jitter = 0.8 + 0.2 * Math.sin(performance.now() / 95 + i * 1.9)
        const scale = activeRef.current ? REST + (1.25 - REST) * smooth.current * jitter : 1
        const nextH = h * scale
        bar.setAttribute('height', nextH.toFixed(2))
        bar.setAttribute('y', (y + h / 2 - nextH / 2).toFixed(2))
      })
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
