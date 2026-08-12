import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { bus, type BusEvent } from '../bus.ts';
import { getAgentStatus } from '../agent/status.ts';
import { listEvents } from '../repo/events.ts';
import { listMatchDetails } from '../repo/matches.ts';
import { deleteAllPosts, listRecentPosts } from '../repo/posts.ts';
import { logEvent } from '../repo/events.ts';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  groupId: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'approved', 'sent', 'failed', 'skipped', 'ignored']).optional(),
});

export const feedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/posts', async (request) => {
    const query = listQuery.parse(request.query ?? {});
    return listRecentPosts(query.limit, query.groupId);
  });

  /**
   * Yakalanan gonderileri ve bagli eslesmeleri siler.
   * Gruplar, kurallar ve sablonlar korunur - bu bir sifirlama degil, temizliktir.
   */
  app.delete('/api/posts', async () => {
    const removed = deleteAllPosts();
    logEvent('maintenance', 'info', `${removed} yakalanan gonderi elle temizlendi`);
    return { removed };
  });

  app.get('/api/matches', async (request) => {
    const query = listQuery.parse(request.query ?? {});
    return listMatchDetails(query.limit, query.status);
  });

  app.get('/api/events', async (request) => {
    const query = listQuery.parse(request.query ?? {});
    return listEvents(query.limit);
  });

  /**
   * UI'in canli akisi. Yeni post, eslesme, aksiyon ve durum degisiklikleri buradan akar;
   * boylece panel surekli sorgu atmak zorunda kalmaz.
   */
  app.get('/api/stream', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const write = (event: BusEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Yeni baglanan istemci mevcut durumu hemen gorsun.
    write({ type: 'status', status: getAgentStatus() });

    const unsubscribe = bus.subscribe(write);
    // Proxy/tarayici zaman asimini onlemek icin periyodik yorum satiri.
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 25_000);

    const cleanup = (): void => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
};
