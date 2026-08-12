/** Facebook URL yardimcilari. Hem server hem eklenti kullanir. */

/**
 * Grup akisini kronolojik ("Yeni gonderiler") siraya zorlar.
 * Varsayilan "En alakali" siralamasi yeni postlari gec gosterdigi icin sart.
 */
export function chronologicalGroupUrl(rawUrl: string): string {
  const url = new URL(normalizeGroupUrl(rawUrl));
  url.searchParams.set('sorting_setting', 'CHRONOLOGICAL');
  return url.toString();
}

/** Kullanicinin yapistirdigi her turlu grup adresini temiz bir kanonik forma cevirir. */
export function normalizeGroupUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  // m. ve mbasic. mobil surumleri masaustu DOM'undan farkli; her zaman www kullan.
  url.hostname = 'www.facebook.com';
  url.hash = '';
  url.search = '';
  const match = url.pathname.match(/\/groups\/([^/]+)/);
  url.pathname = match ? `/groups/${match[1]}/` : url.pathname;
  return url.toString();
}

/** Bildirimler sayfasi. Tek sayfa, N grup sayfasinin yerine gecer. */
export const NOTIFICATIONS_URL = 'https://www.facebook.com/notifications';

/**
 * Bildirim metnindeki "<Yazar>, <Grup> grubunda bir gonderi paylasti:" onekini ayiklar.
 *
 * Bu temizlik sart: grup adi metinde kalirsa "Bedava Esya" gibi bir grup adindaki
 * kelimeler HER bildirimde anahtar kelime eslesmesi uretir ve kurallar ise yaramaz hale gelir.
 */
export function stripNotificationPrefix(text: string, groupName?: string | null): string {
  let result = text.replace(/\s+/g, ' ').trim();

  const marker = result.match(/(bir gönderi paylaştı|gönderi paylaştı|posted in|posted)/i);
  if (marker?.index !== undefined) {
    result = result.slice(marker.index + marker[0].length);
    // Onek bulunduysa ardindaki iki nokta gonderi metninin baslangicini isaretler.
    // Onek yoksa bu kirpmayi yapmiyoruz: "Dikkat: bedava koltuk" gibi metinlerde
    // gercek icerigin basini kesmis olurduk.
    const colon = result.indexOf(':');
    if (colon !== -1 && colon <= 120) result = result.slice(colon + 1);
  }

  if (groupName && groupName.trim() !== '') {
    result = result.split(groupName).join(' ');
  }

  return result
    .replace(/^[\s:·\-–—,]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Profil URL'inden DM icin gereken kullanici kimligini cikarir. */
export function extractUserIdFromProfileUrl(profileUrl: string | null): string | null {
  if (!profileUrl) return null;
  const byId = profileUrl.match(/[?&]id=(\d+)/);
  if (byId?.[1]) return byId[1];
  const byPath = profileUrl.match(/facebook\.com\/(?:profile\.php\?id=)?([A-Za-z0-9.]+)\/?/);
  const candidate = byPath?.[1];
  if (!candidate || candidate === 'groups' || candidate === 'profile.php') return null;
  return candidate;
}
