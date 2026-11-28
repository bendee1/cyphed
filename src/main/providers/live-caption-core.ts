import type { LiveSttSession } from './stt.ts'

/** Au plus 30 s d'audio gardées en attendant que la session d'affichage soit prête (PCM 16 bits, 16 kHz). */
const MAX_PENDING_BYTES = 32000 * 30

/**
 * Dictée en fichier entier + texte en direct : le texte collé vient de `base` (le plus juste),
 * une seconde session en direct sert seulement à afficher les mots pendant qu'on parle.
 * L'affichage ne peut jamais faire échouer la dictée : une erreur de la session en direct est ignorée.
 */
export function withLiveCaption(base: LiveSttSession, openLive: () => Promise<LiveSttSession>, warn: (message: string) => void = () => {}): LiveSttSession {
  let live: LiveSttSession | null = null
  let done = false
  let pending: Buffer[] = []
  let pendingBytes = 0

  openLive().then(
    (session) => {
      if (done) {
        session.close()
        return
      }
      live = session
      for (const chunk of pending) session.send(chunk)
      pending = []
    },
    (err: unknown) => {
      pending = []
      warn(err instanceof Error ? err.message : String(err))
    }
  )

  const stopLive = (finish: boolean): void => {
    done = true
    pending = []
    const session = live
    live = null
    if (!session) return
    // À la fin, la session en direct reçoit son commit : les derniers mots s'affichent pendant le traitement.
    if (finish) void session.finalize().catch(() => session.close())
    else session.close()
  }

  return {
    provider: base.provider,
    model: base.model,
    send(pcm16) {
      base.send(pcm16)
      if (done) return
      if (live) live.send(pcm16)
      else if (pendingBytes + pcm16.length <= MAX_PENDING_BYTES) {
        pending.push(pcm16)
        pendingBytes += pcm16.length
      }
    },
    lost: base.lost ? () => base.lost?.() ?? false : undefined,
    finalize() {
      stopLive(true)
      return base.finalize()
    },
    close() {
      stopLive(false)
      base.close()
    }
  }
}
