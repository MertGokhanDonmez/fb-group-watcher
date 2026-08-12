import { EventEmitter } from 'node:events';
import type { BlockKind } from '../../shared/protocol.ts';
import type { ActionRow, MatchDetail, Post } from './types.ts';

/** Eklentinin o anki sagligi. UI'daki durum rozetini ve watchdog'u besler. */
export interface AgentStatus {
  connected: boolean;
  lastHeartbeatAt: number | null;
  extVersion: string | null;
  lastBlock: { kind: BlockKind; at: number; url: string; note?: string } | null;
  /** Ust uste kac turdur hic post parse edilemedi. Selector bozulmasinin gostergesi. */
  consecutiveEmptyRounds: number;
  lastParseAt: number | null;
  /** Su an ziyaret edilen grup (teshis icin). */
  currentGroup: string | null;
}

export type BusEvent =
  | { type: 'post'; post: Post }
  | { type: 'match'; match: MatchDetail }
  | { type: 'action'; action: ActionRow }
  | { type: 'status'; status: AgentStatus }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; at: number };

/**
 * Sunucu ici yayin kanali. SSE endpoint'i buradan besleniyor,
 * boylece UI yeni post/eslesme/durum degisikliklerini aninda goruyor.
 */
class Bus extends EventEmitter {
  emitEvent(event: BusEvent): void {
    this.emit('event', event);
  }

  subscribe(listener: (event: BusEvent) => void): () => void {
    this.on('event', listener);
    return () => {
      this.off('event', listener);
    };
  }
}

export const bus = new Bus();
// SSE istemcisi + watchdog + telegram dinleyicileri; varsayilan 10 limiti uyari uretiyordu.
bus.setMaxListeners(50);
