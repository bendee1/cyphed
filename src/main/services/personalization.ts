import { join } from 'node:path'
import { DEFAULT_TRANSFORMS, type Personalization } from '@shared/types'
import { userDataDir } from '../paths'
import { parsePersonalization } from './personalization-core'
import { readJsonOrQuarantine, writeJsonAtomic } from './json-file'

export {
  addPending,
  applyPersonalization,
  dictionaryTerms,
  isBlockedApp,
  learnFromCorrection,
  mergeLearned
} from './personalization-core'

/** Anciens noms anglais des transformations par défaut (même id), renommés en français au chargement. */
const LEGACY_DEFAULT_NAMES: Record<string, string> = { polish: 'Polish', 'prompt-engineer': 'Prompt Engineer' }

function migrateDefaultNames(p: Personalization): Personalization {
  const transforms = p.transforms.map((t) => {
    const fresh = DEFAULT_TRANSFORMS.find((d) => d.id === t.id)
    return fresh && LEGACY_DEFAULT_NAMES[t.id] === t.name ? { ...t, name: fresh.name } : t
  })
  return { ...p, transforms }
}

const FILE = (): string => join(userDataDir(), 'personalization.json')

export function loadPersonalization(): Personalization {
  // Fichier cassé : il est mis de côté (.corrupt-<date>), jamais écrasé en silence par la sauvegarde suivante.
  const read = readJsonOrQuarantine(FILE())
  if (read.status === 'corrupt') console.warn('[personalization] fichier illisible, mis de côté :', read.quarantinedTo)
  return migrateDefaultNames(parsePersonalization(read.status === 'ok' ? read.value : {}))
}

export function savePersonalization(next: unknown): Personalization {
  const clean = migrateDefaultNames(parsePersonalization(next))
  writeJsonAtomic(FILE(), clean)
  return clean
}
