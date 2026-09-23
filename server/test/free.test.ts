import { describe, expect, it } from 'vitest';
import { checkFreeDescription, phrasePattern } from '../src/matcher/free.ts';
import { DEFAULT_FREE_PHRASES, DEFAULT_NOT_FREE_PHRASES } from '../src/repo/settings.ts';

const isFree = (description: string): boolean =>
  checkFreeDescription(description, DEFAULT_FREE_PHRASES, DEFAULT_NOT_FREE_PHRASES).free;

describe('checkFreeDescription', () => {
  it('Cekce bedava ifadelerini tanir', () => {
    expect(isFree('Daruji gauč, jen si ho odvezte.')).toBe(true);
    expect(isFree('Stůl ZDARMA, Praha 3')).toBe(true);
    expect(isFree('Židle za odvoz')).toBe(true);
    expect(isFree('Skříň za čokoládu')).toBe(true);
    expect(isFree('Lampa za symbolickou cenu 20 Kč')).toBe(true);
  });

  it('Ingilizce ve Turkce ifadeleri tanir', () => {
    expect(isFree('Giving away my old desk, pick up in Karlin')).toBe(true);
    expect(isFree('Free to good home')).toBe(true);
    expect(isFree('Ücretsiz koltuk, gelip alın')).toBe(true);
  });

  it('kargo bedava kalibini bedava saymaz', () => {
    // Cek ilanlarinda en sik yanlis pozitif: "doprava zdarma" = kargo bedava.
    expect(isFree('Gauč 1500 Kč, doprava zdarma po Praze')).toBe(false);
    expect(isFree('Poštovné zdarma')).toBe(false);
    expect(isFree('Sofa 50 EUR, free delivery')).toBe(false);
  });

  it('kargo kalibi silinince kalan gercek bedava ifadesini yine bulur', () => {
    expect(isFree('Daruji stůl, doprava zdarma nelze - jen osobní odběr')).toBe(true);
  });

  it('Ingilizcedeki -free bilesiklerini bedava saymaz', () => {
    expect(isFree('Great sofa from a smoke-free and pet free home, 2000 CZK')).toBe(false);
    expect(isFree('Hands-free headset, 300 Kč')).toBe(false);
  });

  it('free kelimesini baska kelimelerin icinde aramaz', () => {
    expect(isFree('Freezer, 800 Kč')).toBe(false);
  });

  it('fiyat metnini kanit saymaz', () => {
    expect(isFree('Cena 0 Kč, info ve zprávě')).toBe(false);
    expect(isFree('')).toBe(false);
  });

  it('karara yol acan ifadeyi doner', () => {
    expect(checkFreeDescription('Daruju skříň', DEFAULT_FREE_PHRASES, []).phrase).toBe('daruj*');
  });
});

describe('phrasePattern', () => {
  it('sondaki yildizi onek olarak yorumlar', () => {
    expect(phrasePattern('daruj*')?.test('darujeme')).toBe(true);
    expect(phrasePattern('daruj')?.test('darujeme')).toBe(false);
  });

  it('bosluk yerine tireyi de kabul eder', () => {
    expect(phrasePattern('smoke free')?.test('smoke-free')).toBe(true);
  });

  it('bos ifadeden kalip uretmez', () => {
    expect(phrasePattern('  ')).toBeNull();
    expect(phrasePattern('*')).toBeNull();
  });
});
