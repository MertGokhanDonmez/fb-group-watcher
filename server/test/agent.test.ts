import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerToAgentMessage } from '../../shared/protocol.ts';
import { dropTempDb, useTempDb } from './helpers.ts';

let app: FastifyInstance;
let url: string;
let token: string;

beforeAll(async () => {
  useTempDb();
  const { buildApp } = await import('../src/app.ts');
  const { ensureAgentToken } = await import('../src/repo/settings.ts');
  token = ensureAgentToken();
  app = await buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address() as AddressInfo;
  url = `ws://127.0.0.1:${address.port}/agent`;
});

afterAll(async () => {
  await app.close();
  dropTempDb();
});

interface Handshake {
  socket: WebSocket;
  reply: ServerToAgentMessage;
}

/** Baglanir, hello gonderir ve sunucunun ilk yanitini doner. */
function handshake(options: {
  token?: string;
  protocolVersion?: number;
  instanceId: string;
}): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('yanit gelmedi')), 5000);

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          token: options.token ?? token,
          protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
          extVersion: 'test-1.0',
          instanceId: options.instanceId,
        }),
      );
    });

    socket.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as ServerToAgentMessage;
      // 'config' hello_ok'tan hemen sonra gelir; ilk anlamli yaniti bekliyoruz.
      if (message.type !== 'hello_ok' && message.type !== 'hello_error') return;
      clearTimeout(timer);
      resolve({ socket, reply: message });
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const closed = (socket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.on('close', () => resolve());
  });

describe('ajan el sikismasi', () => {
  it('gecerli token ile kabul eder', async () => {
    const { socket, reply } = await handshake({ instanceId: 'ornek-A' });
    expect(reply.type).toBe('hello_ok');
    socket.close();
    await closed(socket);
  });

  it('yanlis token ile reddeder', async () => {
    const { socket, reply } = await handshake({ token: 'yanlis', instanceId: 'ornek-X' });
    expect(reply.type).toBe('hello_error');
    await closed(socket);
  });

  it('protokol surumu uyusmazsa reddeder', async () => {
    const { socket, reply } = await handshake({
      protocolVersion: PROTOCOL_VERSION + 99,
      instanceId: 'ornek-Y',
    });
    expect(reply.type).toBe('hello_error');
    if (reply.type === 'hello_error') expect(reply.reason).toContain('protokol');
    await closed(socket);
  });

  /**
   * Regresyon: sunucu eskiden her yeni baglantiyi kabul edip oncekini duserdi.
   * Eklentinin iki kopyasi yuklendiginde ikisi birbirini surekli dusuruyor ve
   * saniyede birkac kez yeniden baglanan bir kilitlenme olusuyordu.
   */
  it('ikinci bir eklenti ornegini reddeder, mevcut baglantiyi dusurmez', async () => {
    const first = await handshake({ instanceId: 'ornek-1' });
    expect(first.reply.type).toBe('hello_ok');

    const second = await handshake({ instanceId: 'ornek-2' });
    expect(second.reply.type).toBe('hello_error');
    if (second.reply.type === 'hello_error') {
      expect(second.reply.reason).toContain('eklenti ornegi');
    }

    // Kritik nokta: ilk baglanti hayatta kalmali.
    expect(first.socket.readyState).toBe(WebSocket.OPEN);

    first.socket.close();
    await Promise.all([closed(first.socket), closed(second.socket)]);
  });

  it('ayni ornek yeniden baglanabilir (service worker yeniden basladiginda)', async () => {
    const first = await handshake({ instanceId: 'ornek-3' });
    expect(first.reply.type).toBe('hello_ok');

    // Ayni instanceId: bu bir kopya degil, ayni eklentinin yeniden baglanmasi.
    const again = await handshake({ instanceId: 'ornek-3' });
    expect(again.reply.type).toBe('hello_ok');

    again.socket.close();
    await closed(again.socket);
  });
});
