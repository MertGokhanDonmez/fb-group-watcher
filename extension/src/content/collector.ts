import type { ParseStats, RawPost } from '../../../shared/protocol.ts';
import { detectBlock, type BlockDetection } from './detect.ts';
import { watchNotifications } from './notifications.ts';
import { parseFeed } from './parse.ts';

/**
 * Grup sayfasinda calisan toplayici.
 * Kendi basina gezinmez; arka plan servisi sayfayi actiktan sonra "collect" isteyince
 * akisin yuklenmesini bekler, ayristirir ve sonucu geri doner.
 */

export interface CollectRequest {
  type: 'collect';
  fbGroupId: string;
  timeoutMs: number;
}

export interface CollectResponse {
  ok: boolean;
  blocked?: BlockDetection;
  posts?: RawPost[];
  stats?: ParseStats;
  error?: string;
}

const POLL_INTERVAL_MS = 250;
/** Ilk gonderi goruldukten sonra akisin geri kalanina taninan ek sure. */
const SETTLE_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Akis render edilene kadar bekler ve ayristirma sonucunu doner.
 *
 * HAZIR OLMA OLCUTU AYRISTIRMANIN KENDISIDIR. Eskiden yalnizca bir article
 * kapsayicisinin varligina bakiliyordu ve bu yanlisti: Facebook akisi
 * sanallastiriyor, yani aria-posinset tasiyan kapsayicilar sayfa yuklenir
 * yuklenmez BOS yer tutucular olarak olusuyor (gercek bir snapshot'ta 10 yuvanin
 * 7'si bos). Bekleme daha hicbir gonderi render edilmeden ilk bos yuvayi gorup
 * bitiyor, parseFeed bos yuvalari eliyor ve geriye articlesSeen=0 kaliyordu -
 * sunucudaki selector saglik takibi bunu gercek bir ariza sanip "hic gonderi
 * bulunamadi" alarmi uretiyordu. Sorun secicilerde degil, zamanlamadaydi.
 *
 * Ilk gonderi bulununca hemen donmuyoruz: akis hala doluyor olabilir ve tek
 * gonderiyle donmek geri kalanini kacirmak demek. Sayi SETTLE_MS boyunca artmayi
 * birakinca duruyoruz, en gec dwell suresi dolunca.
 */
async function collectFeed(
  fbGroupId: string,
  timeoutMs: number,
): Promise<{ posts: RawPost[]; stats: ParseStats }> {
  const deadline = Date.now() + timeoutMs;
  let best = parseFeed(document, fbGroupId);
  let lastGrowthAt = best.posts.length > 0 ? Date.now() : 0;

  while (Date.now() < deadline) {
    if (lastGrowthAt > 0 && Date.now() - lastGrowthAt >= SETTLE_MS) break;
    await sleep(POLL_INTERVAL_MS);

    const next = parseFeed(document, fbGroupId);
    if (next.posts.length > best.posts.length) lastGrowthAt = Date.now();
    // Yeniden render sirasinda sayi gecici olarak dusebilir; en dolu sonucu koruyoruz.
    if (next.posts.length >= best.posts.length) best = next;
  }

  return best;
}

async function collect(request: CollectRequest): Promise<CollectResponse> {
  const blocked = detectBlock();
  if (blocked) return { ok: false, blocked };

  const { posts, stats } = await collectFeed(request.fbGroupId, request.timeoutMs);

  if (stats.articlesSeen === 0) {
    // Engel ekrani gec yuklenmis olabilir; son bir kez bak.
    const late = detectBlock();
    if (late) return { ok: false, blocked: late };
  }

  return { ok: true, posts, stats };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const request = message as CollectRequest | undefined;
  if (request?.type !== 'collect') return false;

  collect(request)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: String(error) } satisfies CollectResponse);
    });
  return true; // asenkron yanit
});

/**
 * Bildirimler sayfasindaysak izlemeyi hemen baslat.
 * Bu sayfa hic yenilenmez: Facebook yeni bildirimleri acik sekmeye kendisi itiyor,
 * biz sadece dinliyoruz. Arka plan servisi bu sekmeyi acik tutmakla yukumlu.
 */
if (location.pathname.startsWith('/notifications')) {
  const blocked = detectBlock();
  if (blocked) {
    void chrome.runtime.sendMessage({ type: 'blocked_detected', blocked, url: location.href });
  } else {
    watchNotifications((posts) => {
      void chrome.runtime.sendMessage({ type: 'notification_posts', posts });
    });
  }
}
