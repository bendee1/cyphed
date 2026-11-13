import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(root, 'src/shared') },
      extensions: ['.ts', '.mts', '.js', '.mjs', '.json']
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(root, 'src/shared') },
      extensions: ['.ts', '.mts', '.js', '.mjs', '.json']
    },
    build: {
      rollupOptions: {
        input: {
          bar: resolve(root, 'src/preload/bar.ts'),
          hub: resolve(root, 'src/preload/hub.ts'),
          capture: resolve(root, 'src/preload/capture.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          experimentalMinChunkSize: 1_000_000
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer'),
        '@shared': resolve(root, 'src/shared'),
        'src/renderer': resolve(root, 'src/renderer')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          bar: resolve(root, 'src/renderer/bar.html'),
          hub: resolve(root, 'src/renderer/hub.html'),
          capture: resolve(root, 'src/renderer/capture.html')
        }
      }
    }
  }
})
