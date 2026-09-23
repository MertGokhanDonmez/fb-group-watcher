import type { MarketplaceSearch, MarketplaceWatchConfig } from '../../../shared/protocol.ts';
import { marketplaceBrowseUrl, marketplaceSearchUrl } from '../../../shared/marketplace.ts';
import { matchRule } from '../matcher/match.ts';
import { normalizeText, type KeywordOptions } from '../matcher/normalize.ts';
import type { Settings } from '../repo/settings.ts';
import type { Rule } from '../types.ts';

/** Her arama bir sayfa yuklemesi; liste sinirsiz buyurse yuk kontrolden cikar. */
export const MAX_MARKETPLACE_SEARCHES = 30;

function marketplaceRules(rules: Rule[]): Rule[] {
  return rules.filter((rule) => rule.enabled && rule.searchMarketplace);
}

/**
 * Tek sayfa tum kurallara hizmet ettigi icin yaricap en genis kuraldan gelir; dar
 * kurallar pipeline'daki mesafe filtresiyle zaten eleniyor. Kurallardan biri mesafe
 * sinirsizsa yaricap verilmez.
 */
function widestRadius(rules: Rule[]): number | null {
  let widest = 0;
  for (const rule of rules) {
    if (rule.maxDistanceKm === null) return null;
    widest = Math.max(widest, rule.maxDistanceKm);
  }
  return rules.length === 0 ? null : widest;
}

/**
 * Kurallardaki anahtar kelimelerden yedek arama listesini uretir.
 *
 * Marketplace aramasi VEYA desteklemedigi icin her anahtar kelime ayri bir arama.
 * Ayni kelime birden fazla kuralda geciyorsa tek arama yapilir; yaricap o kelimeyi
 * iceren kurallarin en genisi olur. Regex aranamaz; yalnizca eslestirmede kullanilir.
 */
export function buildMarketplaceSearches(rules: Rule[], settings: Settings): MarketplaceSearch[] {
  if (!settings.marketplaceEnabled || settings.marketplaceLocation.trim() === '') return [];

  const byKey = new Map<string, { query: string; rules: Rule[] }>();
  for (const rule of marketplaceRules(rules)) {
    for (const keyword of rule.includeKeywords) {
      const key = normalizeText(keyword);
      if (key === '') continue;
      const existing = byKey.get(key);
      if (existing) existing.rules.push(rule);
      else byKey.set(key, { query: keyword.trim(), rules: [rule] });
    }
  }

  return [...byKey.values()].slice(0, MAX_MARKETPLACE_SEARCHES).map((entry) => ({
    query: entry.query,
    url: marketplaceSearchUrl({
      location: settings.marketplaceLocation,
      query: entry.query,
      maxPrice: settings.marketplaceMaxPrice,
      radiusKm: widestRadius(entry.rules),
    }),
  }));
}

/** Eklentiye gonderilecek Marketplace plani. */
export function buildMarketplaceWatch(rules: Rule[], settings: Settings): MarketplaceWatchConfig {
  const active = settings.marketplaceEnabled ? marketplaceRules(rules) : [];
  const override = settings.marketplaceBrowseUrl.trim();
  const location = settings.marketplaceLocation.trim();
  const url =
    override !== ''
      ? override
      : location !== ''
        ? marketplaceBrowseUrl({
            location,
            maxPrice: settings.marketplaceMaxPrice,
            radiusKm: widestRadius(active),
          })
        : null;

  return {
    enabled: settings.marketplaceEnabled,
    browse:
      active.length > 0 && url !== null
        ? { url, intervalMs: settings.marketplaceBrowseIntervalMs }
        : null,
    searches: settings.marketplaceSearchEnabled ? buildMarketplaceSearches(rules, settings) : [],
    searchIntervalMs: settings.marketplaceSearchIntervalMs,
  };
}

/**
 * Genel sayfadaki kartin acilmaya deger olup olmadigi: basligi Marketplace'i
 * kapsayan bir kuralla eslesiyor mu. Kartta aciklama olmadigi icin yalnizca
 * baslik elimizde; 'hepsi' modundaki kural icin bile tek kelime yeterli sayilir,
 * kalanlari aciklamada olabilir. Haric tutulan kelime baslikta gecerse ilan
 * zaten eslesemeyecegi icin acilmaz.
 */
export function titleWorthVisiting(
  title: string | null,
  rules: Rule[],
  options: KeywordOptions = {},
): boolean {
  if (!title) return false;
  return marketplaceRules(rules).some(
    (rule) => matchRule(title, { ...rule, matchMode: 'any' }, options).matched,
  );
}
