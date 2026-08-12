import type { ParseStats, RawPost } from '../../../shared/protocol.ts';
import {
  AUTHOR_LINK_PATTERNS,
  COMMENT_LINK_PATTERN,
  GROUP_IN_HREF_PATTERN,
  POST_ID_PATTERNS,
  POST_LINK_PATTERNS,
  SELECTORS,
  matchesAny,
  queryAll,
  queryFirst,
} from './selectors.ts';

/* ---------- Metin cikarma ---------- */

/**
 * Ekranda GORUNMEYEN tuzak metin mi?
 *
 * Facebook zaman damgasi ve baglanti onizlemelerinde kazima karsiti bir numara
 * kullaniyor: gercek karakterlerin arasina yuzlerce sahte harf serpiyor ve
 * sahtelerini `position: absolute; top: 3em` ile ekran disina itiyor. Ham
 * textContent okunursa "8h" yerine "nSsotoedrph00hlammic0amu56t8f06g388t56c999h4mt5i332l110 6"
 * gibi bir cop cikiyor.
 *
 * Iki isaret de yapisal: aria-hidden erisilebilirlik agacindan cikarilmis her seyi,
 * inline `position: absolute` ise akistan cikarilmis tuzaklari eler. Sinif ismine
 * dayanmiyoruz - onlar zaten her derlemede degisiyor.
 */
function isHiddenDecoy(element: Element): boolean {
  if (element.getAttribute('aria-hidden') === 'true') return true;
  if (element.hasAttribute('hidden')) return true;
  const style = element.getAttribute('style') ?? '';
  return /position:\s*absolute/i.test(style);
}

/** Tuzak metne serpistirilen gorunmez birlestiriciler ve sifir genislikli karakterler. */
const INVISIBLE_CHARS = /[͏​-‍⁠﻿]/g;

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
    if (isHiddenDecoy(element)) return;

    for (const child of Array.from(element.childNodes)) walk(child);

    if (tag === 'div' || tag === 'p' || tag === 'li' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
      parts.push('\n');
    }
  };

  walk(node);
  return parts
    .join('')
    .replace(INVISIBLE_CHARS, '')
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

  /*
   * Karakterlerin GORSEL sirasi da karistiriliyor: DOM'da "h19" duran etiket
   * ekranda "19h" gorunur (Facebook sirayi flex `order` ile veriyor). Stylesheet
   * icerik script'inin elinde olmadigi icin sirayi CSS'ten okuyamayiz - ama goreli
   * zaman etiketi her dilde <sayi><birim> duzenindedir, birim basa gecmisse
   * siralama bozulmus demektir. Yanlis pozitif riski dusuk: "aug 19" gibi bir
   * metin ters cevrilse bile "aug" bilinen bir birim degil, sonuc yine null.
   */
  const scrambled = text.match(/^([a-zçğıöşü]+)\s*(\d+)$/);
  const normalized = scrambled ? `${scrambled[2]}${scrambled[1]}` : text;

  const match = normalized.match(/(\d+)\s*([a-zçğıöşü]+)/);
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

/**
 * Dugum bu gonderiye mi ait, yoksa altindaki bir yoruma mi?
 *
 * Eskiden gonderi de yorum da role="article" tasidigi icin `closest('[role=article]')`
 * karsilastirmasi yetiyordu. Artik gonderide o attribute yok, dolayisiyla ayni
 * karsilastirma HER yorumu "gonderiye ait" sayardi. Bunun yerine dugumle kapsayici
 * arasinda bir yorum sinirinin bulunup bulunmadigina bakiyoruz.
 */
function insideNestedComment(node: Element, container: HTMLElement): boolean {
  const comment = node.closest<HTMLElement>(SELECTORS.comment.join(','));
  return comment != null && comment !== container && container.contains(comment);
}

/** Kapsayiciya ait (yorumlarin icinde olmayan) baglantilar. */
function ownAnchors(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
    (anchor) => !insideNestedComment(anchor, container),
  );
}

interface PostRef {
  fbPostId: string;
  /** Href'ten okunabildiyse grup slug/id'si; okunamazsa null. */
  groupFromHref: string | null;
}

/**
 * Gonderi kimligini kapsayicidaki HERHANGI bir baglantidan cikarir.
 *
 * Onem sirasi yok: hangi kalip once eslesirse o. Yorum kalici baglantilari da
 * kabul edilir - `/groups/<g>/posts/<id>/?comment_id=<c>` adresinde YOL gonderiyi
 * tanimlar, comment_id yalnizca o gonderi icindeki yorumu. Fotograf baglantilarindaki
 * `set=pcb.<id>` de ayni gonderiye isaret eder.
 */
function findPostRef(container: HTMLElement): PostRef | null {
  const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') ?? '';
    for (const pattern of POST_ID_PATTERNS) {
      const match = href.match(pattern);
      if (match?.[1]) {
        return { fbPostId: match[1], groupFromHref: href.match(GROUP_IN_HREF_PATTERN)?.[1] ?? null };
      }
    }
  }
  return null;
}

/**
 * Gonderinin kendi zaman damgasi baglantisi.
 *
 * Href'e guvenemiyoruz (artik yalnizca sifreli `__cft__` blogu tasiyor), bu yuzden
 * ICERIKTEN gidiyoruz: yoruma ait olmayan, kisa ve goreli zamana cozulebilen metni
 * olan ilk baglanti. Tuzak karakterler readableText icinde zaten eleniyor.
 */
function findTimeLink(container: HTMLElement, now: number): HTMLAnchorElement | null {
  for (const anchor of ownAnchors(container)) {
    const href = anchor.getAttribute('href') ?? '';
    if (COMMENT_LINK_PATTERN.test(href)) continue;
    const label = readableText(anchor).trim();
    if (label.length === 0 || label.length > 16) continue;
    if (parseRelativeTimeLabel(label, now) !== null) return anchor;
  }
  return null;
}

function findAuthorLink(container: HTMLElement): HTMLAnchorElement | null {
  // Once yazar blogu: Facebook'un kendi isaretlemesi, tahmine gerek birakmiyor.
  const block = queryFirst(container, SELECTORS.authorBlock);
  const candidates = block && !insideNestedComment(block, container)
    ? Array.from(block.querySelectorAll<HTMLAnchorElement>('a[href]'))
    : ownAnchors(container);

  for (const anchor of candidates) {
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

function extractMessage(container: HTMLElement, authorLink: HTMLAnchorElement | null): string {
  const direct = queryFirst(container, SELECTORS.message);
  if (direct && !insideNestedComment(direct, container)) return readableText(direct);

  // Yedek strateji: gonderiye ait en uzun metin blogu.
  let best = '';
  for (const node of Array.from(container.querySelectorAll<HTMLElement>('div[dir="auto"]'))) {
    if (insideNestedComment(node, container)) continue;
    if (authorLink && node.contains(authorLink)) continue;
    const text = readableText(node);
    if (text.length > best.length) best = text;
  }
  return best;
}

function extractImages(container: HTMLElement, authorLink: HTMLAnchorElement | null): string[] {
  const urls: string[] = [];
  for (const img of Array.from(container.querySelectorAll<HTMLImageElement>('img[src]'))) {
    if (insideNestedComment(img, container)) continue;
    // Profil fotograflari yazar linkinin icinde durur; urun gorseli degildir.
    if (authorLink && authorLink.contains(img)) continue;
    const src = img.getAttribute('src') ?? '';
    if (!src.startsWith('https://')) continue;
    const width = Number(img.getAttribute('width') ?? img.width ?? 0);
    // Kucuk gorseller avatar/rozet/emoji; urun fotografi degil.
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
  const ref = findPostRef(article);
  if (!ref) return null;

  // Permalink'i id + grup'tan kendimiz kuruyoruz: elimizdeki href bir yorum ya da
  // fotograf baglantisi olabilir, oldugu gibi saklanirsa yanlis yere goturur.
  const group = ref.groupFromHref ?? fbGroupId;
  const permalink = `https://www.facebook.com/groups/${group}/posts/${ref.fbPostId}/`;

  const authorLink = findAuthorLink(article);
  const authorHref = authorLink?.getAttribute('href') ?? null;
  const timeLink = findTimeLink(article, now);
  const postedAtLabel = timeLink ? readableText(timeLink).trim() || null : null;

  return {
    source: 'feed',
    fbPostId: ref.fbPostId,
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
  const articles = queryAll(feed, SELECTORS.article)
    // Ic ice kapsayicilarda yalnizca en distakini al.
    .filter((article) => article.parentElement?.closest(SELECTORS.article.join(',')) == null)
    /*
     * Sanallastirilmis (henuz render edilmemis) yuvalari ele.
     *
     * Facebook ekran disindaki gonderileri yalnizca yer tutucu bir kutu olarak
     * birakiyor: kapsayici ve aria-posinset var, icerik yok. Bunlari "ayristirilamadi"
     * saymak selector saglik alarmini surekli tetikler ve gercek bir bozulmayi
     * gurultunun icinde kaybederdik. Metni olmayan kutu bozuk degil, henuz bos.
     */
    .filter((article) => readableText(article).length > 0);

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
