import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  server: {
    // порт назначает среда запуска; сам по себе — 5173
    port: Number(process.env.PORT ?? 5173),
    strictPort: !!process.env.PORT,
    host: true,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 3000}`, changeOrigin: false } },
  },
  // карта (maplibre) грузится отдельно и только там, где она нужна
  build: { outDir: '../dist/web', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 1200 },
});
