/**
 * Prag semt/bolge sozlugu.
 *
 * Koordinatlar bolgelerin YAKLASIK merkezleridir (+/- 1 km). Amac sokak seviyesinde
 * adres bulmak degil, "bu ilan bana yakin mi?" sorusuna guvenilir cevap vermek.
 * Bu yaklasim disariya hicbir istek atmaz: cevrimdisi, aninda ve hiz siniri yok.
 *
 * Yeni bir bolge eklemek icin listeye bir satir eklemek yeterli; `aliases` alanina
 * insanlarin gercekte yazdigi varyantlari koyun (Ingilizce/Cekce/kisaltma).
 */

export interface PragueArea {
  name: string;
  lat: number;
  lon: number;
  /** Metinde aranacak yazim varyantlari. Normalize edilmis halleriyle eslesirler. */
  aliases: string[];
  /**
   * Sehir geneli girdi. Yalnizca daha ozel bir bolge bulunamazsa kullanilir;
   * aksi halde "Praha" kelimesi "Krc" gecen bir ilanda da eslesip mesafeyi bozar.
   */
  generic?: boolean;
}

export const PRAGUE_AREAS: PragueArea[] = [
  // Merkez
  { name: 'Praha 1 - Staré Město', lat: 50.0875, lon: 14.4213, aliases: ['praha 1', 'prague 1', 'stare mesto', 'old town'] },
  { name: 'Malá Strana', lat: 50.088, lon: 14.404, aliases: ['mala strana', 'lesser town'] },
  { name: 'Hradčany', lat: 50.09, lon: 14.395, aliases: ['hradcany'] },
  { name: 'Nové Město', lat: 50.0785, lon: 14.427, aliases: ['nove mesto', 'new town'] },

  // Praha 2
  { name: 'Vinohrady', lat: 50.0755, lon: 14.445, aliases: ['vinohrady', 'praha 2', 'prague 2'] },
  { name: 'Vyšehrad', lat: 50.064, lon: 14.418, aliases: ['vysehrad'] },

  // Praha 3
  { name: 'Žižkov', lat: 50.087, lon: 14.46, aliases: ['zizkov', 'praha 3', 'prague 3'] },

  // Praha 4
  { name: 'Nusle', lat: 50.06, lon: 14.44, aliases: ['nusle', 'praha 4', 'prague 4'] },
  { name: 'Podolí', lat: 50.05, lon: 14.42, aliases: ['podoli'] },
  { name: 'Braník', lat: 50.03, lon: 14.41, aliases: ['branik'] },
  { name: 'Krč', lat: 50.035, lon: 14.45, aliases: ['krc'] },
  { name: 'Pankrác', lat: 50.048, lon: 14.437, aliases: ['pankrac'] },

  // Praha 5
  { name: 'Smíchov', lat: 50.07, lon: 14.403, aliases: ['smichov', 'praha 5', 'prague 5', 'andel'] },
  { name: 'Košíře', lat: 50.065, lon: 14.37, aliases: ['kosire'] },
  { name: 'Barrandov', lat: 50.03, lon: 14.39, aliases: ['barrandov'] },
  { name: 'Stodůlky', lat: 50.045, lon: 14.32, aliases: ['stodulky', 'praha 13', 'prague 13'] },

  // Praha 6
  { name: 'Dejvice', lat: 50.1, lon: 14.39, aliases: ['dejvice', 'praha 6', 'prague 6'] },
  { name: 'Bubeneč', lat: 50.105, lon: 14.41, aliases: ['bubenec'] },
  { name: 'Břevnov', lat: 50.085, lon: 14.36, aliases: ['brevnov'] },
  { name: 'Vokovice', lat: 50.1, lon: 14.35, aliases: ['vokovice'] },
  { name: 'Ruzyně', lat: 50.1, lon: 14.29, aliases: ['ruzyne'] },

  // Praha 7
  { name: 'Holešovice', lat: 50.103, lon: 14.44, aliases: ['holesovice', 'praha 7', 'prague 7'] },
  { name: 'Letná', lat: 50.098, lon: 14.426, aliases: ['letna'] },

  // Praha 8
  { name: 'Karlín', lat: 50.093, lon: 14.45, aliases: ['karlin', 'praha 8', 'prague 8'] },
  { name: 'Libeň', lat: 50.11, lon: 14.475, aliases: ['liben'] },
  { name: 'Kobylisy', lat: 50.12, lon: 14.46, aliases: ['kobylisy'] },

  // Praha 9
  { name: 'Vysočany', lat: 50.108, lon: 14.5, aliases: ['vysocany', 'praha 9', 'prague 9'] },
  { name: 'Prosek', lat: 50.12, lon: 14.5, aliases: ['prosek'] },
  { name: 'Letňany', lat: 50.13, lon: 14.51, aliases: ['letnany', 'praha 18', 'prague 18'] },

  // Praha 10
  { name: 'Vršovice', lat: 50.068, lon: 14.46, aliases: ['vrsovice', 'praha 10', 'prague 10'] },
  { name: 'Strašnice', lat: 50.075, lon: 14.49, aliases: ['strasnice'] },
  { name: 'Malešice', lat: 50.085, lon: 14.5, aliases: ['malesice'] },
  { name: 'Záběhlice', lat: 50.055, lon: 14.49, aliases: ['zabehlice'] },

  // Guney / guneydogu
  { name: 'Chodov', lat: 50.03, lon: 14.5, aliases: ['chodov', 'praha 11', 'prague 11'] },
  { name: 'Háje', lat: 50.03, lon: 14.525, aliases: ['haje'] },
  { name: 'Modřany', lat: 50.0, lon: 14.41, aliases: ['modrany', 'praha 12', 'prague 12'] },
  { name: 'Kunratice', lat: 50.0, lon: 14.48, aliases: ['kunratice'] },

  // Dogu / kuzey
  { name: 'Černý Most', lat: 50.108, lon: 14.58, aliases: ['cerny most', 'praha 14', 'prague 14'] },
  { name: 'Hostivař', lat: 50.05, lon: 14.53, aliases: ['hostivar', 'praha 15', 'prague 15'] },
  { name: 'Radotín', lat: 49.99, lon: 14.36, aliases: ['radotin', 'praha 16', 'prague 16'] },
  { name: 'Řepy', lat: 50.07, lon: 14.31, aliases: ['repy', 'praha 17', 'prague 17'] },
  { name: 'Horní Počernice', lat: 50.11, lon: 14.6, aliases: ['horni pocernice', 'praha 20', 'prague 20'] },
  { name: 'Újezd nad Lesy', lat: 50.08, lon: 14.65, aliases: ['ujezd nad lesy', 'praha 21', 'prague 21'] },
  { name: 'Uhříněves', lat: 50.03, lon: 14.6, aliases: ['uhrineves', 'praha 22', 'prague 22'] },
  { name: 'Suchdol', lat: 50.13, lon: 14.38, aliases: ['suchdol'] },
  { name: 'Čakovice', lat: 50.14, lon: 14.53, aliases: ['cakovice', 'praha 19', 'prague 19'] },

  // Genel
  {
    name: 'Praha (merkez)',
    lat: 50.0755,
    lon: 14.4378,
    aliases: ['praha centrum', 'prague centre', 'prague center', 'praha', 'prague'],
    generic: true,
  },
];

/** Iki koordinat arasi kus ucusu mesafe (km). */
export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
