// Lecture / écriture sûres des fichiers JSON de l'appli (réglages, clés, personnalisation).
// Pur (node:fs seulement) : testable avec `node --test`, sans Electron.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type JsonRead =
  | { status: 'missing' }
  | { status: 'ok'; value: unknown }
  | { status: 'corrupt'; quarantinedTo: string | null }

/** Horodatage utilisable dans un nom de fichier Windows (pas de « : »). */
export function stampForFile(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

/** Écrit dans `<fichier>.tmp` puis renomme : une coupure en plein milieu ne laisse jamais un fichier tronqué. */
export function writeJsonAtomic(path: string, value: unknown, space: number | undefined = 2): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, space), 'utf8')
  renameSync(tmp, path)
}

/**
 * Lit un fichier JSON. Illisible (JSON cassé) : le fichier est renommé en `<fichier>.corrupt-<date>`
 * et jamais écrasé en silence. Un fichier absent n'est pas une erreur.
 */
export function readJsonOrQuarantine(path: string, now: Date = new Date()): JsonRead {
  if (!existsSync(path)) return { status: 'missing' }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // Lecture impossible (verrou, droits) : on ne touche pas au fichier.
    return { status: 'corrupt', quarantinedTo: null }
  }
  try {
    return { status: 'ok', value: JSON.parse(text.replace(/^﻿/, '')) }
  } catch {
    const target = `${path}.corrupt-${stampForFile(now)}`
    try {
      renameSync(path, target)
      return { status: 'corrupt', quarantinedTo: target }
    } catch {
      return { status: 'corrupt', quarantinedTo: null }
    }
  }
}
