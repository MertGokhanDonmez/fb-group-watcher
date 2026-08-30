import { NOTIFICATION_CHANNEL, type ParseStats, type RawPost } from '../../shared/protocol.ts';
import { stripNotificationPrefix } from '../../shared/facebook.ts';
import { getAgentStatus, patchAgentStatus } from './agent/status.ts';
import { bus } from './bus.ts';
import { getGroupByFbId } from './repo/groups.ts';
import { logEvent } from './repo/events.ts';
import { enrichPost, insertPostIfNew, type PostLocation } from './repo/posts.ts';
import { getSettings } from './repo/settings.ts';
import { extractLocation, haversineKm } from './location/extract.ts';
import type { Post } from './types.ts';

/**
 * Gonderi metninden bolgeyi cikarir ve ev konumuna uzakligi hesaplar.
 * Ev konumu ayarlanmamissa (0,0) mesafe hesaplanmaz - yanlis bir sayi gostermektense
 * "bilinmiyor" demek dogru; mesafe filtresi de bu durumda hicbir seyi elemez.
 */
function resolveLocation(text: string): PostLocation | null {
  const found = extractLocation(text);
  if (!found) return null;

  const settings = getSettings();
  const homeSet = settings.homeLat !== 0 || settings.homeLon !== 0;
  return {
    name: found.name,
    lat: found.lat,
    lon: found.lon,
    distanceKm: homeSet
      ? Math.round(haversineKm(settings.homeLat, settings.homeLon, found.lat, found.lon) * 10) / 10
      : null,
  };
}

/** Selector alarmi tek bir bozulma serisinde bir kez gonderilir, her turda degil. */
let selectorAlertSent = false;
/**
 * Son basarili ayristirmanin zamani.
 *
 * Alarmin sordugu soru "bu tur bos mu geldi" degil, "bot KOR mu" olmali. Facebook
 * akisi sanallastirdigi ve arka plan sekmesini kistigi icin tekil turlarin bos
 * donmesi normaldir ve kendiliginden toparlanir; gercek bir selector bozulmasi ise
 * toparlanmaz. Ikisini ayiran sey sureklilik, ardisik tur sayisi degil.
 */
let lastSuccessfulParseAt = Date.now();
/** Son tarama turunun zamani; turlar arasindaki bosluklari fark etmek icin. */
let lastRoundAt = Date.now();

/**
 * Eklentinin getirdigi gonderileri isler.
 *
 * Iki kaynak var: grup akisi taramasi ve bildirimler sayfasi. Bildirim kayitlari
 * kisaltilmis metin tasir, bu yuzden ayni gonderi sonradan taramadan tam haliyle
 * gelirse kayit zenginlestirilir. Yalnizca ilk kez gorulen gonderiler geri doner.
 */
export function ingestPosts(channel: string, posts: RawPost[], stats: ParseStats): Post[] {
  const newPosts: Post[] = [];

  for (const raw of posts) {
    // Her gonderi kendi grubunu tasir: bildirim turu birden fazla gruba ait olabilir.
    const group = getGroupByFbId(raw.fbGroupId);
    const cleaned: RawPost = {
      ...raw,
      text:
        raw.source === 'notification'
          ? stripNotificationPrefix(raw.text, group?.name ?? null)
          : raw.text,
    };

    const location = resolveLocation(cleaned.text);
    const saved = insertPostIfNew(cleaned, group?.id ?? null, location);
    if (saved) {
      newPosts.push(saved);
      bus.emitEvent({ type: 'post', post: saved });
      continue;
    }

    // Zaten gorulmus: yeni sayilmaz ama eksik alanlar tamamlanabilir.
    const enriched = enrichPost(cleaned.fbPostId, cleaned, cleaned.text, location);
    if (!enriched) continue;
    bus.emitEvent({ type: 'post', post: enriched.post });
    // Metin buyuduyse (kisaltilmis bildirim -> tam gonderi) yeniden eslestirmeye
    // gonder. Eslesme UNIQUE(post_id, rule_id) ile tekil oldugu icin bu guvenli:
    // zaten eslesmisse yeni eslesme uretilmez, kacirilmis anahtar kelime yakalanir.
    if (enriched.textGrew) newPosts.push(enriched.post);
  }

  if (channel === NOTIFICATION_CHANNEL) {
    patchAgentStatus({ lastParseAt: Date.now(), currentGroup: 'bildirimler' });
  } else {
    updateSelectorHealth(channel, stats);
  }
  return newPosts;
}

/**
 * Facebook DOM'u degistiginde bot sessizce hicbir sey bulamaz hale gelir.
 * En olasi ve en sinsi ariza bu oldugu icin ayrica izleniyor:
 * sayfada article gorunuyor ama hicbiri parse edilemiyorsa selector bozulmustur.
 */
function updateSelectorHealth(fbGroupId: string, stats: ParseStats): void {
  const settings = getSettings();
  const now = Date.now();

  /*
   * Turlar arasinda uzun bir bosluk varsa o sure KORLUK DEGILDIR: bot bakmiyordu
   * ki goremesin. Sessiz saatler, eklentinin cevrimdisi olmasi, Chrome'un kapali
   * kalmasi, sunucunun yeniden baslamasi - hepsi boyle bir bosluk uretir. Sayac
   * sifirlanmazsa duraklama biter bitmez ilk birkac bos tur, biriken saatlerle
   * birlesip aninda yanlis alarm veriyor (gercekte yasandi: 7 saatlik sessiz
   * saatlerin ardindan 08:04'te).
   */
  const idleReset = Math.max(5 * 60_000, settings.groupSweepMs);
  if (now - lastRoundAt > idleReset) lastSuccessfulParseAt = now;
  lastRoundAt = now;

  const parsedNothing = stats.postsParsed === 0;
  const streak = parsedNothing ? getAgentStatus().consecutiveEmptyRounds + 1 : 0;

  patchAgentStatus({
    lastParseAt: now,
    currentGroup: fbGroupId,
    consecutiveEmptyRounds: streak,
  });

  if (!parsedNothing) {
    lastSuccessfulParseAt = now;
    if (selectorAlertSent) {
      selectorAlertSent = false;
      logEvent('selector_health', 'info', 'Post ayristirma yeniden calisiyor', { fbGroupId });
    }
    return;
  }

  /*
   * Bos tur tek basina alarm sebebi degil. Alarm ancak bot bir sure boyunca
   * HIC ayristiramadiysa anlamli: aralarina basarili turlar serpistirilmis bos
   * turlar gecici bir render yarisidir, bozulma degil. Bu kapi olmadan alarm
   * basari/basarisizlik salinimlarinda tekrar tekrar tetikleniyor ve gercek bir
   * arizayi gorunmez kilacak kadar gurultu uretiyordu (22 saatte 41 kez).
   *
   * Esik zamanla olculur ve tarama hizindan turetilir: tam bir tur boyunca hicbir
   * seyin ayristirilamamasi normaldir, ucu birden kacirilmissa degildir.
   */
  const blindMs = Math.max(15 * 60_000, settings.groupSweepMs * 3);
  const blindFor = now - lastSuccessfulParseAt;

  if (streak >= settings.selectorHealthThreshold && blindFor >= blindMs && !selectorAlertSent) {
    selectorAlertSent = true;
    const message =
      stats.articlesSeen > 0
        ? `Sayfada ${stats.articlesSeen} gonderi goruluyor ama hicbiri ayristirilamadi - selector bozulmus olabilir`
        : 'Grup akisinda hic gonderi bulunamadi - oturum kapanmis veya sayfa yapisi degismis olabilir';
    logEvent('selector_health', 'error', message, {
      fbGroupId,
      stats,
      streak,
      blindForMs: blindFor,
    });
    bus.emitEvent({ type: 'log', level: 'error', message, at: Date.now() });
  }
}
