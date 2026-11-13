// Publie une version : construit l'installeur et le met dans les versions GitHub de bendee1/cyphed,
// d'où les copies installées se mettent à jour. Monter "version" dans package.json avant.
// Le jeton vient de GH_TOKEN, sinon de `gh auth token` ; il n'est jamais affiché.
import { execSync } from 'node:child_process'

const env = { ...process.env }
if (!env.GH_TOKEN) {
  try {
    env.GH_TOKEN = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    console.error('Pas de jeton GitHub : définir GH_TOKEN ou se connecter avec `gh auth login`.')
    process.exit(1)
  }
}
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env })
run('npm run check')
run('npm run build:native')
run('npm run build:voice')
run('npx electron-vite build')
run('npx electron-builder --win --config.directories.output=release --publish always')
