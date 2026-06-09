import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',  // Fixed for Netlify root SPA deploy (was './')
  plugins: [
    react(),
    // Industry-standard PWA service worker (Workbox via vite-plugin-pwa).
    // Replaces the old hand-rolled public/sw.js. The generated worker precaches
    // every build asset keyed by its content hash, so each deploy produces a new
    // worker; `registerType: 'autoUpdate'` then installs it and reloads open
    // windows automatically — no hand-bumped CACHE_NAME, no stale bundles.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,        // we register manually via virtual:pwa-register in offline-support.js
      manifest: false,             // keep the existing hand-written public/manifest.webmanifest
      includeManifestIcons: false,
      devOptions: { enabled: false }, // SW only in production builds (matches the old import.meta.env.PROD guard)
      workbox: {
        // Precache the app shell + code. mp3 (~7 MB each) are excluded — too large to
        // precache and non-critical; they load from the network like before.
        globPatterns: ['**/*.{js,css,html,ico,svg,png,webmanifest,woff,woff2}'],
        globIgnores: ['**/*.mp3', 'shailos/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // SPA fallback: navigations resolve to index.html, EXCEPT these server-owned
        // paths, which must reach the network (Firebase auth proxy, Netlify functions,
        // and the separate /shailos mini-site).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__\//, /^\/\.netlify\//, /^\/shailos\//],
        // Cache the cross-origin Google Fonts (Material Symbols) so the UI renders
        // offline — the only runtime cache. Firebase/Firestore/identitytoolkit and
        // Netlify functions have no handler here, so they always go straight to network.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // Build identity — surfaced in the ?diag=1 readout so we can tell, from the device
  // itself, whether it is running the latest deploy or a stale cached bundle.
  define: {
    __BUILD_COMMIT__: JSON.stringify((process.env.COMMIT_REF || process.env.GIT_COMMIT || 'dev').slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: 3000,
  },
});
