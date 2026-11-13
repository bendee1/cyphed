import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const all = args.size === 0
const wantType = all || args.has('--typecheck')
const wantTest = all || args.has('--test')
const wantBuild = all || args.has('--build')

function run(cmd, argv) {
  console.log(`$ ${cmd} ${argv.join(' ')}`)
  const result = spawnSync(cmd, argv, { cwd: root, stdio: 'inherit', shell: true })
  if (result.status) process.exit(result.status)
}

if (wantType) {
  run('npx', ['tsc', '-p', 'tsconfig.node.json', '--noEmit'])
  run('npx', ['tsc', '-p', 'tsconfig.web.json', '--noEmit'])
}

if (wantTest) {
  const tests = readdirSync(join(root, 'tests'))
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => join('tests', name))
  run('node', ['--experimental-sqlite', '--test', '--test-reporter=spec', ...tests])
}

if (wantBuild) {
  run('npx', ['electron-vite', 'build'])
  const names = ['bar.js', 'hub.js', 'capture.js']
  for (const name of names) {
    const file = join(root, 'out/preload', name)
    const text = readFileSync(file, 'utf8')
    if (/require\(\s*['"][^'"]*chunks\//.test(text) || /from\s+['"][^'"]*chunks\//.test(text)) {
      console.error(`preload ${name} depends on a local chunk — sandbox cannot load it`)
      process.exit(1)
    }
    if (!text.includes('exposeInMainWorld') || !text.includes('cyphed')) {
      console.error(`preload ${name} does not expose window.cyphed`)
      process.exit(1)
    }
  }
  console.log('preload standalone: bar.js hub.js capture.js')
}
