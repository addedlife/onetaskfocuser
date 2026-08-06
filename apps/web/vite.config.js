import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The version string lives in src/version.js and is the single source of truth.
// Read it here rather than duplicating it, so the manifest below can never drift
// from what the bundle believes it is.
const APP_VERSION = (readFileSync(new URL('./src/version.js', import.meta.url), 'utf8')
  .match(/APP_VERSION\s*=\s*"([^"]+)"/) || [, 'unknown'])[1];
const BUILD_TIME = new Date().toISOString();

// Emits dist/version.json — the "is there a newer app than the one I'm running?"
// manifest. The running tab polls it and compares against the version compiled
// into its own bundle (see src/update-watcher.js).
//
// It deliberately does NOT go through the service worker's update lifecycle:
// public/sw.js is a hand-maintained file whose bytes only change when someone
// bumps CACHE_NAME, so the browser sees a byte-identical worker on most deploys
// and never fires `updatefound`. A plain no-cache JSON fetch is honest about
// what shipped, works in a normal tab and an installed PWA alike, and carries
// the actual version string so the dialog and the pill can name it.
function versionManifest() {
  return {
    name: 'shamash-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION, buildTime: BUILD_TIME }),
      });
    },
  };
}

export default defineConfig({
  base: '/',  // Fixed for Netlify root SPA deploy (was './')
  plugins: [react(), versionManifest()],
  // Build identity — surfaced in the ?diag=1 readout so we can tell, from the device
  // itself, whether it is running the latest deploy or a stale cached bundle.
  define: {
    __BUILD_COMMIT__: JSON.stringify((process.env.COMMIT_REF || process.env.GIT_COMMIT || 'dev').slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
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
