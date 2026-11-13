import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Personalization, ScratchNote } from '@shared/types'
import { hubApi } from '@/lib/bridge'
import { EmptyState } from './EmptyState'
import { t, transformName, uiLocale } from '@/lib/i18n'

function noteTitle(note: Pick<ScratchNote, 'title' | 'text'>): string {
  if (note.title.trim()) return note.title.trim()
  const first = note.text.split('\n').find((line) => line.trim())
  return first ? first.trim().slice(0, 60) : t('pad.untitled')
}

function when(iso: string): string {
  return new Intl.DateTimeFormat(uiLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function ScratchpadView(): ReactElement {
  const [notes, setNotes] = useState<ScratchNote[]>([])
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [transforms, setTransforms] = useState<Personalization['transforms']>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const loaded = useRef(false)
  const saveTimer = useRef(0)

  useEffect(() => {
    const api = hubApi()
    void api?.getNotes?.().then((list) => {
      setNotes(list)
      loaded.current = true
      setReady(true)
    }).catch(() => setReady(true))
    void api?.getPersonalization?.().then((p) => setTransforms(p.transforms))
  }, [])

  const persist = useCallback((next: ScratchNote[]) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void hubApi()?.saveNotes?.(next), 500)
  }, [])

  const update = useCallback(
    (next: ScratchNote[]) => {
      setNotes(next)
      if (loaded.current) persist(next)
    },
    [persist]
  )

  const current = notes.find((n) => n.id === selected) ?? null
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? notes.filter((n) => `${n.title}\n${n.text}`.toLowerCase().includes(q)) : notes
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [notes, query])

  function create(): void {
    const note: ScratchNote = { id: `n-${Date.now().toString(36)}`, title: '', text: '', updatedAt: new Date().toISOString() }
    update([note, ...notes])
    setSelected(note.id)
  }

  function edit(patch: Partial<Pick<ScratchNote, 'title' | 'text'>>): void {
    if (!current) return
    update(notes.map((n) => (n.id === current.id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)))
  }

  function remove(): void {
    if (!current) return
    update(notes.filter((n) => n.id !== current.id))
    setSelected('')
  }

  async function copy(): Promise<void> {
    if (!current) return
    try {
      await navigator.clipboard.writeText(current.text)
      setMessage(t('pad.copied'))
    } catch {
      setMessage(t('pad.copyFail'))
    }
    window.setTimeout(() => setMessage(''), 1800)
  }

  async function apply(transformId: string): Promise<void> {
    if (!current || !current.text.trim() || busy) return
    setBusy(true)
    setMessage(t('pad.transforming'))
    const result = await hubApi()?.transformText?.(current.text, transformId)
    setBusy(false)
    if (result?.ok) {
      edit({ text: result.text })
      setMessage(t('pad.transformed'))
    } else {
      setMessage(result?.error ?? t('pad.transformFail'))
    }
    window.setTimeout(() => setMessage(''), 4000)
  }

  return (
    <div className="cy-page cy-wide">
      <div className="cy-head">
        <h1 className="cy-h1">{t('page.scratchpad')} <span className="cy-beta">{t('common.beta')}</span></h1>
        {notes.length > 0 ? <button type="button" className="cy-btn is-dark" onClick={create}>{t('pad.new')}</button> : null}
      </div>
      <p className="cy-intro">{t('pad.intro')}</p>
      {notes.length === 0 ? (
        ready ? <EmptyState action={<button type="button" className="cy-btn is-dark" onClick={create}>{t('pad.new')}</button>}>
          {t('pad.empty')}
        </EmptyState> : null
      ) : (
      <div className="cy-pad">
        <aside className="cy-pad-list">
          <div className="cy-pad-search">
            <input className="cy-input" value={query} placeholder={t('pad.search')} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {shown.length === 0 ? (
            <p className="cy-empty">{t('pad.nothingFound')}</p>
          ) : (
            shown.map((n) => (
              <button type="button" key={n.id} className={`cy-pad-item${n.id === selected ? ' is-on' : ''}`} onClick={() => setSelected(n.id)}>
                <b>{noteTitle(n)}</b>
                <span>{when(n.updatedAt)}</span>
              </button>
            ))
          )}
        </aside>
        <div className="cy-pad-editor">
          {current ? (
            <>
              <input className="cy-input cy-pad-title" value={current.title} placeholder={t('pad.titlePh')} onChange={(e) => edit({ title: e.target.value })} />
              <div className="cy-pad-actions">
                {transforms.map((tf) => (
                  <button type="button" key={tf.id} className="cy-btn" disabled={busy || !current.text.trim()} onClick={() => void apply(tf.id)}>
                    {transformName(tf)}
                  </button>
                ))}
                <span className="cy-pad-spacer" />
                <button type="button" className="cy-btn" onClick={() => void copy()}>{t('common.copy')}</button>
                <button type="button" className="cy-btn is-danger" onClick={remove}>{t('pad.delete')}</button>
              </div>
              <textarea
                className="cy-input cy-pad-text"
                value={current.text}
                placeholder={t('pad.bodyPh')}
                onChange={(e) => edit({ text: e.target.value })}
              />
              {message ? <p className="cy-pad-msg" role="status">{message}</p> : null}
            </>
          ) : (
            <p className="cy-empty">{t('pad.pick')}</p>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
