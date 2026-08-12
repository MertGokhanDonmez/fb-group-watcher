import { pushConfigToAgent } from './agent/hub.ts';
import { getAgentStatus, isAgentAlive } from './agent/status.ts';
import { bus } from './bus.ts';
import { logEvent, pruneEventsOlderThan } from './repo/events.ts';
import { prunePostsOlderThan } from './repo/posts.ts';
import { getSettings } from './repo/settings.ts';
import { computePause } from './safety/quiet.ts';

const CHECK_INTERVAL_MS = 60_000;
const RETENTION_DAYS = 21;

/** Ayni kesinti icin tekrar tekrar alarm uretmemek icin. */
let offlineAlerted = false;

/**
 * Botun sessizce olmesi en olasi ariza senaryosu: Chrome kapanir, eklenti durur,
 * hicbir hata gorunmez ve kullanici gunlerce fark etmez. Watchdog tam bunu yakalar.
 */
export function startWatchdog(onOffline?: (message: string) => void): NodeJS.Timeout {
  const timer = setInterval(() => {
    const settings = getSettings();
    const alive = isAgentAlive(settings.heartbeatTimeoutSec);

    if (!alive && !offlineAlerted) {
      offlineAlerted = true;
      const status = getAgentStatus();
      const message = status.connected
        ? `Eklenti bagli ama ${settings.heartbeatTimeoutSec} saniyedir yasam sinyali gondermiyor - Chrome donmus olabilir`
        : 'Eklenti cevrimdisi - Chrome kapali veya eklenti devre disi';
      logEvent('watchdog', 'error', message);
      bus.emitEvent({ type: 'log', level: 'error', message, at: Date.now() });
      onOffline?.(message);
    } else if (alive && offlineAlerted) {
      offlineAlerted = false;
      const message = 'Eklenti yeniden cevrimici';
      logEvent('watchdog', 'info', message);
      bus.emitEvent({ type: 'log', level: 'info', message, at: Date.now() });
    }

    syncPauseState();
    pruneOldData();
  }, CHECK_INTERVAL_MS);

  timer.unref();
  return timer;
}

let lastPaused: boolean | null = null;

/**
 * Sessiz saatlerin baslamasi/bitmesi bir olay uretmez; zamanin gecmesiyle olur.
 * Eklentinin bunu ogrenmesinin tek yolu yeni plani ona gondermektir.
 */
function syncPauseState(): void {
  const pause = computePause(getSettings());
  if (lastPaused === pause.paused) return;
  lastPaused = pause.paused;
  pushConfigToAgent();
  const message = pause.paused
    ? `Toplama duraklatildi: ${pause.reason ?? '-'}`
    : 'Toplama yeniden basladi';
  logEvent('schedule', 'info', message);
  bus.emitEvent({ type: 'log', level: 'info', message, at: Date.now() });
}

let lastPruneAt = 0;

/** Gunde bir kez eski post ve gunluk kayitlarini siler; veritabani sinirsiz buyumesin. */
function pruneOldData(): void {
  const now = Date.now();
  if (now - lastPruneAt < 24 * 60 * 60 * 1000) return;
  lastPruneAt = now;
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const posts = prunePostsOlderThan(cutoff);
  const events = pruneEventsOlderThan(cutoff);
  if (posts > 0 || events > 0) {
    logEvent('maintenance', 'info', `Temizlik: ${posts} post, ${events} kayit silindi`);
  }
}
