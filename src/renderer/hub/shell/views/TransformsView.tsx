import { useEffect, useState, type ReactElement } from 'react'
import { hubApi } from '@/lib/bridge'
import { formatHotkey, t, transformDescription, transformName } from '@/lib/i18n'
import { TRANSFORM_APP_CATEGORIES } from '@shared/types'
import { usePersonalization } from '../usePersonalization'

const COMMAND_KEY = '__command'
const INHERIT = '__inherit'
const NONE = '__none'

export function TransformsView(): ReactElement {
  const [data, save, error] = usePersonalization()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  const auto = data.autoTransform
  const autoEntry = data.transforms.find((tr) => tr.id === auto)
  const inheritedName = autoEntry ? transformName(autoEntry) : t('tf.byApp.none')
  const [capturing, setCapturing] = useState('')

  useEffect(() => {
    if (!capturing) return
    const api = hubApi()
    const off = api?.onHotkeyCapture((result) => {
      setCapturing('')
      if (result.ok && capturing === COMMAND_KEY) {
        save({ ...data, commandHotkey: result.accelerator })
      } else if (result.ok) {
        save({ ...data, transforms: data.transforms.map((t) => (t.id === capturing ? { ...t, hotkey: result.accelerator } : t)) })
      }
    })
    void api?.beginHotkeyCapture()
    return () => {
      off?.()
      void api?.cancelHotkeyCapture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing])

  function create(): void {
    if (!name.trim() || !prompt.trim()) return
    const id = `custom-${Date.now().toString(36)}`
    save({ ...data, transforms: [...data.transforms, { id, name: name.trim(), description: t('tf.custom'), prompt: prompt.trim() }] })
    setName('')
    setPrompt('')
    setCreating(false)
  }

  return (
    <div className="cy-page">
      <div className="cy-head">
        <h1 className="cy-h1">{t('page.transforms')}</h1>
      </div>
      <p>{t('tf.intro')}</p>
      <div className="cy-auto">
        <div>
          <b>{t('tf.command.title')}</b>
          <span>{t('tf.command.desc')}</span>
        </div>
        <button
          type="button"
          className="cy-key-btn"
          onClick={() => setCapturing(capturing === COMMAND_KEY ? '' : COMMAND_KEY)}
          title={t('tf.command.keyTitle')}
        >
          {capturing === COMMAND_KEY ? t('tf.pressCombo') : formatHotkey(data.commandHotkey)}
        </button>
      </div>
      {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
      <div className="cy-head" style={{ marginTop: 28 }}>
        <h2 className="cy-h2">{t('tf.mine')}</h2>
        <button type="button" className="cy-btn is-dark" onClick={() => setCreating((v) => !v)}>
          {creating ? t('common.cancel') : t('tf.create')}
        </button>
      </div>
      {creating ? (
        <form className="cy-form cy-form-col" onSubmit={(e) => { e.preventDefault(); create() }}>
          <input className="cy-input" value={name} placeholder={t('tf.namePh')} onChange={(e) => setName(e.target.value)} />
          <textarea className="cy-input" rows={3} value={prompt} placeholder={t('tf.promptPh')} onChange={(e) => setPrompt(e.target.value)} />
          <button type="submit" className="cy-btn is-dark cy-form-submit">{t('common.save')}</button>
        </form>
      ) : null}
      <div className="cy-cards">
        {data.transforms.map((tr) => (
          <div className={`cy-card${auto === tr.id ? ' is-on' : ''}`} key={tr.id}>
            <b>{transformName(tr)}</b>
            <span>{transformDescription(tr) || tr.prompt.slice(0, 60)}</span>
            <button
              type="button"
              className="cy-key-btn"
              onClick={() => setCapturing(capturing === tr.id ? '' : tr.id)}
              title={t('tf.keyTitle')}
            >
              {capturing === tr.id ? t('tf.pressCombo') : formatHotkey(tr.hotkey || `Control+Alt+${data.transforms.indexOf(tr) + 1}`)}
            </button>
            <div className="cy-card-actions">
              <button type="button" onClick={() => save({ ...data, autoTransform: auto === tr.id ? '' : tr.id })}>
                {auto === tr.id ? t('tf.auto.on') : t('tf.auto.off')}
              </button>
              <button type="button" aria-label={t('common.remove', { name: transformName(tr) })} onClick={() => save({ ...data, transforms: data.transforms.filter((x) => x.id !== tr.id), autoTransform: auto === tr.id ? '' : auto })}>×</button>
            </div>
          </div>
        ))}
      </div>
      <h2 className="cy-h2 cy-byapp-title">{t('tf.byApp.title')}</h2>
      <p className="cy-byapp-sub">{t('tf.byApp.sub', { name: inheritedName })}</p>
      <div className="cy-byapp">
        {TRANSFORM_APP_CATEGORIES.map((category) => {
          const own = data.autoTransformByApp[category]
          return (
            <label key={category} className="cy-byapp-row">
              <span>
                <b>{t(`cat.${category}`)}</b>
                <small>{t(`cat.${category}.hint`)}</small>
              </span>
              <select
                className="cy-select"
                value={own === undefined ? INHERIT : own === '' ? NONE : own}
                onChange={(e) => {
                  const next = { ...data.autoTransformByApp }
                  if (e.target.value === INHERIT) delete next[category]
                  else next[category] = e.target.value === NONE ? '' : e.target.value
                  save({ ...data, autoTransformByApp: next })
                }}
              >
                <option value={INHERIT}>{t('tf.byApp.inherit')}</option>
                <option value={NONE}>{t('tf.byApp.none')}</option>
                {data.transforms.map((tr) => (
                  <option key={tr.id} value={tr.id}>{transformName(tr)}</option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </div>
  )
}
