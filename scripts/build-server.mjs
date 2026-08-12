/**
 * Sunucuyu tek bir dosyaya derler: server/dist/index.js
 *
 * node_modules disarida birakilir (--packages=external): Fastify gibi paketler
 * dinamik require kullandigi icin bundle edilmeleri kirilgan olur. Yalnizca
 * kendi kaynagimiz (server/src + shared/) birlestirilir - boylece shared/
 * klasorune giden gorece import'lar sorun cikarmaz.
 */
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await esbuild.build({
  entryPoints: [path.join(root, 'server/src/index.ts')],
  outfile: path.join(root, 'server/dist/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});

process.stdout.write('\nSunucu derlendi: server/dist/index.js\n');
