import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canShowTip,
  countChatDictation,
  EMPTY_TIPS,
  parseTipsState,
  recordTip,
  SEND_TIP_AFTER,
  TIP_GAP_MS,
  TIP_MAX
} from '../src/main/services/tips-core.ts'
import { HoldController } from '../src/main/services/hotkey-hold.ts'

describe('conseils', () => {
  it('un conseil à la fois, espacés, et chacun un nombre limité de fois', () => {
    let state = parseTipsState(null)
    const t0 = 1_000_000_000
    assert.equal(canShowTip(state, 'learned', t0), true)
    state = recordTip(state, 'learned', t0)
    assert.equal(canShowTip(state, 'hands-free', t0 + 1000), false)
    assert.equal(canShowTip(state, 'hands-free', t0 + TIP_GAP_MS), true)
    let t = t0
    for (let i = 1; i < TIP_MAX.learned; i++) {
      t += TIP_GAP_MS
      state = recordTip(state, 'learned', t)
    }
    assert.equal(canShowTip(state, 'learned', t + TIP_GAP_MS * 10), false)
  })

  it('« appuie sur Entrée » proposé après quelques messages, jamais à qui le dit déjà', () => {
    let state = { ...EMPTY_TIPS, shown: {} }
    for (let i = 0; i < SEND_TIP_AFTER; i++) state = countChatDictation(state, false)
    assert.equal(state.chatDictations, SEND_TIP_AFTER)
    state = countChatDictation(state, true)
    assert.equal(state.chatDictations, 0)
    assert.equal(canShowTip(state, 'send-enter', Date.now() + TIP_GAP_MS * 2), false)
  })

  it('lit un fichier abîmé sans planter', () => {
    assert.deepEqual(parseTipsState({ shown: { learned: 'x', 'hands-free': 1 }, lastAt: 'y' }), {
      shown: { 'hands-free': 1 },
      lastAt: 0,
      chatDictations: 0
    })
  })

  it('le maintien rapporte sa durée au relâchement (conseil mains libres)', () => {
    let now = 0
    let down = true
    let active = false
    let tick: (() => void) | null = null
    const held: number[] = []
    const hold = new HoldController({
      vks: () => [0x11, 0x20],
      isDown: () => down,
      now: () => now,
      isActive: () => active,
      toggle: () => {
        active = !active
      },
      setInterval: (fn) => {
        tick = fn
        return 1
      },
      clearInterval: () => {
        tick = null
      },
      onHeld: (ms) => held.push(ms)
    })
    hold.onPress()
    now += 70_000
    down = false
    tick?.()
    assert.deepEqual(held, [70_000])
  })
})
