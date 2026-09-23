import { normalizeText } from './normalize.ts';

/**
 * Marketplace ilaninin gercekten bedava olup olmadigina aciklamadan karar verir.
 *
 * Fiyat alani kanit sayilmaz: saticilar dikkat cekmek icin "0 Kč" yazip fiyati
 * aciklamaya koyabiliyor. Bu yuzden karar YALNIZCA aciklamaya dayanir.
 *
 * Iki asama var: once "doprava zdarma" gibi bedava kelimesi gecen ama esyanin
 * bedava oldugunu gostermeyen kaliplar metinden silinir, sonra kalan metinde
 * bedava ifadesi aranir. Veto yerine silme kullaniyoruz: "Daruji gauc, doprava
 * zdarma nelze" gibi bir ilan kargo kalibi yuzunden elenmemeli.
 */

export interface FreeCheck {
  free: boolean;
  /** Karara yol acan ifade (kullanicinin yazdigi haliyle). */
  phrase: string | null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ifadeyi tam kelime olarak arayan kalip uretir. Anahtar kelime eslestirmesinden
 * farkli olarak sonu da sinirlidir: "free" ifadesi "freezer" icinde bulunmamali.
 * Sondaki '*' onek aramasi demektir ("daruj*" -> daruji, daruju, darujeme).
 * Kelimeler arasi bosluk tire de olabilir ("smoke free" = "smoke-free").
 */
export function phrasePattern(phrase: string, flags = 'u'): RegExp | null {
  const trimmed = phrase.trim();
  const prefix = trimmed.endsWith('*');
  const normalized = normalizeText(prefix ? trimmed.slice(0, -1) : trimmed);
  if (normalized === '') return null;
  const body = normalized.split(' ').map(escapeRegex).join('[\\s-]+');
  return new RegExp(`\\b${body}${prefix ? '' : '\\b'}`, flags);
}

export function checkFreeDescription(
  description: string,
  freePhrases: string[],
  notFreePhrases: string[],
): FreeCheck {
  let haystack = normalizeText(description);
  if (haystack === '') return { free: false, phrase: null };

  for (const phrase of notFreePhrases) {
    const pattern = phrasePattern(phrase, 'gu');
    if (pattern) haystack = haystack.replace(pattern, ' ');
  }

  for (const phrase of freePhrases) {
    if (phrasePattern(phrase)?.test(haystack)) return { free: true, phrase: phrase.trim() };
  }
  return { free: false, phrase: null };
}
