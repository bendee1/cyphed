import type { ReactElement, ReactNode } from 'react'

/** État vide commun : une phrase d'usage avec un exemple. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }): ReactElement {
  return (
    <div className="cy-empty">
      <p>{children}</p>
      {action}
    </div>
  )
}
