import koffi from 'koffi'
import type { MouseBindings } from './mouse-bindings'

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const HookProc = koffi.proto('intptr __stdcall CyphedMouseHookProc(int nCode, uintptr wParam, void* lParam)')
const MsLlHook = koffi.struct('CyphedMsLlHook', {
  x: 'int32',
  y: 'int32',
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  extra: 'uintptr'
})

const SetWindowsHookExW = user32.func(
  'void* __stdcall SetWindowsHookExW(int idHook, CyphedMouseHookProc* lpfn, void* hMod, uint32 dwThreadId)'
)
const CallNextHookEx = user32.func('intptr __stdcall CallNextHookEx(void* hhk, int nCode, uintptr wParam, void* lParam)')
const UnhookWindowsHookEx = user32.func('int __stdcall UnhookWindowsHookEx(void* hhk)')
const GetModuleHandleW = kernel32.func('void* __stdcall GetModuleHandleW(void* name)')

const WH_MOUSE_LL = 14
const WM_MBUTTONDOWN = 0x0207
const WM_MBUTTONUP = 0x0208
const WM_XBUTTONDOWN = 0x020b
const WM_XBUTTONUP = 0x020c

let hook: unknown = null
let callback: unknown = null

/** Installe le crochet souris global (une seule fois). */
export function installMouseHook(bindings: MouseBindings): boolean {
  if (hook) return true
  try {
    callback = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
      try {
        // Un clic simulé par un autre logiciel (LLMHF_INJECTED) ne lance jamais une dictée.
        const injected = nCode >= 0 && (wParam === WM_MBUTTONDOWN || wParam === WM_MBUTTONUP || wParam === WM_XBUTTONDOWN || wParam === WM_XBUTTONUP)
          ? ((koffi.decode(lParam, MsLlHook) as { flags: number }).flags & 1) === 1
          : false
        if (nCode >= 0 && !injected) {
          let button = 0
          let isDown = false
          if (wParam === WM_MBUTTONDOWN || wParam === WM_MBUTTONUP) {
            button = 0x04
            isDown = wParam === WM_MBUTTONDOWN
          } else if (wParam === WM_XBUTTONDOWN || wParam === WM_XBUTTONUP) {
            const data = koffi.decode(lParam, MsLlHook) as { mouseData: number }
            button = data.mouseData >>> 16 === 1 ? 0x05 : 0x06
            isDown = wParam === WM_XBUTTONDOWN
          }
          if (button && bindings.handle(button, isDown)) return 1
        }
      } catch {
        /* ne jamais casser la chaîne de crochets */
      }
      return CallNextHookEx(hook, nCode, wParam, lParam)
    }, koffi.pointer(HookProc))
    hook = SetWindowsHookExW(WH_MOUSE_LL, callback, GetModuleHandleW(null), 0)
    return Boolean(hook)
  } catch (err) {
    console.warn('[mouse] crochet indisponible :', err instanceof Error ? err.message : err)
    hook = null
    return false
  }
}

export function removeMouseHook(): void {
  if (hook) {
    try {
      UnhookWindowsHookEx(hook)
    } catch {
      /* ignore */
    }
  }
  hook = null
}
