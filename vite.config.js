import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
  server: { port: 5173, strictPort: true, host: true },
  preview: { port: 4173, strictPort: true },
});
