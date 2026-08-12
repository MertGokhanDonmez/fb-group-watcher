import { b, execute, queryAll, queryOne, toBool } from '../db/index.ts';
import type { Group } from '../types.ts';

interface GroupRow {
  id: number;
  fb_group_id: string;
  name: string;
  url: string;
  dwell_ms: number;
  priority: number;
  enabled: number;
  daily_action_cap: number;
  created_at: number;
}

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    fbGroupId: row.fb_group_id,
    name: row.name,
    url: row.url,
    dwellMs: row.dwell_ms,
    priority: row.priority,
    enabled: toBool(row.enabled),
    dailyActionCap: row.daily_action_cap,
    createdAt: row.created_at,
  };
}

export function listGroups(): Group[] {
  return queryAll<GroupRow>('SELECT * FROM groups ORDER BY priority DESC, name').map(toGroup);
}

export function listEnabledGroups(): Group[] {
  return queryAll<GroupRow>(
    'SELECT * FROM groups WHERE enabled = 1 ORDER BY priority DESC, name',
  ).map(toGroup);
}

export function getGroup(id: number): Group | null {
  const row = queryOne<GroupRow>('SELECT * FROM groups WHERE id = ?', id);
  return row ? toGroup(row) : null;
}

export function getGroupByFbId(fbGroupId: string): Group | null {
  const row = queryOne<GroupRow>('SELECT * FROM groups WHERE fb_group_id = ?', fbGroupId);
  return row ? toGroup(row) : null;
}

export type GroupInput = Omit<Group, 'id' | 'createdAt'>;

export function createGroup(input: GroupInput): Group {
  const result = execute(
    `INSERT INTO groups (fb_group_id, name, url, dwell_ms, priority, enabled, daily_action_cap, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.fbGroupId,
    input.name,
    input.url,
    input.dwellMs,
    input.priority,
    b(input.enabled),
    input.dailyActionCap,
    Date.now(),
  );
  const created = getGroup(result.lastInsertRowid);
  if (!created) throw new Error('Grup olusturuldu ama geri okunamadi');
  return created;
}

export function updateGroup(id: number, patch: Partial<GroupInput>): Group | null {
  const current = getGroup(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  execute(
    `UPDATE groups
     SET fb_group_id = ?, name = ?, url = ?, dwell_ms = ?, priority = ?, enabled = ?, daily_action_cap = ?
     WHERE id = ?`,
    next.fbGroupId,
    next.name,
    next.url,
    next.dwellMs,
    next.priority,
    b(next.enabled),
    next.dailyActionCap,
    id,
  );
  return getGroup(id);
}

export function deleteGroup(id: number): boolean {
  return execute('DELETE FROM groups WHERE id = ?', id).changes > 0;
}
