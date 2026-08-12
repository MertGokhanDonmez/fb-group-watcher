import { describe, expect, it } from 'vitest';
import { stripNotificationPrefix } from '../../shared/facebook.ts';
import { computePause, isQuietHours } from '../src/safety/quiet.ts';
import type { Settings } from '../src/repo/settings.ts';

function at(hour: number): Date {
  const date = new Date('2026-08-09T00:00:00');
  date.setHours(hour, 0, 0, 0);
  return date;
}

describe('isQuietHours', () => {
  it('gun icinde kalan araligi dogru degerlendirir', () => {
    expect(isQuietHours(1, 8, at(3))).toBe(true);
    expect(isQuietHours(1, 8, at(0))).toBe(false);
    expect(isQuietHours(1, 8, at(1))).toBe(true); // baslangic dahil
    expect(isQuietHours(1, 8, at(8))).toBe(false); // bitis haric
  });

  it('gece yarisini asan araligi dogru degerlendirir', () => {
    // 22:00 - 06:00 arasi
    expect(isQuietHours(22, 6, at(23))).toBe(true);
    expect(isQuietHours(22, 6, at(2))).toBe(true);
    expect(isQuietHours(22, 6, at(12))).toBe(false);
    expect(isQuietHours(22, 6, at(6))).toBe(false);
  });

  it('bos aralikta hicbir zaman sessiz degildir', () => {
    expect(isQuietHours(5, 5, at(5))).toBe(false);
  });
});

const BASE: Settings = {
  agentToken: 'x',
  dryRun: true,
  killSwitch: false,
  telegramBotToken: '',
  telegramChatId: '',
  maxActionsPerHour: 6,
  maxActionsPerDay: 30,
  minActionGapSec: 90,
  quietHoursStart: 1,
  quietHoursEnd: 8,
  pauseCollectionInQuietHours: true,
  turkishSuffixMatching: false,
  homeLat: 0,
  homeLon: 0,
  homeLabel: '',
  notificationsEnabled: true,
  notificationsRefreshMs: 1_800_000,
  groupSweepMs: 420_000,
  cycleGapMs: 3000,
  jitterRatio: 0.35,
  selectorHealthThreshold: 3,
  heartbeatTimeoutSec: 300,
};

describe('computePause', () => {
  it('kill switch her seyi durdurur', () => {
    expect(computePause({ ...BASE, killSwitch: true }, at(12)).paused).toBe(true);
  });

  it('sessiz saatlerde toplama durur', () => {
    const state = computePause(BASE, at(3));
    expect(state.paused).toBe(true);
    expect(state.reason).toContain('Sessiz saatler');
  });

  it('sessiz saat duraklatmasi kapatilabilir', () => {
    expect(computePause({ ...BASE, pauseCollectionInQuietHours: false }, at(3)).paused).toBe(false);
  });

  it('normal saatlerde calisir', () => {
    expect(computePause(BASE, at(14)).paused).toBe(false);
  });
});

describe('stripNotificationPrefix', () => {
  it('Turkce bildirim onekini ayiklar', () => {
    const text = 'Ayşe Yılmaz, Bedava Eşya İstanbul grubunda bir gönderi paylaştı: Bedava koltuk veriyorum';
    expect(stripNotificationPrefix(text, 'Bedava Eşya İstanbul')).toBe('Bedava koltuk veriyorum');
  });

  it('Ingilizce bildirim onekini ayiklar', () => {
    const text = 'Zeynep Kaya posted in Free Stuff: Free fridge, working condition';
    expect(stripNotificationPrefix(text, 'Free Stuff')).toBe('Free fridge, working condition');
  });

  it('grup adi metinde kalmaz', () => {
    // Kritik: grup adi kalsaydi "bedava" anahtar kelimesi HER bildirimde eslesirdi.
    const text = 'Ali, Bedava Eşya grubunda bir gönderi paylaştı: masa veriyorum';
    const result = stripNotificationPrefix(text, 'Bedava Eşya');
    expect(result.toLocaleLowerCase('tr')).not.toContain('bedava');
    expect(result).toBe('masa veriyorum');
  });

  it('onek yoksa gonderi metnini kirpmaz', () => {
    // "Dikkat:" ifadesi bir bildirim oneki degil, gercek icerigin parcasi.
    expect(stripNotificationPrefix('Dikkat: bedava koltuk', null)).toBe('Dikkat: bedava koltuk');
  });

  it('bosluklari sadelestirir', () => {
    expect(stripNotificationPrefix('  cok    bosluklu   metin ', null)).toBe('cok bosluklu metin');
  });
});
