import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, initDb } from '../src/db/index.ts';

let currentDir: string | null = null;

/** Her test dosyasi kendi izole veritabaniyla calisir. */
export function useTempDb(): void {
  currentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbw-test-'));
  initDb(path.join(currentDir, 'test.db'));
}

export function dropTempDb(): void {
  closeDb();
  if (currentDir) {
    fs.rmSync(currentDir, { recursive: true, force: true });
    currentDir = null;
  }
}
