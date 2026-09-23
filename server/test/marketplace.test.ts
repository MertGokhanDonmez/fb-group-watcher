import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MarketplaceCard, MarketplaceListing, ParseStats } from '../../shared/protocol.ts';
import {
  ingestMarketplaceListing,
  ingestMarketplaceResults,
  MAX_VISITS_PER_SEARCH,
} from '../src/marketplace/ingest.ts';
import {
  buildMarketplaceSearches,
  buildMarketplaceWatch,
  titleWorthVisiting,
} from '../src/marketplace/searches.ts';
import { formatMatchMessage } from '../src/notify/telegram.ts';
import { processNewPosts } from '../src/pipeline.ts';
import { createGroup } from '../src/repo/groups.ts';
import { listMatchDetails } from '../src/repo/matches.ts';
import { getPostByFbId, marketplacePostId } from '../src/repo/posts.ts';
import { createRule, type RuleInput } from '../src/repo/rules.ts';
import { getSettings } from '../src/repo/settings.ts';
import type { Rule } from '../src/types.ts';
import { dropTempDb, useTempDb } from './helpers.ts';

const STATS: ParseStats = { articlesSeen: 1, postsParsed: 1, failures: 0 };

function ruleInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    name: 'Mobilya',
    enabled: true,
    matchMode: 'any',
    includeKeywords: ['gauč', 'stůl'],
    excludeKeywords: [],
    regex: null,
    actionComment: false,
    actionDm: false,
    actionNotify: true,
    requireApproval: true,
    commentTemplateId: null,
    dmTemplateId: null,
    dailyCap: 20,
    maxPostAgeMin: 60,
    maxDistanceKm: null,
    searchMarketplace: true,
    priority: 1,
    groupIds: [],
    ...overrides,
  };
}

let counter = 1000;
function card(overrides: Partial<MarketplaceCard> = {}): MarketplaceCard {
  counter += 1;
  const listingId = String(counter);
  return {
    listingId,
    url: `https://www.facebook.com/marketplace/item/${listingId}/`,
    title: 'Gauč',
    priceText: 'Zdarma',
    priceAmount: 0,
    locationText: 'Praha',
    imageUrl: null,
    ...overrides,
  };
}

function listing(from: MarketplaceCard, overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    listingId: from.listingId,
    url: from.url,
    title: from.title,
    description: 'Daruji gauč, Praha 3.',
    priceText: from.priceText,
    priceAmount: from.priceAmount,
    locationText: 'Praha',
    sellerName: 'Jana',
    sellerProfileUrl: null,
    imageUrls: [],
    postedAt: Date.now() - 5 * 60_000,
    postedAtLabel: null,
    ...overrides,
  };
}

/** Karti aramadan, ilani sayfadan gecirir ve olusan eslesmelerin kural adlarini doner. */
function run(from: MarketplaceCard, overrides: Partial<MarketplaceListing> = {}): string[] {
  ingestMarketplaceResults('search', 'gauč', [from], STATS);
  const before = listMatchDetails(500).length;
  const post = ingestMarketplaceListing(listing(from, overrides));
  if (post?.freeVerified === true) processNewPosts([post]);
  const all = listMatchDetails(500);
  return all.slice(0, all.length - before).map((match) => match.ruleName);
}

beforeAll(() => {
  useTempDb();
  const group = createGroup({
    fbGroupId: 'bedava-esya',
    name: 'Bedava Esya',
    url: 'https://www.facebook.com/groups/bedava-esya/',
    dwellMs: 8000,
    priority: 1,
    enabled: true,
    dailyActionCap: 10,
  });
  // Grup secimi Marketplace'i kisitlamamali.
  createRule(ruleInput({ groupIds: [group.id] }));
  createRule(ruleInput({ name: 'Sadece gruplar', includeKeywords: ['gauč'], searchMarketplace: false }));
});

afterAll(() => dropTempDb());

describe('buildMarketplaceSearches', () => {
  const rule = (overrides: Partial<Rule>): Rule => ({
    ...ruleInput(),
    id: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  });

  it('ayni kelimeyi tek aramada toplar, yaricap en genis kuraldan gelir', () => {
    const searches = buildMarketplaceSearches(
      [
        rule({ includeKeywords: ['Gauč', 'stůl'], maxDistanceKm: 3 }),
        rule({ includeKeywords: ['gauc'], maxDistanceKm: 7.5 }),
      ],
      getSettings(),
    );
    expect(searches.map((search) => search.query)).toEqual(['Gauč', 'stůl']);
    const url = new URL(searches[0]!.url);
    expect(url.pathname).toBe('/marketplace/prague/search/');
    expect(url.searchParams.get('query')).toBe('Gauč');
    expect(url.searchParams.get('radius')).toBe('8');
    expect(url.searchParams.get('maxPrice')).toBe('10');
    expect(url.searchParams.get('sortBy')).toBe('creation_time_descend');
    expect(new URL(searches[1]!.url).searchParams.get('radius')).toBe('3');
  });

  it('mesafesi sinirsiz kural varsa yaricap vermez', () => {
    const searches = buildMarketplaceSearches(
      [rule({ includeKeywords: ['gauč'], maxDistanceKm: 3 }), rule({ includeKeywords: ['gauč'] })],
      getSettings(),
    );
    expect(new URL(searches[0]!.url).searchParams.has('radius')).toBe(false);
  });

  it('pasif ve Marketplace disi kurallari atlar', () => {
    const searches = buildMarketplaceSearches(
      [
        rule({ includeKeywords: ['a'], enabled: false }),
        rule({ includeKeywords: ['b'], searchMarketplace: false }),
      ],
      getSettings(),
    );
    expect(searches).toEqual([]);
  });

  it('Marketplace kapaliyken arama uretmez', () => {
    const settings = { ...getSettings(), marketplaceEnabled: false };
    expect(buildMarketplaceSearches([rule({})], settings)).toEqual([]);
  });
});

describe('buildMarketplaceWatch', () => {
  const rule = (overrides: Partial<Rule>): Rule => ({
    ...ruleInput(),
    id: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  });

  it('genel sayfayi en genis yaricapla ve anahtar kelimesiz uretir', () => {
    const watch = buildMarketplaceWatch(
      [rule({ maxDistanceKm: 3 }), rule({ maxDistanceKm: 6 })],
      getSettings(),
    );
    const url = new URL(watch.browse!.url);
    expect(url.pathname).toBe('/marketplace/prague/');
    expect(url.searchParams.has('query')).toBe(false);
    expect(url.searchParams.get('radius')).toBe('6');
    expect(url.searchParams.get('maxPrice')).toBe('10');
    expect(url.searchParams.get('sortBy')).toBe('creation_time_descend');
    expect(watch.browse!.intervalMs).toBe(300_000);
    expect(watch.searchIntervalMs).toBe(3_600_000);
  });

  it('elle girilen adresi oldugu gibi kullanir', () => {
    const settings = {
      ...getSettings(),
      marketplaceBrowseUrl: 'https://www.facebook.com/marketplace/prague/free/',
    };
    expect(buildMarketplaceWatch([rule({})], settings).browse?.url).toBe(
      'https://www.facebook.com/marketplace/prague/free/',
    );
  });

  it('Marketplace kurali yoksa genel sayfa taranmaz', () => {
    expect(buildMarketplaceWatch([rule({ searchMarketplace: false })], getSettings()).browse).toBeNull();
  });

  it('yedek aramalar kapaliyken arama listesi bos', () => {
    const settings = { ...getSettings(), marketplaceSearchEnabled: false };
    const watch = buildMarketplaceWatch([rule({})], settings);
    expect(watch.searches).toEqual([]);
    expect(watch.browse).not.toBeNull();
  });
});

describe('titleWorthVisiting', () => {
  const rules = (): Rule[] => [
    { ...ruleInput({ matchMode: 'all', excludeKeywords: ['koupím'] }), id: 1, createdAt: 0, updatedAt: 0 },
  ];

  it('basligi kural kelimesi iceren karti secer; hepsi modunda tek kelime yeter', () => {
    expect(titleWorthVisiting('Rohový gauč', rules())).toBe(true);
  });

  it('alakasiz basligi, haric kelimeyi ve bos basligi eler', () => {
    expect(titleWorthVisiting('Kolo', rules())).toBe(false);
    expect(titleWorthVisiting('Koupím gauč', rules())).toBe(false);
    expect(titleWorthVisiting(null, rules())).toBe(false);
  });
});

describe('ingestMarketplaceResults', () => {
  it('genel sayfada yalnizca basligi kurala uyan karti aday yapar, digerini kaydetmez', () => {
    const match = card({ title: 'Jídelní stůl' });
    const other = card({ title: 'Dětské kolo' });
    expect(ingestMarketplaceResults('browse', null, [other, match], STATS)).toEqual([
      { listingId: match.listingId, url: match.url },
    ]);
    expect(getPostByFbId(marketplacePostId(other.listingId))).toBeNull();
  });

  it('aramada baslik suzmesi yapmaz: kelime aciklamada olabilir', () => {
    const untitled = card({ title: 'Nábytek' });
    expect(ingestMarketplaceResults('search', 'stůl', [untitled], STATS)).toHaveLength(1);
  });

  it('yeni adayi kaydeder ve acilmasini ister', () => {
    const fresh = card();
    expect(ingestMarketplaceResults('search', 'gauč', [fresh], STATS)).toEqual([
      { listingId: fresh.listingId, url: fresh.url },
    ]);
    const saved = getPostByFbId(marketplacePostId(fresh.listingId));
    expect(saved?.kind).toBe('marketplace');
    expect(saved?.freeVerified).toBeNull();
  });

  it('fiyat siniri ustundeki ilani aday yapmaz', () => {
    expect(ingestMarketplaceResults('search', 'gauč', [card({ priceText: '500 Kč', priceAmount: 500 })], STATS)).toEqual(
      [],
    );
  });

  it('acilmis ilani tekrar istemez', () => {
    const seen = card();
    run(seen);
    expect(ingestMarketplaceResults('search', 'gauč', [seen], STATS)).toEqual([]);
  });

  it('tek aramadan sinirli sayida ilan acar, kalanlar sonraki turda gelir', () => {
    const batch = Array.from({ length: MAX_VISITS_PER_SEARCH + 3 }, () => card());
    const first = ingestMarketplaceResults('search', 'gauč', batch, STATS);
    expect(first).toHaveLength(MAX_VISITS_PER_SEARCH);
    // Ilk turda istenenlerin sonucu gelmedi (ornegin sayfa ayristirilamadi); bunlar
    // sirayi kapatmamali, sonraki turda arkadaki adaylar istenmeli.
    const second = ingestMarketplaceResults('search', 'gauč', batch, STATS);
    expect(second.map((visit) => visit.listingId)).toEqual(
      batch.slice(MAX_VISITS_PER_SEARCH).map((item) => item.listingId),
    );
  });
});

describe('Marketplace -> eslestirme', () => {
  it('aciklamasinda bedava yazan ilani eslestirir, grup secimine takilmaz', () => {
    expect(run(card())).toEqual(['Mobilya']);
  });

  it('fiyat alani Zdarma olsa da aciklamada bedava yoksa eslestirmez', () => {
    expect(run(card(), { description: 'Gauč, cena dohodou. Pište do zpráv.' })).toEqual([]);
  });

  it('kargo bedava ifadesini bedava saymaz', () => {
    expect(run(card(), { description: 'Gauč 1500 Kč, doprava zdarma' })).toEqual([]);
  });

  it('anahtar kelime yalnizca baslikta olsa da eslesir', () => {
    expect(run(card({ title: 'Stůl' }), { description: 'Daruji, jen odvoz.' })).toEqual(['Mobilya']);
  });

  it('bayat ilani eslestirmez', () => {
    expect(run(card(), { postedAt: Date.now() - 3 * 60 * 60_000 })).toEqual([]);
  });

  it('ilan metnindeki semtten konum cikarir, sehir adini konum saymaz', () => {
    const withDistrict = card();
    run(withDistrict);
    expect(getPostByFbId(marketplacePostId(withDistrict.listingId))?.locationName).toBe('Žižkov');

    const cityOnly = card();
    run(cityOnly, { description: 'Daruji gauč.' });
    expect(getPostByFbId(marketplacePostId(cityOnly.listingId))?.locationName).toBeNull();
  });

  it('Telegram mesajinda baslik, fiyat ve bedava dayanagi gorunur', () => {
    const item = card({ title: 'Gauč <rohový>' });
    run(item);
    const detail = listMatchDetails(500).find(
      (match) => match.post.fbPostId === marketplacePostId(item.listingId),
    );
    const message = formatMatchMessage(detail!);
    expect(message).toContain('Marketplace');
    expect(message).toContain('<b>Gauč &lt;rohový&gt; · Zdarma</b>');
    expect(message).toContain('aciklamada: "daruj*"');
    expect(message).toContain('Ilani ac');
  });
});
