import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ParseStats, RawPost } from '../../shared/protocol.ts';
import { NOTIFICATION_CHANNEL } from '../../shared/protocol.ts';
import { bus } from '../src/bus.ts';
import { ingestPosts } from '../src/ingest.ts';
import {
  escapeHtml,
  formatMatchMessage,
  notifyMatch,
  sendTelegramMessage,
  startTelegramAlarms,
} from '../src/notify/telegram.ts';
import { processNewPosts } from '../src/pipeline.ts';
import { createGroup } from '../src/repo/groups.ts';
import { getMatchDetail, listMatchDetails } from '../src/repo/matches.ts';
import { createRule } from '../src/repo/rules.ts';
import { updateSettings } from '../src/repo/settings.ts';
import { dropTempDb, useTempDb } from './helpers.ts';

const STATS: ParseStats = { articlesSeen: 1, postsParsed: 1, failures: 0 };

/** Basarili Bot API cevabini taklit eder. */
function telegramOk(): Response {
  return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
}

function telegramError(status: number, description: string): Response {
  return new Response(JSON.stringify({ ok: false, description }), { status });
}

const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>();

let counter = 0;
function rawPost(text: string): RawPost {
  counter += 1;
  return {
    source: 'notification',
    fbPostId: `tg-${counter}`,
    fbGroupId: 'free.stuff.in.prague',
    permalink: `https://www.facebook.com/groups/free.stuff.in.prague/posts/${counter}/`,
    authorName: 'Tester',
    authorProfileUrl: null,
    authorUserId: null,
    text,
    imageUrls: [],
    postedAt: Date.now() - 60_000,
    postedAtLabel: '1m',
  };
}

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
  useTempDb();
  updateSettings({ telegramBotToken: 'test-token', telegramChatId: '42' });
  createGroup({
    fbGroupId: 'free.stuff.in.prague',
    name: 'Free Stuff in Prague',
    url: 'https://www.facebook.com/groups/free.stuff.in.prague/',
    dwellMs: 8000,
    priority: 1,
    enabled: true,
    dailyActionCap: 10,
  });
  createRule({
    name: 'Free furniture',
    enabled: true,
    matchMode: 'any',
    includeKeywords: ['sofa', 'chair'],
    excludeKeywords: [],
    regex: null,
    actionComment: false,
    actionDm: false,
    actionNotify: true,
    requireApproval: true,
    commentTemplateId: null,
    dmTemplateId: null,
    dailyCap: 20,
    maxPostAgeMin: 30,
    maxDistanceKm: null,
    priority: 1,
    groupIds: [],
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  dropTempDb();
});

afterEach(() => {
  fetchMock.mockReset();
  updateSettings({ telegramBotToken: 'test-token', telegramChatId: '42', killSwitch: false });
});

/** Boru hattindan bir gonderi gecirir ve o gonderiye ait eslesmeyi doner. */
function feed(text: string) {
  const post = rawPost(text);
  processNewPosts(ingestPosts(NOTIFICATION_CHANNEL, [post], STATS));
  const detail = listMatchDetails(100).find((match) => match.post.fbPostId === post.fbPostId);
  if (!detail) throw new Error(`eslesme olusmadi: ${text}`);
  return detail;
}

/** Ayni eslesmenin aksiyonlariyla birlikte guncel halini getirir. */
function refresh(id: number) {
  const detail = getMatchDetail(id);
  if (!detail) throw new Error('eslesme kayboldu');
  return detail;
}

describe('sendTelegramMessage', () => {
  it('dogru URL ve govdeyle gonderir', async () => {
    fetchMock.mockResolvedValueOnce(telegramOk());
    const result = await sendTelegramMessage('merhaba');

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.telegram.org/bottest-token/sendMessage');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.chat_id).toBe('42');
    expect(body.text).toBe('merhaba');
    expect(body.parse_mode).toBe('HTML');
  });

  it('yapilandirilmamissa API cagrisi yapmadan hata doner', async () => {
    updateSettings({ telegramBotToken: '' });
    const result = await sendTelegramMessage('merhaba');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('API hatasinda description alanini yuzeye cikarir', async () => {
    fetchMock.mockResolvedValueOnce(telegramError(400, 'chat not found'));
    const result = await sendTelegramMessage('merhaba');
    expect(result).toEqual({ ok: false, error: 'Telegram API 400: chat not found' });
  });

  it('ag hatasini yakalar, firlatmaz', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await sendTelegramMessage('merhaba');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('formatMatchMessage', () => {
  it('gonderi metnindeki HTML karakterlerini kacislar', () => {
    expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;"');
  });

  it('kural, grup, anahtar kelime ve linki icerir', () => {
    fetchMock.mockResolvedValue(telegramOk());
    const detail = feed('Free sofa <cheap & nice>, pick up today');
    const message = formatMatchMessage(detail);

    expect(message).toContain('<b>Free furniture</b>');
    expect(message).toContain('Free Stuff in Prague');
    expect(message).toContain('<i>sofa</i>');
    expect(message).toContain('&lt;cheap &amp; nice&gt;'); // ham HTML mesaji bozmamali
    expect(message).toContain(`<a href="${detail.post.permalink}">`);
  });
});

describe('notifyMatch', () => {
  it('gonderim sonucunu telegram aksiyonu olarak kaydeder', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(telegramOk()));
    const detail = feed('Free chair, Karlin');
    await notifyMatch(detail);

    const refreshed = refresh(detail.id);
    const action = refreshed.actions.find((a) => a.kind === 'telegram' && a.status === 'sent');
    expect(action).toBeDefined();
    expect(action?.sentAt).not.toBeNull();
  });

  it('basarisiz gonderimi hatasiyla birlikte kaydeder', async () => {
    // Her cagriya taze Response: govde bir kez okunabilir, paylasilan nesne olmaz.
    fetchMock.mockImplementation(() => Promise.resolve(telegramError(401, 'unauthorized')));
    const detail = feed('Free sofa, Vinohrady');
    await notifyMatch(detail);

    // feed() sirasinda boru hattinin tetikledigi bildirim de ayni anda kosuyor;
    // her iki kaydin da sonuclanmasini bekle.
    await vi.waitFor(() => {
      const actions = refresh(detail.id).actions.filter((a) => a.kind === 'telegram');
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action.status).toBe('failed');
        expect(action.error).toContain('unauthorized');
      }
    });
  });

  it('kill switch acikken gondermez, iptal kaydi birakir', async () => {
    fetchMock.mockResolvedValue(telegramOk());
    updateSettings({ killSwitch: true });
    const detail = feed('Free chair, Zizkov');
    await notifyMatch(detail);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh(detail.id).actions.find((a) => a.kind === 'telegram')?.status).toBe('cancelled');
  });

  it('yapilandirilmamissa aksiyon kaydi bile olusturmaz', async () => {
    updateSettings({ telegramBotToken: '' });
    const detail = feed('Free sofa, Smichov');
    await notifyMatch(detail);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh(detail.id).actions.filter((a) => a.kind === 'telegram')).toEqual([]);
  });

  it('boru hatti eslesince bildirimi kendiliginden tetikler', async () => {
    fetchMock.mockResolvedValue(telegramOk());
    feed('Free sofa in Letna, come get it');
    // processNewPosts gonderimi beklemez; mock'un cagrilmasini bekle.
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});

describe('startTelegramAlarms', () => {
  it('error seviyesindeki gunlugu iletir, aynisini pencere icinde tekrarlamaz', async () => {
    fetchMock.mockResolvedValue(telegramOk());
    const stop = startTelegramAlarms();

    bus.emitEvent({ type: 'log', level: 'error', message: 'Eklenti cevrimdisi', at: Date.now() });
    bus.emitEvent({ type: 'log', level: 'error', message: 'Eklenti cevrimdisi', at: Date.now() });
    bus.emitEvent({ type: 'log', level: 'warn', message: 'Onemsiz uyari', at: Date.now() });
    bus.emitEvent({ type: 'log', level: 'error', message: 'Selector bozuldu', at: Date.now() });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const texts = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(String(init?.body)) as { text: string }).text,
    );
    expect(texts[0]).toContain('Eklenti cevrimdisi');
    expect(texts[1]).toContain('Selector bozuldu');

    stop();
    bus.emitEvent({ type: 'log', level: 'error', message: 'Durduktan sonra', at: Date.now() });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
