import { tm } from '../lang'
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

// Dernière lecture réussie, et vrai tant qu'une lecture a échoué sans que le fichier soit cassé (verrou, antivirus).
let lastGood: Personalization | null = null
let unreadable = false

export function loadPersonalization(): Personalization {
  // Fichier cassé : il est mis de côté (.corrupt-<date>), jamais écrasé en silence par la sauvegarde suivante.
  const read = readJsonOrQuarantine(FILE())
  if (read.status === 'corrupt' && read.quarantinedTo === null) {
    // Lecture impossible pour l'instant : le fichier est intact. Rendre des valeurs vides ferait écraser
    // tout le dictionnaire à la sauvegarde suivante : on garde la dernière version lue.
    unreadable = true
    console.warn('[personalization] lecture impossible pour l’instant, dernière version gardée')
    return lastGood ?? migrateDefaultNames(parsePersonalization({}))
  }
  if (read.status === 'corrupt') console.warn('[personalization] fichier illisible, mis de côté :', read.quarantinedTo)
  unreadable = false
  lastGood = migrateDefaultNames(parsePersonalization(read.status === 'ok' ? read.value : {}))
  return lastGood
}

export function savePersonalization(next: unknown): Personalization {
  // Jamais lu correctement et illisible maintenant : écrire écraserait un fichier intact avec des valeurs vides.
  if (unreadable && !lastGood) throw new Error(tm('pers.unreadable'))
  const clean = migrateDefaultNames(parsePersonalization(next))
  writeJsonAtomic(FILE(), clean)
  lastGood = clean
  unreadable = false
  return clean
}
