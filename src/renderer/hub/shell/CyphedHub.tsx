import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { BarChart3, BookText, Mic, NotebookPen, Scissors, Settings as SettingsIcon, PenLine, Type, Volume2 } from 'lucide-react'
import type { HubStatus } from '@shared/ipc'
import { emptyHubStats, type BarState, type Insights, type RecordingMode } from '@shared/types'
import { CyphedMark } from '@/components/brand/CyphedMark'
import { hubApi } from '@/lib/bridge'
import { SettingsPanel } from '../Settings'
import { ReaderPanel } from '../Reader'
import { installTtsPlayer } from '../ttsPlayer'
import { InsightsView } from './InsightsView'
import { ScratchpadView } from './ScratchpadView'
import { BlockedApps } from './views/BlockedApps'
import { Dictionary } from './views/Dictionary'
import { Home, type Row } from './views/Home'
import { Snippets } from './views/Snippets'
import { StyleView } from './views/StyleView'
import { TransformsView } from './views/TransformsView'
import { formatHotkey, t } from '@/lib/i18n'
import type { TextKey } from '@shared/i18n/index'
import './hub.css'

type View = 'home' | 'insights' | 'dictionary' | 'snippets' | 'style' | 'transforms' | 'scratchpad' | 'reader'

const NAV: Array<{ id: View; label: TextKey; Icon: typeof Mic }> = [
  { id: 'home', label: 'nav.home', Icon: Mic },
  { id: 'insights', label: 'nav.insights', Icon: BarChart3 },
  { id: 'dictionary', label: 'nav.dictionary', Icon: BookText },
  { id: 'snippets', label: 'nav.snippets', Icon: Scissors },
  { id: 'style', label: 'nav.style', Icon: Type },
  { id: 'transforms', label: 'nav.transforms', Icon: PenLine },
  { id: 'scratchpad', label: 'nav.scratchpad', Icon: NotebookPen },
  { id: 'reader', label: 'nav.reader', Icon: Volume2 }
]

const EMPTY_STATUS: HubStatus = {
  hotkey: 'Control+Shift+Space',
  language: 'multi',
  cerebras: false,
  deepgram: false,
  mistral: false,
  elevenlabs: false,
  mock: false,
  count: 0,
  words: 0,
  stats: emptyHubStats()
}

export function CyphedHub(): ReactElement {
  const [view, setView] = useState<View>('home')
  const [status, setStatus] = useState<HubStatus>(EMPTY_STATUS)
  const [rows, setRows] = useState<Row[]>([])
  const [insights, setInsights] = useState<Insights | null>(null)
  const [bar, setBar] = useState<BarState>({ phase: 'hidden', level: 0 })
  const [showSettings, setShowSettings] = useState(false)
  const [mode, setMode] = useState<RecordingMode>('toggle')
  const live = Boolean(hubApi())

  const pull = useCallback(async () => {
    const api = hubApi()
    if (!api) return
    const [nextStatus, history, nextInsights, nextSettings] = await Promise.all([
      api.getStatus(),
      api.getHistory(''),
      api.getInsights(),
      api.getSettings?.().catch(() => null)
    ])
    setStatus(nextStatus)
    if (nextSettings) setMode(nextSettings.settings.mode)
    setRows(history)
    setInsights(nextInsights)
  }, [])

  useEffect(() => {
    if (!live) return
    void pull().catch(() => undefined)
    const api = hubApi()
    const offInvalidate = api?.onInvalidate(() => void pull().catch(() => undefined))
    const offBar = api?.onBarState(setBar)
    return () => {
      offInvalidate?.()
      offBar?.()
    }
  }, [live, pull])

  useEffect(() => (live ? installTtsPlayer() : undefined), [live])

  useEffect(() => hubApi()?.onNavigate?.((next) => { setShowSettings(false); setView(next) }), [live])

  useEffect(() => {
    if (!showSettings) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSettings])

  const listening = bar.phase === 'listening'
  const engineOk = status.deepgram || status.mock

  return (
    <div className="cy">
      <aside className="cy-side">
        <div className="cy-brand">
          <CyphedMark variant="dark" />
        </div>
        <nav className="cy-nav" aria-label={t('nav.label')}>
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
              <Icon className="cy-ico" aria-hidden />
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="cy-spacer" />
        <div className="cy-foot">
          <span
            className={`cy-live ${listening ? 'is-live' : engineOk ? 'is-on' : ''}`}
            role="status"
            title={listening ? t('status.listening') : bar.phase === 'processing' ? t('status.processing') : engineOk ? t('status.readyWith', { hotkey: formatHotkey(status.hotkey) }) : t('status.setup')}
            aria-label={listening ? t('status.listening') : engineOk ? t('status.ready') : t('status.setup')}
          />
          <button type="button" onClick={() => setShowSettings(true)}>
            <SettingsIcon className="cy-ico" aria-hidden />
            {t('nav.settings')}
          </button>
        </div>
      </aside>
      <main className="cy-main">
        {status.update ? <UpdateBanner version={status.update} dictating={bar.phase !== 'hidden'} /> : null}
        {view === 'home' ? <Home status={status} mode={mode} rows={rows} insights={insights} barPhase={bar.phase} onSettings={() => setShowSettings(true)} onChanged={() => void pull().catch(() => undefined)} /> : null}
        {view === 'dictionary' ? <Dictionary /> : null}
        {view === 'snippets' ? <Snippets /> : null}
        {view === 'style' ? <StyleView /> : null}
        {view === 'transforms' ? <TransformsView /> : null}
        {view === 'insights' ? <InsightsView /> : null}
        {view === 'scratchpad' ? <ScratchpadView /> : null}
        {view === 'reader' ? (
          <div className="cy-page">
            <ReaderPanel onDone={() => void pull().catch(() => undefined)} onNotice={() => undefined} />
          </div>
        ) : null}
      </main>
      {showSettings ? (
        <div className="cy-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowSettings(false) }}>
          <div className="cy-modal is-single" role="dialog" aria-modal="true" aria-label={t('nav.settings')}>
            <div className="cy-modal-body">
              <button type="button" className="cy-close" aria-label={t('common.close')} onClick={() => setShowSettings(false)}>×</button>
              <SettingsPanel onSaved={() => void pull().catch(() => undefined)} />
              <BlockedApps />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Une version téléchargée attend : on le dit, avec le bouton pour redémarrer (sinon elle s'installe à la fermeture). */
function UpdateBanner({ version, dictating }: { version: string; dictating: boolean }): ReactElement {
  const [busy, setBusy] = useState(false)
  return (
    <div className="cy-update" role="status">
      <span className="cy-update-dot" aria-hidden />
      <p>
        <strong>{t('update.banner', { version })}</strong> {t('update.bannerHint')}
      </p>
      <button
        type="button"
        className="cy-btn is-dark"
        disabled={busy || dictating}
        onClick={() => {
          setBusy(true)
          void hubApi()
            ?.installUpdate?.()
            .then((started) => {
              if (!started) setBusy(false)
            })
            .catch(() => setBusy(false))
        }}
      >
        {t('update.restart')}
      </button>
    </div>
  )
}
