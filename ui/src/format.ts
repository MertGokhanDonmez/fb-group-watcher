/** Panelde tekrar eden bicimlendirme yardimcilari. */

export function timeAgo(timestamp: number | null): string {
  if (timestamp === null) return '-';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} sn once`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk once`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa once`;
  return `${Math.round(hours / 24)} g once`;
}

export function clock(timestamp: number | null): string {
  if (timestamp === null) return '-';
  return new Date(timestamp).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function truncate(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}...`;
}

/** Virgul/satir ile ayrilmis kullanici girdisini temiz bir listeye cevirir. */
export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * YALNIZCA satir sonuna gore boler.
 *
 * Sablon varyantlari cumledir ve "Interested, is this still available?" gibi
 * dogal olarak virgul icerir; parseList bunlari iki ayri varyanta bolerek yarim
 * mesaj uretir. Anahtar kelime listelerinde virgul ayirici olarak dogru oldugu
 * icin iki fonksiyon ayri tutuluyor.
 */
export function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
