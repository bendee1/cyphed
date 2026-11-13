import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { BarState } from '@shared/types'
import { AnthropicCleanupProvider } from '../providers/anthropic'
import { copySelection, insertText } from './insertion'
import { dictionaryTerms, isBlockedApp, loadPersonalization } from './personalization'
import { captureForeground } from './context'
import { isTerminalApp } from './command-core'
import { tm } from '../lang'

/** Transforme le texte sélectionné dans l'application active. */
export class TransformService {
  private busy = false
  private hideToken = 0
  private readonly provider = new AnthropicCleanupProvider()

  constructor(private bar: BrowserWindow) {}

  private show(state: BarState): void {
    this.hideToken += 1
    if (!this.bar.isDestroyed()) this.bar.webContents.send(IPC.barState, state)
  }

  async run(index: number): Promise<void> {
    if (this.busy) return
    const personal = loadPersonalization()
    const transform = personal.transforms[index]
    if (!transform) return
    this.busy = true
    try {
      // La fenêtre visée est celle du raccourci : le résultat y retourne, même si on a changé de fenêtre entre-temps.
      const target = captureForeground()
      if (isBlockedApp(personal, target.processName)) throw new Error(tm('bar.tfBlocked', { app: target.processName }))
      // Ctrl+C dans un terminal interrompt le programme en cours : jamais.
      if (isTerminalApp(target.processName)) throw new Error(tm('bar.tfTerminal'))
      this.show({ phase: 'processing', level: 0 })
      const selected = (await copySelection()).trim()
      if (!selected) throw new Error(tm('bar.tfNoSelection'))
      const result = await this.provider.transform(
        selected,
        transform.prompt,
        dictionaryTerms(personal),
        15000,
        personal.voiceProfileEnabled ? personal.voiceProfile : ''
      )
      const inserted = await insertText(result, target.hwnd, target.hwndFocus)
      if (inserted === 'copied') {
        this.show({ phase: 'error', message: tm('bar.copiedPaste'), level: 0 })
        this.hideLater(3000)
        return
      }
      this.show({ phase: 'hidden', level: 0 })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[transform]', message)
      this.show({ phase: 'error', message, level: 0 })
      this.hideLater(2600)
    } finally {
      this.busy = false
    }
  }

  /** Masque la barre plus tard, sauf si une dictée l'a reprise entre-temps. */
  private hideLater(ms: number): void {
    const token = this.hideToken
    setTimeout(() => {
      if (token === this.hideToken) this.show({ phase: 'hidden', level: 0 })
    }, ms)
  }
}
