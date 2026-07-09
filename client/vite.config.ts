import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@server': path.resolve(__dirname, '../server/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/trpc': 'http://localhost:3001',
      '/upload': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
})
