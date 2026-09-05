/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
    },
    server: {
      proxy: {
        // Forwards /api/* to the backend configured via VITE_API_BASE_URL.
        // Falls back to the local FastAPI dev server when the variable is unset.
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  };
})
