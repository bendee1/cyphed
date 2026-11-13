import type { TtsPlayPayload } from '@shared/ipc'
import { hubApi } from '@/lib/bridge'
import { t } from '@/lib/i18n'

export function installTtsPlayer(): () => void {
  const api = hubApi()
  if (!api || typeof api.onTtsPlay !== 'function') return () => undefined

  let current: HTMLAudioElement | null = null
  let currentId = ''
  let objectUrl = ''

  function release(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = ''
    if (current) {
      current.onended = null
      current.onerror = null
      current.pause()
    }
    current = null
    currentId = ''
  }

  const offPlay = api.onTtsPlay((payload: TtsPlayPayload) => {
    release()
    currentId = payload.id
    const blob = new Blob([new Uint8Array(payload.data)], { type: payload.mime || 'audio/mpeg' })
    objectUrl = URL.createObjectURL(blob)
    const audio = new Audio(objectUrl)
    current = audio
    audio.onended = () => {
      if (current !== audio) return
      const id = currentId
      release()
      api.sendTtsEnded(id)
    }
    audio.onerror = () => {
      if (current !== audio) return
      const id = currentId
      release()
      api.sendTtsError(id, t('tts.failed'))
    }
    void audio.play().catch((err: unknown) => {
      if (current !== audio) return
      const id = currentId
      release()
      api.sendTtsError(id, err instanceof Error ? err.message : t('tts.blocked'))
    })
  })

  const offStop = api.onTtsStop((id) => {
    if (id && currentId && id !== currentId) return
    release()
  })

  return () => {
    offPlay()
    offStop()
    release()
  }
}
