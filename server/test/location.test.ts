import { describe, expect, it } from 'vitest';
import { extractLocation, haversineKm } from '../src/location/extract.ts';

describe('extractLocation', () => {
  it('Cekce semt adini aksanlariyla bulur', () => {
    expect(extractLocation('Free chair, Žižkov')?.name).toBe('Žižkov');
    expect(extractLocation('kreslo zdarma, Vinohrady')?.name).toBe('Vinohrady');
  });

  it('aksansiz yazilmis semt adini da bulur', () => {
    // Insanlar cogu zaman aksansiz yaziyor.
    expect(extractLocation('Giving away a desk in Zizkov')?.name).toBe('Žižkov');
    expect(extractLocation('sofa in Holesovice, free')?.name).toBe('Holešovice');
  });

  it('Praha numarali bolgeleri tanir', () => {
    expect(extractLocation('Free table, Praha 3')?.name).toBe('Žižkov');
    expect(extractLocation('Free table, Prague 7')?.name).toBe('Holešovice');
  });

  it('ozel bolgeyi sehir genelinden once secer', () => {
    // "Prague" kelimesi de geciyor ama Karlin daha ozel; mesafe ona gore hesaplanmali.
    const found = extractLocation('Free sofa in Prague, Karlin area, pick up today');
    expect(found?.name).toBe('Karlín');
  });

  it('yalnizca sehir adi varsa merkez girdisine duser', () => {
    expect(extractLocation('Free stuff, Prague')?.name).toBe('Praha (merkez)');
  });

  it('kelime ortasinda eslesmez', () => {
    // "repy" -> Repy semti; "creepy" icinde eslesmemeli.
    expect(extractLocation('a creepy old lamp, free')).toBeNull();
  });

  it('konum yoksa null doner', () => {
    expect(extractLocation('Free wooden chair, message me')).toBeNull();
  });
});

describe('haversineKm', () => {
  it('ayni nokta icin sifir doner', () => {
    expect(haversineKm(50.0755, 14.4378, 50.0755, 14.4378)).toBeCloseTo(0, 5);
  });

  it('Prag ici mesafeyi makul hesaplar', () => {
    // Zizkov -> Smichov yaklasik 4-5 km.
    const km = haversineKm(50.087, 14.46, 50.07, 14.403);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(6);
  });

  it('simetriktir', () => {
    const a = haversineKm(50.087, 14.46, 50.1, 14.39);
    const b = haversineKm(50.1, 14.39, 50.087, 14.46);
    expect(a).toBeCloseTo(b, 9);
  });
});
