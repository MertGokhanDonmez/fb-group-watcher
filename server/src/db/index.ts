import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `node:sqlite` yalnizca `node:` onekiyle erisilebildigi icin Node'un `builtinModules`
 * listesinde gorunmez; Vite/Vitest oneki soyup "sqlite" paketini aramaya calisir ve coker.
 * Tipi `import type` ile aliyoruz (derlemede silinir), degeri ise calisma zamaninda
 * createRequire ile cozuyoruz - boylece hicbir bundler bu importa dokunmaz.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync: Database } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
import { CONFIG } from '../config.ts';
import { MIGRATIONS } from './migrations.ts';

let db: DatabaseSync | null = null;

/**
 * Baglantiyi acar ve migration'lari uygular.
 * Yol parametresi testlerin kendi gecici veritabanini kullanabilmesi icin var;
 * uretimde parametresiz cagrilir ve CONFIG.dbPath kullanilir.
 */
export function initDb(dbPath: string = CONFIG.dbPath): DatabaseSync {
  if (db) return db;
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const handle = new Database(dbPath);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA busy_timeout = 5000');
  migrate(handle);
  db = handle;
  return handle;
}

export function getDb(): DatabaseSync {
  return db ?? initDb();
}

export function closeDb(): void {
  db?.close();
  db = null;
}

function migrate(handle: DatabaseSync): void {
  const row = handle.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const current = Number(row?.user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    handle.exec('BEGIN');
    try {
      handle.exec(sql);
      // user_version parametre kabul etmez, degeri satir ici yazmak zorundayiz.
      handle.exec(`PRAGMA user_version = ${version + 1}`);
      handle.exec('COMMIT');
    } catch (error) {
      handle.exec('ROLLBACK');
      throw new Error(`Migration ${version + 1} basarisiz: ${String(error)}`);
    }
  }
}

/* ---------- Parametre yardimcilari ---------- */

/**
 * node:sqlite JS boolean kabul etmez; 0/1'e cevirmek zorundayiz.
 * Bu donusumu unutmak calisma zamaninda TypeError'a yol acar.
 */
export function b(value: boolean): number {
  return value ? 1 : 0;
}

/** SQLite'tan gelen 0/1 degerini boolean'a cevirir. */
export function toBool(value: unknown): boolean {
  return Number(value) === 1;
}

/** JSON kolonlarini guvenli okur; bozuk veri yuzunden sunucu dusmemeli. */
export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function prepare(sql: string): StatementSync {
  return getDb().prepare(sql);
}

/* ---------- Tipli sorgu yardimcilari ---------- */

/** node:sqlite'in kabul ettigi parametre tipleri; boolean ve undefined YOKTUR. */
export type SqlParam = string | number | bigint | null | Uint8Array;

/**
 * node:sqlite satirlari `Record<string, SQLOutputValue>` olarak doner ve satir
 * arayuzlerimize dogrudan cast edilemez. Donusum tek yerde burada yapiliyor ki
 * repo katmani `as unknown as` gurultusuyle dolmasin.
 */
export function queryAll<T>(sql: string, ...params: SqlParam[]): T[] {
  return getDb().prepare(sql).all(...params) as unknown as T[];
}

export function queryOne<T>(sql: string, ...params: SqlParam[]): T | undefined {
  return getDb().prepare(sql).get(...params) as unknown as T | undefined;
}

export interface ExecuteResult {
  changes: number;
  lastInsertRowid: number;
}

export function execute(sql: string, ...params: SqlParam[]): ExecuteResult {
  const result = getDb().prepare(sql).run(...params);
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

/** Bir grup yazmayi tek transaction'da calistirir. */
export function transaction<T>(fn: () => T): T {
  const handle = getDb();
  handle.exec('BEGIN');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}
