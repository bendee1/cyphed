import type { ReactElement } from 'react'
import { formatHotkey } from './format'

/** Raccourci dessiné en touches : « Ctrl » « Maj » « Espace ». */
export function Keys({ hotkey }: { hotkey: string }): ReactElement {
  const label = formatHotkey(hotkey)
  return (
    <span className="cy-key" aria-label={label}>
      {label.split(' + ').map((part, i) => (
        <kbd key={`${part}-${i}`}>{part}</kbd>
      ))}
    </span>
  )
}
