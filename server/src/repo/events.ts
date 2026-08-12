import { execute, queryAll } from '../db/index.ts';

export type EventLevel = 'info' | 'warn' | 'error';

export interface AgentEvent {
  id: number;
  kind: string;
  level: EventLevel;
  message: string;
  payload: unknown;
  createdAt: number;
}

interface Row {
  id: number;
  kind: string;
  level: EventLevel;
  message: string;
  payload: string | null;
  created_at: number;
}

/** Teshis gunlugu. Botun neden sustugunu sonradan anlamanin tek yolu budur. */
export function logEvent(kind: string, level: EventLevel, message: string, payload?: unknown): void {
  execute(
    'INSERT INTO agent_events (kind, level, message, payload, created_at) VALUES (?, ?, ?, ?, ?)',
    kind,
    level,
    message,
    payload === undefined ? null : JSON.stringify(payload),
    Date.now(),
  );
}

export function listEvents(limit = 100): AgentEvent[] {
  return queryAll<Row>('SELECT * FROM agent_events ORDER BY created_at DESC LIMIT ?', limit).map(
    (row) => ({
      id: row.id,
      kind: row.kind,
      level: row.level,
      message: row.message,
      payload: row.payload === null ? null : safeParse(row.payload),
      createdAt: row.created_at,
    }),
  );
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function pruneEventsOlderThan(cutoffMs: number): number {
  return execute('DELETE FROM agent_events WHERE created_at < ?', cutoffMs).changes;
}
