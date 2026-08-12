/**
 * Chrome eklentisini derler. Cikti: extension/dist (Chrome'a "paketlenmemis" olarak yuklenir).
 *
 * Arka plan service worker'i ESM olarak derlenir (manifest'te "type": "module"),
 * content script ve secenekler sayfasi ise IIFE - content script'ler ESM olamaz.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'extension');
const outDir = path.join(srcDir, 'dist');
const watch = process.argv.includes('--watch');

fs.mkdirSync(outDir, { recursive: true });

/** Bundle disi statik dosyalar dist'e kopyalanir. */
function copyStatic() {
  for (const file of ['manifest.json', 'options.html']) {
    fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
  }
}

const shared = {
  bundle: true,
  target: 'chrome116',
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  minify: false,
};

const builds = [
  { entryPoints: [path.join(srcDir, 'src/background.ts')], outfile: path.join(outDir, 'background.js'), format: 'esm' },
  { entryPoints: [path.join(srcDir, 'src/content/collector.ts')], outfile: path.join(outDir, 'content.js'), format: 'iife' },
  { entryPoints: [path.join(srcDir, 'src/options.ts')], outfile: path.join(outDir, 'options.js'), format: 'iife' },
];

if (watch) {
  copyStatic();
  const contexts = await Promise.all(builds.map((build) => esbuild.context({ ...shared, ...build })));
  await Promise.all(contexts.map((context) => context.watch()));
  fs.watch(srcDir, (_event, filename) => {
    if (filename === 'manifest.json' || filename === 'options.html') copyStatic();
  });
  process.stdout.write(`\nEklenti izleniyor. Chrome'a yukleyin: ${outDir}\n`);
} else {
  await Promise.all(builds.map((build) => esbuild.build({ ...shared, ...build })));
  copyStatic();
  process.stdout.write(`\nEklenti derlendi: ${outDir}\n`);
}
