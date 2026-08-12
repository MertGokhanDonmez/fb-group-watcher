import { normalizeText } from '../matcher/normalize.ts';
import { PRAGUE_AREAS, haversineKm, type PragueArea } from './prague.ts';

export interface ExtractedLocation {
  name: string;
  lat: number;
  lon: number;
  /** Metinde gercekten gecen yazim; panelde neden bu bolgeye karar verildigini gosterir. */
  matchedAlias: string;
}

interface AliasEntry {
  alias: string;
  pattern: RegExp;
  area: PragueArea;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Takma adlar uzunluga gore azalan sirada denenir: "praha 3" ifadesi "praha"dan
 * once eslesmeli, aksi halde her ilan sehir merkezine atanir ve mesafe anlamsizlasir.
 */
function buildIndex(areas: PragueArea[]): { specific: AliasEntry[]; generic: AliasEntry[] } {
  const specific: AliasEntry[] = [];
  const generic: AliasEntry[] = [];

  for (const area of areas) {
    for (const alias of area.aliases) {
      const normalized = normalizeText(alias);
      const entry: AliasEntry = {
        alias,
        // Bolge adlari kelime sinirlariyla aranir; "repy" ifadesi "creepy" icinde eslesmemeli.
        pattern: new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'u'),
        area,
      };
      if (area.generic === true) generic.push(entry);
      else specific.push(entry);
    }
  }

  const byLength = (a: AliasEntry, b: AliasEntry): number => b.alias.length - a.alias.length;
  return { specific: specific.sort(byLength), generic: generic.sort(byLength) };
}

const INDEX = buildIndex(PRAGUE_AREAS);

/**
 * Gonderi metninden bolge cikarir.
 * Once ozel bolgeler denenir, hicbiri bulunamazsa sehir geneli girdi kullanilir.
 * Hicbir sey bulunamazsa null doner - konum bilinmiyor demektir, elenmez.
 */
export function extractLocation(text: string): ExtractedLocation | null {
  const haystack = normalizeText(text);

  for (const list of [INDEX.specific, INDEX.generic]) {
    for (const entry of list) {
      if (!entry.pattern.test(haystack)) continue;
      return {
        name: entry.area.name,
        lat: entry.area.lat,
        lon: entry.area.lon,
        matchedAlias: entry.alias,
      };
    }
  }
  return null;
}

/** Bilinen bolgeler listesi (panelde ev konumu secimi icin). */
export function listAreas(): { name: string; lat: number; lon: number }[] {
  return PRAGUE_AREAS.map((area) => ({ name: area.name, lat: area.lat, lon: area.lon }));
}

export { haversineKm };
