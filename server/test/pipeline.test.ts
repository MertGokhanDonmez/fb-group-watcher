import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParseStats, RawPost } from '../../shared/protocol.ts';
import { NOTIFICATION_CHANNEL } from '../../shared/protocol.ts';
import { ingestPosts } from '../src/ingest.ts';
import { processNewPosts } from '../src/pipeline.ts';
import { createGroup } from '../src/repo/groups.ts';
import { listMatchDetails } from '../src/repo/matches.ts';
import { createRule } from '../src/repo/rules.ts';
import { dropTempDb, useTempDb } from './helpers.ts';

const STATS: ParseStats = { articlesSeen: 1, postsParsed: 1, failures: 0 };

let counter = 0;
function notification(text: string, overrides: Partial<RawPost> = {}): RawPost {
  counter += 1;
  return {
    source: 'notification',
    fbPostId: `p-${counter}`,
    fbGroupId: 'free.stuff.in.prague',
    permalink: `https://www.facebook.com/groups/free.stuff.in.prague/posts/${counter}/`,
    authorName: 'Tester',
    authorProfileUrl: null,
    authorUserId: null,
    text,
    imageUrls: [],
    postedAt: Date.now() - 60_000,
    postedAtLabel: '1m',
    ...overrides,
  };
}

/** Bir gonderiyi boru hattindan gecirir ve olusan eslesmelerin anahtar kelimelerini doner. */
function feed(post: RawPost): string[][] {
  const before = listMatchDetails(200).length;
  processNewPosts(ingestPosts(NOTIFICATION_CHANNEL, [post], STATS));
  const all = listMatchDetails(200);
  return all.slice(0, all.length - before).map((match) => match.matchedKeywords);
}

beforeAll(() => {
  useTempDb();
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
    includeKeywords: ['sofa', 'chair', 'table', 'desk'],
    excludeKeywords: ['for sale', 'selling', 'looking for', 'wanted'],
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

afterAll(() => dropTempDb());

describe('yakalama -> eslestirme boru hatti', () => {
  it('anahtar kelime gecen Ingilizce gonderiyi eslestirir', () => {
    expect(feed(notification('Free sofa in Praha 3, pick up today'))).toEqual([['sofa']]);
  });

  it('satis ilanini eler', () => {
    expect(feed(notification('Sofa for sale, 2000 CZK'))).toEqual([]);
  });

  it('esya arayan ilani eler', () => {
    expect(feed(notification('Looking for a chair for my flat'))).toEqual([]);
  });

  it('alakasiz gonderiyi eslestirmez', () => {
    expect(feed(notification('Free bicycle helmet, Karlin'))).toEqual([]);
  });

  it('aksanli metinde de eslesir', () => {
    expect(feed(notification('ZDARMA: křeslo a stůl, Žižkov (chair and table)'))).toEqual([
      ['chair', 'table'],
    ]);
  });

  it('bayat gonderiye eslesme uretmez', () => {
    const stale = notification('Free desk, still available', {
      postedAt: Date.now() - 3 * 60 * 60_000,
    });
    expect(feed(stale)).toEqual([]);
  });

  it('bildirim onekindeki grup adi yanlis eslesme uretmez', () => {
    // Grup adi "Free Stuff in Prague" metinde kalsaydi her bildirim eslesirdi;
    // burada anahtar kelime yok, dolayisiyla eslesme de olmamali.
    const withPrefix = notification(
      'Jan Novak posted in Free Stuff in Prague: giving away a bicycle helmet',
    );
    expect(feed(withPrefix)).toEqual([]);
  });

  it('ayni gonderi iki kez gelirse ikinci eslesme uretmez', () => {
    const post = notification('Free wooden desk, Vinohrady');
    expect(feed(post)).toEqual([['desk']]);
    // Ayni gonderi grup taramasindan tekrar gelir; dedupe devrede olmali.
    expect(feed({ ...post, source: 'feed' })).toEqual([]);
  });

  it('bildirimde kacan anahtar kelimeyi tam metin gelince yakalar', () => {
    // Bildirim metni kisaltilmis: anahtar kelime "sofa" gorunmuyor.
    const truncated = notification('Jan posted: giving away a nice comfortable');
    expect(feed(truncated)).toEqual([]);

    // Grup taramasi ayni gonderiyi tam metniyle getirir. Post zaten var, zenginlestirilir
    // ama metin buyudugu icin yeniden eslestirilmeli - guvenlik agi burada devreye girer.
    const full = { ...truncated, source: 'feed' as const, text: 'giving away a nice comfortable sofa, Karlin' };
    expect(feed(full)).toEqual([['sofa']]);
  });
});
