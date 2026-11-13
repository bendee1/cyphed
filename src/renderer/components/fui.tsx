import type { ReactElement, ReactNode } from 'react'

export function FuiHeading({
  eyebrow,
  title,
  trailing
}: {
  eyebrow: string
  title: string
  trailing?: ReactNode
}): ReactElement {
  return (
    <div className="hub-heading">
      <div>
        <p className="hub-kicker">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {trailing}
    </div>
  )
}
