import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/maplibre-gl')) {
            return 'maplibre';
          }
          if (id.includes('node_modules/chart.js')) {
            return 'chart';
          }
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/zustand')
          ) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    proxy: {
      // AD-5: local dev relay to bypass graphhopper.gpx.studio CORS restriction
      '/api/graphhopper': {
        target: 'https://graphhopper.gpx.studio',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/graphhopper/, ''),
      },
      '/api/brouter': {
        target: 'https://brouter.de/brouter',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/brouter/, ''),
      },
      // Route sharing lives in worker.ts — run `npx wrangler dev` (port 8787)
      // alongside vite to use share links in dev.
      '/api/share': {
        target: 'http://127.0.0.1:8787',
      },
    },
  },
})
