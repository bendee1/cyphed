// Publie une version : construit l'installeur puis le met, avec latest.yml et le blockmap, dans les versions GitHub
// de bendee1/cyphed, d'où les copies installées se mettent à jour. Monter "version" dans package.json avant.
// Publication par `gh` en une étape : l'envoi d'electron-builder crée la version deux fois en parallèle et échoue (422).
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'

const REPO = 'bendee1/cyphed'
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`
const run = (cmd) => execSync(cmd, { stdio: 'inherit' })

try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' })
} catch {
  console.error('GitHub CLI non connecté : lancer `gh auth login`.')
  process.exit(1)
}
try {
  execFileSync('gh', ['release', 'view', tag, '-R', REPO], { stdio: 'ignore' })
  console.error(`${tag} existe déjà sur ${REPO} : monter "version" dans package.json.`)
  process.exit(1)
} catch {
  /* pas encore publiée */
}

run('npm run check')
run('npm run build:native')
run('npm run build:voice')
run('npx electron-vite build')
run('npx electron-builder --win --config.directories.output=release --publish never')

// Les noms des fichiers envoyés doivent être ceux que latest.yml annonce (tirets, pas d'espaces).
const latest = readFileSync('release/latest.yml', 'utf8')
const url = /url: (.+)/.exec(latest)?.[1]?.trim()
const installer = `release/Cyphed Setup ${version}.exe`
if (!url || !existsSync(installer)) throw new Error('latest.yml ou installeur introuvable')
if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}$`, 'm').test(latest)) throw new Error(`latest.yml n'est pas celui de la version ${version}`)
const dir = 'release/upload'
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir)
copyFileSync(installer, `${dir}/${url}`)
copyFileSync(`${installer}.blockmap`, `${dir}/${url}.blockmap`)
copyFileSync('release/latest.yml', `${dir}/latest.yml`)
execFileSync(
  'gh',
  ['release', 'create', tag, '-R', REPO, '--title', `Cyphed ${version}`, '--notes', `Cyphed ${version} for Windows. Installed copies update themselves.`,
    `${dir}/${url}`, `${dir}/${url}.blockmap`, `${dir}/latest.yml`],
  { stdio: 'inherit' }
)
rmSync(dir, { recursive: true, force: true })
