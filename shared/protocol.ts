/**
 * Backend <-> Chrome eklentisi arasindaki WebSocket sozlesmesi.
 * Bu dosya hem server hem extension tarafindan import edilir; tek gercek kaynak burasidir.
 */

// 3: hello mesajina instanceId eklendi (yinelenen eklenti kopyalarini ayirt etmek icin).
// 4: Marketplace aramasi ve ilan ziyareti mesajlari eklendi.
// 5: Marketplace genel sayfa taramasi; sonuc mesajina kaynak alani eklendi.
// 6: Sayfa snapshot'i alma (selector onarimi icin) eklendi.
export const PROTOCOL_VERSION = 6;

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

/** Marketplace'te tek bir anahtar kelime aramasi. */
export interface MarketplaceSearch {
  query: string;
  /** Siralama, fiyat ve yaricap parametreleri islenmis arama sayfasi adresi. */
  url: string;
}

/**
 * Marketplace izleme. Bildirim mekanizmasi olmadigi icin tek yol periyodik taramadir
 * ve kendi sekmesinde, grup turundan bagimsiz yurur.
 *
 * Ana yol genel sayfa: tek sayfa, anahtar kelimesiz, en yeni once ve fiyat sinirli.
 * Kartlar sunucuda basliga gore suzulur. Anahtar kelime aramalari yalnizca yedektir:
 * kelime yalnizca aciklamada gecen ilanlari Facebook'un aramasi bulabilir.
 */
export interface MarketplaceWatchConfig {
  enabled: boolean;
  /** Genel sayfa. Taranacak kural yoksa null. */
  browse: { url: string; intervalMs: number } | null;
  /** Yedek anahtar kelime aramalari; her biri searchIntervalMs icinde bir kez yapilir. */
  searches: MarketplaceSearch[];
  searchIntervalMs: number;
}

/** Kartlarin geldigi sayfa: genel sayfa mi, anahtar kelime aramasi mi. */
export type MarketplaceSource = 'browse' | 'search';

/** Arama sonuc kartindan okunan ilan. Kartta aciklama YOK; bedava karari icin ilan acilmali. */
export interface MarketplaceCard {
  listingId: string;
  url: string;
  title: string | null;
  /** Kartta gorunen ham fiyat ("Zdarma", "1 200 Kč"). */
  priceText: string | null;
  /** Fiyat metninden cikarilan tutar; cozulemezse null. */
  priceAmount: number | null;
  locationText: string | null;
  imageUrl: string | null;
}

/** Ilan sayfasindan okunan tam kayit. */
export interface MarketplaceListing {
  listingId: string;
  url: string;
  title: string | null;
  /** Bedava karari yalnizca buna dayanir; fiyat alani kanit sayilmaz. */
  description: string;
  priceText: string | null;
  priceAmount: number | null;
  locationText: string | null;
  sellerName: string | null;
  sellerProfileUrl: string | null;
  imageUrls: string[];
  /** Ilanin yayinlanma zamani, epoch ms. Cikarilamazsa null. */
  postedAt: number | null;
  postedAtLabel: string | null;
}

/** Sunucunun eklentiden acmasini istedigi ilan. */
export interface MarketplaceVisit {
  listingId: string;
  url: string;
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
  marketplace: MarketplaceWatchConfig;
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

/**
 * Sayfa snapshot'i istegi. Facebook'un DOM'u degistiginde ayristiriciyi onarmanin
 * tek yolu gercek sayfanin HTML'ine bakmaktir; bu komut onu gecici bir sekmede
 * alip getirir. Snapshot yalnizca yerel diske yazilir.
 */
export interface CaptureCommand {
  captureId: number;
  url: string;
  /** Sayfa yuklendikten sonra icerigin render olmasi icin beklenecek sure (ms). */
  dwellMs: number;
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
      type: 'marketplace_results';
      source: MarketplaceSource;
      /** Anahtar kelime aramasinda aranan kelime; genel sayfada null. */
      query: string | null;
      cards: MarketplaceCard[];
      stats: ParseStats;
    }
  | { type: 'marketplace_listing'; listing: MarketplaceListing }
  | { type: 'capture_result'; captureId: number; url: string; html?: string; error?: string }
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
  /** Arama sonucundaki yeni adaylar: bedava karari icin ilan sayfalari acilmali. */
  | { type: 'visit_listings'; listings: MarketplaceVisit[] }
  | { type: 'capture'; command: CaptureCommand }
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
