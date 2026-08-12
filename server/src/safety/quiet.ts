import type { Settings } from '../repo/settings.ts';

/**
 * Verilen saatin sessiz araliga dusup dusmedigini soyler.
 * Aralik gece yarisini asabilir (orn. 22 -> 6), bu yuzden basit bir
 * "start <= hour < end" karsilastirmasi yeterli degil.
 */
export function isQuietHours(start: number, end: number, now: Date = new Date()): boolean {
  if (start === end) return false; // bos aralik: sessiz saat yok
  const hour = now.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface PauseState {
  paused: boolean;
  reason: string | null;
}

/**
 * Toplamanin duraklatilip duraklatilmayacagini belirler.
 * Kill switch elle ve kalicidir; sessiz saatler otomatik ve gecicidir.
 */
export function computePause(settings: Settings, now: Date = new Date()): PauseState {
  if (settings.killSwitch) {
    return { paused: true, reason: 'Kill switch acik' };
  }
  if (
    settings.pauseCollectionInQuietHours &&
    isQuietHours(settings.quietHoursStart, settings.quietHoursEnd, now)
  ) {
    return {
      paused: true,
      reason: `Sessiz saatler (${settings.quietHoursStart}:00-${settings.quietHoursEnd}:00)`,
    };
  }
  return { paused: false, reason: null };
}
