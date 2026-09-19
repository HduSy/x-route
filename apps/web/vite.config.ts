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
    },
  },
})
