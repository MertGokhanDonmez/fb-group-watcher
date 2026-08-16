import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dropTempDb, useTempDb } from './helpers.ts';

let app: FastifyInstance;

beforeAll(async () => {
  useTempDb();
  // buildApp veritabanina dokunan modulleri import ettigi icin useTempDb'den sonra yuklenmeli.
  const { buildApp } = await import('../src/app.ts');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  dropTempDb();
});

async function createGroup(url: string, name: string): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ url, name }),
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: number }).id;
}

describe('govdesiz istekler', () => {
  /**
   * Regresyon: panel her istege Content-Type: application/json ekliyordu.
   * Fastify'in varsayilan ayristiricisi bos govdeyi 400 ile reddettigi icin
   * TUM silme islemleri ve token yenileme sessizce basarisiz oluyordu.
   */
  it('DELETE, application/json basligiyla ve bos govdeyle calisir', async () => {
    const id = await createGroup('https://www.facebook.com/groups/silme-testi-a', 'Silme A');

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${id}`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(204);
    const groups = (await app.inject({ method: 'GET', url: '/api/groups' })).json() as unknown[];
    expect(groups).toHaveLength(0);
  });

  it('DELETE, baslik olmadan da calisir', async () => {
    const id = await createGroup('https://www.facebook.com/groups/silme-testi-b', 'Silme B');
    const response = await app.inject({ method: 'DELETE', url: `/api/groups/${id}` });
    expect(response.statusCode).toBe(204);
  });

  it('govdesiz POST (token yenileme) calisir', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/agent-token/regenerate',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { token: string }).token).toHaveLength(48);
  });

  it('bozuk JSON govdesi hala reddedilir', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { 'content-type': 'application/json' },
      payload: '{bozuk',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('grup dogrulama', () => {
  it('facebook grup adresi olmayan girdiyi reddeder', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ url: 'https://example.com/sayfa' }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('ayni grubu iki kez eklemez', async () => {
    await createGroup('https://www.facebook.com/groups/tekrar-testi', 'Tekrar');
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ url: 'https://www.facebook.com/groups/tekrar-testi/?ref=x' }),
    });
    expect(response.statusCode).toBe(409);
  });

  it('olmayan grubu silmeye calisinca 404 doner', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/groups/99999' });
    expect(response.statusCode).toBe(404);
  });
});

describe('kelime arama (probe)', () => {
  async function createRule(payload: Record<string, unknown>): Promise<number> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rules',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: number }).id;
  }

  async function probe(query: string): Promise<Array<Record<string, unknown>>> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/rules/probe?q=${encodeURIComponent(query)}`,
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { results: Array<Record<string, unknown>> }).results;
  }

  it('birebir listedeki kelimeyi listedIn ile isaretler', async () => {
    const id = await createRule({
      name: 'Probe birebir',
      includeKeywords: ['bed', 'sofa'],
      excludeKeywords: [],
    });
    const row = (await probe('bed')).find((item) => item.ruleId === id);
    expect(row?.listedIn).toBe('include');
    expect(row?.matched).toBe(true);
  });

  /**
   * Panelin varlik sebebi bu ayrim: "bedside" listede yazmaz ama "bed" onek
   * eslesmesiyle onu da yakalar. Sadece birebir arama gosterseydik kullanici
   * zaten kapsanan terimi tekrar ekleyip listeyi sisirirdi.
   */
  it('listede yazmayan ama onek ile yakalanan terimi ayirt eder', async () => {
    const id = await createRule({
      name: 'Probe onek',
      includeKeywords: ['bed'],
      excludeKeywords: [],
    });
    const row = (await probe('bedside')).find((item) => item.ruleId === id);
    expect(row?.listedIn).toBeNull();
    expect(row?.matched).toBe(true);
    expect(row?.includeHits).toEqual(['bed']);
  });

  it('haric tutulan kelimeyi veto olarak raporlar', async () => {
    const id = await createRule({
      name: 'Probe veto',
      includeKeywords: ['chair'],
      excludeKeywords: ['sold'],
    });
    const row = (await probe('sold')).find((item) => item.ruleId === id);
    expect(row?.listedIn).toBe('exclude');
    expect(row?.matched).toBe(false);
    expect(row?.reason).toBe('excluded');
  });

  it('bos sorguyu 400 ile reddeder', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/rules/probe?q=' });
    expect(response.statusCode).toBe(400);
  });
});
