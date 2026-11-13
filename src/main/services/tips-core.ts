// Conseils montrés dans la barre : un seul à la fois, jamais deux de suite trop vite,
// et chacun un nombre limité de fois. Pur, testable avec `node --test`.

export type TipId = 'hands-free' | 'learned' | 'send-enter'

/** Nombre maximal d'affichages par conseil. */
export const TIP_MAX: Record<TipId, number> = { 'hands-free': 2, learned: 3, 'send-enter': 2 }

/** Écart minimal entre deux conseils. */
export const TIP_GAP_MS = 10 * 60_000

/** Dictées en messagerie ou chez un assistant IA avant de proposer « appuie sur Entrée ». */
export const SEND_TIP_AFTER = 5

export type TipsState = {
  shown: Partial<Record<TipId, number>>
  lastAt: number
  /** Dictées en messagerie ou IA sans « appuie sur Entrée », depuis le dernier conseil d'envoi. */
  chatDictations: number
}

export const EMPTY_TIPS: TipsState = { shown: {}, lastAt: 0, chatDictations: 0 }

export function parseTipsState(raw: unknown): TipsState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_TIPS, shown: {} }
  const value = raw as Partial<TipsState>
  const shown: Partial<Record<TipId, number>> = {}
  for (const id of Object.keys(TIP_MAX) as TipId[]) {
    const n = value.shown?.[id]
    if (typeof n === 'number' && n > 0) shown[id] = Math.floor(n)
  }
  return {
    shown,
    lastAt: typeof value.lastAt === 'number' ? value.lastAt : 0,
    chatDictations: typeof value.chatDictations === 'number' ? value.chatDictations : 0
  }
}

/** Ce conseil peut-il s'afficher maintenant ? */
export function canShowTip(state: TipsState, id: TipId, now: number): boolean {
  if ((state.shown[id] ?? 0) >= TIP_MAX[id]) return false
  return now - state.lastAt >= TIP_GAP_MS
}

export function recordTip(state: TipsState, id: TipId, now: number): TipsState {
  return {
    ...state,
    shown: { ...state.shown, [id]: (state.shown[id] ?? 0) + 1 },
    lastAt: now,
    chatDictations: id === 'send-enter' ? 0 : state.chatDictations
  }
}

/** Compte une dictée en messagerie ou IA ; un « appuie sur Entrée » dit montre que l'astuce est connue. */
export function countChatDictation(state: TipsState, sent: boolean): TipsState {
  if (sent) return { ...state, chatDictations: 0, shown: { ...state.shown, 'send-enter': TIP_MAX['send-enter'] } }
  return { ...state, chatDictations: state.chatDictations + 1 }
}
