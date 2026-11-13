// Logo Cyphed « Le C qui parle » : un C ouvert, l'onde de la voix sort par son ouverture.
// Géométrie dans un carré 96. Deux dessins : normal (≥ 40 px) et petit (≤ 32 px, moins de barres, traits plus épais).

const R2 = (n) => Math.round(n * 100) / 100

function arc(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180
  const x = R2(cx + r * Math.cos(a))
  return `M${x} ${R2(cy - r * Math.sin(a))}A${r} ${r} 0 1 0 ${x} ${R2(cy + r * Math.sin(a))}`
}

export const GEOMETRY = {
  normal: { cx: 47, cy: 48, r: 25, stroke: 13, open: 50, barW: 5.2, step: 8.2, x0: 42, heights: [0.55, 0.9, 0.62, 0.42, 0.26], maxH: 32 },
  small: { cx: 50, cy: 48, r: 24, stroke: 17, open: 54, barW: 10, step: 14, x0: 46, heights: [0.8, 0.46], maxH: 36 }
}

/** Les formes du logo (sans fond), à placer dans un <svg viewBox="0 0 96 96">. */
export function markShapes(size, { c, bars }) {
  const g = GEOMETRY[size]
  const ring = `<path d="${arc(g.cx, g.cy, g.r, g.open)}" fill="none" stroke="${c}" stroke-width="${g.stroke}" stroke-linecap="round"/>`
  const rects = g.heights
    .map((h, i) => {
      const H = h * g.maxH
      const x = g.x0 + i * g.step
      return `<rect x="${R2(x)}" y="${R2(g.cy - H / 2)}" width="${g.barW}" height="${R2(H)}" rx="${g.barW / 2}" fill="${bars}"/>`
    })
    .join('')
  return ring + rects
}

const GRADS = `
  <linearGradient id="cy-ivory" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#ece8e1"/><stop offset="1" stop-color="#a9a49c"/></linearGradient>
  <linearGradient id="cy-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b5c"/><stop offset="0.55" stop-color="#ff2a2a"/><stop offset="1" stop-color="#b30d16"/></linearGradient>`

/** Logo seul, pour un fond sombre (C ivoire) ou clair (C encre). */
export function markSvg(theme, size = 'normal') {
  const c = theme === 'dark' ? 'url(#cy-ivory)' : '#141414'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs>${GRADS}</defs>${markShapes(size, { c, bars: 'url(#cy-red)' })}</svg>`
}

/** Icône d'application : carré arrondi noir, halo rouge discret, logo ivoire. */
export function appIconSvg(size = 'normal') {
  const small = size === 'small'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${GRADS}
  <radialGradient id="cy-bg" cx="0.3" cy="0.2" r="1.1"><stop offset="0" stop-color="#1d1b1a"/><stop offset="0.55" stop-color="#0b0b0b"/><stop offset="1" stop-color="#000"/></radialGradient>
  <linearGradient id="cy-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#fff" stop-opacity="0.1"/></linearGradient>
  <filter id="cy-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>
  <filter id="cy-drop" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.4" flood-color="#000" flood-opacity="0.55"/></filter>
</defs>
<rect x="${small ? 0 : 8}" y="${small ? 0 : 8}" width="${small ? 512 : 496}" height="${small ? 512 : 496}" rx="${small ? 116 : 112}" fill="url(#cy-bg)"/>
${small ? '' : '<rect x="9.5" y="9.5" width="493" height="493" rx="110.5" fill="none" stroke="url(#cy-rim)" stroke-width="3"/>'}
${small ? '' : '<circle cx="276" cy="256" r="140" fill="#ff2a2a" opacity="0.17" filter="url(#cy-glow)"/>'}
<g transform="translate(${small ? 26 : 40} ${small ? 26 : 40}) scale(${small ? 4.8 : 4.5})" filter="${small ? '' : 'url(#cy-drop)'}">${markShapes(size, { c: 'url(#cy-ivory)', bars: 'url(#cy-red)' })}</g>
</svg>`
}
