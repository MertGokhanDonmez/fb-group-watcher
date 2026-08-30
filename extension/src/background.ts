import {
  NOTIFICATION_CHANNEL,
  PROTOCOL_VERSION,
  type AgentConfig,
  type AgentGroupConfig,
  type AgentToServerMessage,
  type RawPost,
  type ServerToAgentMessage,
} from '../../shared/protocol.ts';
import type { BlockDetection } from './content/detect.ts';
import type { CollectResponse } from './content/collector.ts';

/**
 * Arka plan servisi.
 *
 * Iki ayri sekme kullanir:
 *   bildirim sekmesi - hic gezinmez, hic yenilenmez. Facebook yeni gonderileri
 *                      acik sekmeye kendisi iter; icerik betigi sadece dinler.
 *                      Ana yakalama yolu budur ve neredeyse hic sayfa yuklemez.
 *   calisma sekmesi  - gruplari yavas bir turda gezer. Bildirimlerin kacirdigi
 *                      (Facebook bazen bildirimleri birlestirir) gonderiler icin
 *                      guvenlik agidir.
 */

const SERVER_BASE = 'ws://127.0.0.1:8787/agent';
const EXT_VERSION = chrome.runtime.getManifest().version;
const HEARTBEAT_MS = 20_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
/**
 * Sunucu bagliliti kalici bir nedenle reddettiginde (yanlis token, surum uyusmazligi,
 * ikinci kopya) hizli yeniden denemek hem ise yaramaz hem de sunucuyu gunluk
 * mesajlariyla bogar. Bu durumda uzun araliklarla deneriz.
 */
const FATAL_RETRY_MS = 5 * 60_000;
const TAB_LOAD_TIMEOUT_MS = 45_000;

let socket: WebSocket | null = null;
let config: AgentConfig | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
/** Bu andan once yeni baglanti denenmez. Alarm gibi disaridan gelen tetikler de buna uyar. */
let nextConnectAllowedAt = 0;
let connecting = false;
let cycleRunning = false;
/** Yeni config gelince suren donguyu iptal etmek icin surum sayaci. */
let configEpoch = 0;

/* ---------- Yardimcilar ---------- */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Zamanlamaya insan benzeri sapma ekler; sabit araliklar otomasyonun en belirgin izidir. */
function jitter(baseMs: number, ratio: number): number {
  const spread = baseMs * ratio;
  return Math.max(250, Math.round(baseMs - spread / 2 + Math.random() * spread));
}

function send(message: AgentToServerMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  send({ type: 'log', level, message });
  if (level === 'error') console.error('[fbw]', message);
}

async function getToken(): Promise<string> {
  const stored = await chrome.storage.local.get('agentToken');
  return typeof stored.agentToken === 'string' ? stored.agentToken : '';
}

/**
 * Bu eklenti kurulumunun kimligi. Service worker yeniden basladiginda ayni kalir
 * (storage.local'da durur) ama ikinci bir eklenti kopyasi kendi storage'ina sahip
 * oldugu icin farkli olur. Sunucu bu sayede "ayni ornek yeniden baglandi" ile
 * "ikinci bir kopya baglanmaya calisiyor" durumlarini ayirt edebiliyor.
 */
async function getInstanceId(): Promise<string> {
  const stored = await chrome.storage.local.get('instanceId');
  if (typeof stored.instanceId === 'string' && stored.instanceId !== '') return stored.instanceId;
  const instanceId = crypto.randomUUID();
  await chrome.storage.local.set({ instanceId });
  return instanceId;
}

/* ---------- Baglanti ---------- */

async function connect(): Promise<void> {
  // Tek giris noktasi olarak kendini korur: es zamanli cagrilar, hala acik bir
  // soket ve bekleme suresi dolmadan yapilan denemeler burada eleniyor.
  // Alarm da bu fonksiyonu cagirdigi icin koruma tek yerde toplaniyor.
  if (connecting) return;
  if (Date.now() < nextConnectAllowedAt) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const token = await getToken();
  if (!token) {
    console.warn('[fbw] Agent token girilmemis. Eklenti secenekler sayfasindan tokeni yapistirin.');
    scheduleReconnect();
    return;
  }

  connecting = true;
  const instanceId = await getInstanceId();
  socket = new WebSocket(SERVER_BASE);

  socket.addEventListener('open', () => {
    connecting = false;
    reconnectDelay = RECONNECT_MIN_MS;
    send({
      type: 'hello',
      token,
      protocolVersion: PROTOCOL_VERSION,
      extVersion: EXT_VERSION,
      instanceId,
    });
  });

  socket.addEventListener('message', (event: MessageEvent<string>) => {
    let message: ServerToAgentMessage;
    try {
      message = JSON.parse(event.data) as ServerToAgentMessage;
    } catch {
      return;
    }
    void handleServerMessage(message);
  });

  socket.addEventListener('close', () => {
    connecting = false;
    socket = null;
    config = null;
    configEpoch += 1;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // 'close' zaten arkasindan gelir; yeniden baglanmayi orada yonetiyoruz.
  });
}

function scheduleReconnect(): void {
  const delay = reconnectDelay;
  // Kalici red sonrasi belirlenen uzun aralik korunmali; normal kopmalarda
  // ustel olarak buyuyen bekleme uygulanir.
  reconnectDelay =
    delay >= FATAL_RETRY_MS ? FATAL_RETRY_MS : Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  nextConnectAllowedAt = Date.now() + delay;
  setTimeout(() => void connect(), delay);
}

async function handleServerMessage(message: ServerToAgentMessage): Promise<void> {
  switch (message.type) {
    case 'hello_ok':
      console.info('[fbw] Backend baglantisi kuruldu');
      return;

    case 'hello_error':
      // Kalici bir red: token yanlis, surum uyusmuyor veya ikinci kopya.
      // Hizli yeniden denemek durumu duzeltmez, sadece gurultu uretir.
      console.error(`[fbw] Backend reddetti: ${message.reason}`);
      reconnectDelay = FATAL_RETRY_MS;
      socket?.close();
      return;

    case 'config':
      config = message.config;
      configEpoch += 1;
      await applyNotificationTab(message.config);
      void startCycle(configEpoch);
      return;

    case 'do_action':
      // Yorum/DM yazma Faz 3'te gelecek. Sessizce basarili gostermek yerine
      // acikca basarisiz bildiriyoruz ki panelde yanlis bir "gonderildi" gorunmesin.
      send({
        type: 'action_result',
        actionId: message.command.actionId,
        ok: false,
        verified: false,
        error: 'Aksiyon uygulama henuz etkin degil (Faz 3)',
      });
      return;

    case 'ping':
      send({ type: 'heartbeat', ts: Date.now() });
      return;
  }
}

/* ---------- Sekme yonetimi ---------- */

async function getStoredTab(key: string): Promise<number | null> {
  const stored = await chrome.storage.session.get(key);
  const id = typeof stored[key] === 'number' ? (stored[key] as number) : null;
  if (id === null) return null;
  try {
    const tab = await chrome.tabs.get(id);
    return tab.id ?? null;
  } catch {
    return null; // sekme kapatilmis
  }
}

async function openTab(key: string, url: string): Promise<number> {
  const tab = await chrome.tabs.create({ url, active: false, pinned: true });
  if (tab.id === undefined) throw new Error('Sekme acilamadi');
  await chrome.storage.session.set({ [key]: tab.id });
  return tab.id;
}

/**
 * Bildirim sekmesini acik tutar. Bu sekme bilerek gezdirilmez ve yenilenmez -
 * degeri tam olarak "acik kalmasindan" gelir.
 */
async function applyNotificationTab(current: AgentConfig): Promise<void> {
  const existing = await getStoredTab('notificationTabId');

  if (!current.notifications.enabled || current.paused) {
    if (existing !== null) {
      await chrome.tabs.remove(existing).catch(() => undefined);
      await chrome.storage.session.remove('notificationTabId');
    }
    return;
  }

  if (existing === null) {
    await openTab('notificationTabId', current.notifications.url);
    await chrome.storage.session.set({ notificationOpenedAt: Date.now() });
  }
}

/** Uzun sure acik kalan sekmede Facebook'un baglantisi kopabiliyor; ara sira tazeliyoruz. */
async function refreshNotificationTabIfStale(): Promise<void> {
  if (!config?.notifications.enabled) return;
  const tabId = await getStoredTab('notificationTabId');
  if (tabId === null) return;
  const stored = await chrome.storage.session.get('notificationOpenedAt');
  const openedAt = typeof stored.notificationOpenedAt === 'number' ? stored.notificationOpenedAt : 0;
  if (Date.now() - openedAt < config.notifications.refreshMs) return;
  await chrome.tabs.reload(tabId).catch(() => undefined);
  await chrome.storage.session.set({ notificationOpenedAt: Date.now() });
}

async function getWorkerTabId(): Promise<number> {
  const existing = await getStoredTab('workerTabId');
  if (existing !== null) return existing;
  return openTab('workerTabId', 'https://www.facebook.com/');
}

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo): void => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(true);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function requestCollect(
  tabId: number,
  fbGroupId: string,
  timeoutMs: number,
): Promise<CollectResponse | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return (await chrome.tabs.sendMessage(tabId, {
        type: 'collect',
        fbGroupId,
        timeoutMs,
      })) as CollectResponse;
    } catch {
      await sleep(750);
    }
  }
  return null;
}

/** Toplama cevabini sunucuya iletir; grup taramasi ve tekil gonderi ziyareti ortak kullanir. */
function deliverCollectResponse(
  response: CollectResponse | null,
  fbGroupId: string,
  url: string,
): void {
  if (!response) {
    log('warn', `${fbGroupId}: sayfa yanit vermedi (content script ulasilamadi)`);
    return;
  }
  if (response.blocked) {
    send({ type: 'blocked', kind: response.blocked.kind, url, note: response.blocked.note });
    return;
  }
  if (!response.ok) {
    log('warn', `${fbGroupId}: toplama hatasi - ${response.error ?? 'bilinmiyor'}`);
    return;
  }
  send({
    type: 'posts',
    fbGroupId,
    posts: response.posts ?? [],
    stats: response.stats ?? { articlesSeen: 0, postsParsed: 0, failures: 0 },
  });
}

/* ---------- Bildirimden tam icerik ziyareti ---------- */

/**
 * Bildirim metni kisaltilmis gelir; anahtar kelime kirpilan kisimda kalirsa
 * eslesme kacar. Bu kuyruk, bildirimde gorunen gonderiyi cok gecmeden kalici
 * baglantisindan acip TAM metni toplar - "bildirime tiklayan kullanici"
 * davranisinin kendisi oldugu icin trafik profili de dogaldir. Sunucudaki
 * zenginlestirme + yeniden eslestirme mekanizmasi gerisini hallediyor.
 */
const PENDING_VISIT_CAP = 10; // bildirim sekmesi ilk acilista eski bildirimleri de dokebilir
const VISITED_REMEMBER_CAP = 300;
const POST_VISIT_MIN_GAP_MS = 9_000;
const POST_VISIT_DWELL_MS = 12_000;
/** Bu yastan eski gonderiye gitmeye deger yok; kurallar zaten bayat postu eler. */
const POST_VISIT_MAX_AGE_MS = 60 * 60 * 1000;

const pendingPostVisits: { permalink: string; fbGroupId: string }[] = [];
const visitedPermalinks = new Set<string>();

function enqueuePostVisit(post: RawPost): void {
  if (post.postedAt !== null && Date.now() - post.postedAt > POST_VISIT_MAX_AGE_MS) return;
  if (visitedPermalinks.has(post.permalink)) return;
  if (pendingPostVisits.length >= PENDING_VISIT_CAP) return;
  if (pendingPostVisits.some((item) => item.permalink === post.permalink)) return;
  pendingPostVisits.push({ permalink: post.permalink, fbGroupId: post.fbGroupId });
}

function rememberVisited(permalink: string): void {
  visitedPermalinks.add(permalink);
  if (visitedPermalinks.size > VISITED_REMEMBER_CAP) {
    const oldest = visitedPermalinks.values().next().value;
    if (oldest !== undefined) visitedPermalinks.delete(oldest);
  }
}

async function visitPost(target: { permalink: string; fbGroupId: string }): Promise<void> {
  rememberVisited(target.permalink);
  const tabId = await getWorkerTabId();

  const current = await chrome.tabs.get(tabId);
  const loaded = waitForTabLoad(tabId, TAB_LOAD_TIMEOUT_MS);
  if (current.url === target.permalink) await chrome.tabs.reload(tabId);
  else await chrome.tabs.update(tabId, { url: target.permalink, active: false });
  await loaded;

  const response = await requestCollect(tabId, target.fbGroupId, POST_VISIT_DWELL_MS);
  deliverCollectResponse(response, target.fbGroupId, target.permalink);
}

/* ---------- Grup taramasi (guvenlik agi) ---------- */

/**
 * Oncelikli round-robin sirasi uretir.
 * Yuksek oncelikli gruplar bir tam turda birden fazla kez ziyaret edilir, ama
 * pes pese degil - turlara yayilarak. Boylece hicbir grup uzun sure aclik cekmez.
 */
export function buildRotation(groups: AgentGroupConfig[]): AgentGroupConfig[] {
  if (groups.length === 0) return [];
  const weight = (group: AgentGroupConfig): number => Math.max(1, group.priority);
  const maxWeight = Math.max(...groups.map(weight));

  const rotation: AgentGroupConfig[] = [];
  for (let round = 0; round < maxWeight; round += 1) {
    for (const group of groups) {
      if (weight(group) > round) rotation.push(group);
    }
  }
  return rotation;
}

/**
 * Tarama sirasi dongu yeniden baslatmalarina dayanikli olmali. Dongu sanildigindan
 * sik yeniden kurulur: her ayar kaydi config push'u tetikler, service worker
 * uyanmalari da cabasi. Sayac yerel kalsaydi her seferinde listenin ilk grubundan
 * baslanir ve sondaki gruplara neredeyse hic sira gelmezdi (gercekte yasandi).
 * storage.session SW yeniden baslatmalarini da atlatir.
 */
let sweepIndex: number | null = null;

async function getSweepIndex(): Promise<number> {
  if (sweepIndex !== null) return sweepIndex;
  const stored = await chrome.storage.session.get('sweepIndex');
  sweepIndex = typeof stored.sweepIndex === 'number' ? (stored.sweepIndex as number) : 0;
  return sweepIndex;
}

async function advanceSweepIndex(): Promise<void> {
  // Sinirsiz buyumesin; rotasyon uzunlugu degisse de modulo guvenli kalir.
  sweepIndex = ((await getSweepIndex()) + 1) % 1_000_000;
  await chrome.storage.session.set({ sweepIndex });
}

async function startCycle(epoch: number): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    await runCycle(epoch);
  } catch (error) {
    log('error', `Dongu hatasi: ${String(error)}`);
  } finally {
    cycleRunning = false;
  }
}

/**
 * Tam bir tur groupSweepMs suresine yayilir; sayfa yuklemeleri araya esit dagitilir.
 * Amac hiz degil kapsama: hizli yakalama isini bildirim sekmesi yapiyor.
 */
async function runCycle(epoch: number): Promise<void> {
  while (epoch === configEpoch && config) {
    if (config.paused) {
      await sleep(30_000);
      continue;
    }

    // Bildirimden dusen gonderiler oncelikli: tam metin ne kadar erken gelirse
    // eslestirme o kadar erken dogru veriyle calisir. Grup taramasi bekleyebilir.
    const pendingVisit = pendingPostVisits.shift();
    if (pendingVisit) {
      await visitPost(pendingVisit);
      await interruptibleSleep(
        jitter(Math.max(config.cycleGapMs, POST_VISIT_MIN_GAP_MS), config.jitterRatio),
        epoch,
      );
      continue;
    }

    const rotation = buildRotation(config.groups);
    if (rotation.length === 0) {
      await interruptibleSleep(30_000, epoch);
      continue;
    }

    const group = rotation[(await getSweepIndex()) % rotation.length];
    await advanceSweepIndex();
    if (group) await visitGroup(group);

    await refreshNotificationTabIfStale();

    const perVisitMs = Math.max(config.cycleGapMs, Math.round(config.groupSweepMs / rotation.length));
    await interruptibleSleep(jitter(perVisitMs, config.jitterRatio), epoch);
  }
}

/**
 * Tur arasi bekleme, yeni bir bildirim ziyareti dustugunde erken sonlanir -
 * yoksa "hemen git" vaadi 3-4 dakikalik tarama uykusuna takilirdi.
 * Epoch degisiminde de erken cikar ki eski dongu gecikmeden kapansin.
 */
async function interruptibleSleep(ms: number, epoch: number): Promise<void> {
  const SLICE_MS = 2_000;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (epoch !== configEpoch) return;
    if (pendingPostVisits.length > 0) return;
    await sleep(Math.min(SLICE_MS, deadline - Date.now()));
  }
}

async function visitGroup(group: AgentGroupConfig): Promise<void> {
  const tabId = await getWorkerTabId();

  const current = await chrome.tabs.get(tabId);
  const alreadyThere = current.url === group.url;
  const loaded = waitForTabLoad(tabId, TAB_LOAD_TIMEOUT_MS);
  // Ayni adrese tabs.update cagrisi yeniden yukleme tetiklemez; o durumda reload gerekiyor.
  if (alreadyThere) await chrome.tabs.reload(tabId);
  else await chrome.tabs.update(tabId, { url: group.url, active: false });
  await loaded;

  const response = await requestCollect(tabId, group.fbGroupId, group.dwellMs);
  deliverCollectResponse(response, group.fbGroupId, group.url);
}

/* ---------- Icerik betiginden gelen mesajlar ---------- */

interface NotificationPostsMessage {
  type: 'notification_posts';
  posts: RawPost[];
}

interface BlockedMessage {
  type: 'blocked_detected';
  blocked: BlockDetection;
  url: string;
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  const incoming = message as NotificationPostsMessage | BlockedMessage | undefined;

  if (incoming?.type === 'notification_posts') {
    if (incoming.posts.length === 0) return false;
    send({
      type: 'posts',
      fbGroupId: NOTIFICATION_CHANNEL,
      posts: incoming.posts,
      stats: {
        articlesSeen: incoming.posts.length,
        postsParsed: incoming.posts.length,
        failures: 0,
      },
    });
    // Kisaltilmis bildirim metniyle yetinme: gonderinin tam halini almak icin
    // kalici baglantiyi ziyaret kuyruguna ekle. Duraklamadaysa ekleme - sessiz
    // saatlerde sayfa acmak duraklatmanin amacini bosa cikarir.
    if (config && !config.paused) {
      for (const post of incoming.posts) enqueuePostVisit(post);
    }
    return false;
  }

  if (incoming?.type === 'blocked_detected') {
    send({
      type: 'blocked',
      kind: incoming.blocked.kind,
      url: incoming.url,
      note: incoming.blocked.note,
    });
    return false;
  }

  return false;
});

/* ---------- Yasam dongusu ---------- */

// Heartbeat hem sunucudaki watchdog'u besler hem de MV3 service worker'inin
// bosta kalip sonlandirilmasini engeller.
setInterval(() => send({ type: 'heartbeat', ts: Date.now() }), HEARTBEAT_MS);

// Service worker yine de sonlandirilirsa alarm onu uyandirip donguyu yeniden baslatir.
chrome.alarms.create('fbw-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  if (!socket || socket.readyState === WebSocket.CLOSED) void connect();
  else if (config && !cycleRunning) void startCycle(configEpoch);
});

chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
void connect();
