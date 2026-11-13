import { useMemo, useState, type ReactElement } from 'react'
import type { HubStatus } from '@shared/ipc'
import type { ActivityRecord, BarState, Insights, RecordingMode } from '@shared/types'
import { hubApi } from '@/lib/bridge'
import { EmptyState } from '../EmptyState'
import { buildDayWave, waveTicks } from '../day-wave-core'
import { Keys } from '../Keys'
import { formatNumber, t, tp, uiLocale } from '@/lib/i18n'

export type Row = Pick<ActivityRecord, 'id' | 'finalText' | 'createdAt' | 'words' | 'durationMs' | 'app' | 'kind' | 'provenance'>

/** Dictée ratée (à refaire depuis l'audio) ou collée en texte brut (à renettoyer). */
function retryReason(row: Row): { failed: boolean; reason: string } | null {
  if (row.kind !== 'dictation' || row.provenance?.retried) return null
  if (row.provenance?.failed) return { failed: true, reason: row.provenance.failed }
  if (row.provenance?.cleanupFallback) return { failed: false, reason: row.provenance.cleanupFallback }
  return null
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (dayKey(iso) === dayKey(today.toISOString())) return t('home.day.today')
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('home.day.yesterday')
  return new Intl.DateTimeFormat(uiLocale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function Home({ status, mode, rows, insights, barPhase, onSettings, onChanged }: { status: HubStatus; mode: RecordingMode; rows: Row[]; insights: Insights | null; barPhase: BarState['phase']; onSettings: () => void; onChanged: () => void }): ReactElement {
  const [copied, setCopied] = useState('')
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')
  const [learned, setLearned] = useState('')
  const [retrying, setRetrying] = useState('')
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null)
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const row of rows) {
      const key = dayLabel(row.createdAt)
      map.set(key, [...(map.get(key) ?? []), row])
    }
    return [...map.entries()]
  }, [rows])

  async function saveCorrection(row: Row): Promise<void> {
    const text = draft.trim()
    setEditing('')
    if (!text || text === row.finalText.trim()) return
    const result = await hubApi()?.correctActivity?.(row.id, text)
    if (result?.ok) {
      setLearned(
        result.added.length > 0
          ? t('home.learned', { words: result.added.map((e) => `${e.term} → ${e.replacement ?? e.term}`).join(', ') })
          : t('home.corrected')
      )
      window.setTimeout(() => setLearned(''), 4000)
      onChanged()
    }
  }

  async function retry(row: Row): Promise<void> {
    setRetrying(row.id)
    setRetryError(null)
    const result = await hubApi()?.retryActivity?.(row.id)
    setRetrying('')
    if (!result) return
    if (result.ok) {
      setLearned(t('home.retried'))
      window.setTimeout(() => setLearned(''), 5000)
      onChanged()
    } else {
      setRetryError({ id: row.id, message: result.error })
    }
  }

  async function copy(row: Row): Promise<void> {
    try {
      await navigator.clipboard.writeText(row.finalText.trim())
      setCopied(row.id)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      /* presse-papiers indisponible */
    }
  }

  const wave = useMemo(() => buildDayWave(rows), [rows])
  const listening = barPhase === 'listening'
  const ready = status.deepgram || status.mock

  return (
    <div className="cy-page">
      <header className="cy-home-head">
        <h1 className="cy-h1">{t('home.title')}</h1>
        <span className="cy-ready">
          <span className={`cy-dot ${listening ? 'is-live' : ready ? 'is-on' : ''}`} />
          {listening ? t('status.listening') : ready ? t('status.ready') : t('status.setup')}
          <Keys hotkey={status.hotkey} />
        </span>
      </header>
      <section className="cy-wave" aria-label={t('home.wave.aria')}>
        <div className="cy-wave-nums">
          <div><b className="cy-num">{formatNumber(wave.total)}</b><span>{tp('home.wave.words', wave.total)}</span></div>
          <div><b className="cy-num">{insights?.wordsPerMinute ?? 0}</b><span>{t('home.wave.wpm')}</span></div>
          <div><b className="cy-num">{tp('unit.day', insights?.currentStreak ?? 0)}</b><span>{t('home.wave.streak')}</span></div>
        </div>
        <div className="cy-wave-chart">
          <div className="cy-wave-cols" aria-hidden>
            {wave.slots.map((words, i) => (
              <i key={i} className={words ? '' : 'is-zero'} style={words ? { height: `${Math.max(6, Math.round((words / wave.max) * 100))}%` } : undefined} />
            ))}
          </div>
          <div className="cy-wave-axis" aria-hidden>
            {waveTicks(wave).map((h) => (
              <span key={h} style={{ left: `${((h - wave.startHour) / (wave.endHour - wave.startHour)) * 100}%` }}>{t('home.wave.hour', { h })}</span>
            ))}
          </div>
          <p className="cy-wave-engine">
            {ready ? 'Deepgram' : t('home.engine.setup')}
            {' · '}
            {status.cleanupModel || (status.anthropic ? 'Claude Haiku 5.5' : status.cerebras ? 'Cerebras' : t('home.engine.plain'))}
          </p>
        </div>
      </section>
      <div>
        <div>
          {learned ? <p className="cy-learned" role="status">{learned}</p> : null}
          {groups.length === 0 ? (
            <EmptyState>
              {t('home.empty.none')}{' '}
              {mode === 'push_to_talk' ? t('home.empty.push') : t('home.empty.toggle')}{' '}
              <button type="button" className="cy-link" onClick={onSettings}>{t('home.empty.change')}</button>
            </EmptyState>
          ) : (
            groups.map(([label, list]) => (
              <section key={label}>
                <div className="cy-day">{label}</div>
                <div className="cy-list">
                  {list.map((row) => {
                    const toRetry = retryReason(row)
                    return (
                    <div className={`cy-row${editing === row.id ? ' is-editing' : ''}`} key={row.id}>
                      <time>{timeLabel(row.createdAt)}</time>
                      <div>
                        {editing === row.id ? (
                          <>
                          <textarea
                            className="cy-input cy-edit"
                            autoFocus
                            rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 80)))}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditing('')
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveCorrection(row)
                            }}
                          />
                          <small>{t('home.editHint')}</small>
                          </>
                        ) : toRetry?.failed ? (
                          <p className="cy-row-failed">{t('home.failed', { reason: toRetry.reason })}</p>
                        ) : (
                          <p>{row.finalText.trim()}</p>
                        )}
                        {toRetry && editing !== row.id ? (
                          <div className="cy-retry">
                            {!toRetry.failed ? <span>{t('home.rawPasted', { reason: toRetry.reason })}</span> : null}
                            <button type="button" className="cy-btn" disabled={retrying === row.id} onClick={() => void retry(row)}>
                              {retrying === row.id ? t('home.retrying') : t('home.retry')}
                            </button>
                            {retryError?.id === row.id ? <span role="alert">{retryError.message}</span> : null}
                          </div>
                        ) : null}
                        {row.kind !== 'dictation' ? <small>{row.kind === 'reader_text' ? t('home.kind.readerText') : t('home.kind.readerCapture')}</small> : null}
                      </div>
                      <div className="cy-row-actions">
                        {editing === row.id ? (
                          <>
                            <button type="button" onClick={() => setEditing('')}>{t('common.cancel')}</button>
                            <button type="button" onClick={() => void saveCorrection(row)}>{t('common.save')}</button>
                          </>
                        ) : (
                          <>
                            {row.kind === 'dictation' && !toRetry?.failed ? (
                              <button type="button" onClick={() => { setEditing(row.id); setDraft(row.finalText.trim()) }}>{t('home.correct')}</button>
                            ) : null}
                            {toRetry?.failed ? null : (
                              <button type="button" onClick={() => void copy(row)}>
                                {copied === row.id ? t('common.copied') : t('common.copy')}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
