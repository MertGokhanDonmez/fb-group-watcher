/**
 * Backend <-> Chrome eklentisi arasindaki WebSocket sozlesmesi.
 * Bu dosya hem server hem extension tarafindan import edilir; tek gercek kaynak burasidir.
 */

// 3: hello mesajina instanceId eklendi (yinelenen eklenti kopyalarini ayirt etmek icin).
export const PROTOCOL_VERSION = 3;

/** Bir gonderinin nereden yakalandigi. */
export type PostSource = 'feed' | 'notification';

/**
 * Bildirim turlari tek bir gruba ait degildir; her gonderi kendi grubunu tasir.
 * 'posts' mesajinin grup alani bu sabitle isaretlenir.
 */
export const NOTIFICATION_CHANNEL = '__notifications__';

/** Eklentinin bir grup akisindan cikardigi ham post. */
export interface RawPost {
  /**
   * Bildirimden gelen gonderilerde metin kisaltilmis olabilir; grup taramasi
   * ayni gonderiyi tam metniyle yakalayinca kayit zenginlestirilir.
   */
  source: PostSource;
  /** Facebook post id (permalink'ten cikarilir). Dedupe anahtari. */
  fbPostId: string;
  /** Postun ait oldugu grubun facebook id'si. */
  fbGroupId: string;
  permalink: string;
  authorName: string | null;
  authorProfileUrl: string | null;
  /** Profil url'inden cikarilabiliyorsa numeric/kullanici id. DM icin gerekli. */
  authorUserId: string | null;
  text: string;
  imageUrls: string[];
  /** Postun yayinlanma zamani, epoch ms. Cikarilamazsa null. */
  postedAt: number | null;
  /** Feed'de gorunen ham zaman etiketi ("12 dk", "1 sa") - teshis icin saklanir. */
  postedAtLabel: string | null;
}

/** Bir tur parse sonrasi saglik metrikleri. Selector bozulmasini tespit etmek icin. */
export interface ParseStats {
  /** DOM'da bulunan [role="article"] sayisi. */
  articlesSeen: number;
  /** Basariyla parse edilen post sayisi. */
  postsParsed: number;
  /** Parse edilemeyen article sayisi. */
  failures: number;
}

export type BlockKind =
  | 'checkpoint'
  | 'captcha'
  | 'rate_limit'
  | 'login_required'
  | 'unknown';

/** Eklentiye gonderilecek calisma plani. */
export interface AgentGroupConfig {
  fbGroupId: string;
  url: string;
  /** Sayfada ne kadar beklenip parse edilecegi (ms). */
  dwellMs: number;
  /** Yuksek oncelikli gruplar round-robin'de daha sik ziyaret edilir. */
  priority: number;
}

/**
 * Bildirim izleme. Her grup icin Facebook'ta "Tum gonderiler" bildirimi acildiginda
 * tek bir bildirim sayfasi N grup sayfasinin yerine gecer: sayfa yuklemesi ~5 kat
 * azalir ve yeni gonderi daha hizli goruntulenir.
 */
export interface NotificationWatchConfig {
  enabled: boolean;
  url: string;
  /**
   * Sekme bu araliktan uzun sure acik kalirsa bir kez tazelenir.
   * Bu bir yoklama araligi DEGILDIR: yeni gonderiler arada Facebook tarafindan
   * acik sekmeye itilir. Yalnizca uzun suren oturumlarda kopan baglantiya karsi.
   */
  refreshMs: number;
}

export interface AgentConfig {
  groups: AgentGroupConfig[];
  /** Iki grup ziyareti arasi taban bekleme (ms). */
  cycleGapMs: number;
  /** Zamanlamaya eklenecek rastgele sapma orani (0.0 - 1.0). */
  jitterRatio: number;
  /** true ise eklenti asla gercek aksiyon uygulamaz, sadece uygular gibi yapar. */
  dryRun: boolean;
  /** true ise toplama da aksiyon da durur. */
  killSwitch: boolean;
  /**
   * Toplama duraklatildi mi. Kill switch'ten farki: sessiz saatler gibi
   * gecici ve otomatik sonlanan durumlari da kapsar.
   */
  paused: boolean;
  pauseReason: string | null;
  notifications: NotificationWatchConfig;
  /** Tam bir grup taramasi turu bittikten sonra beklenecek sure (guvenlik agi). */
  groupSweepMs: number;
}

export type AgentActionKind = 'comment' | 'dm';

/** Backend'in eklentiye "sunu yap" komutu. */
export interface AgentActionCommand {
  actionId: number;
  kind: AgentActionKind;
  permalink: string;
  /** DM icin hedef profil. */
  authorProfileUrl: string | null;
  /** Sablondan render edilmis, gonderilecek nihai metin. */
  text: string;
}

/* ---------- Eklenti -> Server ---------- */

export type AgentToServerMessage =
  | {
      type: 'hello';
      token: string;
      protocolVersion: number;
      extVersion: string;
      /**
       * Eklenti ornegini tanimlar. Ayni ornegin yeniden baglanmasi ile ikinci bir
       * eklenti kopyasinin baglanmasini ayirt etmeyi saglar; aksi halde iki kopya
       * birbirini sirayla dusurup sonsuz donguye girer.
       */
      instanceId: string;
    }
  | { type: 'heartbeat'; ts: number }
  | { type: 'posts'; fbGroupId: string; posts: RawPost[]; stats: ParseStats }
  | {
      type: 'action_result';
      actionId: number;
      ok: boolean;
      /** Yorum gonderildikten sonra postta gercekten gorundu mu? */
      verified: boolean;
      error?: string;
    }
  | { type: 'blocked'; kind: BlockKind; url: string; note?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

/* ---------- Server -> Eklenti ---------- */

export type ServerToAgentMessage =
  | { type: 'hello_ok'; protocolVersion: number }
  | { type: 'hello_error'; reason: string }
  | { type: 'config'; config: AgentConfig }
  | { type: 'do_action'; command: AgentActionCommand }
  | { type: 'ping' };

/* ---------- Yardimcilar ---------- */

export function parseAgentMessage(raw: string): AgentToServerMessage | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    if (typeof (value as { type?: unknown }).type !== 'string') return null;
    return value as AgentToServerMessage;
  } catch {
    return null;
  }
}

/** Facebook grup post permalink'inden post id cikarir. */
export function extractPostId(permalink: string): string | null {
  const patterns = [
    /\/groups\/[^/]+\/posts\/(\d+)/,
    /\/groups\/[^/]+\/permalink\/(\d+)/,
    /[?&]multi_permalinks=(\d+)/,
    /[?&]story_fbid=(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = permalink.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Grup url'inden facebook grup id'sini (veya slug'ini) cikarir. */
export function extractGroupId(url: string): string | null {
  const match = url.match(/facebook\.com\/groups\/([^/?#]+)/);
  return match?.[1] ?? null;
}
