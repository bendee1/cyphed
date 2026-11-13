import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)')

/** Vrai si la touche est physiquement enfoncée à cet instant. */
export function isKeyDown(vk: number): boolean {
  return (GetAsyncKeyState(vk) & 0x8000) !== 0
}
