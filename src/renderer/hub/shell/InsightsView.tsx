import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Insights } from '@shared/types'
import { hubApi } from '@/lib/bridge'
import { categoryLabel } from './categories'
import { t, tp } from '@/lib/i18n'

const EMPTY: Insights = {
  dictations: 0,
  totalWords: 0,
  wordsPerMinute: 0,
  currentStreak: 0,
  longestStreak: 0,
  categories: [],
  topApps: [],
  days: {},
  dictionaryEntries: 0
}

const GAUGE_MAX_WPM = 220

function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

function Gauge({ value }: { value: number }): ReactElement {
  const ratio = Math.max(0, Math.min(1, value / GAUGE_MAX_WPM))
  const length = Math.PI * 70
  return (
    <svg className="cy-gauge" viewBox="0 0 160 90" role="img" aria-label={t('ins.wpmAria', { value })}>
      <path d="M10 80 A70 70 0 0 1 150 80" fill="none" stroke="#e5e2d8" strokeWidth="16" strokeLinecap="round" />
      <path
        d="M10 80 A70 70 0 0 1 150 80"
        fill="none"
        stroke="var(--cy-red-deep)"
        strokeWidth="16"
        strokeLinecap="round"
        strokeDasharray={`${length * ratio} ${length}`}
      />
    </svg>
  )
}

function Heatmap({ days }: { days: Record<string, number> }): ReactElement {
  const cells = useMemo(() => {
    const today = new Date()
    const start = new Date(today)
    start.setDate(start.getDate() - 17 * 7 + 1)
    start.setDate(start.getDate() - start.getDay()) // aligne sur le dimanche
    const max = Math.max(1, ...Object.values(days))
    const out: Array<{ key: string; level: number; future: boolean }> = []
    for (const d = new Date(start); d <= new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - today.getDay())); d.setDate(d.getDate() + 1)) {
      const key = dayKey(d)
      const words = days[key] ?? 0
      out.push({ key, level: words === 0 ? 0 : Math.max(1, Math.ceil((words / max) * 3)), future: d > today })
    }
    return out
  }, [days])
  return (
    <div className="cy-heat" aria-hidden>
      {cells.map((cell) => (
        <span key={cell.key} className={`cy-heat-cell l${cell.level}${cell.future ? ' is-future' : ''}`} title={t('ins.heatTitle', { date: cell.key, words: days[cell.key] ?? 0 })} />
      ))}
    </div>
  )
}

export function InsightsView(): ReactElement {
  const [data, setData] = useState<Insights>(EMPTY)
  const [error, setError] = useState('')

  useEffect(() => {
    void hubApi()
      ?.getInsights?.()
      .then(setData)
      .catch(() => setError(t('ins.error')))
  }, [])

  return (
    <div className="cy-page cy-wide">
      <div className="cy-head">
        <h1 className="cy-h1">{t('page.insights')}</h1>
      </div>
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      <div className="cy-ins-grid">
        <section className="cy-ins-card">
          <div className="cy-ins-big">{data.wordsPerMinute}</div>
          <div className="cy-ins-label">{t('ins.wpm')}</div>
          <Gauge value={data.wordsPerMinute} />
        </section>
        <section className="cy-ins-card">
          <div className="cy-ins-big">{data.dictionaryEntries}</div>
          <div className="cy-ins-label">{t('ins.dictionary')}</div>
          <p className="cy-ins-note">{t('ins.dictionaryNote')}</p>
        </section>
        <section className="cy-ins-card">
          <div className="cy-ins-big">{data.totalWords}</div>
          <div className="cy-ins-label">{t('ins.total')}</div>
          <p className="cy-ins-note">{tp('unit.dictation', data.dictations)}</p>
        </section>
      </div>
      <div className="cy-ins-grid two">
        <section className="cy-ins-card">
          <h2 className="cy-ins-title">{t('ins.byApp')}</h2>
          <div className="cy-bars">
            {data.categories.map((c) => (
              <div className="cy-bar-row" key={c.id}>
                <span className="cy-bar-label">{categoryLabel(c.id)}</span>
                <span className="cy-bar-track">
                  <span className="cy-bar-fill" style={{ width: `${c.percent}%` }} />
                </span>
                <span className="cy-bar-value" title={t('ins.percent', { percent: c.percent })}>{tp('unit.dictation', c.count)}</span>
              </div>
            ))}
          </div>
          {data.topApps.length > 0 ? (
            <>
              <h3 className="cy-ins-sub">{t('ins.topApps')}</h3>
              <ul className="cy-apps">
                {data.topApps.map((a) => (
                  <li key={a.app}><span>{a.app}</span><b>{tp('unit.word', a.words)}</b></li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <section className="cy-ins-card">
          <h2 className="cy-ins-title">{tp('ins.streak', data.currentStreak)}</h2>
          <div className="cy-ins-label">{tp('ins.record', data.longestStreak)}</div>
          <Heatmap days={data.days} />
        </section>
      </div>
    </div>
  )
}
