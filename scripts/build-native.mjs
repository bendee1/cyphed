// Compile native/uia-helper/UiaHelper.cs et native/mouse-helper/MouseHelper.cs avec csc.exe du .NET Framework 4.x (présent sur tout Windows).
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'uia-helper', 'UiaHelper.cs')
const outDir = join(root, 'native', 'bin')
const output = join(outDir, 'uia-helper.exe')

function fail(message) {
  console.error(`build-native : ${message}`)
  process.exit(1)
}

if (process.platform !== 'win32') fail('uia-helper ne se compile que sous Windows.')
if (!existsSync(source)) fail(`source introuvable : ${source}`)

const windir = process.env.SystemRoot || process.env.windir || 'C:\Windows'
const frameworks = [
  join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319'),
  join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319')
]
const dir = frameworks.find((d) => existsSync(join(d, 'csc.exe')))
if (!dir) {
  fail(
    `csc.exe introuvable (cherché dans ${frameworks.join(' et ')}). ` +
      'Le .NET Framework 4.x est inclus dans Windows : activer la fonctionnalité "NET Framework 4.8 Advanced Services".'
  )
}

const wpf = join(dir, 'WPF')
const refs = ['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll']
const refPaths = refs.map((name) => [join(wpf, name), join(dir, name)].find((p) => existsSync(p)))
const missing = refs.filter((_, i) => !refPaths[i])
if (missing.length) fail(`références .NET manquantes : ${missing.join(', ')} (dossier ${wpf})`)

mkdirSync(outDir, { recursive: true })
const args = [
  '/nologo',
  '/target:exe',
  '/platform:x64',
  '/optimize+',
  `/out:${output}`,
  ...refPaths.map((p) => `/reference:${p}`),
  source
]
function compile(args, out, name) {
  const result = spawnSync(join(dir, 'csc.exe'), args, { encoding: 'utf8' })
  if (result.stdout?.trim()) console.log(result.stdout.trim())
  if (result.stderr?.trim()) console.error(result.stderr.trim())
  if (result.error) fail(`csc.exe n'a pas pu démarrer : ${result.error.message}`)
  if (result.status !== 0) fail(`échec de la compilation de ${name} (code ${result.status}).`)
  console.log(`${name} compilé (${Math.round(statSync(out).size / 1024)} Ko) : ${out}`)
}
compile(args, output, 'uia-helper.exe')

// Crochet souris dans son propre processus : la souris du PC ne dépend jamais du fil principal d'Electron.
const mouseSource = join(root, 'native', 'mouse-helper', 'MouseHelper.cs')
const mouseOutput = join(outDir, 'mouse-helper.exe')
if (!existsSync(mouseSource)) fail(`source introuvable : ${mouseSource}`)
compile(['/nologo', '/target:winexe', '/platform:x64', '/optimize+', `/out:${mouseOutput}`, mouseSource], mouseOutput, 'mouse-helper.exe')
