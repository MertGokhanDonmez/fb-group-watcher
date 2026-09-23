import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  parseAgentMessage,
  type AgentConfig,
  type AgentToServerMessage,
  type ServerToAgentMessage,
} from '../../../shared/protocol.ts';
import { NOTIFICATIONS_URL, chronologicalGroupUrl } from '../../../shared/facebook.ts';
import { computePause } from '../safety/quiet.ts';
import { bus } from '../bus.ts';
import { ingestPosts } from '../ingest.ts';
import { ingestMarketplaceListing, ingestMarketplaceResults } from '../marketplace/ingest.ts';
import { buildMarketplaceWatch } from '../marketplace/searches.ts';
import { processNewPosts } from '../pipeline.ts';
import { getAction, setActionStatus } from '../repo/actions.ts';
import { logEvent } from '../repo/events.ts';
import { listEnabledGroups } from '../repo/groups.ts';
import { listEnabledRules } from '../repo/rules.ts';
import { setMatchStatus } from '../repo/matches.ts';
import { ensureAgentToken, getSettings, updateSettings } from '../repo/settings.ts';
import { patchAgentStatus } from './status.ts';

/** Bekleyen snapshot istekleri: eklentiden yanit gelince cozulurler. */
const pendingCaptures = new Map<number, (result: CaptureOutcome) => void>();
let nextCaptureId = 1;

export interface CaptureOutcome {
  ok: boolean;
  url: string;
  html?: string;
  error?: string;
}

/**
 * Eklentiden bir sayfanin ham HTML'ini ister. Facebook DOM'u degistiginde
 * ayristiriciyi onarmanin tek yolu gercek sayfaya bakmaktir.
 */
export function requestCapture(url: string, dwellMs: number, timeoutMs: number): Promise<CaptureOutcome> {
  const captureId = nextCaptureId;
  nextCaptureId += 1;

  const sent = sendToAgent({ type: 'capture', command: { captureId, url, dwellMs } });
  if (!sent) {
    return Promise.resolve({ ok: false, url, error: 'Eklenti bagli degil' });
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCaptures.delete(captureId);
      resolve({ ok: false, url, error: 'Eklenti zamaninda yanit vermedi' });
    }, timeoutMs);

    pendingCaptures.set(captureId, (result) => {
      clearTimeout(timer);
      pendingCaptures.delete(captureId);
      resolve(result);
    });
  });
}

/** Ayni anda yalnizca bir eklenti baglantisi kabul edilir. */
let socket: WebSocket | null = null;
/** Bagli eklenti orneginin kimligi; ayni ornegin yeniden baglanmasini tanimak icin. */
let currentInstanceId: string | null = null;
/** Baglanti gunlugu kisitlamasi: yeniden baglanma firtinasi veritabanini sisirmemeli. */
let lastConnectLogAt = 0;
const CONNECT_LOG_INTERVAL_MS = 60_000;

export function buildAgentConfig(): AgentConfig {
  const settings = getSettings();
  const pause = computePause(settings);
  return {
    groups: listEnabledGroups().map((group) => ({
      fbGroupId: group.fbGroupId,
      url: chronologicalGroupUrl(group.url),
      dwellMs: group.dwellMs,
      priority: group.priority,
    })),
    cycleGapMs: settings.cycleGapMs,
    jitterRatio: settings.jitterRatio,
    dryRun: settings.dryRun,
    killSwitch: settings.killSwitch,
    paused: pause.paused,
    pauseReason: pause.reason,
    notifications: {
      enabled: settings.notificationsEnabled,
      url: NOTIFICATIONS_URL,
      refreshMs: settings.notificationsRefreshMs,
    },
    groupSweepMs: settings.groupSweepMs,
    marketplace: buildMarketplaceWatch(listEnabledRules(), settings),
  };
}

export function sendToAgent(message: ServerToAgentMessage): boolean {
  if (!socket || socket.readyState !== socket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

/** Ayar veya grup listesi degistiginde eklentiye yeni plani gonderir. */
export function pushConfigToAgent(): void {
  sendToAgent({ type: 'config', config: buildAgentConfig() });
}

export function isAgentConnected(): boolean {
  return socket !== null && socket.readyState === socket.OPEN;
}

export function handleAgentConnection(incoming: WebSocket): void {
  let authenticated = false;

  // DIKKAT: gelen soket burada aktif soket yapilmaz. Once kimlik dogrulanir,
  // cunku "her yeni baglanti oncekini atsin" davranisi iki eklenti kopyasi
  // oldugunda ikisinin birbirini surekli dusurdugu bir kilitlenme uretiyor.

  incoming.on('message', (data: Buffer | string) => {
    const message = parseAgentMessage(data.toString());
    if (!message) {
      logEvent('agent', 'warn', 'Cozulemeyen mesaj alindi');
      return;
    }

    if (!authenticated) {
      if (message.type !== 'hello') {
        incoming.send(
          JSON.stringify({ type: 'hello_error', reason: 'once hello gonderilmeli' } satisfies ServerToAgentMessage),
        );
        incoming.close(4001, 'unauthenticated');
        return;
      }
      authenticated = authenticate(incoming, message);
      return;
    }

    handleMessage(message);
  });

  incoming.on('close', () => {
    // Yalnizca aktif soketin kapanmasi durum degisikligidir; reddedilen
    // yinelenen baglantilarin kapanmasi paneli etkilememeli.
    if (socket === incoming) {
      socket = null;
      patchAgentStatus({ connected: false, currentGroup: null });
      throttledLog('agent', 'warn', 'Eklenti baglantisi kapandi');
    }
  });

  incoming.on('error', (error: Error) => {
    logEvent('agent', 'error', `Soket hatasi: ${error.message}`);
  });
}

function authenticate(
  incoming: WebSocket,
  message: Extract<AgentToServerMessage, { type: 'hello' }>,
): boolean {
  const expected = ensureAgentToken();
  if (message.token !== expected) {
    incoming.send(
      JSON.stringify({ type: 'hello_error', reason: 'gecersiz token' } satisfies ServerToAgentMessage),
    );
    incoming.close(4003, 'bad token');
    logEvent('agent', 'error', 'Gecersiz token ile baglanti denemesi');
    return false;
  }
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    incoming.send(
      JSON.stringify({
        type: 'hello_error',
        reason: `protokol surumu uyusmuyor (sunucu ${PROTOCOL_VERSION}, eklenti ${message.protocolVersion}) - eklentiyi yeniden derleyin`,
      } satisfies ServerToAgentMessage),
    );
    incoming.close(4004, 'protocol mismatch');
    logEvent('agent', 'error', 'Protokol surumu uyusmuyor', {
      server: PROTOCOL_VERSION,
      extension: message.protocolVersion,
    });
    return false;
  }

  /**
   * Baska bir eklenti ornegi zaten sagli sekilde bagliysa yeni baglantiyi
   * KABUL ETMIYORUZ. Eskiden yeni baglanti eskisini duserdi; iki kopya yuklenince
   * ikisi birbirini sirayla dusurup saniyede birkac kez yeniden baglanan bir
   * kilitlenme olusuyordu. Simdi ikinci kopya acikca reddediliyor.
   */
  const existingAlive = socket !== null && socket !== incoming && socket.readyState === socket.OPEN;
  if (existingAlive && currentInstanceId !== null && currentInstanceId !== message.instanceId) {
    incoming.send(
      JSON.stringify({
        type: 'hello_error',
        reason:
          'Baska bir eklenti ornegi zaten bagli. Tarayicinin eklentiler sayfasinda ' +
          'bu eklentinin birden fazla kopyasi yuklu olabilir; fazla olani kaldirin.',
      } satisfies ServerToAgentMessage),
    );
    incoming.close(4005, 'duplicate instance');
    throttledLog(
      'agent',
      'warn',
      'Ikinci bir eklenti ornegi baglanmaya calisti ve reddedildi - eklentinin birden fazla kopyasi yuklu olabilir',
    );
    return false;
  }

  // Ayni ornek yeniden baglaniyorsa (service worker yeniden basladi) eski soketi biraktir.
  if (socket !== null && socket !== incoming) {
    try {
      socket.close(4000, 'replaced');
    } catch {
      /* zaten kapali */
    }
  }

  const instanceChanged = currentInstanceId !== message.instanceId;
  socket = incoming;
  currentInstanceId = message.instanceId;

  patchAgentStatus({
    connected: true,
    extVersion: message.extVersion,
    lastHeartbeatAt: Date.now(),
  });
  incoming.send(
    JSON.stringify({ type: 'hello_ok', protocolVersion: PROTOCOL_VERSION } satisfies ServerToAgentMessage),
  );
  pushConfigToAgent();

  // Service worker sik sik uyanip yeniden baglanir; her seferinde log yazmak
  // gunlugu kullanissiz hale getirir.
  if (instanceChanged || Date.now() - lastConnectLogAt > CONNECT_LOG_INTERVAL_MS) {
    lastConnectLogAt = Date.now();
    logEvent('agent', 'info', `Eklenti baglandi (v${message.extVersion})`);
  }
  return true;
}

/** Ayni uyariyi saniyede bir tekrarlamak yerine seyrek yazar. */
const throttleState = new Map<string, number>();
function throttledLog(kind: string, level: 'info' | 'warn' | 'error', message: string): void {
  const last = throttleState.get(message) ?? 0;
  if (Date.now() - last < CONNECT_LOG_INTERVAL_MS) return;
  throttleState.set(message, Date.now());
  logEvent(kind, level, message);
}

function handleMessage(message: AgentToServerMessage): void {
  switch (message.type) {
    case 'heartbeat':
      patchAgentStatus({ lastHeartbeatAt: Date.now() });
      return;

    case 'posts':
      processNewPosts(ingestPosts(message.fbGroupId, message.posts, message.stats));
      return;

    case 'marketplace_results': {
      const listings = ingestMarketplaceResults(
        message.source,
        message.query,
        message.cards,
        message.stats,
      );
      if (listings.length > 0) sendToAgent({ type: 'visit_listings', listings });
      return;
    }

    case 'capture_result': {
      const resolve = pendingCaptures.get(message.captureId);
      if (!resolve) {
        logEvent('agent', 'warn', `Bilinmeyen snapshot yaniti: ${message.captureId}`);
        return;
      }
      resolve({
        ok: message.html !== undefined,
        url: message.url,
        html: message.html,
        error: message.error,
      });
      return;
    }

    case 'marketplace_listing': {
      const post = ingestMarketplaceListing(message.listing);
      if (post?.freeVerified === true) processNewPosts([post]);
      return;
    }

    case 'action_result':
      handleActionResult(message);
      return;

    case 'blocked':
      handleBlocked(message);
      return;

    case 'log':
      logEvent('agent', message.level, message.message);
      bus.emitEvent({ type: 'log', level: message.level, message: message.message, at: Date.now() });
      return;

    case 'hello':
      // Yeniden hello gonderilmesi zararsiz; yok say.
      return;
  }
}

function handleActionResult(
  message: Extract<AgentToServerMessage, { type: 'action_result' }>,
): void {
  const action = getAction(message.actionId);
  if (!action) {
    logEvent('action', 'warn', `Bilinmeyen aksiyon sonucu: ${message.actionId}`);
    return;
  }

  if (message.ok) {
    setActionStatus(action.id, 'sent', { verified: message.verified, error: null });
    setMatchStatus(action.matchId, 'sent');
    if (!message.verified) {
      // Gonderildi ama postta gorunmedi: sessiz basarisizlik ihtimali.
      logEvent(
        'action',
        'warn',
        `Aksiyon ${action.id} gonderildi ama dogrulanamadi - yorumun gercekten yazildigini elle kontrol edin`,
      );
    }
  } else {
    setActionStatus(action.id, 'failed', { error: message.error ?? 'bilinmeyen hata' });
    setMatchStatus(action.matchId, 'failed');
    logEvent('action', 'error', `Aksiyon ${action.id} basarisiz: ${message.error ?? '-'}`);
  }

  const updated = getAction(action.id);
  if (updated) bus.emitEvent({ type: 'action', action: updated });
}

/**
 * Facebook checkpoint/captcha/hiz siniri gosterdiginde tek dogru davranis durmaktir.
 * Devam etmek hesabi kalici riske sokar, bu yuzden kill switch otomatik aciliyor.
 */
function handleBlocked(message: Extract<AgentToServerMessage, { type: 'blocked' }>): void {
  updateSettings({ killSwitch: true });
  patchAgentStatus({
    lastBlock: { kind: message.kind, at: Date.now(), url: message.url, note: message.note },
  });
  const text = `Facebook engeli tespit edildi (${message.kind}). Bot durduruldu.`;
  logEvent('blocked', 'error', text, message);
  bus.emitEvent({ type: 'log', level: 'error', message: text, at: Date.now() });
  pushConfigToAgent();
}
