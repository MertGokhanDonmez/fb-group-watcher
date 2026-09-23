import type { MarketplaceCard, MarketplaceListing, ParseStats } from '../../../shared/protocol.ts';
import {
  extractListingId,
  marketplaceItemUrl,
  parsePriceAmount,
} from '../../../shared/marketplace.ts';
import { parseRelativeTimeLabel, readableText } from './parse.ts';
import {
  LISTED_MARKERS,
  MARKETPLACE,
  MARKETPLACE_JSON_KEYS,
  PRICE_LINE_PATTERN,
  SEE_MORE_TEXTS,
  queryFirst,
} from './selectors.ts';

/**
 * Marketplace ayristirici.
 *
 * Arama sayfasi yalnizca kart verir (baslik, fiyat, konum); aciklama yoktur.
 * Bedava karari aciklamaya dayandigi icin her aday ilanin sayfasi ayrica acilir
 * ve orada tam kayit okunur.
 */

function lines(node: Node): string[] {
  return readableText(node)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function looksLikePrice(line: string): boolean {
  return PRICE_LINE_PATTERN.test(line.trim());
}

/* ---------- Arama sayfasi ---------- */

/**
 * Kart metni sirasi: fiyat (indirimliyse eski fiyat da), baslik, konum.
 * Fiyat satirlari atlanip kalan ilk iki satir baslik ve konum kabul edilir.
 */
function parseCard(anchor: HTMLAnchorElement, listingId: string): MarketplaceCard | null {
  const cardLines = lines(anchor);
  const priceIndex = cardLines.findIndex(looksLikePrice);
  const priceText = priceIndex === -1 ? null : (cardLines[priceIndex] ?? null);
  const rest = cardLines.slice(priceIndex + 1).filter((line) => !looksLikePrice(line));
  const title = rest[0] ?? null;
  if (title === null && priceText === null) return null;

  const image = anchor.querySelector<HTMLImageElement>('img[src^="https://"]');
  return {
    listingId,
    url: marketplaceItemUrl(listingId),
    title,
    priceText,
    priceAmount: parsePriceAmount(priceText),
    locationText: rest[1] ?? null,
    imageUrl: image?.getAttribute('src') ?? null,
  };
}

export function parseMarketplaceSearch(root: ParentNode): {
  cards: MarketplaceCard[];
  stats: ParseStats;
} {
  const seen = new Set<string>();
  const cards: MarketplaceCard[] = [];
  let failures = 0;

  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>(MARKETPLACE.itemLink))) {
    const listingId = extractListingId(anchor.getAttribute('href') ?? '');
    if (!listingId || seen.has(listingId)) continue;
    seen.add(listingId);
    const card = parseCard(anchor, listingId);
    if (card) cards.push(card);
    else failures += 1;
  }

  return { cards, stats: { articlesSeen: seen.size, postsParsed: cards.length, failures } };
}

/* ---------- Ilan sayfasi: gomulu JSON ---------- */

interface EmbeddedListing {
  title: string | null;
  description: string | null;
  priceText: string | null;
  locationText: string | null;
  postedAt: number | null;
}

const JSON_WINDOW = 6000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** JSON string literal'ini cozer; kacis dizileri (\u00e1, \n) JSON.parse ile acilir. */
function decodeString(literal: string | undefined): string | null {
  if (literal === undefined) return null;
  try {
    const value = JSON.parse(literal) as unknown;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Kalibin, verilen konuma en yakin eslesmesinin ilk grubunu doner. */
function nearestCapture(source: string, pattern: RegExp, anchor: number): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
    const distance = Math.abs((match.index ?? 0) - anchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = match[1];
    }
  }
  return best;
}

const STRING = '("(?:[^"\\\\]|\\\\.)*")';
const plainField = (key: string): RegExp => new RegExp(`"${escapeRegex(key)}":${STRING}`);
const textField = (key: string): RegExp => new RegExp(`"${escapeRegex(key)}":\\{"text":${STRING}`);

/**
 * Sayfaya gomulu veri bloklarindan ilani okur.
 *
 * Sayfada birden fazla ilanin (benzer ilanlar) verisi olabilir. Her aciklamanin
 * bolgesi, komsu aciklamalar arasinda kalan metindir; bu ilanin kimligini iceren
 * bolge secilir. Kimlik genelde nesnenin basinda, aciklamadan once geldigi icin
 * once aciklamadan onceki kisima, sonra sonrakine bakilir. Tek aciklama varsa o
 * kullanilir. Diger alanlar secilen bolgede aciklamaya en yakin eslesmeden okunur.
 */
export function readEmbeddedListing(doc: Document, listingId: string): EmbeddedListing | null {
  const blob = Array.from(doc.querySelectorAll(MARKETPLACE.dataScripts))
    .map((script) => script.textContent ?? '')
    .filter((text) => text.includes(MARKETPLACE_JSON_KEYS.description))
    .join('\n');
  if (blob === '') return null;

  const key = `"${MARKETPLACE_JSON_KEYS.description}":`;
  const positions: number[] = [];
  for (let index = blob.indexOf(key); index !== -1; index = blob.indexOf(key, index + 1)) {
    positions.push(index);
  }
  if (positions.length === 0) return null;

  const at = (i: number): number => positions[i] ?? 0;
  const regionStart = (i: number): number => (i === 0 ? Math.max(0, at(0) - JSON_WINDOW) : at(i - 1));
  const regionEnd = (i: number): number =>
    i === positions.length - 1 ? at(i) + JSON_WINDOW : at(i + 1);

  const idMarker = `"id":"${listingId}"`;
  let chosen = positions.findIndex((position, i) => blob.slice(regionStart(i), position).includes(idMarker));
  if (chosen === -1) {
    chosen = positions.findIndex((position, i) => blob.slice(position, regionEnd(i)).includes(idMarker));
  }
  if (chosen === -1 && positions.length === 1) chosen = 0;
  if (chosen === -1) return null;

  const region = blob.slice(regionStart(chosen), regionEnd(chosen));
  const anchor = at(chosen) - regionStart(chosen);
  const creation = nearestCapture(
    region,
    new RegExp(`"${MARKETPLACE_JSON_KEYS.creationTime}":(\\d{9,13})`),
    anchor,
  );

  return {
    description: decodeString(
      blob.slice(at(chosen)).match(textField(MARKETPLACE_JSON_KEYS.description))?.[1],
    ),
    title: decodeString(nearestCapture(region, plainField(MARKETPLACE_JSON_KEYS.title), anchor)),
    priceText: decodeString(nearestCapture(region, textField(MARKETPLACE_JSON_KEYS.price), anchor)),
    locationText: decodeString(
      nearestCapture(region, textField(MARKETPLACE_JSON_KEYS.location), anchor),
    ),
    // Facebook saniye cinsinden tutuyor; milisaniye gelirse oldugu gibi kullanilir.
    postedAt: creation ? (creation.length <= 10 ? Number(creation) * 1000 : Number(creation)) : null,
  };
}

/* ---------- Ilan sayfasi: DOM yedegi ---------- */

/** Baglanti icindeki metinler (satici, benzer ilanlar) aciklama olamaz. */
function outsideLinks(node: Element): boolean {
  return node.closest('a[href]') === null;
}

function findDescription(scope: HTMLElement, title: string | null): string | null {
  let best = '';
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>('div[dir="auto"], span[dir="auto"]'))) {
    if (!outsideLinks(node)) continue;
    if (node.querySelector('h1')) continue;
    const text = readableText(node);
    if (text === title || looksLikePrice(text)) continue;
    if (text.length > best.length) best = text;
  }
  return best === '' ? null : best;
}

function findPriceAfterTitle(scope: HTMLElement): string | null {
  const heading = queryFirst(scope, MARKETPLACE.title);
  if (!heading) return null;
  // Fiyat basligin hemen altinda; basligin ebeveynleri icindeki ilk fiyat satiri aranir.
  let container: HTMLElement | null = heading.parentElement;
  for (let depth = 0; depth < 4 && container; depth += 1) {
    const price = lines(container).find(looksLikePrice);
    if (price) return price;
    container = container.parentElement;
  }
  return null;
}

function findListedLabel(scope: HTMLElement): string | null {
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>('span, abbr'))) {
    const text = readableText(node).trim();
    if (text.length === 0 || text.length > 100) continue;
    const lower = text.toLocaleLowerCase('tr');
    if (!LISTED_MARKERS.some((marker) => lower.includes(marker))) continue;
    if (parseRelativeTimeLabel(text) !== null) return text;
  }
  return null;
}

function findImages(scope: HTMLElement): string[] {
  const urls: string[] = [];
  for (const img of Array.from(scope.querySelectorAll<HTMLImageElement>('img[src^="https://"]'))) {
    if (!outsideLinks(img)) continue; // profil fotografi ve benzer ilan gorselleri
    const width = Number(img.getAttribute('width') ?? img.width ?? 0);
    if (width > 0 && width < 100) continue;
    const src = img.getAttribute('src') ?? '';
    if (!urls.includes(src)) urls.push(src);
  }
  return urls.slice(0, 5);
}

/**
 * Uzun aciklamayi kisaltan "Devamini gor" dugmesine tiklar. Gomulu JSON
 * okunamazsa DOM'daki aciklama kirpik kalir ve sondaki "zdarma" kacabilir.
 * Tiklama yapildiysa true doner; cagiran taraf DOM'un guncellenmesini beklemeli.
 */
export function expandDescription(scope: ParentNode): boolean {
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>('[role="button"]'))) {
    if (!outsideLinks(node)) continue;
    const text = readableText(node).trim().toLocaleLowerCase('tr');
    if (!SEE_MORE_TEXTS.includes(text)) continue;
    node.click();
    return true;
  }
  return false;
}

/* ---------- Ilan sayfasi ---------- */

/**
 * Ilan sayfasini ayristirir. Once gomulu JSON denenir (aciklama tam ve kirpilmamis),
 * eksik kalan alanlar DOM'dan tamamlanir. Ne baslik ne aciklama bulunursa null.
 */
export function parseMarketplaceItem(
  doc: Document,
  listingId: string,
  now: number = Date.now(),
): MarketplaceListing | null {
  const embedded = readEmbeddedListing(doc, listingId);
  const scope = queryFirst(doc, MARKETPLACE.itemScope) ?? doc.body;

  const heading = queryFirst(scope, MARKETPLACE.title);
  const title = embedded?.title ?? (heading ? readableText(heading) : null);
  const description = embedded?.description ?? findDescription(scope, title) ?? '';
  if (!title && description === '') return null;

  const priceText = embedded?.priceText ?? findPriceAfterTitle(scope);
  const postedAtLabel = findListedLabel(scope);
  const seller = Array.from(scope.querySelectorAll<HTMLAnchorElement>(MARKETPLACE.sellerLink)).find(
    (anchor) => {
      const name = readableText(anchor);
      return name.length > 0 && name.length <= 80;
    },
  );
  const sellerHref = seller?.getAttribute('href') ?? null;

  return {
    listingId,
    url: marketplaceItemUrl(listingId),
    title,
    description,
    priceText,
    priceAmount: parsePriceAmount(priceText),
    locationText: embedded?.locationText ?? null,
    sellerName: seller ? readableText(seller) : null,
    sellerProfileUrl: sellerHref ? new URL(sellerHref, 'https://www.facebook.com').toString() : null,
    imageUrls: findImages(scope),
    postedAt:
      embedded?.postedAt ?? (postedAtLabel ? parseRelativeTimeLabel(postedAtLabel, now) : null),
    postedAtLabel,
  };
}
