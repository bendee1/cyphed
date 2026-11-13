import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateLegacyUserFiles } from './db/user-files.ts'

const require = createRequire(import.meta.url)

let userDataOverride: string | null = null

function hereDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return __dirname
  }
}

function electronApp(): { isPackaged: boolean; getPath: (name: string) => string } | null {
  try {
    const mod = require('electron') as { app?: { isPackaged: boolean; getPath: (name: string) => string } }
    if (mod?.app && typeof mod.app.getPath === 'function') return mod.app
  } catch {
    /* node tests */
  }
  return null
}

export function projectRoot(): string {
  const app = electronApp()
  return app?.isPackaged ? dirname(app.getPath('exe')) : join(hereDir(), '../..')
}

/** Logo Cyphed (.ico, 16 à 256 px) : livré dans les ressources (brand/), pris dans le kit en développement. */
export function brandIconPath(): string {
  const app = electronApp()
  return app?.isPackaged ? join(process.resourcesPath, 'brand', 'cyphed.ico') : join(projectRoot(), 'cyphed-logo-kit', 'parle', 'windows', 'cyphed.ico')
}

export function legacyProjectUserDataDir(): string {
  return join(projectRoot(), 'user-data')
}

export function userDataDir(): string {
  if (userDataOverride) {
    mkdirSync(userDataOverride, { recursive: true })
    return userDataOverride
  }
  const app = electronApp()
  if (!app) {
    throw new Error('userDataDir requires Electron or setUserDataDirForTests()')
  }
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function migrateUserDataToAppData(): string[] {
  return migrateLegacyUserFiles(legacyProjectUserDataDir(), userDataDir())
}

export function loadDotEnv(): void {
  const envPath = join(projectRoot(), '.env')
  if (!existsSync(envPath)) return
  const text = readFileSync(envPath, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
