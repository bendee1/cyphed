import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { t } from '@/lib/i18n'

type Draft = { x: number; y: number; w: number; h: number }

export function CaptureApp(): ReactElement {
  const [image, setImage] = useState('')
  const [displayId, setDisplayId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const draftRef = useRef<Draft | null>(null)

  useEffect(() => {
    const api = window.cyphed
    const apply = (payload: { displayId: number; imageDataUrl: string }): void => {
      setDisplayId(payload.displayId)
      setImage(payload.imageDataUrl)
    }
    void api?.getCaptureInit?.().then((payload) => {
      if (payload) apply(payload)
    })
    if (!api?.onCaptureInit) return
    return api.onCaptureInit(apply)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') window.cyphed?.abortCapture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function pos(event: MouseEvent<HTMLElement>): { x: number; y: number } {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  function onDown(event: MouseEvent<HTMLElement>): void {
    const point = pos(event)
    origin.current = point
    const next = { x: point.x, y: point.y, w: 0, h: 0 }
    draftRef.current = next
    setDraft(next)
  }

  function onMove(event: MouseEvent<HTMLElement>): void {
    const start = origin.current
    if (!start) return
    const point = pos(event)
    const next = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y)
    }
    draftRef.current = next
    setDraft(next)
  }

  function onUp(): void {
    const rect = draftRef.current
    const id = displayId
    origin.current = null
    draftRef.current = null
    setDraft(null)
    if (!rect || id == null || rect.w < 12 || rect.h < 12) return
    window.cyphed?.pickCapture({
      displayId: id,
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h
    })
  }

  return (
    <div
      className="cap"
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={() => {
        origin.current = null
        setDraft(null)
      }}
    >
      {image ? <img className="cap-shot" src={image} alt="" draggable={false} /> : null}
      <div className="cap-dim" />
      {draft && draft.w > 2 && draft.h > 2 ? (
        <i
          className="cap-rect"
          style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
        />
      ) : null}
      <p className="cap-hint">{t('capture.hint')}</p>
    </div>
  )
}
