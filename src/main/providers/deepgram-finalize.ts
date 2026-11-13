export type DeepgramLiveMessage = {
  type?: string
  is_final?: boolean
  speech_final?: boolean
  from_finalize?: boolean
  channel?: {
    alternatives?: Array<{ transcript?: string }>
  }
}

export type TranscriptFold = {
  committed: string
  interim: string
}

function transcriptOf(msg: DeepgramLiveMessage): string {
  return msg.channel?.alternatives?.[0]?.transcript ?? ''
}

export function foldTranscript(state: TranscriptFold, msg: DeepgramLiveMessage): TranscriptFold {
  if (msg.type && msg.type !== 'Results') return state
  const text = transcriptOf(msg)
  if (!text) return state
  if (msg.is_final) {
    return { committed: `${state.committed} ${text}`.trim(), interim: '' }
  }
  return { committed: state.committed, interim: text }
}

export function isFinalizeResult(msg: DeepgramLiveMessage): boolean {
  return msg.from_finalize === true
}

export function isCloseAck(msg: DeepgramLiveMessage): boolean {
  return msg.type === 'Metadata'
}

export async function closeAndCollect(
  sendClose: () => void,
  subscribe: (listener: (msg: DeepgramLiveMessage) => void) => () => void,
  getTranscript: () => string,
  metadataTimeoutMs: number
): Promise<string> {
  const pending = waitUntil(subscribe, isCloseAck, metadataTimeoutMs)
  sendClose()
  await pending
  return getTranscript()
}

export function waitUntil<T>(
  subscribe: (listener: (value: T) => void) => () => void,
  match: (value: T) => boolean,
  timeoutMs: number
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      off()
      resolve(value)
    }
    const off = subscribe((value) => {
      if (match(value)) finish(value)
    })
    const timer = setTimeout(() => finish(undefined), timeoutMs)
  })
}
