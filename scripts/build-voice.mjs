// Prépare la voix locale livrée avec Cyphed (Pocket TTS, Kyutai) dans native/voice :
// un Python autonome, le moteur aux paquets verrouillés (empreintes, roues précompilées seulement),
// le modèle français et la voix Estelle. electron-builder le copie dans les ressources (voice/).
// Refait seulement si requirements.txt ou la version de Python change.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PYTHON = '3.12.13'
const LOCK = join(ROOT, 'native', 'pocket', 'requirements.txt')
const SCRIPT = join(ROOT, 'native', 'pocket', 'pocket-serve.py')
const OUT = join(ROOT, 'native', 'voice')
const STAMP = join(OUT, 'build.json')

const stamp = createHash('sha256').update(readFileSync(LOCK)).update(PYTHON).digest('hex')
if (existsSync(STAMP) && JSON.parse(readFileSync(STAMP, 'utf8')).stamp === stamp && existsSync(join(OUT, 'python', 'python.exe'))) {
  console.log('[voice] déjà prête')
  process.exit(0)
}

function uvPath() {
  try {
    execFileSync('uv', ['--version'], { stdio: 'ignore' })
    return 'uv'
  } catch {
    throw new Error('uv introuvable : installe-le (https://docs.astral.sh/uv/) puis relance npm run build:voice')
  }
}

const uv = uvPath()
const tmp = join(ROOT, 'native', 'voice-tmp')
rmSync(OUT, { recursive: true, force: true })
rmSync(tmp, { recursive: true, force: true })
// Aucune clé ni jeton : le dépôt public de Kyutai suffit pour les voix intégrées.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(_API_KEY|_TOKEN|_SECRET|_KEY)$/i.test(k)))
const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...env, UV_NO_CONFIG: '1', ...extra } })

console.log(`[voice] Python ${PYTHON}`)
run(uv, ['python', 'install', PYTHON, '--install-dir', tmp, '--no-bin'])
const installed = readdirSync(tmp).find((name) => name.startsWith(`cpython-${PYTHON}-windows-x86_64`))
if (!installed) throw new Error('Python installé introuvable')
mkdirSync(OUT, { recursive: true })
renameSync(join(tmp, installed), join(OUT, 'python'))
rmSync(tmp, { recursive: true, force: true })
const python = join(OUT, 'python', 'python.exe')

console.log('[voice] moteur')
run(uv, ['pip', 'install', '--python', python, '--break-system-packages', '--require-hashes', '--only-binary', ':all:', '-r', LOCK])
// En-têtes et bibliothèques de compilation de torch : inutiles pour lire.
const torch = join(OUT, 'python', 'Lib', 'site-packages', 'torch')
rmSync(join(torch, 'include'), { recursive: true, force: true })
for (const file of readdirSync(join(torch, 'lib'))) if (file.endsWith('.lib')) rmSync(join(torch, 'lib', file))

console.log('[voice] modèle français et Estelle')
const hfHome = join(OUT, 'hf-cache')
run(python, ['-I', '-X', 'utf8', SCRIPT, '--prefetch'], { HF_HOME: hfHome, HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' })
rmSync(join(hfHome, 'xet'), { recursive: true, force: true })
rmSync(join(hfHome, 'hub', '.locks'), { recursive: true, force: true })

writeFileSync(STAMP, JSON.stringify({ stamp, python: PYTHON, at: new Date().toISOString() }, null, 2))
console.log('[voice] prête')
