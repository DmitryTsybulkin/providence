import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const SERVER = 'http://127.0.0.1:4317'

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: false },
      '/events': { target: SERVER, ws: true, changeOrigin: false },
    },
  },
})
