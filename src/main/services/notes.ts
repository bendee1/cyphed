import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ScratchNote } from '@shared/types'
import { userDataDir } from '../paths'
import { parseNotes } from './notes-core'

const FILE = (): string => join(userDataDir(), 'scratchpad.json')

export function loadNotes(): ScratchNote[] {
  try {
    if (!existsSync(FILE())) return []
    return parseNotes(JSON.parse(readFileSync(FILE(), 'utf8')))
  } catch {
    return []
  }
}

export function saveNotes(next: unknown): ScratchNote[] {
  const clean = parseNotes(next)
  writeFileSync(FILE(), JSON.stringify(clean, null, 2), 'utf8')
  return clean
}
