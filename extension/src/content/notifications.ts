import { extractPostId, type RawPost } from '../../../shared/protocol.ts';
import { parseRelativeTimeLabel, readableText } from './parse.ts';
import { COMMENT_LINK_PATTERN, POST_LINK_PATTERNS, matchesAny } from './selectors.ts';

/**
 * Bildirimler sayfasi izleyicisi.
 *
 * Sayfayi periyodik olarak YENILEMIYORUZ. Facebook acik sekmeye yeni bildirimleri
 * kendi baglantisi uzerinden itiyor; biz sadece DOM'u dinliyoruz. Bunun sonucu:
 * sayfa yuklemesi neredeyse sifir, gecikme neredeyse yok ve olusan trafik profili
 * "Facebook'u sekmede acik birakmis kullanici"dan ayirt edilemez.
 */

/** Bir dugum altindaki gonderi baglantisi sayisi; komsu bildirime tasmayi tespit etmek icin. */
function countPostLinks(node: ParentNode): number {
  let total = 0;
  for (const link of Array.from(node.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (matchesAny(link.getAttribute('href') ?? '', POST_LINK_PATTERNS)) total += 1;
  }
  return total;
}

/** Zaman etiketi disinda anlamli icerik var mi? ("52m", "9h" gibi degerler icerik sayilmaz. */
function hasMeaningfulText(text: string): boolean {
  if (text.length < 25) return false;
  // Sadece zaman etiketiyse icerik yok demektir.
  return parseRelativeTimeLabel(text) === null || text.length > 40;
}

/**
 * Bildirim satirinin kapsayicisini bulur.
 *
 * Facebook'un bildirimler sayfasinda sabit bir kapsayici isareti (role="listitem" vb.)
 * yok ve yapisi degisiyor. Bu yuzden isimlendirmeye guvenmek yerine baglantidan yukari
 * yuruyoruz: anlamli metin bulunca duruyoruz, ama ikinci bir gonderi baglantisi goren
 * seviyeye cikmiyoruz - orasi artik komsu bildirimi de kapsiyor demektir.
 */
function itemContainer(anchor: HTMLElement): HTMLElement {
  const labelled = anchor.closest<HTMLElement>('[role="listitem"], [role="article"]');
  if (labelled && countPostLinks(labelled) === 1) return labelled;

  let node: HTMLElement = anchor;
  for (let depth = 0; depth < 8; depth += 1) {
    if (hasMeaningfulText(readableText(node))) return node;
    const parent = node.parentElement;
    if (!parent || parent === document.body) break;
    // Ust seviye birden fazla bildirimi kapsiyorsa bir onceki seviyede kaliyoruz.
    if (countPostLinks(parent) > 1) break;
    node = parent;
  }
  return node;
}

function absoluteUrl(href: string): string {
  try {
    return new URL(href, 'https://www.facebook.com').toString();
  } catch {
    return href;
  }
}

function cleanPermalink(href: string): string {
  const url = new URL(absoluteUrl(href));
  const match = url.pathname.match(/\/groups\/([^/]+)\/(posts|permalink)\/(\d+)/);
  if (match) return `https://www.facebook.com/groups/${match[1]}/posts/${match[3]}/`;
  url.hash = '';
  url.search = '';
  return url.toString();
}

/**
 * Bildirimdeki goreli zaman etiketini bulur ("52m", "9 sa", "2 dk").
 * Once baglantinin kendi metnine bakilir - Facebook zaman damgasini sik sik
 * dogrudan baglantiya koyuyor; bulunamazsa kapsayicidaki kisa metinler taranir.
 */
function findTimeLabel(container: HTMLElement, anchor: HTMLElement): string | null {
  const anchorText = readableText(anchor).trim();
  if (anchorText.length <= 12 && parseRelativeTimeLabel(anchorText) !== null) return anchorText;

  for (const node of Array.from(container.querySelectorAll<HTMLElement>('span, abbr, div'))) {
    const text = readableText(node).trim();
    if (text.length === 0 || text.length > 12) continue;
    if (parseRelativeTimeLabel(text) !== null) return text;
  }
  return null;
}

/**
 * Bildirim listesindeki grup gonderilerini cikarir.
 * Yalnizca grup gonderisine giden baglantilar dikkate alinir; begeni ve etkinlik
 * bildirimleri kendiliginden elenir cunku href kaliplari tutmaz. Yorum bildirimleri
 * ise gonderi linkine comment_id ekleyerek gelir ve AYRICA elenmek zorundadir -
 * aksi halde yorumun metni gonderi icerigi olarak kaydedilir, hatta daha uzunsa
 * zenginlestirme yoluyla gercek gonderi metninin uzerine yazar.
 */
export function parseNotifications(root: ParentNode = document): RawPost[] {
  const seen = new Set<string>();
  const posts: RawPost[] = [];

  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = anchor.getAttribute('href') ?? '';
    if (!matchesAny(href, POST_LINK_PATTERNS)) continue;
    if (COMMENT_LINK_PATTERN.test(href)) continue; // yorum bildirimi, gonderi degil

    const permalink = cleanPermalink(href);
    const fbPostId = extractPostId(permalink);
    if (!fbPostId || seen.has(fbPostId)) continue;

    const groupMatch = permalink.match(/\/groups\/([^/]+)/);
    const fbGroupId = groupMatch?.[1];
    if (!fbGroupId) continue;

    seen.add(fbPostId);
    const container = itemContainer(anchor);
    // Kalin yazilan kisim bildirimlerde eylemi yapan kisidir.
    const bold = container.querySelector('strong, b');
    const timeLabel = findTimeLabel(container, anchor);

    let text = readableText(container);
    // Zaman etiketi metnin sonuna yapisik geliyor; anahtar kelime eslestirmesini
    // bozmasa da panelde gurultu yaratiyor.
    if (timeLabel && text.endsWith(timeLabel)) {
      text = text.slice(0, -timeLabel.length).trim();
    }

    posts.push({
      source: 'notification',
      fbPostId,
      fbGroupId,
      permalink,
      authorName: bold ? readableText(bold) : null,
      authorProfileUrl: null,
      authorUserId: null,
      // Onek temizligi sunucuda yapiliyor: grup adi orada biliniyor.
      text,
      imageUrls: [],
      postedAt: timeLabel ? parseRelativeTimeLabel(timeLabel) : null,
      postedAtLabel: timeLabel,
    });
  }

  return posts;
}

/**
 * Bildirim listesini izler ve daha once bildirilmemis gonderileri geri cagirir.
 * Ayni gonderi tekrar tekrar raporlanmasin diye yerel bir gorulmus kumesi tutulur;
 * sunucudaki dedupe zaten son savunma hatti, bu sadece gereksiz trafigi onler.
 */
export function watchNotifications(onNew: (posts: RawPost[]) => void): () => void {
  const reported = new Set<string>();

  const scan = (): void => {
    const fresh = parseNotifications().filter((post) => !reported.has(post.fbPostId));
    if (fresh.length === 0) return;
    for (const post of fresh) reported.add(post.fbPostId);
    onNew(fresh);
  };

  scan(); // acilistaki mevcut liste

  const observer = new MutationObserver(() => {
    // Facebook tek bildirim eklerken bile cok sayida mutasyon uretir; topluyoruz.
    scheduleScan();
  });

  let pending: number | null = null;
  function scheduleScan(): void {
    if (pending !== null) return;
    pending = window.setTimeout(() => {
      pending = null;
      scan();
    }, 400);
  }

  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    if (pending !== null) window.clearTimeout(pending);
  };
}
