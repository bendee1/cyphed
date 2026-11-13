import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronUp, PenLine, Settings2, Volume2 } from 'lucide-react'
import type { BarReadAction, BarTransforms } from '@shared/ipc'
import type { BarState } from '@shared/types'
import { VoiceMark } from './VoiceMark'
import { micErrorMessage, startMic, type MicHandle } from './mic'
import { t, transformName } from '@/lib/i18n'

const HIDDEN: BarState = { phase: 'hidden', level: 0 }

export function BarApp() {
  const [state, setState] = useState<BarState>(HIDDEN)
  const micRef = useRef<MicHandle | null>(null)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const genRef = useRef(0)
  const queueRef = useRef(Promise.resolve())

  useEffect(() => {
    const offState = window.cyphed.onBarState(setState)
    const offCmd = window.cyphed.onBarCommand((command) => {
      queueRef.current = queueRef.current.then(async () => {
        if (command === 'start-mic') {
          const token = ++genRef.current
          try {
            await micRef.current?.stop()
            micRef.current = null
            const deviceId = await window.cyphed.getMicDevice().catch(() => '')
            const handle = await startMic(
              (pcm) => window.cyphed.sendAudioFrame(pcm),
              (level) => window.cyphed.sendAudioLevel(level),
              () => {
                if (token === genRef.current) window.cyphed.sendMicError(t('mic.unplugged'))
              },
              deviceId
            )
            if (token !== genRef.current) {
              await handle.stop()
              return
            }
            micRef.current = handle
            window.cyphed.sendMicReady()
          } catch (err) {
            if (token !== genRef.current) return
            window.cyphed.sendMicError(micErrorMessage(err))
          }
        }
        if (command === 'stop-mic') {
          genRef.current += 1
          try {
            await micRef.current?.stop()
          } finally {
            micRef.current = null
            window.cyphed.sendMicStopped()
          }
        }
      })
    })
    return () => {
      offState()
      offCmd()
      genRef.current += 1
      void micRef.current?.stop()
    }
  }, [])

  const idle = state.phase === 'hidden'
  const listening = state.phase === 'listening'
  const processing = state.phase === 'processing'
  const error = state.phase === 'error' || state.phase === 'tip'

  const [hover, setHover] = useState(false)
  const [menu, setMenu] = useState(false)
  const [readMenu, setReadMenu] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [tf, setTf] = useState<BarTransforms>({ transforms: [], auto: '' })
  const [lastAuto, setLastAuto] = useState('')
  const leaveTimer = useRef(0)

  const interactive = useCallback((on: boolean) => {
    window.cyphed?.setInteractive(on)
  }, [])

  const refresh = useCallback(async () => {
    const next = await window.cyphed?.getTransforms()
    if (!next) return
    setTf(next)
    if (next.auto) setLastAuto(next.auto)
  }, [])

  function enter(): void {
    window.clearTimeout(leaveTimer.current)
    if (!idle) return
    setHover(true)
    interactive(true)
  }

  function leave(): void {
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      setHover(false)
      setMenu(false)
      setReadMenu(false)
      interactive(false)
    }, 220)
  }

  useEffect(() => {
    if (!idle) {
      setHover(false)
      setMenu(false)
      interactive(false)
    }
  }, [idle, interactive])

  async function openMenu(): Promise<void> {
    if (!menu) await refresh()
    setReadMenu(false)
    setMenu((v) => !v)
  }

  async function openReadMenu(): Promise<void> {
    if (!readMenu) setSpeaking(Boolean(await window.cyphed.readerSpeaking().catch(() => false)))
    setMenu(false)
    setReadMenu((v) => !v)
  }

  function read(action: BarReadAction): void {
    setReadMenu(false)
    void window.cyphed.readAloud(action)
  }

  async function pick(id: string): Promise<void> {
    setLastAuto(id)
    await window.cyphed.setAutoTransform(id, tf.category)
    await refresh()
  }

  async function toggleAuto(): Promise<void> {
    const target = tf.auto ? '' : lastAuto || tf.transforms[0]?.id || ''
    await window.cyphed.setAutoTransform(target, tf.category)
    await refresh()
  }

  const expanded = idle && hover

  return (
    <div className="shell visible">
      <div className="dock" onPointerEnter={enter} onPointerLeave={leave}>
        {readMenu && expanded ? (
          <div className="menu" role="menu" aria-label={t('barui.read')}>
            {speaking ? (
              <>
                <button type="button" role="menuitem" className="menu-item" onClick={() => read('stop')}>
                  <span>{t('barui.stopReading')}</span>
                </button>
                <div className="menu-sep" />
              </>
            ) : null}
            <button type="button" role="menuitem" className="menu-item" onClick={() => read('selection')}>
              <span>{t('barui.readSelection')}</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => read('clipboard')}>
              <span>{t('barui.readClipboard')}</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => read('summary')}>
              <span>{t('barui.summarize')}</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => read('zone')}>
              <span>{t('barui.readZone')}</span>
            </button>
            <div className="menu-sep" />
            <p className="menu-hint">{t('barui.readHint')}</p>
          </div>
        ) : null}
        {menu && expanded ? (
          <div className="menu" role="menu">
            <div className="menu-row">
              <span>{t('barui.applyAfter')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(tf.auto)}
                className={`switch${tf.auto ? ' is-on' : ''}`}
                onClick={() => void toggleAuto()}
              />
            </div>
            {tf.category ? <p className="menu-hint">{t('barui.forApp', { category: t(`cat.${tf.category}`) })}</p> : null}
            <div className="menu-sep" />
            {tf.transforms.map((tr) => (
              <button type="button" role="menuitemradio" aria-checked={(tf.auto || lastAuto) === tr.id} className="menu-item" key={tr.id} onClick={() => void pick(tr.id)}>
                <span>{transformName(tr)}</span>
                {(tf.auto || lastAuto) === tr.id ? <Check size={15} /> : null}
              </button>
            ))}
            <div className="menu-sep" />
            <button type="button" className="menu-item" onClick={() => window.cyphed.openHub('transforms')}>
              <span className="menu-with-icon"><Settings2 size={15} /> {t('barui.configure')}</span>
            </button>
          </div>
        ) : null}
        <div className={`pill ${idle ? (expanded ? 'hover' : 'idle') : state.phase}`} data-phase={state.phase}>
          {idle ? (
            expanded ? (
              <>
                <button type="button" className="dock-btn is-mic" aria-label={t('barui.dictate')} onClick={() => window.cyphed.toggleDictation()}>
                  <VoiceMark level={0} active={false} />
                </button>
                <button type="button" className={`dock-btn${menu ? ' is-open' : ''}`} aria-label={t('barui.rewrites')} onClick={() => void openMenu()}>
                  <PenLine size={15} />
                </button>
                <button type="button" className="dock-btn is-small" aria-label={t('barui.rewritesMenu')} onClick={() => void openMenu()}>
                  <ChevronUp size={14} />
                </button>
                <button type="button" className={`dock-btn${readMenu ? ' is-open' : ''}`} aria-label={t('barui.read')} onClick={() => void openReadMenu()}>
                  <Volume2 size={15} />
                </button>
              </>
            ) : null
          ) : error ? (
            <p className="caption">{state.message ?? t('barui.error')}</p>
          ) : listening && state.message ? (
            <>
              <span className="mark-sm"><VoiceMark level={0} active /></span>
              <p className="caption" role="alert">{state.message}</p>
            </>
          ) : processing && state.message ? (
            <>
              <span className="mark-sm"><VoiceMark level={0} active={false} busy /></span>
              <p className="caption" role="status">{state.message}</p>
            </>
          ) : (
            <>
              <span className="mark-md"><VoiceMark level={state.level} active={listening} busy={processing} waveRef={waveRef} /></span>
              {listening || processing ? (
                <div className="wave" ref={waveRef} aria-hidden>
                  {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
                </div>
              ) : null}
              {processing ? <span className="sr-only" role="status">{t('barui.processing')}</span> : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
