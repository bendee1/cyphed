// Aperçu de l'interface dans un navigateur, avec des données d'exemple (aucun Electron, aucune clé).
// npm run ui:preview  →  http://127.0.0.1:5199/scripts/ui-preview/hub.html  et  bar.html?phase=listening
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../src')

export default defineConfig({
  root: resolve(here, '../..'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(src, 'renderer'),
      '@shared': resolve(src, 'shared'),
      'src/renderer': resolve(src, 'renderer')
    }
  },
  server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [resolve(here, '../..')] } }
})
