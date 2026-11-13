import { addPending, learnFromCorrection, loadPersonalization, savePersonalization } from './personalization'
import { captureForeground } from './context'
import { sameWindow } from './insertion'
import { extractEditedSegment } from './edit-learn-core'
import type { UiaClient } from './uia'
import type { ContextCapture, DictationTarget } from './dictation-machine'

const CHECK_AFTER_MS = [6000, 18000, 45000]

/**
 * Après un collage, relit le champ quelques fois : si la personne a corrigé un mot de la dictée,
 * on le range dans les mots « à valider » du Dictionnaire. Rien n'est ajouté sans son accord.
 */
export class EditWatcher {
  private timers: NodeJS.Timeout[] = []
  private readonly uia: UiaClient
  private readonly onLearned: (added: Array<{ term: string; replacement?: string }>) => void

  constructor(uia: UiaClient, onLearned: (added: Array<{ term: string; replacement?: string }>) => void) {
    this.uia = uia
    this.onLearned = onLearned
  }

  watch(info: { text: string; capture: ContextCapture | null; target: DictationTarget | null }): void {
    this.stop()
    const { capture, target } = info
    if (!capture || target?.hwnd == null) return
    const beforeTail = capture.context.before
    const afterHead = capture.context.after
    const inserted = info.text.trim()
    if (inserted.length < 8) return
    for (const delay of CHECK_AFTER_MS) {
      this.timers.push(setTimeout(() => void this.check(target.hwnd, beforeTail, afterHead, inserted), delay))
    }
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  private async check(hwnd: unknown, beforeTail: string, afterHead: string, inserted: string): Promise<void> {
    try {
      if (!sameWindow(captureForeground().hwnd, hwnd)) return
      const snap = await this.uia.read(900)
      if (!snap || snap.password || !snap.supported) return
      const field = snap.text ?? snap.before + snap.selected + snap.after
      const segment = extractEditedSegment(field, beforeTail, afterHead, inserted)
      if (!segment || segment === inserted) return
      const learned = learnFromCorrection(inserted, segment)
      if (learned.length === 0) return
      const { next, added } = addPending(loadPersonalization(), learned)
      if (added.length === 0) return
      savePersonalization(next)
      this.stop()
      this.onLearned(added)
    } catch (err) {
      // L'apprentissage ne doit jamais gêner, mais une panne ne doit plus passer inaperçue.
      console.warn('[edit-watch]', err instanceof Error ? err.message : err)
    }
  }
}
