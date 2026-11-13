import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { acceleratorToVks } from '../src/main/hotkey-keys.ts'
import { HoldController } from '../src/main/services/hotkey-hold.ts'

function rig(vks: number[] | null = [0x11, 0x20]) {
  let now = 0
  let down = true
  let active = false
  let tick: (() => void) | null = null
  const calls: string[] = []
  const hold = new HoldController({
    vks: () => vks,
    isDown: () => down,
    now: () => now,
    isActive: () => active,
    toggle: () => {
      active = !active
      calls.push(active ? 'start' : 'stop')
    },
    setInterval: (fn) => {
      tick = fn
      return 1
    },
    clearInterval: () => {
      tick = null
    }
  })
  return {
    hold,
    calls,
    press: () => hold.onPress(),
    advance: (ms: number) => {
      now += ms
      tick?.()
    },
    release: () => {
      down = false
      tick?.()
    },
    setDown: (v: boolean) => {
      down = v
    }
  }
}

describe('accelerator keys', () => {
  it('maps modifiers, letters, named keys and F keys', () => {
    assert.deepEqual(acceleratorToVks('Control+Shift+Space'), [0x11, 0x10, 0x20])
    assert.deepEqual(acceleratorToVks('Control+PageUp'), [0x11, 0x21])
    assert.deepEqual(acceleratorToVks('Alt+F9'), [0x12, 0x78])
    assert.deepEqual(acceleratorToVks('Control+K'), [0x11, 0x4b])
    assert.equal(acceleratorToVks('Control+;'), null)
  })
})

describe('push to talk', () => {
  it('stops when released after a real hold', () => {
    const r = rig()
    r.press()
    r.advance(800)
    r.release()
    assert.deepEqual(r.calls, ['start', 'stop'])
  })

  it('a quick tap keeps listening (hands free), next press stops', () => {
    const r = rig()
    r.press()
    r.advance(120)
    r.release()
    assert.deepEqual(r.calls, ['start'])
    r.setDown(true)
    r.press()
    assert.deepEqual(r.calls, ['start', 'stop'])
  })

  it('ignores key auto-repeat while held', () => {
    const r = rig()
    r.press()
    r.press()
    r.press()
    assert.deepEqual(r.calls, ['start'])
  })

  it('falls back to toggle when the key is unknown', () => {
    const r = rig(null)
    r.press()
    r.press()
    assert.deepEqual(r.calls, ['start', 'stop'])
  })
})

describe('mouse accelerators', () => {
  it('recognises mouse buttons alone or with modifiers', async () => {
    const { splitMouseAccelerator } = await import('../src/main/hotkey-keys.ts')
    assert.deepEqual(splitMouseAccelerator('Mouse5'), { mods: [], button: 0x06 })
    assert.deepEqual(splitMouseAccelerator('Control+Mouse4'), { mods: [0x11], button: 0x05 })
    assert.equal(splitMouseAccelerator('Control+PageUp'), null)
    assert.equal(splitMouseAccelerator('Mouse4+Mouse5'), null)
    assert.deepEqual(acceleratorToVks('Mouse5'), [0x06])
  })

  it('swallows a bound button, fires once, and tracks its state', async () => {
    const { MouseBindings } = await import('../src/main/services/mouse-bindings.ts')
    let fired = 0
    const mouse = new MouseBindings(() => false)
    assert.equal(mouse.set('dictation', 'Mouse5', () => { fired++ }), true)
    assert.equal(mouse.handle(0x06, true), true)
    assert.equal(mouse.isButtonDown(0x06), true)
    assert.equal(mouse.handle(0x06, false), true)
    assert.equal(mouse.isButtonDown(0x06), false)
    await new Promise((r) => setImmediate(r))
    assert.equal(fired, 1)
    assert.equal(mouse.handle(0x05, true), false)
    assert.equal(mouse.handle(0x05, false), false)
  })

  it('needs the modifier to be held, and captures the next press', async () => {
    const { MouseBindings } = await import('../src/main/services/mouse-bindings.ts')
    let ctrl = false
    const mouse = new MouseBindings((vk) => vk === 0x11 && ctrl)
    mouse.set('a', 'Control+Mouse4', () => undefined)
    assert.equal(mouse.handle(0x05, true), false)
    mouse.handle(0x05, false)
    ctrl = true
    assert.equal(mouse.handle(0x05, true), true)
    mouse.handle(0x05, false)
    let got = ''
    mouse.capture((acc) => { got = acc })
    assert.equal(mouse.handle(0x06, true), true)
    await new Promise((r) => setImmediate(r))
    assert.equal(got, 'Control+Mouse5')
    assert.equal(mouse.isCapturing(), false)
  })

  it('describes to the mouse helper which buttons to swallow, and says when it changes', async () => {
    const { MouseBindings } = await import('../src/main/services/mouse-bindings.ts')
    const mouse = new MouseBindings(() => false)
    let changes = 0
    mouse.onChange(() => { changes++ })
    assert.equal(mouse.state(), 'state 0')
    mouse.set('dictation', 'Mouse4', () => undefined)
    mouse.set('read', 'Control+Mouse5', () => undefined)
    assert.equal(mouse.state(), 'state 0 5:;6:17')
    mouse.capture(() => undefined)
    assert.equal(mouse.state(), 'state 1 5:;6:17')
    mouse.handle(0x04, true)
    assert.equal(mouse.state(), 'state 0 5:;6:17')
    mouse.clear()
    assert.equal(mouse.state(), 'state 0')
    assert.equal(changes, 5)
  })

  it('follows the helper decision and releases everything when the helper dies', async () => {
    const { MouseBindings } = await import('../src/main/services/mouse-bindings.ts')
    let fired = 0
    let ctrl = true
    const mouse = new MouseBindings((vk) => vk === 0x11 && ctrl)
    mouse.set('a', 'Control+Mouse4', () => { fired++ })
    ctrl = false // relâché entre la décision du crochet et l'arrivée de l'événement
    mouse.fromHook(0x05, true, true)
    await new Promise((r) => setImmediate(r))
    assert.equal(fired, 1)
    assert.equal(mouse.isButtonDown(0x05), true)
    mouse.releaseAll()
    assert.equal(mouse.isButtonDown(0x05), false)
    mouse.fromHook(0x06, true, false)
    await new Promise((r) => setImmediate(r))
    assert.equal(fired, 1)
  })
})
