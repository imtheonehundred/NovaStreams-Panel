import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'public/js',
  base: '/js/dist/',
  build: {
    outDir: '../../public/js/dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        admin: path.resolve(__dirname, 'public/js/src/main.js'),
        reseller: path.resolve(__dirname, 'public/js/src/reseller-main.js'),
        client: path.resolve(__dirname, 'public/js/src/client-main.js'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('chart.js')) return 'vendor';
            return 'vendor';
          }
          if (id.includes('/src/core/')) return 'core';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'public/js/src/core'),
      '@pages': path.resolve(__dirname, 'public/js/src/pages'),
      '@shared': path.resolve(__dirname, 'public/js/src/shared'),
      '@wrappers': path.resolve(__dirname, 'public/js/src/wrappers'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  optimizeDeps: {
    include: ['chart.js'],
  },
});
