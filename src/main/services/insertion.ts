import { clipboard, type NativeImage } from 'electron'
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void* hWnd)')
const AllowSetForegroundWindow = user32.func('bool __stdcall AllowSetForegroundWindow(uint32 dwProcessId)')
const SetFocus = user32.func('void* __stdcall SetFocus(void* hWnd)')
const GetWindowThreadProcessId = user32.func(
  'uint32 __stdcall GetWindowThreadProcessId(void* hWnd, uint32* lpdwProcessId)'
)
const AttachThreadInput = user32.func(
  'bool __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)'
)
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()')
const SendInput = user32.func('uint __stdcall SendInput(uint nInputs, void* pInputs, int cbSize)')
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()')

const OpenClipboard = user32.func('bool __stdcall OpenClipboard(void* hWndNewOwner)')
const EmptyClipboard = user32.func('bool __stdcall EmptyClipboard()')
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()')
const SetClipboardData = user32.func('void* __stdcall SetClipboardData(uint uFormat, void* hMem)')
const RegisterClipboardFormatW = user32.func('uint __stdcall RegisterClipboardFormatW(str16 lpszFormat)')
const GlobalAlloc = kernel32.func('void* __stdcall GlobalAlloc(uint uFlags, uintptr dwBytes)')
const GlobalLock = kernel32.func('void* __stdcall GlobalLock(void* hMem)')
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void* hMem)')
const GlobalFree = kernel32.func('void* __stdcall GlobalFree(void* hMem)')
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void* dst, const void* src, uintptr len)')

const INPUT_KEYBOARD = 1
const KEYEVENTF_KEYUP = 0x0002
const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_V = 0x56
const VK_C = 0x43
const VK_Z = 0x5a
const VK_RETURN = 0x0d
const VK_SHIFT = 0x10
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const INPUT_SIZE = 40
const ASFW_ANY = 0xffffffff
const CF_UNICODETEXT = 13
const GMEM_MOVEABLE = 0x0002
/** Délai avant de remettre le presse-papiers d'origine : l'appli cible doit avoir lu le nôtre. */
const RESTORE_AFTER_MS = 600

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function writeKey(buf: Buffer, index: number, vk: number, flags: number): void {
  const offset = index * INPUT_SIZE
  buf.writeUInt32LE(INPUT_KEYBOARD, offset)
  buf.writeUInt16LE(vk, offset + 8)
  buf.writeUInt16LE(0, offset + 10)
  buf.writeUInt32LE(flags, offset + 12)
}

/** Renvoie le nombre de touches réellement injectées (0 = bloqué, par ex. fenêtre administrateur). */
function sendKeys(pairs: Array<[number, number]>): number {
  const buf = Buffer.alloc(INPUT_SIZE * pairs.length)
  pairs.forEach(([vk, flags], i) => writeKey(buf, i, vk, flags))
  return Number(SendInput(pairs.length, buf, INPUT_SIZE))
}

/** Relâche les modificateurs encore tenus (fin d'un raccourci Ctrl+Alt+…), pour que l'appli reçoive bien Ctrl+V. */
const RELEASE_MODIFIERS: Array<[number, number]> = [
  [VK_MENU, KEYEVENTF_KEYUP],
  [VK_SHIFT, KEYEVENTF_KEYUP],
  [VK_LWIN, KEYEVENTF_KEYUP],
  [VK_RWIN, KEYEVENTF_KEYUP],
  [VK_CONTROL, KEYEVENTF_KEYUP]
]

function pasteKeys(): boolean {
  const keys: Array<[number, number]> = [
    ...RELEASE_MODIFIERS,
    [VK_CONTROL, 0],
    [VK_V, 0],
    [VK_V, KEYEVENTF_KEYUP],
    [VK_CONTROL, KEYEVENTF_KEYUP]
  ]
  return sendKeys(keys) === keys.length
}

/** Lets SetForegroundWindow succeed without ShowWindow (which restores fullscreen). */
function unlockForeground(): void {
  try {
    AllowSetForegroundWindow(ASFW_ANY)
  } catch {
    /* ignore */
  }
  sendKeys([[VK_MENU, KEYEVENTF_KEYUP]])
}

function focusTarget(hwnd: unknown, hwndFocus?: unknown): void {
  if (!hwnd) return

  unlockForeground()

  const pidBuf = Buffer.alloc(4)
  const targetThread = GetWindowThreadProcessId(hwnd, pidBuf)
  const ourThread = GetCurrentThreadId()
  const attached = Boolean(targetThread && targetThread !== ourThread)
  if (attached) AttachThreadInput(ourThread, targetThread, 1)

  SetForegroundWindow(hwnd)
  try {
    SetFocus(hwndFocus || hwnd)
  } catch {
    /* ignore */
  }

  if (attached) AttachThreadInput(ourThread, targetThread, 0)
}

export type InsertResult = 'pasted' | 'copied'

/** Compare deux handles de fenêtre (pointeurs koffi). */
export function sameWindow(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  try {
    return koffi.address(a as never) === koffi.address(b as never)
  } catch {
    return false
  }
}

export function foregroundWindow(): unknown {
  return GetForegroundWindow()
}

// ---------- Presse-papiers ----------

type ClipboardSnapshot = { text: string; html: string; rtf: string; image: NativeImage | null }

/** Garde tout ce qu'on sait remettre : texte, HTML, RTF, image. */
function snapshotClipboard(): ClipboardSnapshot {
  const formats = clipboard.availableFormats()
  return {
    text: clipboard.readText(),
    html: formats.includes('text/html') ? clipboard.readHTML() : '',
    rtf: formats.includes('text/rtf') ? clipboard.readRTF() : '',
    image: formats.some((f) => f.startsWith('image/')) ? clipboard.readImage() : null
  }
}

function restoreClipboard(snap: ClipboardSnapshot): void {
  const image = snap.image && !snap.image.isEmpty() ? snap.image : undefined
  if (!snap.html && !snap.rtf && !image) {
    if (snap.text) writePrivateText(snap.text)
    else clipboard.clear()
    return
  }
  clipboard.write({
    ...(snap.text ? { text: snap.text } : {}),
    ...(snap.html ? { html: snap.html } : {}),
    ...(snap.rtf ? { rtf: snap.rtf } : {}),
    ...(image ? { image } : {})
  })
}

function dwordHandle(value: number): unknown {
  const mem = GlobalAlloc(GMEM_MOVEABLE, 4)
  if (!mem) return null
  const ptr = GlobalLock(mem)
  if (!ptr) {
    GlobalFree(mem)
    return null
  }
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value, 0)
  RtlMoveMemory(ptr, buf, 4)
  GlobalUnlock(mem)
  return mem
}

/**
 * Écrit du texte dans le presse-papiers en demandant à Windows de ne pas le garder
 * dans l'historique (Win+V) ni de le synchroniser dans le cloud. Repli : écriture normale.
 */
/** Met un texte dans le presse-papiers sans le laisser dans l'historique Win+V. */
export function copyPrivate(text: string): void {
  writePrivateText(text)
}

function writePrivateText(text: string): void {
  let opened = false
  try {
    opened = Boolean(OpenClipboard(null))
    if (!opened) throw new Error('presse-papiers occupé')
    EmptyClipboard()
    const data = Buffer.from(`${text}\0`, 'utf16le')
    const mem = GlobalAlloc(GMEM_MOVEABLE, data.length)
    if (!mem) throw new Error('GlobalAlloc')
    const ptr = GlobalLock(mem)
    if (!ptr) {
      GlobalFree(mem)
      throw new Error('GlobalLock')
    }
    RtlMoveMemory(ptr, data, data.length)
    GlobalUnlock(mem)
    if (!SetClipboardData(CF_UNICODETEXT, mem)) {
      GlobalFree(mem)
      throw new Error('SetClipboardData')
    }
    for (const [name, value] of [
      ['ExcludeClipboardContentFromMonitorProcessing', 1],
      ['CanIncludeInClipboardHistory', 0],
      ['CanUploadToCloudClipboard', 0]
    ] as const) {
      const handle = dwordHandle(value)
      if (handle && !SetClipboardData(RegisterClipboardFormatW(name), handle)) GlobalFree(handle)
    }
    CloseClipboard()
    opened = false
  } catch {
    if (opened) CloseClipboard()
    clipboard.writeText(text)
  }
}

/** Une seule opération sur le presse-papiers à la fois, et une restauration en attente au plus. */
let clipboardChain: Promise<unknown> = Promise.resolve()
let pendingRestore: { timer: NodeJS.Timeout; snap: ClipboardSnapshot; ours: string } | null = null

function withClipboard<T>(fn: () => Promise<T>): Promise<T> {
  const run = clipboardChain.then(fn, fn)
  clipboardChain = run.catch(() => undefined)
  return run
}

/** Ce qu'il y avait avant nous : si une restauration attend encore, c'est son contenu, pas notre texte. */
function takeOriginal(): ClipboardSnapshot {
  if (pendingRestore) {
    clearTimeout(pendingRestore.timer)
    const { snap } = pendingRestore
    pendingRestore = null
    return snap
  }
  return snapshotClipboard()
}

function scheduleRestore(snap: ClipboardSnapshot, ours: string): void {
  const timer = setTimeout(() => {
    if (pendingRestore?.timer !== timer) return
    pendingRestore = null
    // La personne a copié autre chose entre-temps : on n'y touche pas.
    if (clipboard.readText() !== ours) return
    restoreClipboard(snap)
  }, RESTORE_AFTER_MS)
  pendingRestore = { timer, snap, ours }
}

/**
 * Colle le texte dans la fenêtre visée. Si Windows refuse de lui rendre le focus, ou bloque
 * la frappe simulée (fenêtre administrateur), on ne colle pas au hasard : le texte reste
 * dans le presse-papiers ('copied'). Le presse-papiers d'origine est remis en arrière-plan.
 */
export function insertText(text: string, targetHwnd?: unknown, focusHwnd?: unknown): Promise<InsertResult> {
  if (!text) return Promise.resolve('pasted')
  return withClipboard(async () => {
    const original = takeOriginal()
    writePrivateText(text)

    if (targetHwnd && !sameWindow(GetForegroundWindow(), targetHwnd)) {
      focusTarget(targetHwnd, focusHwnd)
      await sleep(80)
      if (!sameWindow(GetForegroundWindow(), targetHwnd)) {
        focusTarget(targetHwnd, focusHwnd)
        await sleep(120)
        if (!sameWindow(GetForegroundWindow(), targetHwnd)) return 'copied'
      }
    }
    if (!pasteKeys()) return 'copied'
    scheduleRestore(original, text)
    return 'pasted'
  })
}

/** Annule la dernière insertion (Ctrl+Z) dans l'application active. */
/** Touche Entrée (envoi d'un message après le collage). */
export function pressEnter(): void {
  sendKeys([...RELEASE_MODIFIERS, [VK_RETURN, 0], [VK_RETURN, KEYEVENTF_KEYUP]])
}

export async function undoLastInsert(): Promise<void> {
  await sleep(150)
  sendKeys([...RELEASE_MODIFIERS, [VK_CONTROL, 0], [VK_Z, 0], [VK_Z, KEYEVENTF_KEYUP], [VK_CONTROL, KEYEVENTF_KEYUP]])
}

/** Copie la sélection du champ actif (Ctrl+C), puis remet le presse-papiers d'origine. */
export function copySelection(): Promise<string> {
  return withClipboard(async () => {
    const original = takeOriginal()
    const sentinel = `__cyphed_${Date.now()}__`
    writePrivateText(sentinel)
    await sleep(150)
    sendKeys([...RELEASE_MODIFIERS, [VK_CONTROL, 0], [VK_C, 0], [VK_C, KEYEVENTF_KEYUP], [VK_CONTROL, KEYEVENTF_KEYUP]])
    let copied = ''
    for (let i = 0; i < 12; i++) {
      await sleep(40)
      const now = clipboard.readText()
      if (now && now !== sentinel) {
        copied = now
        break
      }
    }
    restoreClipboard(original)
    return copied
  })
}
