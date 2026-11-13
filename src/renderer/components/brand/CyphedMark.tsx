import { useId, type SVGProps } from 'react'

type CyphedMarkVariant = 'light' | 'dark' | 'mono'

export interface CyphedMarkProps extends SVGProps<SVGSVGElement> {
  /** light : sur fond clair (C encre). dark : sur fond sombre (C ivoire). mono : couleur du texte. */
  variant?: CyphedMarkVariant
  title?: string
}

// Logo « Le C qui parle ». Géométrie tirée de cyphed-logo-kit/parle/mark.mjs (taille normale) : la changer là-bas.
const RING = 'M63.07 28.85A25 25 0 1 0 63.07 67.15'
const BARS: Array<[number, number, number]> = [
  [42, 39.2, 17.6],
  [50.2, 33.6, 28.8],
  [58.4, 38.08, 19.84],
  [66.6, 41.28, 13.44],
  [74.8, 43.84, 8.32]
]

export function CyphedMark({ variant = 'light', title = 'Cyphed', ...props }: CyphedMarkProps) {
  const uid = useId().replace(/:/g, '')
  const ivoryId = `cyphed-ivory-${uid}`
  const redId = `cyphed-red-${uid}`
  const ring = variant === 'dark' ? `url(#${ivoryId})` : variant === 'mono' ? 'currentColor' : '#141414'
  const bars = variant === 'mono' ? 'currentColor' : `url(#${redId})`

  return (
    <svg viewBox="0 0 96 96" role="img" aria-label={title} {...props}>
      <title>{title}</title>
      <defs>
        <linearGradient id={ivoryId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#ece8e1" />
          <stop offset="1" stopColor="#a9a49c" />
        </linearGradient>
        <linearGradient id={redId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b5c" />
          <stop offset="0.55" stopColor="#ff2a2a" />
          <stop offset="1" stopColor="#b30d16" />
        </linearGradient>
      </defs>
      <path d={RING} fill="none" stroke={ring} strokeWidth="13" strokeLinecap="round" />
      {BARS.map(([x, y, h]) => (
        <rect key={x} x={x} y={y} width="5.2" height={h} rx="2.6" fill={bars} opacity={variant === 'mono' ? 0.6 : 1} />
      ))}
    </svg>
  )
}
