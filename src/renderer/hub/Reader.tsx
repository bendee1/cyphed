import { useEffect, useState, type ReactElement } from 'react'
import type { CapturePreview, ReaderAction } from '@shared/ipc'
import { FuiHeading } from '@/components/fui'
import { hubApi } from '@/lib/bridge'
import { t } from '@/lib/i18n'

const ACTIONS: ReaderAction[] = ['read', 'summarize', 'explain']

export function ReaderPanel({
  onDone,
  onNotice
}: {
  onDone: () => void
  onNotice: (text: string) => void
}): ReactElement {
  const [preview, setPreview] = useState<CapturePreview | null>(null)
  const [paste, setPaste] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState<'capture' | ReaderAction | 'speak' | null>(null)
  const [error, setError] = useState('')
  const api = hubApi()
  const hasZone = Boolean(preview)
  const hasText = Boolean(paste.trim() || result.trim())

  useEffect(() => {
    const current = hubApi()
    if (!current || typeof current.onTtsFailed !== 'function') return
    return current.onTtsFailed((message) => {
      if (!message) return
      setError(message)
      onNotice(message)
    })
  }, [onNotice])

  async function captureZone(): Promise<void> {
    if (!api || typeof api.startCapture !== 'function') {
      setError(t('reader.restart'))
      return
    }
    setBusy('capture')
    setError('')
    onNotice(t('reader.note.select'))
    try {
      const next = await api.startCapture()
      if (!next) {
        onNotice(t('reader.note.cancelled'))
        return
      }
      setPreview(next)
      setResult('')
      onNotice(t('reader.note.captured'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reader.note.captureFail'))
    } finally {
      setBusy(null)
    }
  }

  async function run(action: ReaderAction): Promise<void> {
    if (!api || typeof api.runReader !== 'function') {
      setError(t('reader.restart'))
      return
    }
    setBusy(action)
    setError('')
    try {
      const source =
        hasZone && !paste.trim()
          ? ({ kind: 'zone' } as const)
          : { kind: 'text' as const, text: paste.trim() || result.trim() }
      const out = await api.runReader(action, source)
      if (source.kind === 'zone') setPreview(null)
      setResult(out.text)
      if (out.speakError) {
        setError(out.speakError)
        onNotice(out.speakError)
      } else if (out.fallback && out.inFrench === false) {
        onNotice(t('reader.note.original'))
      } else if (out.inFrench === false) {
        onNotice(t('reader.note.readOriginal'))
      } else {
        onNotice(t('reader.note.french'))
      }
      onDone()
    } catch (err) {
      if (hasZone && !paste.trim()) setPreview(null)
      setError(err instanceof Error ? err.message : t('reader.note.actionFail'))
    } finally {
      setBusy(null)
    }
  }

  async function stop(): Promise<void> {
    await hubApi()?.stopSpeak?.()
    setBusy(null)
    onNotice(t('reader.note.stopped'))
  }

  return (
    <section className="hub-reader">
      <p className="hub-kicker">{t('reader.kicker')}</p>
      <h1>{t('page.reader')}</h1>
      <p>{t('reader.intro')}</p>

      <div className="hub-reader-toolbar">
        <button type="button" data-slot="button" disabled={busy === 'capture'} onClick={() => void captureZone()}>
          {busy === 'capture' ? t('reader.capturing') : t('reader.capture')}
        </button>
        {result || (busy && busy !== 'capture') ? (
          <button type="button" className="is-ghost" onClick={() => void stop()}>
            {t('reader.stop')}
          </button>
        ) : null}
      </div>

      {preview ? (
        <figure className="hub-reader-preview">
          <img src={preview.previewDataUrl} alt={t('reader.zoneAlt')} />
          <figcaption>
            {t('reader.caption', { w: preview.width, h: preview.height })}
          </figcaption>
        </figure>
      ) : (
        <p className="hub-reader-hint">{t('reader.dragHint')}</p>
      )}

      <FuiHeading eyebrow={t('reader.actions.eyebrow')} title={t('reader.actions.title')} />
      <div className="hub-seg">
        {ACTIONS.map((id) => (
          <button
            key={id}
            type="button"
            disabled={Boolean(busy) || (!hasZone && !hasText)}
            title={t('reader.action.hint')}
            onClick={() => void run(id)}
          >
            {busy === id ? '…' : t(`reader.action.${id}`)}
          </button>
        ))}
      </div>

      <label className="hub-field">
        <span>{t('reader.paste')}</span>
        <textarea
          value={paste}
          rows={4}
          placeholder={t('reader.pastePh')}
          onChange={(event) => setPaste(event.target.value)}
        />
      </label>

      {result ? (
        <article className="hub-reader-result">
          <p className="hub-kicker">{t('reader.result')}</p>
          <p>{result}</p>
        </article>
      ) : null}

      {error ? (
        <p className="hub-settings-status is-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
