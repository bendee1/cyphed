import { useState, type ReactElement } from 'react'
import { FuiHeading } from '@/components/fui'
import { usePersonalization } from '../usePersonalization'
import { t } from '@/lib/i18n'

export function BlockedApps(): ReactElement {
  const [data, save, error] = usePersonalization()
  const [name, setName] = useState('')

  function add(): void {
    const value = name.trim()
    if (!value) return
    save({ ...data, blockedApps: [...data.blockedApps, value] })
    setName('')
  }

  return (
    <section className="cy-blocked hub-settings">
      <FuiHeading eyebrow={t('blocked.ctx.eyebrow')} title={t('blocked.ctx.title')} />
      <label className="cy-voice-toggle">
        <input
          type="checkbox"
          checked={data.readContext}
          onChange={(e) => save({ ...data, readContext: e.target.checked })}
        />
        {t('blocked.ctx.toggle')}
      </label>
      <FuiHeading eyebrow={t('blocked.eyebrow')} title={t('blocked.title')} />
      <p>{t('blocked.intro')}</p>
      <form className="cy-form is-single" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input className="cy-input" value={name} placeholder={t('blocked.namePh')} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="is-ghost">{t('blocked.add')}</button>
      </form>
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      <div className="cy-chips">
        {data.blockedApps.map((app) => (
          <span className="cy-chip" key={app}>
            {app}
            <button type="button" aria-label={t('common.unblock', { app })} onClick={() => save({ ...data, blockedApps: data.blockedApps.filter((x) => x !== app) })}>×</button>
          </span>
        ))}
      </div>
    </section>
  )
}
