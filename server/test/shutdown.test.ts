import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dropTempDb, useTempDb } from './helpers.ts';

beforeAll(() => useTempDb());
afterAll(() => dropTempDb());

/**
 * Regresyon: panelin canli akisi (SSE) ve eklentinin soketi hic kapanmayan
 * baglantilar. app.close() onlari bekledigi icin Ctrl+C sunucuyu durduramiyordu.
 */
describe('kapanis', () => {
  it('acik SSE ve WebSocket baglantisi varken de kapanir', async () => {
    const { buildApp } = await import('../src/app.ts');
    const app = await buildApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;

    // Panelin canli akisi: ilk kare gelene kadar bekle ki baglanti gercekten acik olsun.
    const stream = await new Promise<http.IncomingMessage>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/api/stream`, (response) => {
          response.once('data', () => resolve(response));
        })
        .on('error', reject);
    });
    stream.on('error', () => undefined); // kapanista kesilmesi beklenen davranis

    const socket = new WebSocket(`ws://127.0.0.1:${port}/agent`);
    socket.on('error', () => undefined);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));

    const outcome = await Promise.race([
      app.close().then(() => 'closed' as const),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 3000)),
    ]);
    expect(outcome).toBe('closed');
  });
});
