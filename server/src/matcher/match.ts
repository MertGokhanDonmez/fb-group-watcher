import type { Rule } from '../types.ts';
import { keywordPattern, normalizeText, type KeywordOptions } from './normalize.ts';

export interface MatchResult {
  matched: boolean;
  /** Eslesen anahtar kelimeler (kullaniciya gosterilmek uzere, orijinal yazimlariyla). */
  keywords: string[];
  /** Eslesmediyse nedeni - teshis ve panelde aciklama icin. */
  reason?: 'excluded' | 'no-include-match' | 'missing-terms' | 'empty-rule';
}

type MatchableRule = Pick<
  Rule,
  'matchMode' | 'includeKeywords' | 'excludeKeywords' | 'regex'
>;

/**
 * Bir gonderi metnini kurala gore degerlendirir. Saf fonksiyon: veritabanina
 * dokunmaz, boylece kenar durumlari testte hizlica dogrulanabilir.
 *
 * Sira onemli: haric tutulan kelimeler her seyi veto eder. "satilik koltuk"
 * ilanina "koltuk" araniyor diye eslesmek istemiyoruz.
 */
export function matchRule(
  text: string,
  rule: MatchableRule,
  options: KeywordOptions = {},
): MatchResult {
  const haystack = normalizeText(text);

  for (const excluded of rule.excludeKeywords) {
    const pattern = keywordPattern(excluded, options);
    if (pattern?.test(haystack)) {
      return { matched: false, keywords: [], reason: 'excluded' };
    }
  }

  const hits: string[] = [];
  for (const keyword of rule.includeKeywords) {
    const pattern = keywordPattern(keyword, options);
    if (pattern?.test(haystack)) hits.push(keyword);
  }

  // Regex, ek bir arama terimi gibi davranir: 'any' modunda tek basina yeterlidir,
  // 'all' modunda diger terimlerle birlikte saglanmasi gerekir.
  const hasRegex = rule.regex !== null && rule.regex.trim() !== '';
  let regexHit = false;
  if (hasRegex) {
    try {
      regexHit = new RegExp(rule.regex as string, 'iu').test(haystack);
      if (regexHit) hits.push(`/${rule.regex as string}/`);
    } catch {
      // Gecersiz regex kayit sirasinda dogrulaniyor; yine de burada patlamamaliyiz.
      regexHit = false;
    }
  }

  const termCount = rule.includeKeywords.length + (hasRegex ? 1 : 0);
  if (termCount === 0) {
    // Terimi olmayan kural her gonderiyle eslesirdi; bu neredeyse her zaman hatadir.
    return { matched: false, keywords: [], reason: 'empty-rule' };
  }

  if (rule.matchMode === 'all') {
    const allMatched = hits.length === termCount;
    return allMatched
      ? { matched: true, keywords: hits }
      : { matched: false, keywords: hits, reason: 'missing-terms' };
  }

  return hits.length > 0
    ? { matched: true, keywords: hits }
    : { matched: false, keywords: [], reason: 'no-include-match' };
}

/** Gonderi kuralin kapsamindaki bir gruba mi ait? Bos liste = tum gruplar. */
export function ruleCoversGroup(rule: Pick<Rule, 'groupIds'>, groupId: number | null): boolean {
  if (rule.groupIds.length === 0) return true;
  if (groupId === null) return false;
  return rule.groupIds.includes(groupId);
}

/**
 * Gonderi kuralin kabul ettigi yastan eski mi?
 * Yas bilinmiyorsa elemiyoruz - bildirimlerden gelen kayitlarda zaman etiketi
 * her zaman cikarilamiyor ve bu yuzden gercek firsatlari kacirmak istemeyiz.
 */
export function isTooOld(
  postedAt: number | null,
  maxPostAgeMin: number,
  now: number = Date.now(),
): boolean {
  if (postedAt === null) return false;
  return now - postedAt > maxPostAgeMin * 60_000;
}
