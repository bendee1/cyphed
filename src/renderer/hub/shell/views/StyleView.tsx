import { useEffect, useState, type ReactElement } from 'react'
import type { StyleCategory, StyleTone } from '@shared/types'
import { hubApi } from '@/lib/bridge'
import { categoryHint, categoryLabel } from '../categories'
import { usePersonalization } from '../usePersonalization'
import { t } from '@/lib/i18n'

const CATEGORY_IDS: StyleCategory[] = ['personal', 'work', 'email', 'other']

const TONES: StyleTone[] = ['formal', 'casual', 'very_casual']

function VoiceProfileCard(): ReactElement {
  const [data, save, error] = usePersonalization()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    setDraft(data.voiceProfile)
  }, [data.voiceProfile])

  async function build(): Promise<void> {
    setBusy(true)
    setNote('')
    try {
      const result = await hubApi()?.buildVoiceProfile()
      if (!result) setNote(t('common.analysisUnavailable'))
      else if (!result.ok) setNote(result.error)
      else {
        setDraft(result.text)
        save({ ...data, voiceProfile: result.text })
        setNote(t('style.profile.done', { n: result.analyzed }))
      }
    } catch {
      setNote(t('common.analysisFail'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cy-voice">
      <div className="cy-voice-head">
        <div>
          <b>{t('style.profile.title')}</b>
          <span className="cy-voice-sub">{t('style.profile.sub')}</span>
        </div>
        <label className="cy-voice-toggle">
          <input
            type="checkbox"
            disabled={!draft.trim()}
            checked={data.voiceProfileEnabled && Boolean(draft.trim())}
            onChange={(e) => save({ ...data, voiceProfileEnabled: e.target.checked })}
          />
          {t('style.profile.on')}
        </label>
      </div>
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      <textarea
        className="cy-input cy-voice-text"
        rows={7}
        value={draft}
        placeholder={t('style.profile.placeholder')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== data.voiceProfile && save({ ...data, voiceProfile: draft })}
      />
      <div className="cy-suggest">
        <button type="button" className="cy-btn" disabled={busy} onClick={() => void build()}>
          {busy ? t('common.analyzing') : t('style.profile.build')}
        </button>
        <span className="cy-suggest-note">
          {note || t('style.profile.note')}
        </span>
      </div>
    </div>
  )
}

export function StyleView(): ReactElement {
  const [data, save, error] = usePersonalization()
  const [category, setCategory] = useState<StyleCategory>('personal')
  return (
    <div className="cy-page">
      <div className="cy-head">
        <h1 className="cy-h1">{t('page.style')}</h1>
      </div>
      <div className="cy-tabs" role="tablist">
        {CATEGORY_IDS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={category === id} onClick={() => setCategory(id)}>
            {categoryLabel(id)}
          </button>
        ))}
      </div>
      <p style={{ marginTop: 0, color: 'var(--cy-ink-2)' }}>{t('style.hint', { hint: categoryHint(category) })}</p>
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      <div className="cy-style-card">
        {TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            className="cy-choice"
            aria-pressed={data.styles[category] === tone}
            onClick={() => save({ ...data, styles: { ...data.styles, [category]: tone } })}
          >
            <div>
              <b>{t(`style.tone.${tone}`)}</b>
              <span className="cy-sample">{t(`style.sample.${tone}`)}</span>
            </div>
          </button>
        ))}
      </div>
      <VoiceProfileCard />
    </div>
  )
}
