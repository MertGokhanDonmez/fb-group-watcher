import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseStats } from '../../shared/protocol.ts';

/**
 * Selector saglik alarminin ne zaman SUSMASI gerektigi.
 *
 * Bu testler somut bir aksakliktan dogdu: alarm ardisik bos tur sayisina bakiyordu
 * ve Facebook akisi sanallastirdigi icin bos turlar basarili turlarla donusumlu
 * geliyordu. Sonuc, 22 saatte 41 kez "bozuldu / duzeldi" cifti - gercek bir
 * bozulmayi icinde kaybedecek kadar gurultu. Alarm artik surekliligi olcuyor.
 */

const EMPTY: ParseStats = { articlesSeen: 0, postsParsed: 0, failures: 0 };
const UNPARSABLE: ParseStats = { articlesSeen: 12, postsParsed: 0, failures: 12 };
const HEALTHY: ParseStats = { articlesSeen: 8, postsParsed: 8, failures: 0 };

/** groupSweepMs varsayilani 420sn; korluk esigi bunun 3 kati ile 15dk'nin buyugu. */
const BLIND_MS = 21 * 60_000;

let ingestPosts: typeof import('../src/ingest.ts').ingestPosts;
let dropTempDb: typeof import('./helpers.ts').dropTempDb;
let errors: string[];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-26T09:00:00Z'));

  /*
   * SIRA ONEMLI. resetModules once gelmeli: modul durumunu (son basarili
   * ayristirma zamani) her test icin sifirliyoruz, ama veritabani gecici dosyaya
   * baglandiktan SONRA sifirlanirsa taze modul grafigi baglantiyi kaybeder ve
   * getDb() uretim veritabanini acar - testler gercek veriye yazar.
   */
  vi.resetModules();
  const helpers = await import('./helpers.ts');
  dropTempDb = helpers.dropTempDb;
  helpers.useTempDb();

  ({ ingestPosts } = await import('../src/ingest.ts'));

  errors = [];
  const events = await import('../src/repo/events.ts');
  const original = events.logEvent;
  vi.spyOn(events, 'logEvent').mockImplementation((kind, level, message, payload) => {
    if (kind === 'selector_health' && level === 'error') errors.push(message);
    return original(kind, level, message, payload);
  });
});

afterEach(() => {
  dropTempDb();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Bir tarama turu; tur arasi zaman ilerletilir. */
function round(stats: ParseStats, advanceMs = 60_000): void {
  ingestPosts('free.stuff.in.prague', [], stats);
  vi.advanceTimersByTime(advanceMs);
}

describe('selector saglik alarmi', () => {
  it('bos ve basarili turlar donusumlu geldiginde HIC alarm vermez', () => {
    // Gercekte gozlenen desen: uc bos tur, sonra basarili bir tur, tekrar tekrar.
    for (let cycle = 0; cycle < 10; cycle += 1) {
      round(EMPTY);
      round(EMPTY);
      round(EMPTY);
      round(HEALTHY);
    }
    expect(errors).toEqual([]);
  });

  it('bot gercekten korse alarm verir', () => {
    // Once saglikli bir tur: "son basarili ayristirma" saati buradan baslar.
    round(HEALTHY);
    // Ardindan korluk esigini asacak kadar uzun sure hicbir sey ayristirilamiyor.
    for (let i = 0; i < BLIND_MS / 60_000 + 2; i += 1) round(EMPTY);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('hic gonderi bulunamadi');
  });

  it('sayfada gonderi gorunup ayristirilamiyorsa selector bozulmasini isaret eder', () => {
    round(HEALTHY);
    for (let i = 0; i < BLIND_MS / 60_000 + 2; i += 1) round(UNPARSABLE);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('selector bozulmus olabilir');
  });

  it('kor kaldigi surece alarmi tekrarlamaz', () => {
    round(HEALTHY);
    for (let i = 0; i < 120; i += 1) round(EMPTY);

    // Saatlerce suren bir bozulma tek bir alarm uretmeli, yuzlerce degil.
    expect(errors).toHaveLength(1);
  });

  it('sessiz saatlerden sonra biriken bosluk korluk sayilmaz', () => {
    // Gercekte yasanan yanlis alarm: 01:00-08:00 arasi toplama duraklatiliyor,
    // 08:04'te ilk uc tur bos gelince 7 saatlik bosluk "korluk" sanilip alarm
    // veriliyordu. Bot o sure boyunca bakmiyordu; goremedigi icin degil.
    round(HEALTHY);
    vi.advanceTimersByTime(7 * 60 * 60_000); // sessiz saatler

    round(EMPTY);
    round(EMPTY);
    round(EMPTY);

    expect(errors).toEqual([]);
  });

  it('bosluktan sonra korluk yeniden olculur ve gercek ariza yine yakalanir', () => {
    round(HEALTHY);
    vi.advanceTimersByTime(7 * 60 * 60_000);
    // Bosluk sayaci sifirladi; ama bu noktadan sonra gercekten kor kalirsa alarm gelmeli.
    for (let i = 0; i < BLIND_MS / 60_000 + 2; i += 1) round(EMPTY);

    expect(errors).toHaveLength(1);
  });

  it('esik asilmadan once tek basina uzun sessizlik alarm uretmez', () => {
    round(HEALTHY);
    // Esigin hemen altinda kalacak kadar bos tur.
    const rounds = Math.floor(BLIND_MS / 60_000) - 1;
    for (let i = 0; i < rounds; i += 1) round(EMPTY);

    expect(errors).toEqual([]);
  });
});
