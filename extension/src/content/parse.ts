import type { ParseStats, RawPost } from '../../../shared/protocol.ts';
import { extractPostId } from '../../../shared/protocol.ts';
import {
  AUTHOR_LINK_PATTERNS,
  COMMENT_LINK_PATTERN,
  POST_LINK_PATTERNS,
  SELECTORS,
  matchesAny,
  queryAll,
  queryFirst,
} from './selectors.ts';

/* ---------- Metin cikarma ---------- */

/**
 * innerText tarayiciya bagli ve test ortamlarinda yok; textContent ise satirlari
 * bosluksuz birlestirip "bedavakoltuk" gibi kelimeler uretir ve kelime sinirina
 * dayali eslestirmeyi bozar. Bu yuzden blok elemanlarinda satir sonu ekleyen
 * kendi yuruyusumuzu kullaniyoruz.
 */
export function readableText(node: Node): string {
  const parts: string[] = [];

  const walk = (current: Node): void => {
    if (current.nodeType === 3) {
      parts.push(current.textContent ?? '');
      return;
    }
    if (current.nodeType !== 1) return;

    const element = current as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    if (tag === 'script' || tag === 'style') return;

    for (const child of Array.from(element.childNodes)) walk(child);

    if (tag === 'div' || tag === 'p' || tag === 'li' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
      parts.push('\n');
    }
  };

  walk(node);
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- Goreli zaman ---------- */

/** Uzun birimler once denenmeli, yoksa "dakika" icindeki "d" yanlis eslesir. */
const TIME_UNITS: { patterns: string[]; ms: number }[] = [
  { patterns: ['saniye', 'sn', 'seconds', 'second', 'secs', 'sec'], ms: 1000 },
  { patterns: ['dakika', 'dak', 'dk', 'minutes', 'minute', 'mins', 'min'], ms: 60_000 },
  { patterns: ['saat', 'sa', 'hours', 'hour', 'hrs', 'hr'], ms: 3_600_000 },
  { patterns: ['hafta', 'hft', 'hf', 'weeks', 'week', 'wks', 'wk'], ms: 604_800_000 },
  { patterns: ['gün', 'gun', 'days', 'day'], ms: 86_400_000 },
];

/** Tek harfli kisaltmalar; ancak sayidan hemen sonra tek basina gelirlerse gecerli. */
const SHORT_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  g: 86_400_000,
};

/**
 * "2 dk", "5 sa", "3 g", "1 h", "Dün" gibi etiketleri epoch ms'e cevirir.
 * Cozulemezse null doner - bu durumda post yasi bilinmez ve bayat post korumasi
 * postu ihtiyatli davranarak eler.
 */
export function parseRelativeTimeLabel(label: string, now: number = Date.now()): number | null {
  const text = label.trim().toLocaleLowerCase('tr');
  if (text === '') return null;

  if (/(şimdi|simdi|az önce|az once|just now|now)/.test(text)) return now;
  if (/(dün|dun|yesterday)/.test(text)) return now - 86_400_000;

  const match = text.match(/(\d+)\s*([a-zçğıöşü]+)/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  if (!Number.isFinite(amount)) return null;

  for (const entry of TIME_UNITS) {
    if (entry.patterns.some((pattern) => unit.startsWith(pattern))) {
      return now - amount * entry.ms;
    }
  }
  const short = SHORT_UNITS[unit];
  if (short !== undefined) return now - amount * short;

  return null;
}

/* ---------- Gonderi ayristirma ---------- */

function absoluteUrl(href: string): string {
  try {
    return new URL(href, 'https://www.facebook.com').toString();
  } catch {
    return href;
  }
}

/** Permalink'i takip parametrelerinden arindirip kanonik hale getirir. */
function cleanPermalink(href: string): string {
  const url = new URL(absoluteUrl(href));
  const postMatch = url.pathname.match(/\/groups\/([^/]+)\/(posts|permalink)\/(\d+)/);
  if (postMatch) {
    return `https://www.facebook.com/groups/${postMatch[1]}/posts/${postMatch[3]}/`;
  }
  const multi = url.searchParams.get('multi_permalinks');
  const groupMatch = url.pathname.match(/\/groups\/([^/]+)/);
  if (multi && groupMatch) {
    return `https://www.facebook.com/groups/${groupMatch[1]}/posts/${multi}/`;
  }
  url.hash = '';
  return url.toString();
}

function findPostLink(article: HTMLElement): HTMLAnchorElement | null {
  const anchors = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of anchors) {
    // Yorumlar ic ice article olarak gelir; sadece bu gonderiye ait linkleri al.
    if (anchor.closest('[role="article"]') !== article) continue;
    const href = anchor.getAttribute('href') ?? '';
    // comment_id tasiyan link yorumun kalici baglantisidir; zaman damgasi ve
    // permalink yanlis secilmesin diye gonderi linki olarak kabul edilmez.
    if (COMMENT_LINK_PATTERN.test(href)) continue;
    if (matchesAny(href, POST_LINK_PATTERNS)) return anchor;
  }
  return null;
}

function findAuthorLink(article: HTMLElement, postLink: HTMLAnchorElement | null): HTMLAnchorElement | null {
  const anchors = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of anchors) {
    if (anchor === postLink) continue;
    if (anchor.closest('[role="article"]') !== article) continue;
    const href = anchor.getAttribute('href') ?? '';
    if (matchesAny(href, POST_LINK_PATTERNS)) continue;
    if (!matchesAny(absoluteUrl(href), AUTHOR_LINK_PATTERNS)) continue;
    const name = readableText(anchor);
    // Yazar linki ismi tasir; bos veya asiri uzun olan link yazar linki degildir.
    if (name.length === 0 || name.length > 80) continue;
    return anchor;
  }
  return null;
}

function extractMessage(article: HTMLElement, authorLink: HTMLAnchorElement | null): string {
  const direct = queryFirst(article, SELECTORS.message);
  if (direct) return readableText(direct);

  // Yedek strateji: gonderiye ait en uzun metin blogu.
  // Yorumlar ic ice article oldugu icin closest kontroluyle eleniyor.
  let best = '';
  for (const node of Array.from(article.querySelectorAll<HTMLElement>('div[dir="auto"]'))) {
    if (node.closest('[role="article"]') !== article) continue;
    if (authorLink && node.contains(authorLink)) continue;
    const text = readableText(node);
    if (text.length > best.length) best = text;
  }
  return best;
}

function extractImages(article: HTMLElement, authorLink: HTMLAnchorElement | null): string[] {
  const urls: string[] = [];
  for (const img of Array.from(article.querySelectorAll<HTMLImageElement>('img[src]'))) {
    if (img.closest('[role="article"]') !== article) continue;
    // Profil fotograflari yazar linkinin icinde durur; urun gorseli degildir.
    if (authorLink && authorLink.contains(img)) continue;
    const src = img.getAttribute('src') ?? '';
    if (!src.startsWith('https://')) continue;
    const width = Number(img.getAttribute('width') ?? img.width ?? 0);
    // Kucuk gorseller avatar/rozet; urun fotografi degil.
    if (width > 0 && width < 100) continue;
    if (!urls.includes(src)) urls.push(src);
  }
  return urls.slice(0, 5);
}

function extractUserId(authorHref: string): string | null {
  const groupUser = authorHref.match(/\/groups\/[^/]+\/user\/(\d+)/);
  if (groupUser?.[1]) return groupUser[1];
  const profileId = authorHref.match(/[?&]id=(\d+)/);
  if (profileId?.[1]) return profileId[1];
  const username = absoluteUrl(authorHref).match(/facebook\.com\/([A-Za-z0-9.]+)\/?(?:\?|$)/);
  return username?.[1] ?? null;
}

/**
 * Tek bir gonderiyi ayristirir.
 * Kalici baglanti bulunamazsa null doner: post id olmadan dedupe yapilamaz,
 * dedupe olmadan da ayni posta defalarca yorum yazma riski dogar.
 */
export function parseArticle(
  article: HTMLElement,
  fbGroupId: string,
  now: number = Date.now(),
): RawPost | null {
  const postLink = findPostLink(article);
  if (!postLink) return null;

  const permalink = cleanPermalink(postLink.getAttribute('href') ?? '');
  const fbPostId = extractPostId(permalink);
  if (!fbPostId) return null;

  const authorLink = findAuthorLink(article, postLink);
  const authorHref = authorLink?.getAttribute('href') ?? null;
  const postedAtLabel = readableText(postLink).trim() || null;

  return {
    source: 'feed',
    fbPostId,
    fbGroupId,
    permalink,
    authorName: authorLink ? readableText(authorLink) : null,
    authorProfileUrl: authorHref ? absoluteUrl(authorHref) : null,
    authorUserId: authorHref ? extractUserId(authorHref) : null,
    text: extractMessage(article, authorLink),
    imageUrls: extractImages(article, authorLink),
    postedAt: postedAtLabel ? parseRelativeTimeLabel(postedAtLabel, now) : null,
    postedAtLabel,
  };
}

/** Sayfadaki tum gonderileri ayristirir ve selector sagligi icin istatistik uretir. */
export function parseFeed(
  root: ParentNode,
  fbGroupId: string,
  now: number = Date.now(),
): { posts: RawPost[]; stats: ParseStats } {
  const feed = queryFirst(root, SELECTORS.feed) ?? (root as unknown as HTMLElement);
  const articles = queryAll(feed, SELECTORS.article).filter(
    // Yorumlar da role="article"; sadece en dis seviyedeki gonderileri al.
    (article) => article.parentElement?.closest('[role="article"]') == null,
  );

  const posts: RawPost[] = [];
  let failures = 0;
  for (const article of articles) {
    const parsed = parseArticle(article, fbGroupId, now);
    if (parsed) posts.push(parsed);
    else failures += 1;
  }

  return {
    posts,
    stats: { articlesSeen: articles.length, postsParsed: posts.length, failures },
  };
}
