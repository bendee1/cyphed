# Cyphed — logo « Le C qui parle » (oct. 2026)

Un C ouvert, l'onde rouge de la voix sort par son ouverture.

- `mark.mjs` : la géométrie (carré 96). Deux dessins : normal, et petit (≤ 32 px : 2 barres, traits plus épais).
- `make.mjs` : régénère `svg/`, `png/` (16 à 1024 px, rendus par resvg) et `windows/cyphed.ico`. `node cyphed-logo-kit/parle/make.mjs`
- `svg/cyphed-app-icon*.svg` : icône d'app (carré noir arrondi). `svg/cyphed-mark-dark*` : logo seul sur fond sombre (C ivoire). `svg/cyphed-mark-light*` : sur fond clair (C encre).
- Couleurs : noir `#0b0b0b`, ivoire `#ffffff → #a9a49c`, rouge `#ff6b5c → #ff2a2a → #b30d16`.

Utilisé par : `.exe` et installateur (`package.json` > `win.icon`), fenêtres et zone de notification (`resources/brand/cyphed.ico`), Hub (`src/renderer/components/brand/CyphedMark.tsx`, géométrie recopiée de `mark.mjs`).
