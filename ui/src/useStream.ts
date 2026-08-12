import { useEffect, useRef, useState } from 'react';
import type { AgentStatus, MatchDetail, Post } from './api.ts';

export type StreamEvent =
  | { type: 'post'; post: Post }
  | { type: 'match'; match: MatchDetail }
  | { type: 'action'; action: unknown }
  | { type: 'status'; status: AgentStatus }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; at: number };

/**
 * Sunucunun canli olay akisina baglanir.
 * EventSource kesintide kendisi yeniden baglanir; sayfa yenilemeye gerek kalmaz.
 */
export function useStream(onEvent: (event: StreamEvent) => void): boolean {
  const [connected, setConnected] = useState(false);
  // Dinleyiciyi ref'te tutuyoruz ki her render'da EventSource yeniden kurulmasin.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      try {
        handler.current(JSON.parse(event.data) as StreamEvent);
      } catch {
        /* bozuk kare yok sayilir */
      }
    };

    return () => source.close();
  }, []);

  return connected;
}
