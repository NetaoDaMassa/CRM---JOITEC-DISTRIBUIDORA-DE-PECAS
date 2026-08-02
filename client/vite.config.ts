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
    port: 5183,
    proxy: {
      '/trpc': 'http://localhost:3011',
      '/upload': 'http://localhost:3011',
      '/uploads': 'http://localhost:3011',
    },
  },
})
