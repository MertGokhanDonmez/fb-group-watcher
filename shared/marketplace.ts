/** Marketplace URL ve fiyat yardimcilari. Hem server hem eklenti kullanir. */

export interface MarketplaceSearchOptions {
  /** Facebook'un sehir kisaltmasi ("prague") veya sayisal konum kimligi. */
  location: string;
  query: string;
  /** Bu tutarin ustundeki ilanlar aday bile olmaz. */
  maxPrice: number;
  /** Arama yaricapi (km). null = Facebook'un varsayilani. */
  radiusKm: number | null;
}

/**
 * Arama sayfasi adresi. En yeni ilan once gelsin diye olusturma zamanina gore
 * siralanir ve son gunle sinirlanir: bedava esya saatler icinde gider, eski
 * ilanlari acmak sadece sayfa yuklemesi harcar.
 */
export function marketplaceSearchUrl(options: MarketplaceSearchOptions): string {
  const url = new URL(
    `https://www.facebook.com/marketplace/${encodeURIComponent(options.location.trim())}/search/`,
  );
  url.searchParams.set('query', options.query);
  applyFilters(url, options);
  return url.toString();
}

function applyFilters(url: URL, options: MarketplaceBrowseOptions): void {
  url.searchParams.set('sortBy', 'creation_time_descend');
  url.searchParams.set('daysSinceListed', '1');
  url.searchParams.set('maxPrice', String(Math.max(0, Math.floor(options.maxPrice))));
  if (options.radiusKm !== null) {
    url.searchParams.set('radius', String(Math.max(1, Math.ceil(options.radiusKm))));
  }
}

export type MarketplaceBrowseOptions = Omit<MarketplaceSearchOptions, 'query'>;

/**
 * Genel sayfa adresi: sehir sayfasi, anahtar kelimesiz, ayni filtrelerle.
 * Facebook bu filtreleri sehir sayfasinda da uyguluyor mu gercek sayfada
 * dogrulanmali; uymazsa panelden tarayicidaki adres elle girilebilir.
 */
export function marketplaceBrowseUrl(options: MarketplaceBrowseOptions): string {
  const url = new URL(
    `https://www.facebook.com/marketplace/${encodeURIComponent(options.location.trim())}/`,
  );
  applyFilters(url, options);
  return url.toString();
}

export function marketplaceItemUrl(listingId: string): string {
  return `https://www.facebook.com/marketplace/item/${listingId}/`;
}

export function extractListingId(href: string): string | null {
  return href.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
}

/** Fiyat alaninda "bedava" anlamina gelen etiketler. Kanit DEGIL, yalnizca tutari 0 sayar. */
const FREE_PRICE_LABELS = /\b(zdarma|free|bedava|ucretsiz|gratis|kostenlos|zadarmo|darmo)\b/;

/**
 * "1 200 Kč", "CZK1,200", "Zdarma" gibi fiyat metinlerini tutara cevirir.
 * Cozulemezse null doner; cagiran taraf bunu "bilinmiyor" olarak ele almali.
 */
export function parsePriceAmount(text: string | null): number | null {
  if (!text) return null;
  // Aksanlar sadelestirilir ki "Ücretsiz" gibi etiketlerde \b dogru calissin.
  const folded = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (FREE_PRICE_LABELS.test(folded)) return 0;

  // JS'te \s bosluk turlerini (NBSP, dar NBSP) de kapsar; Facebook binlikleri bunlarla ayiriyor.
  const token = text.match(/\d[\d\s.,]*/)?.[0];
  if (!token) return null;
  let digits = token.replace(/\s/g, '').replace(/[.,]$/, '');
  // Sondaki 1-2 haneli grup ondalik kisimdir ("12,50"); 3 haneli grup binlik ayiracidir ("1,200").
  let fraction = '';
  const decimal = digits.match(/[.,](\d{1,2})$/);
  if (decimal) {
    fraction = decimal[1] ?? '';
    digits = digits.slice(0, -decimal[0].length);
  }
  const whole = digits.replace(/[.,]/g, '');
  if (whole === '') return null;
  const amount = Number(fraction === '' ? whole : `${whole}.${fraction}`);
  return Number.isFinite(amount) ? amount : null;
}
