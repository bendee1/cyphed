import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyHotkeyChange,
  codeToAcceleratorKey,
  inputToAccelerator,
  isHotkeyCancel,
  isModifierKey
} from '../src/shared/hotkey.ts'

describe('hotkey conversion', () => {
  it('maps physical codes so AZERTY Digit/Key stay valid accelerators', () => {
    assert.equal(codeToAcceleratorKey('KeyA'), 'A')
    assert.equal(codeToAcceleratorKey('Digit1'), '1')
    assert.equal(
      inputToAccelerator({
        type: 'keyDown',
        key: '&',
        code: 'Digit1',
        control: true,
        alt: false,
        shift: false,
        meta: false
      }),
      'Control+1'
    )
    assert.equal(
      inputToAccelerator({
        type: 'keyDown',
        key: 'a',
        code: 'KeyQ',
        control: true,
        alt: false,
        shift: false,
        meta: false
      }),
      'Control+Q'
    )
  })

  it('cancels on Escape and ignores modifier-only / invalid keys', () => {
    assert.equal(isHotkeyCancel({ key: 'Escape', code: 'Escape' }), true)
    assert.equal(isModifierKey({ key: 'Control', code: 'ControlLeft' }), true)
    assert.equal(
      inputToAccelerator({
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        control: true,
        alt: false,
        shift: false,
        meta: false
      }),
      null
    )
    assert.equal(
      inputToAccelerator({
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        control: false,
        alt: false,
        shift: false,
        meta: false
      }),
      null
    )
    assert.equal(
      inputToAccelerator({
        type: 'keyDown',
        key: 'Dead',
        code: 'IntlBackslash',
        control: true,
        alt: false,
        shift: false,
        meta: false
      }),
      null
    )
  })

  it('rolls back when register refuses the new accelerator', () => {
    const calls: string[] = []
    const refused = applyHotkeyChange('Control+PageUp', 'Control+F1', (accel) => {
      calls.push(accel)
      return accel === 'Control+PageUp'
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.hotkey, 'Control+PageUp')
    assert.match(refused.error ?? '', /Control\+F1/)
    assert.deepEqual(calls, ['Control+F1', 'Control+PageUp'])

    const ok = applyHotkeyChange('Control+PageUp', 'Control+Shift+L', () => true)
    assert.deepEqual(ok, { hotkey: 'Control+Shift+L', ok: true })
  })
})
