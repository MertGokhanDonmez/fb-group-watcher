import type {
  MarketplaceCard,
  MarketplaceListing,
  MarketplaceSource,
  MarketplaceVisit,
  ParseStats,
} from '../../../shared/protocol.ts';
import { patchAgentStatus } from '../agent/status.ts';
import { bus } from '../bus.ts';
import { resolveLocation } from '../ingest.ts';
import { checkFreeDescription } from '../matcher/free.ts';
import { logEvent } from '../repo/events.ts';
import {
  getPostByFbId,
  insertMarketplaceCard,
  marketplacePostId,
  saveMarketplaceListing,
} from '../repo/posts.ts';
import { listEnabledRules } from '../repo/rules.ts';
import { getSettings } from '../repo/settings.ts';
import type { Post } from '../types.ts';
import { buildMarketplaceSearches, titleWorthVisiting } from './searches.ts';

/**
 * Tek sayfadan en fazla bu kadar ilan acilir. Ilk turda sonuclarin hepsi yeni
 * gorunur; hepsini birden acmak kisa surede onlarca sayfa yuklemesi demek.
 * Kalan adaylar sonraki turlarda sirayla acilir (siralama en yeni once).
 */
export const MAX_VISITS_PER_SEARCH = 4;

/** Bundan eski ve hala acilmamis aday birakilir: bedava esya o surede coktan gitmistir. */
const CANDIDATE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Acilmasi istenen ama sonucu gelmeyen ilan bu sure boyunca tekrar istenmez.
 * Aksi halde sayfasi ayristirilamayan birkac ilan her turda ilk siralari kapar
 * ve arkadaki adaylar hic acilmaz.
 */
const REVISIT_AFTER_MS = 30 * 60 * 1000;
const visitRequestedAt = new Map<string, number>();

function pruneVisitRequests(now: number): void {
  for (const [listingId, at] of visitRequestedAt) {
    if (now - at > CANDIDATE_TTL_MS) visitRequestedAt.delete(listingId);
  }
}

/** Ust uste bu kadar ilanda aciklama bos gelirse ayristirici bozulmus sayilir. */
const EMPTY_DESCRIPTION_ALERT = 5;

/**
 * Sonuc kartlarini isler ve acilmasi gereken ilanlari doner.
 *
 * Kartta aciklama olmadigi icin burada eslestirme YAPILMAZ; kart yalnizca aday
 * olarak kaydedilir. Bedava karari ilan sayfasi geldiginde verilir.
 *
 * Genel sayfa sehirdeki tum ucuz ilanlari getirir; yalnizca basligi bir kurala
 * uyanlar aday olur, digerleri kaydedilmez bile. Anahtar kelime aramasinda bu
 * suzme yapilmaz: kelime aciklamada gecse bile Facebook'un aramasi ilani bulmustur.
 */
export function ingestMarketplaceResults(
  source: MarketplaceSource,
  query: string | null,
  cards: MarketplaceCard[],
  stats: ParseStats,
): MarketplaceVisit[] {
  const settings = getSettings();
  const now = Date.now();
  const visits: MarketplaceVisit[] = [];
  const rules = source === 'browse' ? listEnabledRules() : [];
  const options = { turkishSuffixes: settings.turkishSuffixMatching };

  for (const card of cards) {
    // Sayfa adresindeki fiyat filtresine ek guvence; fiyat bilinmiyorsa aday kalir.
    if (card.priceAmount !== null && card.priceAmount > settings.marketplaceMaxPrice) continue;
    if (source === 'browse' && !titleWorthVisiting(card.title, rules, options)) continue;

    const existing = getPostByFbId(marketplacePostId(card.listingId));
    if (existing) {
      if (existing.freeVerified !== null) continue; // ilan zaten acildi
      if (now - existing.seenAt > CANDIDATE_TTL_MS) continue;
    } else {
      insertMarketplaceCard(
        card,
        resolveLocation(card.locationText ?? '', { allowGeneric: false }),
      );
    }
    if (visits.length >= MAX_VISITS_PER_SEARCH) continue;
    const requestedAt = visitRequestedAt.get(card.listingId);
    if (requestedAt !== undefined && now - requestedAt < REVISIT_AFTER_MS) continue;
    visitRequestedAt.set(card.listingId, now);
    visits.push({ listingId: card.listingId, url: card.url });
  }
  pruneVisitRequests(now);

  patchAgentStatus({
    lastParseAt: now,
    currentGroup: source === 'browse' ? 'marketplace: genel sayfa' : `marketplace: ${query ?? '-'}`,
  });
  updatePageHealth(source, stats);
  return visits;
}

/**
 * Ilan sayfasindan gelen kaydi yazar ve bedava kararini verir.
 * Donen post freeVerified=true ise eslestirmeye gonderilmeli.
 */
export function ingestMarketplaceListing(listing: MarketplaceListing): Post | null {
  const settings = getSettings();
  const verdict = checkFreeDescription(
    listing.description,
    settings.marketplaceFreePhrases,
    settings.marketplaceNotFreePhrases,
  );
  const location = resolveLocation(
    [listing.title ?? '', listing.description, listing.locationText ?? ''].join('\n'),
    { allowGeneric: false },
  );

  const post = saveMarketplaceListing(listing, location, verdict);
  if (post) bus.emitEvent({ type: 'post', post });
  updateDescriptionHealth(listing);
  return post;
}

/* ---------- Ayristirici sagligi ---------- */

/**
 * Genel sayfa sehirdeki tum ucuz ilanlari gosterdigi icin bos donmesi anormaldir;
 * birkac tur ust uste bossa ayristirici bozulmustur. Tek bir anahtar kelime
 * aramasinin bos donmesi ise normaldir (nadir kelime); orada ancak butun aramalar
 * birkac tur ust uste bos donerse alarm verilir.
 */
const emptyStreak: Record<MarketplaceSource, number> = { browse: 0, search: 0 };
const alertSent: Record<MarketplaceSource, boolean> = { browse: false, search: false };

function updatePageHealth(source: MarketplaceSource, stats: ParseStats): void {
  const label = source === 'browse' ? 'Marketplace genel sayfasi' : 'Marketplace aramalari';
  if (stats.postsParsed > 0) {
    emptyStreak[source] = 0;
    if (alertSent[source]) {
      alertSent[source] = false;
      logEvent('selector_health', 'info', `${label} yeniden ilan buluyor`);
    }
    return;
  }

  emptyStreak[source] += 1;
  const settings = getSettings();
  const pages =
    source === 'browse' ? 1 : Math.max(1, buildMarketplaceSearches(listEnabledRules(), settings).length);
  if (alertSent[source] || emptyStreak[source] < settings.selectorHealthThreshold * pages) return;

  alertSent[source] = true;
  const message =
    stats.articlesSeen > 0
      ? `${label}: ${stats.articlesSeen} ilan kutusu goruluyor ama hicbiri ayristirilamadi - selector bozulmus olabilir`
      : `${label} ust uste hic ilan dondurmedi - oturum kapanmis, adres filtreleri gecersiz veya sayfa yapisi degismis olabilir`;
  logEvent('selector_health', 'error', message, { stats, streak: emptyStreak[source] });
  bus.emitEvent({ type: 'log', level: 'error', message, at: Date.now() });
}

let emptyDescriptionStreak = 0;
let descriptionAlertSent = false;

/**
 * Aciklama okunamazsa hicbir ilan bedava sayilmaz ve bot sessizce ise yaramaz
 * hale gelir. Aciklamasiz ilan olabilir ama ust uste birkac tane olasi degil.
 */
function updateDescriptionHealth(listing: MarketplaceListing): void {
  if (listing.description.trim() !== '') {
    emptyDescriptionStreak = 0;
    descriptionAlertSent = false;
    return;
  }
  emptyDescriptionStreak += 1;
  if (descriptionAlertSent || emptyDescriptionStreak < EMPTY_DESCRIPTION_ALERT) return;

  descriptionAlertSent = true;
  const message = `Son ${emptyDescriptionStreak} Marketplace ilaninda aciklama okunamadi - ilan sayfasi selector'u bozulmus olabilir`;
  logEvent('selector_health', 'error', message, { listingId: listing.listingId });
  bus.emitEvent({ type: 'log', level: 'error', message, at: Date.now() });
}
