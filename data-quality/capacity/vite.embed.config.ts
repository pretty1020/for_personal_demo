import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Builds Capacity as an embeddable bundle served from the main Next.js app (public/capacity). */
export default defineConfig({
  plugins: [tailwindcss(), react()],
  // Relative base so lazy chunks resolve next to embed.js (/capacity/chunks/...),
  // not site-root /chunks/... (breaks routes like /capacity/dbe).
  base: './',
  // Copy capacity/public/* into outDir after clean (logos, avatars, icons).
  publicDir: resolve(__dirname, 'public'),
  css: {
    // Prevent Vite from walking up to the Next.js root postcss/tailwind v3 config.
    postcss: resolve(__dirname, 'postcss.config.mjs'),
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/capacity'),
    'import.meta.env.PROD': JSON.stringify(true),
    'import.meta.env.DEV': JSON.stringify(false),
    'import.meta.env.MODE': JSON.stringify('production'),
  },
  build: {
    outDir: resolve(__dirname, '../public/capacity'),
    // Clears prior embed/chunks, then Vite restores files from capacity/public.
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/embed/main.tsx'),
      output: {
        entryFileNames: 'embed.js',
        assetFileNames: 'embed.[ext]',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    chunkSizeWarningLimit: 2000,
  },
})
