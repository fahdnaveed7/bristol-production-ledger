import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Served from GitHub Pages under /bristol-production-ledger/; dev stays at /
  base: typeof process !== 'undefined' && process.env.GITHUB_ACTIONS ? '/bristol-production-ledger/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Bristol Proteins & Oils — Production Ledger',
        short_name: 'Bristol Ledger',
        description: 'Production ledger for Bristol Proteins & Oils',
        theme_color: '#1a293c',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: { port: 5173 },
})
