import { randomBytes } from 'node:crypto';
import { execute, queryAll } from '../db/index.ts';

/**
 * Tum ayarlar tek bir key/value tablosunda tutulur.
 * Varsayilanlar bilerek muhafazakar: dryRun acik, hiz limitleri dusuk.
 */
export interface Settings {
  /** Eklentinin WebSocket'te kimlik dogrulamak icin kullandigi paylasilan sir. */
  agentToken: string;
  /** true iken hicbir gercek aksiyon gonderilmez, sadece loglanir. */
  dryRun: boolean;
  /** true iken toplama ve aksiyon tamamen durur. */
  killSwitch: boolean;

  telegramBotToken: string;
  telegramChatId: string;

  /** Saatte gonderilebilecek maksimum yorum/DM. */
  maxActionsPerHour: number;
  /** Gunde gonderilebilecek maksimum yorum/DM. */
  maxActionsPerDay: number;
  /** Iki aksiyon arasi minimum bosluk (saniye). */
  minActionGapSec: number;
  /** Sessiz saat araligi (yerel saat, 0-23). Baslangic dahil, bitis haric. */
  quietHoursStart: number;
  quietHoursEnd: number;
  /**
   * Sessiz saatlerde yalnizca aksiyonlar degil, sayfa taramasi da dursun mu.
   * Insan gece boyunca kesintisiz grup yenilemez; acik birakmak en belirgin bot izidir.
   */
  pauseCollectionInQuietHours: boolean;

  /**
   * Anahtar kelimelerde Turkce son sessiz yumusamasini da dene (koltuk -> koltugu).
   * Turkce olmayan gruplarda KAPALI kalmali: Ingilizcede "cat" -> "cad" gibi
   * varyantlar "cadillac" ile yanlis eslesme uretir.
   */
  turkishSuffixMatching: boolean;

  /**
   * Ev konumu. Mesafe filtresi bunu referans alir; bos birakilirsa (0,0)
   * mesafe hesaplanmaz ve mesafe kosullari yok sayilir.
   */
  homeLat: number;
  homeLon: number;
  homeLabel: string;

  /** Bildirimler sayfasini izle (grup sayfasi yukleme sayisini ciddi dusurur). */
  notificationsEnabled: boolean;
  /** Bildirim sekmesinin tazelenme araligi (ms). Yoklama araligi degil. */
  notificationsRefreshMs: number;
  /** Tam bir grup taramasi turundan sonra beklenecek sure (ms) - guvenlik agi. */
  groupSweepMs: number;

  /** Eklentinin iki grup ziyareti arasi taban beklemesi (ms). */
  cycleGapMs: number;
  /** Zamanlamaya eklenecek rastgele sapma orani. */
  jitterRatio: number;

  /** Ust uste bu kadar turda hic post parse edilemezse selector alarmi verilir. */
  selectorHealthThreshold: number;
  /** Bu sure heartbeat gelmezse eklenti cevrimdisi sayilir (saniye). */
  heartbeatTimeoutSec: number;
}

type SettingKind = 'string' | 'number' | 'boolean';

const SCHEMA: { [K in keyof Settings]: { key: string; kind: SettingKind; fallback: Settings[K] } } = {
  agentToken: { key: 'agent_token', kind: 'string', fallback: '' },
  dryRun: { key: 'dry_run', kind: 'boolean', fallback: true },
  killSwitch: { key: 'kill_switch', kind: 'boolean', fallback: false },
  telegramBotToken: { key: 'telegram_bot_token', kind: 'string', fallback: '' },
  telegramChatId: { key: 'telegram_chat_id', kind: 'string', fallback: '' },
  maxActionsPerHour: { key: 'max_actions_per_hour', kind: 'number', fallback: 6 },
  maxActionsPerDay: { key: 'max_actions_per_day', kind: 'number', fallback: 30 },
  minActionGapSec: { key: 'min_action_gap_sec', kind: 'number', fallback: 90 },
  quietHoursStart: { key: 'quiet_hours_start', kind: 'number', fallback: 1 },
  quietHoursEnd: { key: 'quiet_hours_end', kind: 'number', fallback: 8 },
  pauseCollectionInQuietHours: { key: 'pause_collection_quiet', kind: 'boolean', fallback: true },
  turkishSuffixMatching: { key: 'turkish_suffix_matching', kind: 'boolean', fallback: false },
  homeLat: { key: 'home_lat', kind: 'number', fallback: 0 },
  homeLon: { key: 'home_lon', kind: 'number', fallback: 0 },
  homeLabel: { key: 'home_label', kind: 'string', fallback: '' },
  notificationsEnabled: { key: 'notifications_enabled', kind: 'boolean', fallback: true },
  notificationsRefreshMs: { key: 'notifications_refresh_ms', kind: 'number', fallback: 1_800_000 },
  groupSweepMs: { key: 'group_sweep_ms', kind: 'number', fallback: 420_000 },
  cycleGapMs: { key: 'cycle_gap_ms', kind: 'number', fallback: 3000 },
  jitterRatio: { key: 'jitter_ratio', kind: 'number', fallback: 0.35 },
  selectorHealthThreshold: { key: 'selector_health_threshold', kind: 'number', fallback: 3 },
  heartbeatTimeoutSec: { key: 'heartbeat_timeout_sec', kind: 'number', fallback: 300 },
};

const FIELDS = Object.keys(SCHEMA) as (keyof Settings)[];

function decode(kind: SettingKind, raw: string): unknown {
  if (kind === 'boolean') return raw === '1' || raw === 'true';
  if (kind === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return raw;
}

function encode(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

export function getSettings(): Settings {
  const rows = queryAll<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const result = {} as Record<keyof Settings, unknown>;
  for (const field of FIELDS) {
    const spec = SCHEMA[field];
    const raw = stored.get(spec.key);
    const decoded = raw === undefined ? undefined : decode(spec.kind, raw);
    result[field] = decoded === undefined ? spec.fallback : decoded;
  }
  return result as unknown as Settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  for (const field of FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      SCHEMA[field].key,
      encode(value),
    );
  }
  return getSettings();
}

/**
 * Ilk calistirmada agent token uretir. Eklentinin secenekler sayfasina bu deger girilir;
 * boylece localhost'taki baska bir sayfa ajan soketine baglanamaz.
 */
export function ensureAgentToken(): string {
  const current = getSettings().agentToken;
  if (current) return current;
  const token = randomBytes(24).toString('hex');
  updateSettings({ agentToken: token });
  return token;
}
