// Fabrique le kit du logo « Le C qui parle » : SVG, PNG (16 à 1024 px, rendus par resvg) et cyphed.ico.
// Usage : node cyphed-logo-kit/parle/make.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appIconSvg, markSvg } from './mark.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const SMALL_MAX = 32 // en dessous, le dessin simplifié (2 barres, traits plus épais)
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

const svgs = {
  'cyphed-app-icon': appIconSvg(),
  'cyphed-app-icon-small': appIconSvg('small'),
  'cyphed-mark-dark': markSvg('dark'),
  'cyphed-mark-dark-small': markSvg('dark', 'small'),
  'cyphed-mark-light': markSvg('light'),
  'cyphed-mark-light-small': markSvg('light', 'small')
}
for (const [name, svg] of Object.entries(svgs)) writeFileSync(join(DIR, 'svg', `${name}.svg`), svg)

function render(svgName, size, out) {
  const svg = readFileSync(join(DIR, 'svg', `${svgName}.svg`), 'utf8')
  writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng())
}

const pngs = {}
for (const kind of ['app-icon', 'mark-dark', 'mark-light']) {
  mkdirSync(join(DIR, 'png', kind), { recursive: true })
  for (const size of SIZES) {
    const svg = `cyphed-${kind}${size <= SMALL_MAX ? '-small' : ''}`
    const out = join(DIR, 'png', kind, `cyphed-${kind}-${size}.png`)
    render(svg, size, out)
    if (kind === 'app-icon') pngs[size] = out
  }
}

// .ico : chaque taille en PNG (accepté par Windows depuis Vista).
const images = ICO_SIZES.map((s) => readFileSync(pngs[s]))
const head = Buffer.alloc(6 + 16 * images.length)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(images.length, 4)
let offset = head.length
images.forEach((img, i) => {
  const s = ICO_SIZES[i]
  const e = 6 + i * 16
  head.writeUInt8(s >= 256 ? 0 : s, e)
  head.writeUInt8(s >= 256 ? 0 : s, e + 1)
  head.writeUInt16LE(1, e + 4)
  head.writeUInt16LE(32, e + 6)
  head.writeUInt32LE(img.length, e + 8)
  head.writeUInt32LE(offset, e + 12)
  offset += img.length
})
writeFileSync(join(DIR, 'windows', 'cyphed.ico'), Buffer.concat([head, ...images]))
console.log('kit prêt')
