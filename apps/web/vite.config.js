import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
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
