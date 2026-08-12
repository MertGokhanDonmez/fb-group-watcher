import type { ParseStats, RawPost } from '../../../shared/protocol.ts';
import { detectBlock, type BlockDetection } from './detect.ts';
import { watchNotifications } from './notifications.ts';
import { parseFeed } from './parse.ts';
import { SELECTORS, queryFirst } from './selectors.ts';

/**
 * Grup sayfasinda calisan toplayici.
 * Kendi basina gezinmez; arka plan servisi sayfayi actiktan sonra "collect" isteyince
 * akisin yuklenmesini bekler, ayristirir ve sonucu geri doner.
 */

export interface CollectRequest {
  type: 'collect';
  fbGroupId: string;
  timeoutMs: number;
  /**
   * 'feed'  - grup akisi taramasi (varsayilan): role="feed" kapsayicisi beklenir.
   * 'post'  - tek gonderinin kalici baglanti sayfasi: feed kapsayicisi olmayabilir,
   *           herhangi bir article gorunur gorunmez ayristirilir.
   */
  mode?: 'feed' | 'post';
}

export interface CollectResponse {
  ok: boolean;
  blocked?: BlockDetection;
  posts?: RawPost[];
  stats?: ParseStats;
  error?: string;
}

const POLL_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Icerik render edilene kadar bekler. Facebook icerigi asenkron yukledigi icin gerekli. */
async function waitForContent(timeoutMs: number, mode: 'feed' | 'post'): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mode === 'post') {
      // Kalici baglanti sayfasinda role="feed" cogu zaman yok; gonderi article'i yeterli.
      if (queryFirst(document, SELECTORS.article)) return true;
    } else {
      const feed = queryFirst(document, SELECTORS.feed);
      if (feed && queryFirst(feed, SELECTORS.article)) return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function collect(request: CollectRequest): Promise<CollectResponse> {
  const blocked = detectBlock();
  if (blocked) return { ok: false, blocked };

  const ready = await waitForContent(request.timeoutMs, request.mode ?? 'feed');
  // Akis hic gelmediyse bile ayristirmayi deniyoruz: sonuctaki articlesSeen=0
  // bilgisi sunucudaki selector saglik takibini besliyor.
  const { posts, stats } = parseFeed(document, request.fbGroupId);

  if (!ready && stats.articlesSeen === 0) {
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
