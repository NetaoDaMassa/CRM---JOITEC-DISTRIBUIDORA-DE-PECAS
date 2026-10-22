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
    port: Number(process.env.VITE_PORT ?? 5183),
    proxy: {
      '/trpc': `http://localhost:${process.env.API_PORT ?? 3011}`,
      '/upload': `http://localhost:${process.env.API_PORT ?? 3011}`,
      '/uploads': `http://localhost:${process.env.API_PORT ?? 3011}`,
      '/chat-socket': { target: `http://localhost:${process.env.API_PORT ?? 3011}`, ws: true },
    },
  },
})
