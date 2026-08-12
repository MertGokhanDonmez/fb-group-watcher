import { describe, expect, it } from 'vitest';
import { isTooOld, matchRule, ruleCoversGroup } from '../src/matcher/match.ts';
import { keywordPattern, normalizeText } from '../src/matcher/normalize.ts';

const rule = (overrides: Partial<Parameters<typeof matchRule>[1]> = {}) => ({
  matchMode: 'any' as const,
  includeKeywords: [] as string[],
  excludeKeywords: [] as string[],
  regex: null as string | null,
  ...overrides,
});

describe('normalizeText', () => {
  it('Ingilizce metni bozmaz', () => {
    expect(normalizeText('Free SOFA in Prague')).toBe('free sofa in prague');
  });

  it('Cekce aksanlari sadelestirir', () => {
    expect(normalizeText('křeslo zdarma, Žižkov')).toBe('kreslo zdarma, zizkov');
    expect(normalizeText('nábytek ZDARMA')).toBe('nabytek zdarma');
  });

  it('Turkce harfleri sadelestirir', () => {
    expect(normalizeText('Bedava KOLTUK, Şişli')).toBe('bedava koltuk, sisli');
    expect(normalizeText('ücretsiz buzdolabı')).toBe('ucretsiz buzdolabi');
  });

  it('Turkce buyuk I sorununa dusmez', () => {
    // Turkce yerelde toLowerCase kullanilsaydi 'I' -> 'ı' olur ve Ingilizce bozulurdu.
    expect(normalizeText('IKEA CHAIR')).toBe('ikea chair');
  });

  it('Lehce ve Almanca harfleri sadelestirir', () => {
    expect(normalizeText('Łódź')).toBe('lodz');
    expect(normalizeText('Straße')).toBe('strasse');
  });
});

describe('keywordPattern', () => {
  it('kelime basinda sinir arar, sonunu serbest birakir', () => {
    const pattern = keywordPattern('sofa')!;
    expect(pattern.test(normalizeText('two sofas free'))).toBe(true);
    expect(pattern.test(normalizeText('a sofabed'))).toBe(true);
    // Kelime ortasinda eslesmemeli.
    expect(pattern.test(normalizeText('microsofa'))).toBe(false);
  });

  it('cok kelimeli terimleri destekler', () => {
    expect(keywordPattern('for sale')!.test(normalizeText('Chair FOR SALE cheap'))).toBe(true);
  });

  it('Turkce ek eslestirmesi kapaliyken yumusama uretmez', () => {
    // Kritik: acik olsaydi "cat" -> "cad" varyanti "cadillac" ile eslesirdi.
    expect(keywordPattern('cat')!.test(normalizeText('cadillac for sale'))).toBe(false);
  });

  it('Turkce ek eslestirmesi acikken yumusamayi yakalar', () => {
    const pattern = keywordPattern('koltuk', { turkishSuffixes: true })!;
    expect(pattern.test(normalizeText('koltuğu veriyorum'))).toBe(true);
  });
});

describe('matchRule', () => {
  it('anahtar kelime gecen gonderiyi yakalar', () => {
    const result = matchRule('Free sofa, pick up today', rule({ includeKeywords: ['sofa'] }));
    expect(result.matched).toBe(true);
    expect(result.keywords).toEqual(['sofa']);
  });

  it('haric tutulan kelime her seyi veto eder', () => {
    const result = matchRule(
      'Sofa for sale, 500 CZK',
      rule({ includeKeywords: ['sofa'], excludeKeywords: ['for sale'] }),
    );
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('excluded');
  });

  it("'all' modunda tum terimler gerekir", () => {
    const strict = rule({ matchMode: 'all', includeKeywords: ['free', 'sofa'] });
    expect(matchRule('free sofa', strict).matched).toBe(true);
    expect(matchRule('free table', strict).matched).toBe(false);
  });

  it('regex ek bir terim gibi davranir', () => {
    const withRegex = rule({ includeKeywords: [], regex: 'praha\\s*[0-9]' });
    expect(matchRule('Giving away chairs, Praha 3', withRegex).matched).toBe(true);
    expect(matchRule('Giving away chairs, Brno', withRegex).matched).toBe(false);
  });

  it('gecersiz regex sunucuyu dusurmez', () => {
    const broken = rule({ includeKeywords: ['sofa'], regex: '[bozuk' });
    expect(() => matchRule('free sofa', broken)).not.toThrow();
    expect(matchRule('free sofa', broken).matched).toBe(true);
  });

  it('terimsiz kural hicbir seyle eslesmez', () => {
    // Aksi halde bos birakilan bir kural TUM gonderileri yakalardi.
    const result = matchRule('anything at all', rule());
    expect(result.matched).toBe(false);
    expect(result.reason).toBe('empty-rule');
  });
});

describe('ruleCoversGroup', () => {
  it('bos grup listesi tum gruplari kapsar', () => {
    expect(ruleCoversGroup({ groupIds: [] }, 5)).toBe(true);
    expect(ruleCoversGroup({ groupIds: [] }, null)).toBe(true);
  });

  it('secili gruplar disini kapsamaz', () => {
    expect(ruleCoversGroup({ groupIds: [1, 2] }, 2)).toBe(true);
    expect(ruleCoversGroup({ groupIds: [1, 2] }, 9)).toBe(false);
    expect(ruleCoversGroup({ groupIds: [1, 2] }, null)).toBe(false);
  });
});

describe('isTooOld', () => {
  const now = 1_000_000_000_000;

  it('esik disindaki gonderiyi eler', () => {
    expect(isTooOld(now - 45 * 60_000, 30, now)).toBe(true);
    expect(isTooOld(now - 10 * 60_000, 30, now)).toBe(false);
  });

  it('yas bilinmiyorsa elemez', () => {
    // Bildirimlerde zaman etiketi her zaman cikarilamiyor; gercek firsati kacirmayalim.
    expect(isTooOld(null, 30, now)).toBe(false);
  });
});
