import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const uiDir = path.dirname(fileURLToPath(import.meta.url));
const API_TARGET = 'http://127.0.0.1:8787';

export default defineConfig({
  root: uiDir,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Dev'de de API ayni origin'den gorunsun: CORS'a gerek kalmaz ve
    // uretimdeki (tek sunucu) davranisla birebir ayni olur.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    // Uretimde Fastify bu klasoru statik servis eder.
    outDir: path.resolve(uiDir, '..', 'server', 'public'),
    emptyOutDir: true,
  },
});
