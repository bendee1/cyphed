import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LiveSttSession } from '../src/main/providers/stt.ts'
import { DictationMachine, cleanupTimeoutMs, type DictationHost } from '../src/main/services/dictation-machine.ts'

type FakeSession = LiveSttSession & {
  frames: Buffer[]
  closed: boolean
  finalized: boolean
}

function session(): FakeSession {
  const frames: Buffer[] = []
  const state = { closed: false, finalized: false }
  return {
    provider: 'mock',
    model: 'mock',
    frames,
    get closed() {
      return state.closed
    },
    get finalized() {
      return state.finalized
    },
    send(pcm) {
      frames.push(pcm)
    },
    async finalize() {
      state.finalized = true
      return frames.map((buf) => buf.toString()).join('') || 'ok'
    },
    close() {
      state.closed = true
    }
  }
}

function host(overrides: Partial<DictationHost> & { openStt: DictationHost['openStt'] }): {
  host: DictationHost
  commands: string[]
  states: Array<{ phase: string; scope: string; message?: string }>
  inserted: string[]
} {
  const commands: string[] = []
  const states: Array<{ phase: string; scope: string; message?: string }> = []
  const inserted: string[] = []
  return {
    commands,
    states,
    inserted,
    host: {
      cleanup: async (input) => ({ text: input.rawText, usedModel: false, latencyMs: null }),
      insert: async (text) => {
        inserted.push(text)
      },
      sendState: (state, scope) => {
        states.push({ phase: state.phase, scope, message: state.message })
      },
      sendCommand: (command) => {
        commands.push(command)
      },
      language: () => 'multi',
      captureTarget: () => ({ processName: 'Code', title: 'x' }),
      persist: () => undefined,
      showBar: () => undefined,
      hideBar: () => undefined,
      now: () => Date.now(),
      // Délais larges : un test ne doit pas échouer parce que la machine de test a ralenti 40 ms.
      readyTimeoutMs: 60_000,
      stoppedTimeoutMs: 60_000,
      prebufferMaxBytes: 4096,
      ...overrides
    }
  }
}

async function pump(): Promise<void> {
  await new Promise((r) => setImmediate(r))
}

describe('DictationMachine', () => {
  it('refuses to listen in a blocked app, without opening the mic', async () => {
    const env = host({ isBlocked: () => true, openStt: async () => session() })
    const machine = new DictationMachine(env.host)
    await machine.toggle()
    assert.equal(machine.getPhase(), 'idle')
    assert.deepEqual(env.commands, [])
    assert.ok(env.states.some((s) => s.phase === 'error'))
  })

  it('tells the user when the text could only be copied', async () => {
    const stt = session()
    const env = host({ openStt: async () => stt, insert: async () => 'copied' })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    const stop = machine.toggle()
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.equal(env.states.at(-1)?.phase, 'error')
    assert.equal(env.states.some((s) => s.phase === 'done'), false)
  })

  it('sends last frames before Finalize and does not listen before mic-ready', async () => {
    const stt = session()
    const env = host({ openStt: async () => stt })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    assert.ok(env.states.some((s) => s.phase === 'processing'))
    assert.equal(
      env.states.some((s) => s.phase === 'listening'),
      false
    )
    assert.deepEqual(env.commands, ['start-mic'])
    machine.onAudioFrame(Buffer.from('pre'))
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    assert.equal(machine.getPhase(), 'listening')
    machine.onAudioFrame(Buffer.from('live'))
    const stop = machine.toggle()
    machine.onAudioFrame(Buffer.from('tail'))
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.equal(stt.frames.map((buf) => buf.toString()).join(''), 'prelivetail')
    assert.equal(stt.finalized, true)
    assert.ok(stt.closed)
    assert.equal(stt.frames.at(-1)?.toString(), 'tail')
  })

  it('keeps the words said before Deepgram opened when released early', async () => {
    let release!: (value: LiveSttSession) => void
    const stt = session()
    const env = host({
      openStt: () =>
        new Promise<LiveSttSession>((resolve) => {
          release = resolve
        })
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    await pump()
    assert.equal(machine.getPhase(), 'starting')
    machine.onAudioFrame(Buffer.from('oui'))
    const stop = machine.toggle()
    await pump()
    assert.equal(machine.getPhase(), 'stopping')
    machine.onMicStopped()
    await pump()
    release(stt)
    await Promise.all([start, stop])
    assert.equal(stt.frames.map((b) => b.toString()).join(''), 'oui')
    assert.ok(stt.finalized, 'la session ouverte en retard est utilisée')
    assert.ok(stt.closed, 'WebSocket/session must not stay orphan')
    assert.deepEqual(env.inserted, ['oui'])
    assert.equal(machine.getPhase(), 'idle')
  })

  it('clé refusée après le relâchement : le vrai message, et rien de gardé', async () => {
    let fail!: (err: Error) => void
    let persisted = 0
    const env = host({
      openStt: () =>
        new Promise<LiveSttSession>((_resolve, reject) => {
          fail = reject
        }),
      persist: () => {
        persisted++
      },
      saveAudio: () => undefined
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    await pump()
    machine.onAudioLevel(0.2)
    for (let i = 0; i < 4; i++) machine.onAudioFrame(Buffer.alloc(8000))
    const stop = machine.toggle()
    await pump()
    machine.onMicStopped()
    await pump()
    fail(new Error('Clé Deepgram refusée'))
    await Promise.all([start, stop])
    assert.equal(persisted, 0)
    assert.ok(env.states.some((s) => s.phase === 'error' && s.message === 'Clé Deepgram refusée'))
    assert.equal(machine.getPhase(), 'idle')
  })

  it('micro muet : prévient pendant l’écoute, puis se tait quand le son revient', async () => {
    const env = host({ openStt: async () => session(), muteNoticeMs: 20 })
    const machine = new DictationMachine(env.host)
    void machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    await new Promise((r) => setTimeout(r, 40))
    const warned = env.states.filter((s) => s.phase === 'listening' && s.message)
    assert.equal(warned.length, 1)
    machine.onAudioLevel(0.2)
    const last = env.states.at(-1)
    assert.equal(last?.phase, 'listening')
    assert.equal(last?.message, undefined)
  })

  it('pas d’alerte « micro muet » quand le son arrive', async () => {
    const env = host({ openStt: async () => session(), muteNoticeMs: 20 })
    const machine = new DictationMachine(env.host)
    void machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    machine.onAudioLevel(0.1)
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(env.states.some((s) => s.message), false)
  })

  it('returns to idle when saving the dictation throws', async () => {
    const stt = session()
    const env = host({
      openStt: async () => stt,
      persist: () => {
        throw new Error('disque plein')
      }
    })
    const machine = new DictationMachine(env.host)
    await runDictation(machine)
    assert.equal(machine.getPhase(), 'idle')
    assert.equal(env.states.at(-1)?.phase, 'error')
    await runDictation(machine)
    assert.equal(env.inserted.length, 2, 'la dictée suivante marche encore')
  })

  it('Échap pendant l’écoute arrête le micro et ne colle rien', async () => {
    const stt = session()
    const env = host({ openStt: async () => stt })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    assert.equal(machine.cancel(), true)
    machine.onMicStopped()
    await start
    assert.equal(machine.getPhase(), 'idle')
    assert.ok(stt.closed)
    assert.deepEqual(env.inserted, [])
    assert.ok(env.commands.includes('stop-mic'))
  })

  it('Échap pendant le nettoyage : rien n’est collé', async () => {
    let machine!: DictationMachine
    const env = host({
      openStt: async () => session(),
      cleanup: async (input) => {
        machine.cancel()
        return { text: input.rawText, usedModel: false, latencyMs: null }
      }
    })
    machine = new DictationMachine(env.host)
    await runDictation(machine)
    assert.deepEqual(env.inserted, [])
    assert.equal(machine.getPhase(), 'idle')
  })

  it('dit « micro muet » quand aucun son n’est arrivé', async () => {
    const stt = session()
    stt.finalize = async () => ''
    const env = host({ openStt: async () => stt })
    const machine = new DictationMachine(env.host)
    const messages: string[] = []
    const send = env.host.sendState
    env.host.sendState = (state, scope) => {
      if (state.message) messages.push(state.message)
      send(state, scope)
    }
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    machine.onAudioLevel(0)
    const stop = machine.toggle()
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.match(messages.at(-1) ?? '', /Micro muet/)
  })

  it('champ mot de passe : rien au modèle, rien dans l’historique', async () => {
    let cleaned = 0
    let persisted = 0
    const env = host({
      openStt: async () => session(),
      captureContext: async () => ({ context: { before: '', selected: '', after: '' }, sensitive: true }),
      cleanup: async (input) => {
        cleaned++
        return { text: input.rawText, usedModel: false, latencyMs: null }
      },
      persist: () => {
        persisted++
      }
    })
    const machine = new DictationMachine(env.host)
    await runDictation(machine)
    assert.equal(cleaned, 0)
    assert.equal(persisted, 0)
    assert.deepEqual(env.inserted, ['ok'])
  })

  it('surfaces a mic error while starting and stays idle', async () => {
    const env = host({
      openStt: () => new Promise(() => undefined)
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicError('permission denied')
    await start
    assert.equal(machine.getPhase(), 'idle')
    assert.ok(env.states.some((s) => s.phase === 'error'))
  })

  it('times out if the mic never confirms ready', async () => {
    const env = host({
      openStt: () => new Promise(() => undefined),
      readyTimeoutMs: 15
    })
    const machine = new DictationMachine(env.host)
    await machine.toggle()
    assert.equal(machine.getPhase(), 'idle')
    assert.ok(env.states.some((s) => s.phase === 'error'))
    assert.ok(env.commands.includes('stop-mic'))
  })

  it('closes a deferred openStt after micError even if it later resolves', async () => {
    let resolveOpen!: (value: LiveSttSession) => void
    const stt = session()
    const env = host({
      openStt: () =>
        new Promise<LiveSttSession>((resolve) => {
          resolveOpen = resolve
        })
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicError('permission denied')
    await start
    assert.equal(machine.getPhase(), 'idle')
    resolveOpen(stt)
    await pump()
    await pump()
    assert.ok(stt.closed, 'late-resolved session after mic:error must close')
  })

  it('handles openStt rejection before micReady without unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      let rejectOpen!: (err: Error) => void
      const env = host({
        openStt: () =>
          new Promise<LiveSttSession>((_, reject) => {
            rejectOpen = reject
          })
      })
      const machine = new DictationMachine(env.host)
      const start = machine.toggle()
      await pump()
      assert.equal(machine.getPhase(), 'starting')
      rejectOpen(new Error('ws fail'))
      await start
      await pump()
      assert.equal(machine.getPhase(), 'idle')
      assert.ok(env.states.some((s) => s.phase === 'error'))
      assert.equal(rejections.length, 0, 'openStt rejection must be handled before mic:ready')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('ignores a second tap while stopping (rapid double-tap after listen)', async () => {
    const stt = session()
    const env = host({ openStt: async () => stt })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    await pump()
    const firstStop = machine.toggle()
    const secondStop = machine.toggle()
    machine.onAudioFrame(Buffer.from('x'))
    machine.onMicStopped()
    await Promise.all([start, firstStop, secondStop])
    assert.equal(stt.finalized, true)
    assert.equal(machine.getPhase(), 'idle')
  })
})

describe('cleanupTimeoutMs', () => {
  it('laisse plus de temps aux dictées longues, avec un plafond', () => {
    assert.ok(cleanupTimeoutMs(100) >= 4000)
    assert.ok(cleanupTimeoutMs(1200) > cleanupTimeoutMs(100))
    assert.ok(cleanupTimeoutMs(1200) >= 12000)
    assert.equal(cleanupTimeoutMs(100000), 20000)
  })
})

async function runDictation(machine: DictationMachine, kind: 'dictation' | 'command' = 'dictation'): Promise<void> {
  const start = machine.toggle(kind)
  await pump()
  machine.onMicReady()
  for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
  const stop = machine.toggle()
  machine.onMicStopped()
  await Promise.all([start, stop])
}

describe('contexte, commande, vérification', () => {
  const ctx = (before: string, after = '', selected = '') => ({ context: { before, selected, after }, token: 'snap' })

  it('donne le contexte au nettoyage et raccorde les espaces', async () => {
    const inputs: Array<unknown> = []
    const env = host({
      openStt: async () => session(),
      captureContext: async () => ctx('Bonjour'),
      cleanup: async (input) => {
        inputs.push(input.context)
        return { text: 'le monde', usedModel: true, latencyMs: 1, provider: 'anthropic' }
      }
    })
    await runDictation(new DictationMachine(env.host))
    assert.deepEqual(inputs[0], { before: 'Bonjour', selected: '', after: '' })
    assert.equal(env.inserted[0], ' le monde')
  })

  it('la dictée continue sans contexte si la lecture échoue', async () => {
    const env = host({
      openStt: async () => session(),
      captureContext: async () => {
        throw new Error('uia mort')
      }
    })
    await runDictation(new DictationMachine(env.host))
    assert.equal(env.inserted.length, 1)
  })

  it('le mode commande n’appelle pas le nettoyage et insère le résultat', async () => {
    let cleaned = false
    const env = host({
      openStt: async () => session(),
      captureContext: async () => ctx('', '', 'long texte'),
      cleanup: async (input) => {
        cleaned = true
        return { text: input.rawText, usedModel: false, latencyMs: null }
      },
      command: async () => ({ status: 'ok', text: 'court' })
    })
    await runDictation(new DictationMachine(env.host), 'command')
    assert.equal(cleaned, false)
    assert.deepEqual(env.inserted, ['court'])
  })

  it('une demande hors de portée affiche un message et n’insère rien', async () => {
    const env = host({
      openStt: async () => session(),
      command: async () => ({ status: 'unsupported', message: 'Je ne sais pas envoyer de mails.' })
    })
    await runDictation(new DictationMachine(env.host), 'command')
    assert.deepEqual(env.inserted, [])
    assert.equal(env.states.at(-1)?.phase === 'hidden' || env.states.some((s) => s.phase === 'error'), true)
  })

  it('une dictée avec sélection passe en commande quand l’aiguilleur le dit', async () => {
    const env = host({
      openStt: async () => session(),
      captureContext: async () => ctx('', '', 'un texte sélectionné'),
      route: async () => 'command',
      command: async () => ({ status: 'ok', text: 'réécrit' })
    })
    await runDictation(new DictationMachine(env.host))
    assert.deepEqual(env.inserted, ['réécrit'])
  })

  it('sans sélection, l’aiguilleur n’est jamais appelé', async () => {
    let routed = false
    const env = host({
      openStt: async () => session(),
      captureContext: async () => ctx('Salut '),
      route: async () => {
        routed = true
        return 'command'
      }
    })
    await runDictation(new DictationMachine(env.host))
    assert.equal(routed, false)
  })

  it('avertit quand le collage n’est pas confirmé, jamais quand il est inconnu', async () => {
    const notFound = host({ openStt: async () => session(), verifyInsert: async () => 'not-found' })
    await runDictation(new DictationMachine(notFound.host))
    for (let i = 0; i < 5; i++) await pump()
    assert.ok(notFound.states.filter((s) => s.phase === 'error').length >= 1)

    const unknown = host({ openStt: async () => session(), verifyInsert: async () => 'unknown' })
    await runDictation(new DictationMachine(unknown.host))
    for (let i = 0; i < 5; i++) await pump()
    assert.equal(unknown.states.some((s) => s.phase === 'error'), false)
  })

  it('réseau coupé : la dictée continue, rien n’est collé, elle est gardée avec son audio', async () => {
    const offline = Object.assign(new Error('Pas de connexion internet'), { retryable: true })
    const persisted: Array<{ id: string; finalText: string; failed?: string }> = []
    const saved: Array<{ id: string; bytes: number }> = []
    const env = host({
      openStt: async () => {
        throw offline
      },
      persist: (record) => {
        persisted.push({ id: record.id, finalText: record.finalText, failed: record.provenance?.failed })
      },
      saveAudio: (id, chunks) => {
        saved.push({ id, bytes: chunks.reduce((n, c) => n + c.length, 0) })
      }
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    assert.equal(machine.getPhase(), 'listening')
    machine.onAudioLevel(0.2)
    for (let i = 0; i < 4; i++) machine.onAudioFrame(Buffer.alloc(8000))
    const stop = machine.toggle()
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.deepEqual(env.inserted, [])
    assert.equal(persisted.length, 1)
    assert.equal(persisted[0].finalText, '')
    assert.equal(persisted[0].failed, 'Pas de connexion internet')
    assert.deepEqual(saved, [{ id: persisted[0].id, bytes: 32000 }])
    assert.equal(machine.getPhase(), 'idle')
  })

  it('audio non gardé (réglage) : la panne ne promet pas « gardée », rien dans l’historique', async () => {
    const offline = Object.assign(new Error('Pas de connexion internet'), { retryable: true })
    let persisted = 0
    const env = host({
      openStt: async () => {
        throw offline
      },
      persist: () => {
        persisted++
      },
      saveAudio: () => undefined,
      keepsAudio: () => false
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    machine.onAudioLevel(0.2)
    for (let i = 0; i < 4; i++) machine.onAudioFrame(Buffer.alloc(8000))
    const stop = machine.toggle()
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.equal(persisted, 0)
    assert.equal(env.states.some((s) => /Ctrl.Alt.V/.test(s.message ?? '')), false)
    assert.equal(machine.getPhase(), 'idle')
  })

  it('micro perdu en pleine dictée : ce qui a été dit est gardé à réessayer', async () => {
    const persisted: Array<{ failed?: string }> = []
    let savedBytes = 0
    const env = host({
      openStt: async () => session(),
      persist: (record) => {
        persisted.push({ failed: record.provenance?.failed })
      },
      saveAudio: (_id, chunks) => {
        savedBytes = chunks.reduce((n, c) => n + c.length, 0)
      }
    })
    const machine = new DictationMachine(env.host)
    void machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    assert.equal(machine.getPhase(), 'listening')
    machine.onAudioLevel(0.2)
    for (let i = 0; i < 4; i++) machine.onAudioFrame(Buffer.alloc(8000))
    machine.onMicError('Micro débranché')
    for (let i = 0; i < 10; i++) await pump()
    assert.equal(persisted.length, 1)
    assert.equal(persisted[0].failed, 'Micro débranché')
    assert.equal(savedBytes, 32000)
    assert.equal(machine.getPhase(), 'idle')
  })

  it('une dictée réussie garde son audio sous le même id', async () => {
    const stt = session()
    const ids: string[] = []
    const saved: string[] = []
    const env = host({
      openStt: async () => stt,
      persist: (record) => {
        ids.push(record.id)
      },
      saveAudio: (id) => {
        saved.push(id)
      }
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    machine.onAudioLevel(0.2)
    machine.onAudioFrame(Buffer.alloc(20000, 97))
    const stop = machine.toggle()
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.equal(ids.length, 1)
    assert.deepEqual(saved, ids)
  })

  it('clé refusée (pas une panne passagère) : pas de dictée gardée', async () => {
    const persisted: string[] = []
    const env = host({
      openStt: async () => {
        throw new Error('Clé Deepgram refusée')
      },
      persist: (record) => {
        persisted.push(record.id)
      }
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    await start
    for (let i = 0; i < 5; i++) await pump()
    assert.equal(machine.getPhase(), 'idle')
    assert.deepEqual(persisted, [])
  })

  it('« appuie sur Entrée » : la consigne n’est pas collée, Entrée part après le collage', async () => {
    const stt = session()
    stt.finalize = async () => 'On se voit demain, appuie sur Entrée.'
    let enter = 0
    const cleaned: string[] = []
    const env = host({
      openStt: async () => stt,
      cleanup: async (input) => {
        cleaned.push(input.rawText)
        return { text: input.rawText, usedModel: true, latencyMs: 1 }
      },
      pressEnter: () => {
        enter++
      }
    })
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    machine.onAudioLevel(0.2)
    const stop = machine.toggle()
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.deepEqual(cleaned, ['On se voit demain'])
    assert.deepEqual(env.inserted, ['On se voit demain'])
    assert.equal(enter, 1)
  })

  it('traitement lent : la barre le dit, sans bloquer le collage', async () => {
    const stt = session()
    const messages: string[] = []
    const env = host({
      openStt: async () => stt,
      slowNoticeMs: 5,
      cleanup: async (input) => {
        await new Promise((r) => setTimeout(r, 40))
        return { text: input.rawText, usedModel: true, latencyMs: 40 }
      }
    })
    const send = env.host.sendState
    env.host.sendState = (state, scope) => {
      if (state.phase === 'processing' && state.message) messages.push(state.message)
      send(state, scope)
    }
    const machine = new DictationMachine(env.host)
    const start = machine.toggle()
    await pump()
    machine.onMicReady()
    for (let i = 0; i < 15 && machine.getPhase() !== 'listening'; i++) await pump()
    machine.onAudioLevel(0.2)
    const stop = machine.toggle()
    machine.onMicStopped()
    await Promise.all([start, stop])
    assert.equal(messages.length, 1)
    assert.match(messages[0], /plus de temps/)
    assert.equal(env.inserted.length, 1)
  })
})
