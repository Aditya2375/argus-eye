import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/',
  resolve: {
    alias: [
      // zip.js 2.24 removed the lib/zip-no-worker.js entry that Cesium's
      // KmlDataSource still imports; serve the local shim instead.
      {
        find: /^@zip\.js\/zip\.js\/lib\/zip-no-worker\.js$/,
        replacement: path.resolve(rootDir, 'src/shims/zip-no-worker.js'),
      },
    ],
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium/'),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
  server: {
    port: 4189,
    proxy: {
      '/api': {
        target: 'http://localhost:4190',
        changeOrigin: true,
      },
    },
  },
});
