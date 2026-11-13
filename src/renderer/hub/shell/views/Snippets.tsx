import { useState, type ReactElement } from 'react'
import { EmptyState } from '../EmptyState'
import { usePersonalization } from '../usePersonalization'
import { t } from '@/lib/i18n'

export function Snippets(): ReactElement {
  const [data, save, error] = usePersonalization()
  const [trigger, setTrigger] = useState('')
  const [text, setText] = useState('')

  function add(): void {
    if (!trigger.trim() || !text.trim()) return
    save({ ...data, snippets: [{ trigger: trigger.trim(), text: text.trim() }, ...data.snippets] })
    setTrigger('')
    setText('')
  }

  return (
    <div className="cy-page">
      <div className="cy-head">
        <h1 className="cy-h1">{t('page.snippets')}</h1>
      </div>
      <p style={{ marginTop: 0, color: 'var(--cy-ink-2)' }}>
        {t('snip.intro')}
      </p>
      <form className="cy-form" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input className="cy-input" value={trigger} placeholder={t('snip.triggerPh')} onChange={(e) => setTrigger(e.target.value)} />
        <input className="cy-input" value={text} placeholder={t('snip.textPh')} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="cy-btn is-dark">{t('common.add')}</button>
      </form>
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      {data.snippets.length === 0 ? (
        <EmptyState>{t('snip.empty')}</EmptyState>
      ) : (
        <div className="cy-list">
          {data.snippets.map((snippet, index) => (
            <div className="cy-cell" key={`${snippet.trigger}-${index}`}>
              <span><b>{snippet.trigger}</b><span className="cy-arrow">→</span>{snippet.text}</span>
              <button type="button" className="cy-x" aria-label={t('common.remove', { name: snippet.trigger })} onClick={() => save({ ...data, snippets: data.snippets.filter((_, i) => i !== index) })}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
