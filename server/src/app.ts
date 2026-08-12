import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { handleAgentConnection } from './agent/hub.ts';
import { CONFIG } from './config.ts';
import { feedRoutes } from './routes/feed.ts';
import { groupRoutes } from './routes/groups.ts';
import { ruleRoutes } from './routes/rules.ts';
import { settingsRoutes } from './routes/settings.ts';
import { templateRoutes } from './routes/templates.ts';

/**
 * Fastify uygulamasini kurar. Dinlemeye baslamaz - boylece testler
 * app.inject() ile route'lari gercek soket acmadan calistirabilir.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.FBW_LOG_LEVEL ?? 'warn' } });

  /**
   * Fastify'in varsayilan JSON ayristiricisi, Content-Type: application/json
   * gonderilip govde bos birakildiginda istegi 400 ile reddeder. DELETE gibi
   * govdesiz isteklerde bu tamamen mesru bir kombinasyon oldugu icin bos govdeyi
   * hata degil, "govde yok" olarak yorumluyoruz.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      if (body === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (error) {
        // Durum kodu verilmezse Fastify bunu sunucu hatasi sayip 500 doner;
        // bozuk govde istemci hatasidir.
        const failure = error as Error & { statusCode?: number };
        failure.statusCode = 400;
        done(failure, undefined);
      }
    },
  );

  await app.register(websocket);
  await app.register(settingsRoutes);
  await app.register(groupRoutes);
  await app.register(ruleRoutes);
  await app.register(templateRoutes);
  await app.register(feedRoutes);

  app.get('/agent', { websocket: true }, (socket) => {
    handleAgentConnection(socket);
  });

  // UI derlenmisse statik servis edilir; dev'de Vite sunucusu kullanildigi icin olmayabilir.
  if (fs.existsSync(CONFIG.publicDir)) {
    await app.register(fastifyStatic, { root: CONFIG.publicDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/agent')) {
        return reply.status(404).send({ error: 'Bulunamadi' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
