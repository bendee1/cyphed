import { useEffect, useId, useRef, type RefObject } from 'react'
import { displayLevel, PEAK_FLOOR } from './level'

type Props = {
  level: number
  /** Écoute : les barres suivent la voix. */
  active: boolean
  /** Traitement : l'anneau tourne, les barres s'éteignent. */
  busy?: boolean
  /** Onde à côté du logo : ses barres (enfants) montrent les derniers instants de la voix, de gauche à droite. */
  waveRef?: RefObject<HTMLElement | null>
}

// Logo « Le C qui parle » (assets/brand) : ses 5 barres rouges servent de vumètre.
const RING = 'M63.07 28.85A25 25 0 1 0 63.07 67.15'
const BARS: Array<[number, number, number]> = [
  [42, 39.2, 17.6],
  [50.2, 33.6, 28.8],
  [58.4, 38.08, 19.84],
  [66.6, 41.28, 13.44],
  [74.8, 43.84, 8.32]
]
// Amplitude des barres à l'écoute : du repos (voix nulle) au pic, en multiple de la hauteur du logo.
const REST = 0.42
const PEAK = 1.5
// Une colonne de l'onde toutes les 50 ms, quelle que soit la fréquence de l'écran : l'onde couvre 0,6 s.
const WAVE_STEP_MS = 50

export function VoiceMark({ level, active, busy = false, waveRef }: Props) {
  const uid = useId().replace(/:/g, '')
  const barsRef = useRef<Array<SVGRectElement | null>>([])
  const levelRef = useRef(level)
  const activeRef = useRef(active)
  const busyRef = useRef(busy)
  const smooth = useRef(0)
  const peak = useRef(PEAK_FLOOR)
  const history = useRef<number[]>([])
  const lastSample = useRef(0)

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
            ? 0.5 + 0.3 * Math.max(0, Math.sin(now * 6 - i * 1.2))
            : 1
        const nextH = h * scale
        bar.setAttribute('height', nextH.toFixed(2))
        bar.setAttribute('y', (y + h / 2 - nextH / 2).toFixed(2))
      })
      const wave = waveRef?.current
      if (wave) {
        const cols = wave.children
        // Traitement : l'onde se calme et défile doucement.
        const sample = busyNow ? 0.15 + 0.12 * Math.max(0, Math.sin(now * 6)) : smooth.current
        // Une colonne par tranche de 50 ms écoulée (au plus une onde entière après une pause de l'affichage).
        const steps = Math.min(cols.length, Math.floor((now * 1000 - lastSample.current) / WAVE_STEP_MS))
        if (steps > 0) {
          lastSample.current = now * 1000
          for (let k = 0; k < steps; k += 1) history.current.push(sample)
          if (history.current.length > cols.length) history.current.splice(0, history.current.length - cols.length)
        }
        for (let i = 0; i < cols.length; i += 1) {
          const value = history.current[history.current.length - 1 - (cols.length - 1 - i)] ?? 0
          const col = cols[i] as HTMLElement
          col.style.height = `${Math.max(4, Math.round(4 + 26 * value))}px`
          col.style.opacity = busyNow ? '0.55' : '1'
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
