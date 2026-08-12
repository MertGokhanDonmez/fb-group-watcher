import { b, execute, parseJsonArray, queryAll, queryOne, toBool, transaction } from '../db/index.ts';
import type { MatchMode, Rule } from '../types.ts';

interface RuleRow {
  id: number;
  name: string;
  enabled: number;
  match_mode: MatchMode;
  include_keywords: string;
  exclude_keywords: string;
  regex: string | null;
  action_comment: number;
  action_dm: number;
  action_notify: number;
  require_approval: number;
  comment_template_id: number | null;
  dm_template_id: number | null;
  daily_cap: number;
  max_post_age_min: number;
  max_distance_km: number | null;
  priority: number;
  created_at: number;
  updated_at: number;
}

function groupIdsFor(ruleId: number): number[] {
  return queryAll<{ group_id: number }>(
    'SELECT group_id FROM rule_groups WHERE rule_id = ?',
    ruleId,
  ).map((row) => row.group_id);
}

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    enabled: toBool(row.enabled),
    matchMode: row.match_mode,
    includeKeywords: parseJsonArray(row.include_keywords),
    excludeKeywords: parseJsonArray(row.exclude_keywords),
    regex: row.regex,
    actionComment: toBool(row.action_comment),
    actionDm: toBool(row.action_dm),
    actionNotify: toBool(row.action_notify),
    requireApproval: toBool(row.require_approval),
    commentTemplateId: row.comment_template_id,
    dmTemplateId: row.dm_template_id,
    dailyCap: row.daily_cap,
    maxPostAgeMin: row.max_post_age_min,
    maxDistanceKm: row.max_distance_km,
    priority: row.priority,
    groupIds: groupIdsFor(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listRules(): Rule[] {
  return queryAll<RuleRow>('SELECT * FROM rules ORDER BY priority DESC, name').map(toRule);
}

export function listEnabledRules(): Rule[] {
  return queryAll<RuleRow>('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC, name').map(
    toRule,
  );
}

export function getRule(id: number): Rule | null {
  const row = queryOne<RuleRow>('SELECT * FROM rules WHERE id = ?', id);
  return row ? toRule(row) : null;
}

export type RuleInput = Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>;

function replaceGroupLinks(ruleId: number, groupIds: number[]): void {
  execute('DELETE FROM rule_groups WHERE rule_id = ?', ruleId);
  for (const groupId of groupIds) {
    execute('INSERT OR IGNORE INTO rule_groups (rule_id, group_id) VALUES (?, ?)', ruleId, groupId);
  }
}

export function createRule(input: RuleInput): Rule {
  const now = Date.now();
  const id = transaction(() => {
    const result = execute(
      `INSERT INTO rules (
         name, enabled, match_mode, include_keywords, exclude_keywords, regex,
         action_comment, action_dm, action_notify, require_approval,
         comment_template_id, dm_template_id, daily_cap, max_post_age_min, max_distance_km, priority,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.name,
      b(input.enabled),
      input.matchMode,
      JSON.stringify(input.includeKeywords),
      JSON.stringify(input.excludeKeywords),
      input.regex,
      b(input.actionComment),
      b(input.actionDm),
      b(input.actionNotify),
      b(input.requireApproval),
      input.commentTemplateId,
      input.dmTemplateId,
      input.dailyCap,
      input.maxPostAgeMin,
      input.maxDistanceKm,
      input.priority,
      now,
      now,
    );
    replaceGroupLinks(result.lastInsertRowid, input.groupIds);
    return result.lastInsertRowid;
  });
  const created = getRule(id);
  if (!created) throw new Error('Kural olusturuldu ama geri okunamadi');
  return created;
}

export function updateRule(id: number, patch: Partial<RuleInput>): Rule | null {
  const current = getRule(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  transaction(() => {
    execute(
      `UPDATE rules SET
         name = ?, enabled = ?, match_mode = ?, include_keywords = ?, exclude_keywords = ?, regex = ?,
         action_comment = ?, action_dm = ?, action_notify = ?, require_approval = ?,
         comment_template_id = ?, dm_template_id = ?, daily_cap = ?, max_post_age_min = ?,
         max_distance_km = ?, priority = ?, updated_at = ?
       WHERE id = ?`,
      next.name,
      b(next.enabled),
      next.matchMode,
      JSON.stringify(next.includeKeywords),
      JSON.stringify(next.excludeKeywords),
      next.regex,
      b(next.actionComment),
      b(next.actionDm),
      b(next.actionNotify),
      b(next.requireApproval),
      next.commentTemplateId,
      next.dmTemplateId,
      next.dailyCap,
      next.maxPostAgeMin,
      next.maxDistanceKm,
      next.priority,
      Date.now(),
      id,
    );
    replaceGroupLinks(id, next.groupIds);
  });
  return getRule(id);
}

export function deleteRule(id: number): boolean {
  return execute('DELETE FROM rules WHERE id = ?', id).changes > 0;
}
