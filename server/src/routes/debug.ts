import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requestCapture } from '../agent/hub.ts';
import { CONFIG } from '../config.ts';
import { logEvent } from '../repo/events.ts';

/**
 * Teshis ucu.
 *
 * Bu projede en olasi ariza Facebook'un DOM'unu degistirmesi. Onarim icin gercek
 * sayfanin HTML'i gerekiyor ve onu elle almak (DevTools > Copy outerHTML) zahmetli.
 * Bu uc, eklentiye sayfayi gecici bir sekmede actirip ham HTML'i yerel diske yazar.
 *
 * Snapshot Facebook oturumundaki kisisel icerigi de tasir; bu yuzden yalnizca
 * data/ altina yazilir (git'te yok) ve disari hicbir yere gonderilmez.
 */

const CAPTURE_TIMEOUT_MS = 120_000;

const captureSchema = z.object({
  url: z.string().url().startsWith('https://www.facebook.com/'),
  /** Dosya adi; yoksa zaman damgasi kullanilir. */
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,60}$/)
    .optional(),
  /** Sayfa yuklendikten sonra icerigin render olmasi icin beklenecek sure. */
  dwellMs: z.number().int().min(1000).max(60_000).default(8000),
});

export const debugRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/debug/capture', async (request, reply) => {
    const parsed = captureSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Gecersiz istek', detail: parsed.error.flatten() });
    }

    const result = await requestCapture(parsed.data.url, parsed.data.dwellMs, CAPTURE_TIMEOUT_MS);
    if (!result.ok || result.html === undefined) {
      logEvent('debug', 'warn', `Snapshot alinamadi: ${result.error ?? 'bilinmiyor'}`, {
        url: parsed.data.url,
      });
      return reply.status(502).send({ error: result.error ?? 'Snapshot alinamadi' });
    }

    const dir = path.join(CONFIG.dbPath, '..', 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${parsed.data.name ?? 'snapshot'}-${stamp}.html`);
    fs.writeFileSync(file, result.html, 'utf8');

    logEvent('debug', 'info', `Snapshot kaydedildi: ${path.basename(file)}`, { url: result.url });
    return { file, bytes: result.html.length, url: result.url };
  });
};
