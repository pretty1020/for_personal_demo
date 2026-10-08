import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  css: {
    // Do not walk up to the repo-root PostCSS config. That file is for the Next app and requires tailwindcss, which is not installed for this Vite app. Tailwind here is the Vite plugin.
    postcss: {
      plugins: [],
    },
  },
  /** Prefer IPv4 loopback so `localhost` (often ::1) does not hit another process on 5178 (e.g. IDE tooling). */
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'vendor-xlsx'
          if (id.includes('node_modules/echarts')) return 'vendor-echarts'
          if (id.includes('node_modules/@tanstack/table-core')) return 'vendor-table-core'
          if (id.includes('node_modules/@tanstack/react-table')) return 'vendor-react-table'
          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 1400,
  },
})
