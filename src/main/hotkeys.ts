import { globalShortcut, type BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { inputToAccelerator, isHotkeyCancel, isModifierKey } from '@shared/hotkey'
import { acceleratorToVks, splitMouseAccelerator } from './hotkey-keys'
import { HoldController } from './services/hotkey-hold'
import { isKeyDown } from './services/keys'
import { MouseBindings } from './services/mouse-bindings'
import { installMouseHook } from './services/mouse-hook'
import { loadSettings } from './services/settings'
import { loadPersonalization } from './services/personalization'
import type { DictationService } from './services/dictation'
import type { TransformService } from './services/transform'
import { mainLang, tm } from './lang'
import { formatHotkey } from '../shared/i18n/index.ts'

export type Hotkeys = {
  /** Enregistre le raccourci de dictée et tous les autres. Faux si Windows refuse celui de dictée. */
  bind: (accelerator: string) => boolean
  /** Relit les raccourcis après une modification des Transforms. Rend ceux que Windows a refusés. */
  rebind: () => string[]
  /** Capture du prochain raccourci demandé par le Hub (clavier ou bouton de souris). */
  beginCapture: () => void
  cancelCapture: () => void
  /** Raccourci de dictée choisi (celui enregistré par `bind`, même si Windows l'a refusé : la barre le signale alors). */
  active: () => string
}

type Deps = {
  hub: BrowserWindow
  dictation: DictationService
  transformer: TransformService
  /** Ctrl+Alt+L : lire la sélection (ou le texte copié), ou arrêter la lecture. */
  readQuick?: () => void
}

export function createHotkeys({ hub, dictation, transformer, readQuick }: Deps): Hotkeys {
  let current = loadSettings().hotkey
  let capturing = false
  const mouse = new MouseBindings(isKeyDown)
  const registered = new Set<string>()

  /** Raccourci clavier (Electron) ou bouton de souris (crochet Windows). */
  function register(id: string, accelerator: string, run: () => void): boolean {
    if (splitMouseAccelerator(accelerator)) {
      if (!installMouseHook(mouse)) return false
      return mouse.set(id, accelerator, run)
    }
    try {
      const ok = globalShortcut.register(accelerator, run)
      if (ok) registered.add(accelerator)
      return ok
    } catch {
      return false
    }
  }

  /** Retire seulement les raccourcis posés ici : Échap, posé par la dictée en cours, doit rester. */
  function clear(): void {
    for (const accelerator of registered) globalShortcut.unregister(accelerator)
    registered.clear()
    mouse.clear()
  }

  const hold = new HoldController({
    vks: () => acceleratorToVks(current),
    isDown: (vk) => (vk >= 0x04 && vk <= 0x06 ? mouse.isButtonDown(vk) : isKeyDown(vk)),
    now: () => Date.now(),
    isActive: () => dictation.isActive(),
    toggle: () => dictation.toggle(),
    onHeld: (ms) => {
      if (ms >= 60_000) dictation.tip('hands-free', tm('tip.handsFree'))
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
  })

  function onDictationHotkey(): void {
    if (loadSettings().mode === 'push_to_talk') hold.onPress()
    else void dictation.toggle()
  }

  /** Raccourcis des Transforms : celui choisi, sinon Ctrl+Alt+1..9 selon la place dans la liste. */
  function bindTransforms(): string[] {
    const refused: string[] = []
    loadPersonalization().transforms.forEach((transform, index) => {
      const accelerator = transform.hotkey || (index < 9 ? `Control+Alt+${index + 1}` : '')
      if (!accelerator) return
      // Pas de transformation pendant une dictée : les deux se disputeraient le presse-papiers.
      const ok = register(`transform-${index}`, accelerator, () => {
        if (!dictation.isActive()) void transformer.run(index)
      })
      if (!ok && transform.hotkey) refused.push(accelerator)
    })
    return refused
  }

  /** Recoller, annuler, mode commande. Rend le raccourci de commande s'il est refusé. */
  function bindExtras(): string[] {
    const refused: string[] = []
    if (!register('paste-last', 'Control+Alt+V', () => void dictation.pasteLast())) refused.push('Control+Alt+V')
    if (!register('undo-last', 'Control+Alt+Z', () => void dictation.undoLast())) refused.push('Control+Alt+Z')
    if (readQuick && !register('read-quick', 'Control+Alt+L', readQuick)) refused.push('Control+Alt+L')
    const command = loadPersonalization().commandHotkey
    if (command && !register('command', command, () => void dictation.toggle('command'))) refused.push(command)
    return refused
  }

  /** Un raccourci pris par une autre appli ne doit pas mourir en silence : la barre le dit. */
  function warnRefused(refused: string[]): void {
    if (refused.length === 0) return
    const list = refused.map((a) => formatHotkey(a, mainLang())).join(', ')
    setTimeout(() => dictation.notify(tm('bar.hotkeyTaken', { list })), 1500)
  }

  function bind(accelerator: string): boolean {
    clear()
    current = accelerator
    const ok = register('dictation', accelerator, onDictationHotkey)
    warnRefused([...(ok ? [] : [accelerator]), ...bindTransforms(), ...bindExtras()])
    return ok
  }

  function rebind(): string[] {
    clear()
    const ok = register('dictation', current, onDictationHotkey)
    const refused = [...bindTransforms(), ...bindExtras()]
    if (!ok) warnRefused([current])
    return refused
  }

  function endCapture(result: { ok: true; accelerator: string } | { ok: false; reason: 'cancel' }): void {
    capturing = false
    mouse.cancelCapture()
    if (!hub.isDestroyed()) hub.webContents.send(IPC.hubHotkeyResult, result)
  }

  hub.webContents.on('before-input-event', (event, input) => {
    if (!capturing) return
    if (input.type !== 'keyDown') return
    if (isModifierKey(input)) return
    event.preventDefault()
    if (isHotkeyCancel(input)) {
      endCapture({ ok: false, reason: 'cancel' })
      return
    }
    const accelerator = inputToAccelerator({
      type: input.type,
      key: input.key,
      code: input.code,
      control: input.control,
      alt: input.alt,
      shift: input.shift,
      meta: input.meta
    })
    if (!accelerator) return
    endCapture({ ok: true, accelerator })
  })

  return {
    bind,
    rebind,
    beginCapture() {
      capturing = true
      if (installMouseHook(mouse)) {
        mouse.capture((accelerator) => {
          if (capturing) endCapture({ ok: true, accelerator })
        })
      }
    },
    active: () => current,
    cancelCapture() {
      if (capturing) endCapture({ ok: false, reason: 'cancel' })
    }
  }
}
