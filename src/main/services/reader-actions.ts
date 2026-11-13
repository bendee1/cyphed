import { clipboard, type BrowserWindow } from 'electron'
import type { BarReadAction } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import type { CaptureService } from './capture'
import type { DictationService } from './dictation'
import { copySelection } from './insertion'
import { captureForeground } from './context'
import { isTerminalApp } from './command-core'
import type { ReaderService } from './reader'
import { tm } from '../lang'

/** Plafond d'un texte envoyé à Lire depuis la barre (comme depuis le Hub). */
const MAX_READ_CHARS = 20_000

type Deps = {
  reader: ReaderService
  capture: CaptureService
  dictation: DictationService
  hub: BrowserWindow
  capturePreload: string
}

/**
 * Lire depuis la barre ou le raccourci : la sélection, le texte copié ou une zone de l'écran,
 * traduit en français si besoin, puis lu à voix haute. Le Hub n'a pas besoin d'être ouvert.
 */
export class ReaderActions {
  private readonly deps: Deps
  private busy = false

  constructor(deps: Deps) {
    this.deps = deps
  }

  speaking(): boolean {
    return this.deps.reader.speaking()
  }

  /** Raccourci : en cours de lecture, il arrête ; sinon il lit la sélection, à défaut le texte copié. */
  async quick(): Promise<void> {
    if (this.speaking()) {
      this.deps.reader.stopSpeak()
      return
    }
    // Dans un terminal, Ctrl+C interromprait le programme en cours : on lit le texte déjà copié.
    const selected = foregroundIsTerminal() ? '' : (await copySelection()).trim()
    await this.run(selected ? 'selection' : 'clipboard', selected)
  }

  async run(action: BarReadAction, alreadySelected = ''): Promise<void> {
    const { reader, dictation } = this.deps
    if (action === 'stop') {
      reader.stopSpeak()
      return
    }
    if (this.busy || dictation.isActive()) return
    this.busy = true
    reader.stopSpeak()
    try {
      if (action === 'zone') {
        const preview = await this.deps.capture.start(this.deps.capturePreload, this.deps.hub)
        if (!preview) return
        await this.readAndSpeak('read', { kind: 'zone' })
        return
      }
      if (action !== 'clipboard' && !alreadySelected && foregroundIsTerminal()) {
        dictation.notify(tm('bar.tfTerminal'))
        return
      }
      let text = action === 'clipboard' ? clipboard.readText() : alreadySelected || (await copySelection())
      text = text.trim()
      if (!text) {
        dictation.notify(action === 'clipboard' ? tm('bar.nothingCopied') : tm('bar.selectText'))
        return
      }
      const cut = text.length > MAX_READ_CHARS
      if (cut) text = text.slice(0, MAX_READ_CHARS)
      await this.readAndSpeak(action === 'summary' ? 'summarize' : 'read', { kind: 'text', text }, cut)
    } catch (err) {
      dictation.notify(err instanceof Error ? err.message : tm('bar.readFail'))
    } finally {
      this.busy = false
    }
  }

  private async readAndSpeak(
    action: 'read' | 'summarize',
    source: { kind: 'text'; text: string } | { kind: 'zone' },
    cut = false
  ): Promise<void> {
    const { reader, dictation, hub } = this.deps
    dictation.showBarState({ phase: 'processing', level: 0, message: action === 'summarize' ? tm('bar.summarizing') : tm('bar.preparing') })
    const result = await reader.run(action, source)
    if (!hub.isDestroyed()) hub.webContents.send(IPC.hubInvalidate)
    if (dictation.isActive()) return // une dictée a commencé pendant la préparation : ne pas parler par-dessus
    const note = cut ? tm('bar.tooLong') : result.fallback ? tm('bar.partialTranslation') : ''
    dictation.showBarState({ phase: 'tip', level: 0, message: tm('bar.reading', { note }) })
    setTimeout(() => {
      if (!dictation.isActive()) dictation.showBarState({ phase: 'hidden', level: 0 })
    }, 4000)
    void reader.speak(result.text).catch((err) => {
      dictation.notify(err instanceof Error ? err.message : tm('bar.speakFail'))
    })
  }
}

/** Ctrl+C dans un terminal interrompt le programme en cours : jamais de copie simulée là. */
function foregroundIsTerminal(): boolean {
  try {
    return isTerminalApp(captureForeground().processName)
  } catch {
    return false
  }
}
