import { StringDecoder } from 'node:string_decoder'

// Logique pure du client UI Automation : protocole en lignes JSON et vérification d'un collage.

export const UIA_MAX_BEFORE = 1500
export const UIA_MAX_AFTER = 500
export const UIA_MAX_SELECTED = 3000
export const UIA_MAX_TEXT = 20000

export type UiaId = number | string | null

export interface UiaSnapshot {
  id: UiaId
  process: string
  controlType: string
  editable: boolean
  readOnly: boolean
  password: boolean
  /** false : le champ n'expose ni TextPattern ni ValuePattern. */
  supported: boolean
  /** true : la position du curseur est connue (TextPattern). false : tout le texte est dans `before`. */
  caret: boolean
  before: string
  selected: string
  after: string
  length: number
  /** Seulement pour la commande `read`. */
  text?: string
}

export interface UiaPong {
  id: UiaId
  pong: true
}

export interface UiaFailure {
  id: UiaId
  error: string
}

export type UiaReply = UiaSnapshot | UiaPong | UiaFailure

export function isUiaFailure(r: UiaReply): r is UiaFailure {
  return 'error' in r
}

export function isUiaPong(r: UiaReply): r is UiaPong {
  return 'pong' in r
}

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.length > max ? v.slice(0, max) : v
}

function bool(v: unknown): boolean {
  return v === true
}

/** Lit une ligne de réponse du programme natif. Ne lève jamais. */
export function parseUiaLine(line: string): UiaReply {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { id: null, error: 'bad-json' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { id: null, error: 'bad-json' }
  const o = raw as Record<string, unknown>
  const id: UiaId = typeof o.id === 'number' || typeof o.id === 'string' ? o.id : null

  if (o.ok !== true) return { id, error: typeof o.error === 'string' && o.error ? o.error : 'error' }
  if (typeof o.process !== 'string') return { id, pong: true }

  // Défense en profondeur : un champ mot de passe n'a jamais de texte, même si l'exe en renvoyait.
  const password = bool(o.password)
  const keep = (v: unknown, max: number): string => (password ? '' : str(v, max))
  const snap: UiaSnapshot = {
    id,
    process: str(o.process, 260),
    controlType: str(o.controlType, 60),
    editable: bool(o.editable),
    readOnly: bool(o.readOnly),
    password,
    supported: password ? false : bool(o.supported),
    caret: bool(o.caret),
    before: keep(o.before, UIA_MAX_BEFORE),
    selected: keep(o.selected, UIA_MAX_SELECTED),
    after: keep(o.after, UIA_MAX_AFTER),
    length: typeof o.length === 'number' && o.length >= 0 ? Math.floor(o.length) : 0
  }
  if (typeof o.text === 'string') snap.text = keep(o.text, UIA_MAX_TEXT)
  return snap
}

/** Assemble des morceaux de stdout en lignes complètes (UTF-8 coupé au milieu d'un caractère compris). */
export class LineBuffer {
  private decoder = new StringDecoder('utf8')
  private rest = ''
  private maxLine: number

  constructor(maxLine = 1_000_000) {
    this.maxLine = maxLine
  }

  push(chunk: Buffer | string): string[] {
    this.rest += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    const lines: string[] = []
    let nl = this.rest.indexOf('\n')
    while (nl >= 0) {
      const line = this.rest.slice(0, nl).replace(/\r$/, '')
      if (line.length > 0) lines.push(line)
      this.rest = this.rest.slice(nl + 1)
      nl = this.rest.indexOf('\n')
    }
    // Ligne sans fin démesurée : on repart de zéro plutôt que de grossir sans limite.
    if (this.rest.length > this.maxLine) this.rest = ''
    return lines
  }

  reset(): void {
    this.decoder = new StringDecoder('utf8')
    this.rest = ''
  }
}

export type InsertVerdict = 'confirmed' | 'not-found' | 'unknown'

const TAIL = 40

function normalize(s: string): string {
  return s
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Texte lisible d'un instantané : `text` si présent, sinon avant + sélection + après. */
function readable(s: UiaSnapshot | null): string | null {
  if (!s || s.password || !s.supported) return null
  return s.text ?? s.before + s.selected + s.after
}

function countOf(haystack: string, needle: string): number {
  let n = 0
  let from = haystack.indexOf(needle)
  while (from >= 0) {
    n++
    from = haystack.indexOf(needle, from + needle.length)
  }
  return n
}

/**
 * Le texte inséré (ou ses ~40 derniers caractères normalisés) apparaît-il dans le champ relu, plus souvent qu'avant ?
 * `unknown` : champ illisible (mot de passe, non pris en charge, relecture ratée) ou texte inséré vide.
 * Sans lecture « avant », on ne peut pas prouver que le texte n'y était pas : il compte alors comme absent.
 */
export function verifyInsert(
  before: UiaSnapshot | null,
  after: UiaSnapshot | null,
  insertedText: string
): InsertVerdict {
  const afterText = readable(after)
  if (afterText === null) return 'unknown'
  const full = normalize(insertedText)
  if (!full) return 'unknown'
  const needle = full.length > TAIL ? full.slice(-TAIL) : full
  const beforeText = readable(before)
  const was = beforeText === null ? 0 : countOf(normalize(beforeText), needle)
  return countOf(normalize(afterText), needle) > was ? 'confirmed' : 'not-found'
}

/**
 * Prépare un morceau de contexte pour le modèle : fins de ligne unifiées, plafonné à `max` caractères
 * côté curseur (`keep: 'end'` pour le texte avant, `'start'` pour le texte après), sans mot coupé à la coupure.
 */
export function trimContext(s: string, max = UIA_MAX_BEFORE, keep: 'end' | 'start' = 'end'): string {
  const text = s.replace(/\r\n?/g, '\n')
  if (text.length <= max) return text
  if (keep === 'end') {
    const cut = text.slice(text.length - max)
    // La coupure tombe au milieu d'un mot si le caractère juste avant n'est pas un espace.
    if (/\s/.test(text[text.length - max - 1] ?? ' ')) return cut
    const space = cut.search(/\s/)
    return space < 0 ? cut : cut.slice(space + 1)
  }
  const cut = text.slice(0, max)
  if (/\s/.test(text[max] ?? ' ')) return cut
  const space = cut.search(/\s\S*$/)
  return space < 0 ? cut : cut.slice(0, space)
}
