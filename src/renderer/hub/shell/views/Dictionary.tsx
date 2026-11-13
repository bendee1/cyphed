import { useState, type ReactElement } from 'react'
import type { TermSuggestion } from '@shared/types'
import { hubApi } from '@/lib/bridge'
import { EmptyState } from '../EmptyState'
import { usePersonalization } from '../usePersonalization'
import { t } from '@/lib/i18n'

function SuggestionRow({
  suggestion: s,
  onAccept,
  onIgnore
}: {
  suggestion: TermSuggestion
  onAccept: (typed: string) => void
  onIgnore: () => void
}): ReactElement {
  const [typed, setTyped] = useState('')
  const unsure = !s.correct
  return (
    <div className="cy-cell">
      <span>
        {s.heard ? <s>{s.heard}</s> : null}
        <span className="cy-arrow">→</span>
        {unsure ? (
          <input
            className="cy-input cy-suggest-input"
            value={typed}
            placeholder={t('dict.typeCorrect')}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAccept(typed)}
          />
        ) : (
          <b>{s.correct}</b>
        )}
        {s.reason ? <span className="cy-suggest-reason"> {s.reason}</span> : null}
      </span>
      <span className="cy-suggest-actions">
        <button type="button" className="cy-btn is-dark" disabled={unsure && !typed.trim()} onClick={() => onAccept(typed)}>
          {t('common.add')}
        </button>
        <button type="button" className="cy-x" aria-label={t('common.ignore', { name: s.heard || s.correct })} onClick={onIgnore}>×</button>
      </span>
    </div>
  )
}

export function Dictionary(): ReactElement {
  const [data, save, error] = usePersonalization()
  const [term, setTerm] = useState('')
  const [replacement, setReplacement] = useState('')
  const [suggestions, setSuggestions] = useState<TermSuggestion[] | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [suggestNote, setSuggestNote] = useState('')

  async function analyze(): Promise<void> {
    setAnalyzing(true)
    setSuggestNote('')
    try {
      const result = await hubApi()?.suggestTerms()
      if (!result) setSuggestNote(t('common.analysisUnavailable'))
      else if (!result.ok) setSuggestNote(result.error)
      else {
        setSuggestions(result.suggestions)
        setSuggestNote(
          result.suggestions.length === 0
            ? t('dict.nothing', { n: result.analyzed })
            : t('dict.analyzed', { n: result.analyzed })
        )
      }
    } catch {
      setSuggestNote(t('common.analysisFail'))
    } finally {
      setAnalyzing(false)
    }
  }

  function accept(s: TermSuggestion, typed = ''): void {
    const correct = s.correct || typed.trim()
    if (!correct) return
    const entry = s.heard ? { term: s.heard, replacement: correct } : { term: correct }
    save({ ...data, dictionary: [entry, ...data.dictionary] })
    setSuggestions((list) => (list ?? []).filter((x) => x !== s))
  }

  function add(): void {
    const t = term.trim()
    if (!t) return
    const r = replacement.trim()
    save({ ...data, dictionary: [{ term: t, ...(r ? { replacement: r } : {}) }, ...data.dictionary] })
    setTerm('')
    setReplacement('')
  }

  return (
    <div className="cy-page">
      <div className="cy-head">
        <h1 className="cy-h1">{t('page.dictionary')}</h1>
      </div>
      <p style={{ marginTop: 0, color: 'var(--cy-ink-2)' }}>
        {t('dict.intro')}
      </p>
      <form className="cy-form" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input className="cy-input" value={term} placeholder={t('dict.termPh')} onChange={(e) => setTerm(e.target.value)} />
        <input className="cy-input" value={replacement} placeholder={t('dict.replacementPh')} onChange={(e) => setReplacement(e.target.value)} />
        <button type="submit" className="cy-btn is-dark">{t('common.add')}</button>
      </form>
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      <div className="cy-suggest">
        <button type="button" className="cy-btn" disabled={analyzing} onClick={() => void analyze()}>
          {analyzing ? t('common.analyzing') : t('dict.suggest')}
        </button>
        <span className="cy-suggest-note">
          {suggestNote || t('dict.suggestNote')}
        </span>
      </div>
      {suggestions && suggestions.length > 0 ? (
        <div className="cy-list cy-suggest-list">
          {suggestions.map((s) => (
            <SuggestionRow
              key={`${s.heard}>${s.correct}`}
              suggestion={s}
              onAccept={(typed) => accept(s, typed)}
              onIgnore={() => setSuggestions((list) => (list ?? []).filter((x) => x !== s))}
            />
          ))}
        </div>
      ) : null}
      {data.pending.length > 0 ? (
        <div className="cy-list cy-suggest-list">
          <p className="cy-suggest-note" style={{ margin: '0 0 6px' }}>{t('dict.learnedFrom')}</p>
          {data.pending.map((entry) => (
            <div className="cy-cell" key={`${entry.term}>${entry.replacement}`}>
              <span>
                <s>{entry.term}</s>
                <span className="cy-arrow">→</span>
                <b>{entry.replacement}</b>
              </span>
              <span className="cy-suggest-actions">
                <button
                  type="button"
                  className="cy-btn is-dark"
                  onClick={() => save({ ...data, dictionary: [entry, ...data.dictionary], pending: data.pending.filter((x) => x !== entry) })}
                >
                  {t('common.add')}
                </button>
                <button
                  type="button"
                  className="cy-x"
                  aria-label={t('common.ignore', { name: entry.term })}
                  onClick={() => save({ ...data, pending: data.pending.filter((x) => x !== entry) })}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {data.dictionary.length === 0 ? (
        <EmptyState>{t('dict.empty')}</EmptyState>
      ) : (
        <div className="cy-list">
          {data.dictionary.map((entry, index) => (
            <div className="cy-cell" key={`${entry.term}-${index}`}>
              <span>
                {entry.term}
                {entry.replacement ? <><span className="cy-arrow">→</span>{entry.replacement}</> : null}
              </span>
              <button type="button" className="cy-x" aria-label={t('common.remove', { name: entry.term })} onClick={() => save({ ...data, dictionary: data.dictionary.filter((_, i) => i !== index) })}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
