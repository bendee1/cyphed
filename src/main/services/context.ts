import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')
const psapi = koffi.load('psapi.dll')

const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, uint16* lpString, int nMaxCount)')
const GetWindowThreadProcessId = user32.func(
  'uint32 __stdcall GetWindowThreadProcessId(void* hWnd, uint32* lpdwProcessId)'
)
const GetGUIThreadInfo = user32.func('int __stdcall GetGUIThreadInfo(uint32 idThread, void* pgui)')
const OpenProcess = kernel32.func(
  'void* __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)'
)
const CloseHandle = kernel32.func('int __stdcall CloseHandle(void* hObject)')
const GetModuleBaseNameW = psapi.func(
  'uint32 __stdcall GetModuleBaseNameW(void* hProcess, void* hModule, uint16* lpBaseName, uint32 nSize)'
)

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const PROCESS_VM_READ = 0x0010

function utf16Buffer(maxChars: number): Buffer {
  return Buffer.alloc(maxChars * 2)
}

function readUtf16(buf: Buffer, chars: number): string {
  if (chars <= 0) return ''
  return buf.toString('utf16le', 0, chars * 2).replace(/\0+$/, '')
}

export type CapturedTarget = {
  hwnd: unknown
  hwndFocus: unknown
  title: string
  processName: string
}

function readFocusHwnd(threadId: number): unknown {
  // GUITHREADINFO is 72 bytes on Win64; hwndFocus sits at offset 16.
  const info = Buffer.alloc(72)
  info.writeUInt32LE(72, 0)
  if (!GetGUIThreadInfo(threadId, info)) return null
  const hwndFocus = info.readBigUInt64LE(16)
  return hwndFocus === 0n ? null : hwndFocus
}

export function captureForeground(): CapturedTarget {
  const hwnd = GetForegroundWindow()
  if (!hwnd) return { hwnd: null, hwndFocus: null, title: '', processName: '' }

  const titleBuf = utf16Buffer(512)
  const titleChars = GetWindowTextW(hwnd, titleBuf, 512)

  const pidBuf = Buffer.alloc(4)
  const threadId = GetWindowThreadProcessId(hwnd, pidBuf)
  const pid = pidBuf.readUInt32LE(0)
  const hwndFocus = readFocusHwnd(threadId) ?? hwnd

  let processName = ''
  if (pid) {
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid)
    if (handle) {
      const nameBuf = utf16Buffer(260)
      const n = GetModuleBaseNameW(handle, null, nameBuf, 260)
      processName = readUtf16(nameBuf, n)
      CloseHandle(handle)
    }
  }

  return {
    hwnd,
    hwndFocus,
    title: readUtf16(titleBuf, titleChars),
    processName
  }
}
