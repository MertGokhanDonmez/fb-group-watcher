import { b, execute, queryAll, queryOne, toBool } from '../db/index.ts';
import type { ActionKind, ActionRow, ActionStatus } from '../types.ts';

interface Row {
  id: number;
  match_id: number;
  kind: ActionKind;
  status: ActionStatus;
  text: string;
  verified: number;
  error: string | null;
  created_at: number;
  sent_at: number | null;
}

function toAction(row: Row): ActionRow {
  return {
    id: row.id,
    matchId: row.match_id,
    kind: row.kind,
    status: row.status,
    text: row.text,
    verified: toBool(row.verified),
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

export function getAction(id: number): ActionRow | null {
  const row = queryOne<Row>('SELECT * FROM actions WHERE id = ?', id);
  return row ? toAction(row) : null;
}

export function createAction(
  matchId: number,
  kind: ActionKind,
  status: ActionStatus,
  text: string,
): ActionRow {
  const result = execute(
    'INSERT INTO actions (match_id, kind, status, text, created_at) VALUES (?, ?, ?, ?, ?)',
    matchId,
    kind,
    status,
    text,
    Date.now(),
  );
  const created = getAction(result.lastInsertRowid);
  if (!created) throw new Error('Aksiyon olusturuldu ama geri okunamadi');
  return created;
}

export function setActionStatus(
  id: number,
  status: ActionStatus,
  extra: { verified?: boolean; error?: string | null } = {},
): void {
  const sentAt = status === 'sent' || status === 'dry_run' ? Date.now() : null;
  execute(
    `UPDATE actions
        SET status = ?,
            verified = COALESCE(?, verified),
            error = ?,
            sent_at = COALESCE(?, sent_at)
      WHERE id = ?`,
    status,
    extra.verified === undefined ? null : b(extra.verified),
    extra.error ?? null,
    sentAt,
    id,
  );
}

/** Eklentiye gonderilmeyi bekleyen, en eski once. */
export function listQueuedActions(limit = 20): ActionRow[] {
  return queryAll<Row>(
    `SELECT * FROM actions WHERE status = 'queued' AND kind IN ('comment','dm')
      ORDER BY created_at LIMIT ?`,
    limit,
  ).map(toAction);
}

export function listActionsForMatches(matchIds: number[]): Map<number, ActionRow[]> {
  const result = new Map<number, ActionRow[]>();
  if (matchIds.length === 0) return result;
  const placeholders = matchIds.map(() => '?').join(',');
  const rows = queryAll<Row>(
    `SELECT * FROM actions WHERE match_id IN (${placeholders}) ORDER BY created_at`,
    ...matchIds,
  );
  for (const row of rows) {
    const action = toAction(row);
    const bucket = result.get(action.matchId);
    if (bucket) bucket.push(action);
    else result.set(action.matchId, [action]);
  }
  return result;
}

/**
 * Hiz limiti icin: verilen andan beri gonderilen (veya gonderilmekte olan)
 * gercek aksiyon sayisi. 'queued' de sayilir, aksi halde kuyruga yiginca limit asilir.
 */
export function countRealActionsSince(sinceMs: number): number {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM actions
      WHERE kind IN ('comment','dm')
        AND status IN ('queued','sending','sent')
        AND created_at >= ?`,
    sinceMs,
  );
  return Number(row?.total ?? 0);
}

/** En son gercekten gonderilen aksiyonun zamani; iki aksiyon arasi bosluk kontrolu icin. */
export function lastRealActionSentAt(): number | null {
  const row = queryOne<{ ts: number | null }>(
    `SELECT MAX(sent_at) AS ts FROM actions WHERE kind IN ('comment','dm') AND status = 'sent'`,
  );
  return row?.ts ?? null;
}

/** Sunucu yeniden basladiginda 'sending' durumunda asili kalmis aksiyonlari kurtarir. */
export function requeueStuckActions(): number {
  return execute(`UPDATE actions SET status = 'queued' WHERE status = 'sending'`).changes;
}
