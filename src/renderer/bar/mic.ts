import { copyPcm16, LevelLimiter, Pcm16Batcher } from '@shared/pcm-batch'
import { Pcm16Resampler } from '@shared/resample'
import { t } from '@/lib/i18n'

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.stopping = false
    this.port.onmessage = (event) => {
      if (event.data === 'drain') this.stopping = true
    }
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) {
      this.port.postMessage({ t: 'pcm', s: channel })
    }
    if (this.stopping) {
      this.port.postMessage({ t: 'eos' })
      return false
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

export type MicHandle = {
  stop: () => Promise<void>
}

/** Erreur du navigateur -> message qui dit quoi faire. */
export function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return t('mic.denied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('mic.none')
  if (name === 'NotReadableError' || name === 'AbortError') return t('mic.busy')
  return err instanceof Error && err.message ? t('mic.generic', { message: err.message }) : t('mic.unavailable')
}

/** Ouvre le micro choisi ; débranché ou introuvable, on bascule sur le micro par défaut de Windows. */
async function openStream(deviceId: string): Promise<MediaStream> {
  // Audio brut : les filtres du navigateur abîment la parole pour la reconnaissance (Deepgram conseille de les couper).
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: deviceId } }, video: false })
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? ''
      if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw err
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio, video: false })
}

export async function startMic(
  onPcm: (pcm: ArrayBuffer) => void,
  onLevel: (rms: number) => void,
  onEnded?: () => void,
  deviceId = ''
): Promise<MicHandle> {
  const stream = await openStream(deviceId)

  const ctx = new AudioContext()
  const resampler = new Pcm16Resampler(ctx.sampleRate)
  const blob = new Blob([WORKLET], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await ctx.audioWorklet.addModule(url)
  } catch (err) {
    // Sans ça, le micro resterait ouvert (voyant Windows allumé) après un échec.
    stream.getTracks().forEach((track) => track.stop())
    void ctx.close()
    throw err
  } finally {
    URL.revokeObjectURL(url)
  }
  // Micro débranché pendant la dictée : on le dit au lieu d'écouter le vide.
  for (const track of stream.getAudioTracks()) track.onended = () => onEnded?.()

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-capture')
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute)
  mute.connect(ctx.destination)

  const batcher = new Pcm16Batcher((pcm) => onPcm(copyPcm16(pcm)))
  const levels = new LevelLimiter(onLevel, 20)

  function ingest(samples: Float32Array): void {
    let sum = 0
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
    levels.push(Math.sqrt(sum / Math.max(1, samples.length)), performance.now())
    batcher.push(resampler.push(samples))
  }

  function drainCapture(): void {
    batcher.push(resampler.flush())
    batcher.flush()
  }

  node.port.onmessage = (event: MessageEvent<{ t?: string; s?: Float32Array }>) => {
    if (event.data?.t === 'pcm' && event.data.s) ingest(event.data.s)
  }

  return {
    async stop() {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer)
          node.port.onmessage = null
          drainCapture()
          resolve()
        }
        const timer = setTimeout(finish, 280)
        node.port.onmessage = (event: MessageEvent<{ t?: string; s?: Float32Array }>) => {
          if (event.data?.t === 'pcm' && event.data.s) ingest(event.data.s)
          if (event.data?.t === 'eos') finish()
        }
        node.port.postMessage('drain')
      })
      source.disconnect()
      node.disconnect()
      mute.disconnect()
      stream.getTracks().forEach((track) => {
        track.onended = null
        track.stop()
      })
      await ctx.close()
    }
  }
}
