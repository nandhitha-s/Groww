/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
  server: {
    proxy: {
      // Forwards /api/* to the FastAPI backend during development so the
      // browser sees same-origin requests -- no CORS setup needed on the
      // backend, and the HttpOnly session cookie works exactly as it does
      // when the API is called directly.
      '/api': {
        target: 'https://groww-zmgw.onrender.com',
        changeOrigin: true,
      },
    },
  },
})
