/**
 * Dilden bagimsiz metin normalizasyonu.
 *
 * Amac: "Bedava Koltük", "free SOFA", "křeslo zdarma" gibi metinlerde aksan ve
 * buyuk/kucuk harf farklari eslestirmeyi bozmasin. Belirli bir dile ozel kural
 * yazmak yerine Unicode ayristirmasi (NFD) kullaniyoruz: harften ayrilan
 * birlestirici isaretler siliniyor. Bu Turkce, Cekce, Lehce, Almanca, Fransizca
 * ve diger Latin alfabeli dillerde ayni anda calisir.
 *
 * Yararli bir yan etki: sonucta yalnizca ASCII harfler kaldigi icin regex `\b`
 * kelime siniri dogru davranir.
 */

/** NFD ile ayrisamayan harfler; bunlar ayri birer harf, aksanli varyant degil. */
const SPECIAL: Record<string, string> = {
  ı: 'i',
  ł: 'l',
  đ: 'd',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ð: 'd',
  þ: 'th',
};

export function normalizeText(text: string): string {
  // Yerel ayara bagli toLowerCase kullanmiyoruz: Turkce yerelde 'I' -> 'ı' olur ve
  // Ingilizce metni bozar. Nokta ve aksanlar zaten asagida NFD ile temizleniyor.
  const lowered = text.toLowerCase();
  const mapped = lowered.replace(/[ıłđøæœßðþ]/g, (char) => SPECIAL[char] ?? char);
  const folded = mapped.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return folded.replace(/\s+/g, ' ').trim();
}

/**
 * Turkcede son sessiz yumusar: koltuk -> koltugu, kitap -> kitabi.
 * Bu YALNIZCA Turkce icin dogrudur ve varsayilan olarak kapalidir: Ingilizcede
 * acilirsa "cat" anahtar kelimesi "cadillac" ile eslesir gibi hatalar uretir.
 */
const TURKISH_SOFTENING: Record<string, string> = { k: 'g', p: 'b', t: 'd' };

export interface KeywordOptions {
  /** Turkce son sessiz yumusamasini da dene. Turkce olmayan gruplarda kapali tutun. */
  turkishSuffixes?: boolean;
}

export function keywordVariants(keyword: string, options: KeywordOptions = {}): string[] {
  const base = normalizeText(keyword);
  if (base === '') return [];
  const variants = [base];

  if (options.turkishSuffixes === true) {
    const last = base.at(-1);
    const softened = last === undefined ? undefined : TURKISH_SOFTENING[last];
    if (softened !== undefined) variants.push(base.slice(0, -1) + softened);
  }
  return variants;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Anahtar kelime icin eslestirme kalibi uretir.
 *
 * Kelime BASINDA sinir aranir ama sonu serbest birakilir; boylece "sofa" hem
 * "sofas" hem "sofabed" icinde, "koltuk" ise "koltuklar" icinde bulunur. Bastaki
 * sinir "birkoltuk" / "loveseat"->"seat" gibi yanlis eslesmeleri onler.
 */
export function keywordPattern(keyword: string, options: KeywordOptions = {}): RegExp | null {
  const variants = keywordVariants(keyword, options);
  if (variants.length === 0) return null;
  const alternation = variants.map(escapeRegex).join('|');
  return new RegExp(`\\b(?:${alternation})`, 'u');
}
