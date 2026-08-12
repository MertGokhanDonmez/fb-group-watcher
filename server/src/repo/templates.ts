import { execute, parseJsonArray, queryAll, queryOne } from '../db/index.ts';
import type { Template, TemplateKind } from '../types.ts';

interface TemplateRow {
  id: number;
  name: string;
  kind: TemplateKind;
  variants: string;
  created_at: number;
  updated_at: number;
}

function toTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    variants: parseJsonArray(row.variants),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTemplates(kind?: TemplateKind): Template[] {
  const rows = kind
    ? queryAll<TemplateRow>('SELECT * FROM templates WHERE kind = ? ORDER BY name', kind)
    : queryAll<TemplateRow>('SELECT * FROM templates ORDER BY kind, name');
  return rows.map(toTemplate);
}

export function getTemplate(id: number): Template | null {
  const row = queryOne<TemplateRow>('SELECT * FROM templates WHERE id = ?', id);
  return row ? toTemplate(row) : null;
}

export type TemplateInput = Pick<Template, 'name' | 'kind' | 'variants'>;

export function createTemplate(input: TemplateInput): Template {
  const now = Date.now();
  const result = execute(
    'INSERT INTO templates (name, kind, variants, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    input.name,
    input.kind,
    JSON.stringify(input.variants),
    now,
    now,
  );
  const created = getTemplate(result.lastInsertRowid);
  if (!created) throw new Error('Sablon olusturuldu ama geri okunamadi');
  return created;
}

export function updateTemplate(id: number, patch: Partial<TemplateInput>): Template | null {
  const current = getTemplate(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  execute(
    'UPDATE templates SET name = ?, kind = ?, variants = ?, updated_at = ? WHERE id = ?',
    next.name,
    next.kind,
    JSON.stringify(next.variants),
    Date.now(),
    id,
  );
  return getTemplate(id);
}

export function deleteTemplate(id: number): boolean {
  return execute('DELETE FROM templates WHERE id = ?', id).changes > 0;
}
