import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Bundle server/dist/index.js olarak calisir, dev'de server/src/config.ts. Ikisinde de repo koku iki ust dizin. */
export const REPO_ROOT = path.resolve(here, '..', '..');

export const CONFIG = {
  /** Yalnizca loopback'e bind edilir; bot arayuzu asla disariya acilmaz. */
  host: '127.0.0.1',
  port: Number(process.env.FBW_PORT ?? 8787),
  dbPath: process.env.FBW_DB ?? path.join(REPO_ROOT, 'data', 'watcher.db'),
  /** Vite build ciktisi buraya gider ve statik olarak servis edilir. */
  publicDir: path.join(REPO_ROOT, 'server', 'public'),
  /** Vite dev sunucusunun UI'i; CORS icin izin verilir. */
  devUiOrigin: 'http://127.0.0.1:5173',
} as const;
