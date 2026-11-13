import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const USER_DATA_FILES = ['cyphed.db', 'settings.json', 'secrets.json', 'metrics.jsonl'] as const

export function migrateLegacyUserFiles(srcDir: string, destDir: string): string[] {
  const copied: string[] = []
  if (!srcDir || !destDir || srcDir === destDir) return copied
  if (!existsSync(srcDir)) return copied
  mkdirSync(destDir, { recursive: true })

  const destDb = join(destDir, 'cyphed.db')
  if (!existsSync(destDb)) {
    const srcDb = join(srcDir, 'cyphed.db')
    const srcLegacy = join(srcDir, 'omaxvox.db')
    if (existsSync(srcDb)) {
      copyFileSync(srcDb, destDb)
      copied.push('cyphed.db')
    } else if (existsSync(srcLegacy)) {
      copyFileSync(srcLegacy, destDb)
      copied.push('omaxvox.db')
    }
  }

  for (const name of ['settings.json', 'secrets.json', 'metrics.jsonl'] as const) {
    const from = join(srcDir, name)
    const to = join(destDir, name)
    if (!existsSync(to) && existsSync(from)) {
      copyFileSync(from, to)
      copied.push(name)
    }
  }
  return copied
}
