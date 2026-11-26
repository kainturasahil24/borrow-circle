import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The admin dashboard is server-rendered-free SPA. In dev, /api is proxied to
// the Express API so cookies/CORS behave like production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173 },
})
