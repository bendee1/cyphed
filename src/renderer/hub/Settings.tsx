import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { HubSettings, HubSettingsSave, TtsVoice } from '@shared/ipc'
import { AUDIO_KEEP_DAYS, DEFAULT_SETTINGS, type AppSettings, type RecordingMode, type SecretState, type SecretWrite, type VoiceRef } from '@shared/types'
import { parseVoiceKey, sameVoice, voiceKey } from '@shared/voice'
import { canSaveSettings, hubApi } from '@/lib/bridge'
import { FuiHeading } from '@/components/fui'
import { formatHotkey, t } from '@/lib/i18n'

const LANGS: Array<AppSettings['language']> = ['multi', 'fr', 'en']

const UI_LANGS: Array<AppSettings['uiLanguage']> = ['auto', 'fr', 'en']

const MODES: RecordingMode[] = ['toggle', 'push_to_talk']

const STT_ENGINES: Array<AppSettings['sttEngine']> = ['deepgram_file', 'deepgram', 'elevenlabs', 'elevenlabs_live', 'voxtral']

const CLEANUP_LEVELS: Array<AppSettings['cleanupLevel']> = ['none', 'light', 'normal']

const CLEANUP_ENGINES: Array<AppSettings['cleanupEngine']> = ['claude', 'openai']

/** Adresses tirées de la documentation de chaque fournisseur (DeepSeek et OpenCode Go vérifiés le 13 nov. 2026). */
const MODEL_PRESETS: Array<{ id: string; label?: string; url: string; model: string }> = [
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-flash' },
  { id: 'opencode', label: 'OpenCode Go', url: 'https://opencode.ai/inference/go/openai/v1', model: 'deepseek-v4.1-flash' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'local', url: 'http://localhost:11434/v1', model: '' }
]

/** Même règle que le main : HTTPS, ou http seulement vers ce PC. */
function modelUrlTarget(url: string): { ok: boolean; local: boolean } {
  try {
    const parsed = new URL(url.trim())
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    return { ok: parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local), local }
  } catch {
    return { ok: false, local: false }
  }
}

const FALLBACK_VOICES: TtsVoice[] = [
  { id: 'voice_592', name: 'Marie (FR)', provider: 'mistral' },
  { id: 'voice_3137', name: 'Manon (FR)', provider: 'mistral' },
  { id: 'voice_589', name: 'Lea (FR)', provider: 'mistral' },
  { id: 'voice_3141', name: 'Camille (FR)', provider: 'mistral' },
  { id: 'fr_marie_neutral', name: 'Marie, Neutral (FR), Voxtral 2', provider: 'mistral' },
  { id: 'en_paul_neutral', name: 'Paul, Neutral (EN), Voxtral 2', provider: 'mistral' }
]

const VOICE_GROUPS: Array<{ provider: TtsVoice['provider']; label: () => string }> = [
  { provider: 'mistral', label: () => t('set.voice.group.mistral') },
  { provider: 'elevenlabs', label: () => t('set.voice.group.elevenlabs') },
  { provider: 'pocket', label: () => t('set.voice.group.local') }
]

/** Voix rangées par fournisseur, dans l'ordre reçu (Mistral : la langue de l'interface en tête). */
function voiceOptions(voices: TtsVoice[], prefix: string): ReactElement[] {
  return VOICE_GROUPS.filter((group) => voices.some((voice) => voice.provider === group.provider)).map((group) => (
    <optgroup key={`${prefix}-${group.provider}`} label={group.label()}>
      {voices
        .filter((voice) => voice.provider === group.provider)
        .map((voice) => (
          <option key={`${prefix}-${voiceKey(voice)}`} value={voiceKey(voice)}>
            {voice.name.replace(/ — (ElevenLabs|Voxtral)$/, '').replace(' — ', ', ')}
          </option>
        ))}
    </optgroup>
  ))
}

function orphanVoice(voices: TtsVoice[], current: VoiceRef): ReactElement | null {
  if (voices.some((voice) => sameVoice(voice, current))) return null
  return <option value={voiceKey(current)}>{`${current.provider}:${current.id}`}</option>
}

function emptyDraft(): HubSettings {
  const blank: SecretState = { configured: false, source: null }
  return {
    settings: { ...DEFAULT_SETTINGS },
    deepgram: blank,
    cerebras: blank,
    mistral: blank,
    elevenlabs: blank,
    anthropic: blank,
    openai: blank
  }
}

function SecretField({
  label,
  hint,
  state,
  onSet,
  onClear
}: {
  label: string
  hint: string
  state: SecretState
  onSet: (value: string) => void
  onClear: () => void
}): ReactElement {
  const [replacing, setReplacing] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => {
    setReplacing(false)
    setValue('')
  }, [state.configured, state.source])

  if (state.configured && !replacing) {
    return (
      <div className="hub-field">
        <span>{label}</span>
        <div className="hub-secret-status">
          <strong>{t('set.key.configured')}</strong>
          {state.source === 'env' ? <small>· {t('set.key.env')}</small> : null}
          <button type="button" className="is-ghost" onClick={() => setReplacing(true)}>
            {t('set.key.replace')}
          </button>
          {state.source === 'stored' ? (
            <button type="button" className="is-ghost" onClick={onClear}>
              {t('set.key.clear')}
            </button>
          ) : null}
        </div>
        <small>{hint}</small>
      </div>
    )
  }

  return (
    <label className="hub-field">
      <span>{label}</span>
      <input
        className="cy-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={t('set.key.paste')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const next = value.trim()
          if (next) onSet(next)
        }}
      />
      <small>{state.configured ? t('set.key.replaceHint') : hint}</small>
    </label>
  )
}

export function SettingsPanel({
  onSaved,
  onHotkeyCapturing
}: {
  onSaved: () => void
  onHotkeyCapturing?: (active: boolean) => void
}): ReactElement {
  const [draft, setDraft] = useState<HubSettings>(emptyDraft)
  const [capturing, setCapturing] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [status, setStatus] = useState('')
  const [voices, setVoices] = useState<TtsVoice[]>(FALLBACK_VOICES)
  const [voiceError, setVoiceError] = useState('')
  const [previewing, setPreviewing] = useState<'' | 'lire' | 'assistant'>('')
  const [previewError, setPreviewError] = useState('')

  async function previewVoice(role: 'lire' | 'assistant'): Promise<void> {
    const api = hubApi()
    if (!api?.previewVoice) return
    if (previewing) {
      await api.stopSpeak?.()
      setPreviewing('')
      return
    }
    setPreviewError('')
    setPreviewing(role)
    try {
      await api.previewVoice(role)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setPreviewing('')
    }
  }
  const [mics, setMics] = useState<Array<{ id: string; label: string }>>([])

  // Micros branchés, relus quand on en branche ou débranche un.
  useEffect(() => {
    const devices = navigator.mediaDevices
    if (!devices?.enumerateDevices) return
    let alive = true
    const read = (): void => {
      void devices
        .enumerateDevices()
        .then((list) => {
          if (!alive) return
          setMics(
            list
              .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
              .map((d, i) => ({ id: d.deviceId, label: d.label || t('set.mic.n', { n: i + 1 }) }))
          )
        })
        .catch(() => undefined)
    }
    read()
    devices.addEventListener('devicechange', read)
    return () => {
      alive = false
      devices.removeEventListener('devicechange', read)
    }
  }, [])
  const api = hubApi()
  const connected = canSaveSettings(api)
  const seq = useRef(0)
  const keyTimer = useRef(0)
  const savedTimer = useRef(0)
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    return () => {
      window.clearTimeout(keyTimer.current)
      window.clearTimeout(savedTimer.current)
      void hubApi()?.cancelHotkeyCapture?.()
    }
  }, [])

  async function loadVoices(): Promise<void> {
    const current = hubApi()
    if (!current || typeof current.listVoices !== 'function') {
      setVoices(FALLBACK_VOICES)
      setVoiceError(t('set.voice.restartForEl'))
      return
    }
    try {
      const next = await current.listVoices()
      setVoices(next.length ? next : FALLBACK_VOICES)
      setVoiceError(next.length ? '' : t('set.voice.localList'))
    } catch {
      setVoices(FALLBACK_VOICES)
      setVoiceError(t('set.voice.apiDown'))
    }
  }

  useEffect(() => {
    const current = hubApi()
    if (!current || typeof current.getSettings !== 'function') {
      setSaveState('error')
      setStatus(t('set.restart'))
      return
    }
    void current
      .getSettings()
      .then((next) => {
        setDraft(next)
        void loadVoices()
      })
      .catch(() => {
        setSaveState('error')
        setStatus(t('set.status.loadFail'))
      })
  }, [])

  useEffect(() => {
    const current = hubApi()
    if (!current || typeof current.onHotkeyCapture !== 'function') return
    return current.onHotkeyCapture((result) => {
      setCapturing(false)
      onHotkeyCapturing?.(false)
      if (!result.ok) return
      const next = { ...draftRef.current, settings: { ...draftRef.current.settings, hotkey: result.accelerator } }
      setDraft(next)
      void persist(next)
    })
  }, [onHotkeyCapturing])

  async function persist(next: HubSettings): Promise<void> {
    const current = hubApi()
    if (!current || typeof current.saveSettings !== 'function') {
      window.clearTimeout(savedTimer.current)
      setSaveState('error')
      setStatus(t('set.restart'))
      return
    }
    const id = ++seq.current
    window.clearTimeout(savedTimer.current)
    setSaveState('saving')
    setStatus(t('set.status.saving'))
    try {
      const result = await current.saveSettings({
        settings: next.settings
      })
      if (id !== seq.current) return
      if (!result.ok) {
        setSaveState('error')
        setStatus(result.error)
        if (typeof current.getSettings === 'function') {
          const fresh = await current.getSettings()
          if (id !== seq.current) return
          setDraft(fresh)
        }
        return
      }
      if (typeof current.getSettings === 'function') {
        const fresh = await current.getSettings()
        if (id !== seq.current) return
        setDraft(fresh)
      }
      setSaveState('saved')
      setStatus(t('set.status.saved'))
      onSaved()
      void loadVoices()
      savedTimer.current = window.setTimeout(() => {
        setSaveState('idle')
        setStatus('')
      }, 2400)
    } catch (err) {
      if (id !== seq.current) return
      setSaveState('error')
      setStatus(err instanceof Error ? err.message : t('common.saveFail'))
    }
  }

  function setHotkeyMode(active: boolean): void {
    setCapturing(active)
    onHotkeyCapturing?.(active)
  }

  async function startHotkeyCapture(): Promise<void> {
    const current = hubApi()
    if (!current || typeof current.beginHotkeyCapture !== 'function') {
      setSaveState('error')
      setStatus(t('set.restart'))
      return
    }
    setHotkeyMode(true)
    await current.beginHotkeyCapture()
  }

  function cancelHotkeyCapture(): void {
    setHotkeyMode(false)
    void hubApi()?.cancelHotkeyCapture?.()
  }

  const [modelUrl, setModelUrl] = useState('')
  const [modelName, setModelName] = useState('')
  useEffect(() => {
    setModelUrl(draft.settings.openaiBaseUrl)
    setModelName(draft.settings.openaiModel)
  }, [draft.settings.openaiBaseUrl, draft.settings.openaiModel])
  const urlTarget = modelUrlTarget(draft.settings.openaiBaseUrl)
  const missing = [
    urlTarget.ok ? '' : t('set.model.missing.url'),
    draft.settings.openaiModel ? '' : t('set.model.missing.name'),
    urlTarget.local || draft.openai.configured ? '' : t('set.model.missing.key')
  ].filter(Boolean)

  function patchSettings(partial: Partial<AppSettings>): void {
    const next = { ...draft, settings: { ...draft.settings, ...partial } }
    setDraft(next)
    void persist(next)
  }

  async function persistSecret(name: 'deepgram' | 'cerebras' | 'mistral' | 'elevenlabs' | 'anthropic' | 'openai', write: SecretWrite): Promise<void> {
    const current = hubApi()
    if (!current || typeof current.saveSettings !== 'function') {
      setSaveState('error')
      setStatus(t('set.restart'))
      return
    }
    const id = ++seq.current
    setSaveState('saving')
    setStatus(t('set.status.saving'))
    try {
      const payload: HubSettingsSave = { settings: draft.settings, [name]: write }
      const result = await current.saveSettings(payload)
      if (id !== seq.current) return
      if (!result.ok) {
        setSaveState('error')
        setStatus(result.error)
        return
      }
      const fresh = await current.getSettings()
      if (id !== seq.current) return
      setDraft(fresh)
      setSaveState('saved')
      setStatus(t('set.status.saved'))
      onSaved()
      savedTimer.current = window.setTimeout(() => {
        setSaveState('idle')
        setStatus('')
      }, 2400)
    } catch (err) {
      if (id !== seq.current) return
      setSaveState('error')
      setStatus(err instanceof Error ? err.message : t('common.saveFail'))
    }
  }

  return (
    <form
      className="hub-settings"
      onSubmit={(event) => {
        event.preventDefault()
        void persist(draft)
      }}
    >
      <h1>{t('set.title')}</h1>
      <p>{connected ? t('set.introLive') : t('set.introOff')}</p>

      <FuiHeading eyebrow={t('set.dictation.eyebrow')} title={t('set.dictation.title')} />

      <div className="hub-field">
        <span>{t('set.hotkey')}</span>
        <p aria-live="polite">{capturing ? t('set.hotkey.press') : formatHotkey(draft.settings.hotkey)}</p>
        {capturing ? (
          <button type="button" className="is-ghost" onClick={cancelHotkeyCapture}>
            {t('common.cancel')}
          </button>
        ) : (
          <button type="button" className="is-ghost" onClick={() => void startHotkeyCapture()}>
            {t('set.hotkey.edit')}
          </button>
        )}
        <small>{capturing ? t('set.hotkey.capturingHint') : t('set.hotkey.savedHint')}</small>
      </div>

      <fieldset className="hub-field">
        <legend>{t('set.lang.legend')}</legend>
        <div className="hub-seg">
          {LANGS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.settings.language === id}
              className={draft.settings.language === id ? 'is-on' : undefined}
              onClick={() => patchSettings({ language: id })}
            >
              {t(`set.lang.${id}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="hub-field">
        <legend>{t('set.ui.legend')}</legend>
        <div className="hub-seg">
          {UI_LANGS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.settings.uiLanguage === id}
              className={draft.settings.uiLanguage === id ? 'is-on' : undefined}
              onClick={() => patchSettings({ uiLanguage: id })}
            >
              {id === 'auto' ? t('set.ui.auto') : t(`set.lang.${id}`)}
            </button>
          ))}
        </div>
        <small>{t('set.ui.hint')}</small>
      </fieldset>

      <fieldset className="hub-field">
        <legend>{t('set.stt.legend')}</legend>
        <div className="hub-seg">
          {STT_ENGINES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.settings.sttEngine === id}
              className={draft.settings.sttEngine === id ? 'is-on' : undefined}
              onClick={() => patchSettings({ sttEngine: id })}
            >
              {t(`set.stt.${id}`)}
            </button>
          ))}
        </div>
        <small>{t(`set.stt.hint.${draft.settings.sttEngine}`)}</small>
      </fieldset>

      <fieldset className="hub-field">
        <legend>{t('set.mode.legend')}</legend>
        <div className="hub-seg">
          {MODES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.settings.mode === id}
              className={draft.settings.mode === id ? 'is-on' : undefined}
              onClick={() => patchSettings({ mode: id })}
            >
              {t(`set.mode.${id}`)}
            </button>
          ))}
        </div>
        <small>{t('set.mode.hint')}</small>
      </fieldset>

      <fieldset className="hub-field">
        <legend>{t('set.audio.legend')}</legend>
        <div className="hub-seg">
          {[
            { id: true, label: t('set.audio.yes', { days: AUDIO_KEEP_DAYS }) },
            { id: false, label: t('set.audio.no') }
          ].map((item) => (
            <button
              key={String(item.id)}
              type="button"
              aria-pressed={draft.settings.keepAudio === item.id}
              className={draft.settings.keepAudio === item.id ? 'is-on' : undefined}
              onClick={() => patchSettings({ keepAudio: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <small>{t('set.audio.hint')}</small>
      </fieldset>

      <label className="hub-field">
        <span>{t('set.mic')}</span>
        <select
          value={draft.settings.micDeviceId}
          aria-label={t('set.mic')}
          onChange={(event) => {
            const id = event.target.value
            patchSettings({ micDeviceId: id, micLabel: mics.find((m) => m.id === id)?.label ?? '' })
          }}
        >
          <option value="">{t('set.mic.default')}</option>
          {mics.map((mic) => (
            <option key={mic.id} value={mic.id}>
              {mic.label}
            </option>
          ))}
          {draft.settings.micDeviceId && !mics.some((m) => m.id === draft.settings.micDeviceId) ? (
            <option value={draft.settings.micDeviceId}>{t('set.mic.unplugged', { label: draft.settings.micLabel || t('set.mic.chosen') })}</option>
          ) : null}
        </select>
        <small>{t('set.mic.hint')}</small>
      </label>

      <fieldset className="hub-field">
        <legend>{t('set.cleanup.legend')}</legend>
        <div className="hub-seg">
          {CLEANUP_LEVELS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.settings.cleanupLevel === id}
              className={draft.settings.cleanupLevel === id ? 'is-on' : undefined}
              onClick={() => patchSettings({ cleanupLevel: id })}
            >
              {t(`set.cleanup.${id}`)}
            </button>
          ))}
        </div>
        <small>{t(`set.cleanup.hint.${draft.settings.cleanupLevel}`)}</small>
      </fieldset>

      <fieldset className="hub-field">
        <legend>{t('set.model.legend')}</legend>
        <div className="hub-seg">
          {CLEANUP_ENGINES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft.settings.cleanupEngine === id}
              className={draft.settings.cleanupEngine === id ? 'is-on' : undefined}
              onClick={() => patchSettings({ cleanupEngine: id })}
            >
              {t(`set.model.${id}`)}
            </button>
          ))}
        </div>
        <small>{t(`set.model.hint.${draft.settings.cleanupEngine}`)}</small>
      </fieldset>

      {draft.settings.cleanupEngine === 'openai' ? (
        <>
          <div className="hub-field">
            <span>{t('set.model.presets')}</span>
            <div className="hub-seg">
              {MODEL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={draft.settings.openaiBaseUrl === preset.url}
                  className={draft.settings.openaiBaseUrl === preset.url ? 'is-on' : undefined}
                  onClick={() => patchSettings({ openaiBaseUrl: preset.url, openaiModel: preset.model || draft.settings.openaiModel })}
                >
                  {preset.label ?? t('set.model.preset.local')}
                </button>
              ))}
            </div>
          </div>
          <label className="hub-field">
            <span>{t('set.model.url')}</span>
            <input
              className="cy-input"
              type="url"
              spellCheck={false}
              placeholder="https://api.deepseek.com"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              onBlur={() => { if (modelUrl.trim() !== draft.settings.openaiBaseUrl) patchSettings({ openaiBaseUrl: modelUrl.trim() }) }}
            />
            <small>{modelUrl.trim() && !modelUrlTarget(modelUrl).ok ? t('set.model.url.bad') : t('set.model.url.hint')}</small>
          </label>
          <label className="hub-field">
            <span>{t('set.model.name')}</span>
            <input
              className="cy-input"
              spellCheck={false}
              placeholder="deepseek-flash"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              onBlur={() => { if (modelName.trim() !== draft.settings.openaiModel) patchSettings({ openaiModel: modelName.trim() }) }}
            />
            <small>{t('set.model.name.hint')}</small>
          </label>
          <SecretField
            label={t('set.model.key')}
            hint={t('set.model.key.hint')}
            state={draft.openai}
            onSet={(value) => void persistSecret('openai', { set: value })}
            onClear={() => void persistSecret('openai', { clear: true })}
          />
          <p className="hub-note" role="status">
            {missing.length > 0 ? t('set.model.inactive', { missing: missing.join(', ') }) : t('set.model.privacy')}
          </p>
        </>
      ) : null}

      <FuiHeading eyebrow={t('set.keys.eyebrow')} title={t('set.keys.title')} />

      <SecretField
        label="Deepgram"
        hint={t('set.key.deepgram.hint')}
        state={draft.deepgram}
        onSet={(value) => void persistSecret('deepgram', { set: value })}
        onClear={() => void persistSecret('deepgram', { clear: true })}
      />
      <SecretField
        label="Mistral"
        hint={t('set.key.mistral.hint')}
        state={draft.mistral}
        onSet={(value) => void persistSecret('mistral', { set: value })}
        onClear={() => void persistSecret('mistral', { clear: true })}
      />
      <SecretField
        label="ElevenLabs"
        hint={t('set.key.elevenlabs.hint')}
        state={draft.elevenlabs}
        onSet={(value) => void persistSecret('elevenlabs', { set: value })}
        onClear={() => void persistSecret('elevenlabs', { clear: true })}
      />
      <SecretField
        label="Anthropic (Claude Haiku)"
        hint={t('set.key.anthropic.hint')}
        state={draft.anthropic}
        onSet={(value) => void persistSecret('anthropic', { set: value })}
        onClear={() => void persistSecret('anthropic', { clear: true })}
      />
      <SecretField
        label="Cerebras"
        hint={t('set.key.cerebras.hint')}
        state={draft.cerebras}
        onSet={(value) => void persistSecret('cerebras', { set: value })}
        onClear={() => void persistSecret('cerebras', { clear: true })}
      />

      <FuiHeading eyebrow={t('set.voice.eyebrow')} title={t('set.voice.title')} />

      <label className="hub-field">
        <span>{t('set.voice.lire')}</span>
        <select
          value={voiceKey(draft.settings.lireVoice)}
          aria-label={t('set.voice.lire')}
          onChange={(event) => {
            const next = parseVoiceKey(event.target.value)
            if (next) patchSettings({ lireVoice: next })
          }}
        >
          {voiceOptions(voices, 'lire')}
          {orphanVoice(voices, draft.settings.lireVoice)}
        </select>
        <VoicePreviewButton role="lire" previewing={previewing} onPreview={previewVoice} />
        <small>{t('set.voice.lire.hint')}</small>
      </label>

      <label className="hub-field">
        <span>{t('set.voice.assistant')}</span>
        <select
          value={voiceKey(draft.settings.assistantVoice)}
          aria-label={t('set.voice.assistant')}
          onChange={(event) => {
            const next = parseVoiceKey(event.target.value)
            if (next) patchSettings({ assistantVoice: next })
          }}
        >
          {voiceOptions(voices, 'asst')}
          {orphanVoice(voices, draft.settings.assistantVoice)}
        </select>
        <VoicePreviewButton role="assistant" previewing={previewing} onPreview={previewVoice} />
        {previewError ? <small role="alert">{previewError}</small> : null}
        <small>{t('set.voice.assistant.hint', { error: voiceError })}</small>
      </label>

      <button type="button" className="is-ghost" onClick={() => void loadVoices()}>
        {t('set.voice.reload')}
      </button>

      <p className={`hub-settings-status is-${saveState}`} aria-live="polite">
        {status || (connected ? '' : t('set.status.needElectron'))}
      </p>
    </form>
  )
}

function VoicePreviewButton({ role, previewing, onPreview }: { role: 'lire' | 'assistant'; previewing: '' | 'lire' | 'assistant'; onPreview: (role: 'lire' | 'assistant') => Promise<void> }): ReactElement {
  const active = previewing === role
  return (
    <button type="button" className="is-ghost hub-voice-preview" disabled={Boolean(previewing) && !active} onClick={() => void onPreview(role)}>
      {active ? t('set.voice.stop') : t('set.voice.listen')}
    </button>
  )
}
