import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { rememberOverlayId } from '../src/main/services/capture-overlay.ts'

describe('capture overlay lifetime', () => {
  it('does not read webContents after the window is destroyed', () => {
    let alive = true
    const listeners: Array<() => void> = []
    const win = {
      webContents: {
        get id(): number {
          if (!alive) throw new TypeError('Object has been destroyed')
          return 42
        }
      },
      on(_event: 'closed', listener: () => void) {
        listeners.push(listener)
      }
    }
    const removed: number[] = []
    const id = rememberOverlayId(win, {
      add: () => undefined,
      remove: (value) => removed.push(value)
    })
    assert.equal(id, 42)
    alive = false
    assert.doesNotThrow(() => listeners.forEach((fn) => fn()))
    assert.deepEqual(removed, [42])
  })
})
