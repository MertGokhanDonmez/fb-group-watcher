import { bus } from '../bus.ts';
import { createAction, getAction, setActionStatus } from '../repo/actions.ts';
import { logEvent } from '../repo/events.ts';
import { getSettings, type Settings } from '../repo/settings.ts';
import type { MatchDetail } from '../types.ts';

/**
 * Telegram bildirim katmani.
 *
 * Eslesme aninda telefona haber vermek bu aracin asil hiz avantajidir; panel
 * ancak acikken gorulur. Telegram gonderimi Facebook'a dokunmadigi icin
 * dryRun'dan ETKILENMEZ - dryRun yalnizca FB'ye yazan aksiyonlari (yorum/DM)
 * kapatir. Kill switch ise her seyi durdurdugu icin burada da gecerlidir.
 */

const API_TIMEOUT_MS = 10_000;

export function telegramConfigured(settings: Settings): boolean {
  return settings.telegramBotToken !== '' && settings.telegramChatId !== '';
}

export type TelegramResult = { ok: true } | { ok: false; error: string };

/* ---------- Kesif: bot kimligi ve gorunur sohbetler ---------- */

/** Bot API'de tek bir metodu cagirir ve `result` alanini doner. */
async function callTelegram<T>(
  method: string,
  token: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  if (token === '') return { ok: false, error: 'Bot token girilmemis' };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const body = (await response.json()) as { ok?: boolean; result?: T; description?: string };
    if (!response.ok || body.ok !== true) {
      return { ok: false, error: body.description ?? `Telegram API ${response.status}` };
    }
    return { ok: true, result: body.result as T };
  } catch (error) {
    return { ok: false, error: `Telegram'a ulasilamadi: ${String(error)}` };
  }
}

export interface TelegramChat {
  id: string;
  /** Grup/kanal adi, ozel sohbetlerde kisinin adi. */
  title: string;
  /** private | group | supergroup | channel */
  type: string;
}

export interface TelegramDiscovery {
  botUsername: string;
  chats: TelegramChat[];
}

/** Telegram update nesnesinin bize lazim olan kadari. */
interface TelegramUpdate {
  message?: { chat?: RawChat };
  edited_message?: { chat?: RawChat };
  channel_post?: { chat?: RawChat };
  my_chat_member?: { chat?: RawChat };
  chat_member?: { chat?: RawChat };
}

interface RawChat {
  id?: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
}

/**
 * Botun son gunlerde gordugu sohbetleri listeler.
 *
 * Chat ID'yi elle bulmak bu kurulumun en zahmetli adimi: gruplarda @userinfobot
 * ise yaramaz, insanin getUpdates ciktisini elle okumasi gerekir. Burada onu biz
 * yapiyoruz.
 *
 * `offset` GONDERILMIYOR - offset gondermek update'leri onaylayip kuyruktan siler
 * ve kullanici listeyi ikinci kez acamaz.
 *
 * Bir update'in gorunmesi icin botun o sohbette bir sey gormus olmasi gerekir:
 * gruba eklenmesi (my_chat_member) ya da bir mesaj (gizlilik modu aciksa yalnizca
 * komutlar). Bu yuzden arayuzde "gruba /start@botadi yaz" diyoruz.
 */
export async function discoverTelegramChats(
  settings: Settings = getSettings(),
): Promise<{ ok: true; data: TelegramDiscovery } | { ok: false; error: string }> {
  const token = settings.telegramBotToken;

  const me = await callTelegram<{ username?: string }>('getMe', token);
  if (!me.ok) return { ok: false, error: me.error };

  const updates = await callTelegram<TelegramUpdate[]>('getUpdates', token, { limit: 100 });
  if (!updates.ok) return { ok: false, error: updates.error };

  const seen = new Map<string, TelegramChat>();
  for (const update of updates.result) {
    const raw =
      update.message?.chat ??
      update.edited_message?.chat ??
      update.channel_post?.chat ??
      update.my_chat_member?.chat ??
      update.chat_member?.chat;
    if (raw?.id === undefined) continue;
    const id = String(raw.id);
    if (seen.has(id)) continue;
    const title =
      raw.title ??
      [raw.first_name, raw.username ? `@${raw.username}` : null].filter(Boolean).join(' ') ??
      id;
    seen.set(id, { id, title: title === '' ? id : title, type: raw.type ?? 'unknown' });
  }

  // Gruplar once: kullanici neredeyse her zaman bir grubu arıyor.
  const chats = [...seen.values()].sort((a, b) => {
    const rank = (chat: TelegramChat): number => (chat.type === 'private' ? 1 : 0);
    return rank(a) - rank(b) || a.title.localeCompare(b.title);
  });

  return { ok: true, data: { botUsername: me.result.username ?? '', chats } };
}

/** Bot API'ye tek mesaj gonderir. Hata firlatmaz; sonucu deger olarak doner. */
export async function sendTelegramMessage(
  text: string,
  settings: Settings = getSettings(),
): Promise<TelegramResult> {
  if (!telegramConfigured(settings)) {
    return { ok: false, error: 'Telegram yapilandirilmamis (bot token / chat ID eksik)' };
  }
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text,
          parse_mode: 'HTML',
          // Facebook linki onizlemesi girise yonlendirir, mesaji sisirir.
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      const detail = await telegramErrorDetail(response);
      return { ok: false, error: `Telegram API ${response.status}: ${detail}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Telegram'a ulasilamadi: ${String(error)}` };
  }
}

/** Hata govdesindeki "description" alani tek anlasilir kisimdir (orn. "chat not found"). */
async function telegramErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { description?: string };
    return body.description ?? 'bilinmeyen hata';
  } catch {
    return 'bilinmeyen hata';
  }
}

/** Telegram HTML modu yalnizca birkac etiketi taniyor; gonderi metni ham HTML sayilmamali. */
export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const EXCERPT_MAX = 400;

/** Eslesmeyi telefonda tek bakista degerlendirilecek bir mesaja cevirir. */
export function formatMatchMessage(detail: MatchDetail): string {
  const lines: string[] = [];
  lines.push(`\u{1F3AF} <b>${escapeHtml(detail.ruleName)}</b>`);

  const meta: string[] = [];
  if (detail.groupName) meta.push(detail.groupName);
  if (detail.post.locationName) {
    meta.push(
      detail.post.distanceKm !== null
        ? `${detail.post.locationName} (${detail.post.distanceKm} km)`
        : detail.post.locationName,
    );
  }
  if (meta.length > 0) lines.push(`\u{1F4CD} ${escapeHtml(meta.join(' • '))}`);

  if (detail.post.authorName) lines.push(`\u{1F464} ${escapeHtml(detail.post.authorName)}`);
  if (detail.matchedKeywords.length > 0) {
    lines.push(`<i>${escapeHtml(detail.matchedKeywords.join(', '))}</i>`);
  }

  const text = detail.post.text.trim();
  if (text !== '') {
    const excerpt = text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX)}…` : text;
    lines.push('', escapeHtml(excerpt));
  }

  lines.push('', `<a href="${escapeHtml(detail.post.permalink)}">Gonderiyi ac</a>`);
  return lines.join('\n');
}

/**
 * Bir eslesmeyi Telegram'a bildirir ve sonucu aksiyon kaydi olarak birakir.
 * Kayit History sayfasinda gorunur; basarisiz gonderim de orada teshis edilir.
 * Yapilandirilmamissa sessizce atlanir - panel akisi zaten eslesmeyi gosteriyor.
 */
export async function notifyMatch(detail: MatchDetail): Promise<void> {
  const settings = getSettings();
  if (!telegramConfigured(settings)) return;

  const message = formatMatchMessage(detail);

  if (settings.killSwitch) {
    const action = createAction(detail.id, 'telegram', 'cancelled', message);
    logEvent('telegram', 'warn', 'Kill switch acik - Telegram bildirimi iptal edildi', {
      matchId: detail.id,
    });
    bus.emitEvent({ type: 'action', action });
    return;
  }

  const action = createAction(detail.id, 'telegram', 'sending', message);
  const result = await sendTelegramMessage(message, settings);

  if (result.ok) {
    setActionStatus(action.id, 'sent');
    logEvent('telegram', 'info', `Telegram bildirimi gonderildi: "${detail.ruleName}"`, {
      matchId: detail.id,
    });
  } else {
    setActionStatus(action.id, 'failed', { error: result.error });
    logEvent('telegram', 'warn', `Telegram bildirimi gonderilemedi: ${result.error}`, {
      matchId: detail.id,
    });
  }

  const updated = getAction(action.id);
  if (updated) bus.emitEvent({ type: 'action', action: updated });
}

/** Ayni alarm metni bu pencere icinde ikinci kez Telegram'a gitmez. */
const ALARM_REPEAT_WINDOW_MS = 30 * 60 * 1000;

/**
 * Bus'taki error seviyesindeki gunluk olaylarini (eklenti cevrimdisi, selector
 * bozulmasi, engel/checkpoint tespiti) Telegram'a iletir. Botun sessizce olmesi
 * en olasi ariza; kullanicinin bunu panel acmadan ogrenmesi gerekir.
 *
 * Gonderim hatalari yalnizca warn seviyesinde loglanir ve bus'a error olarak
 * YAZILMAZ; aksi halde her hata yeni bir alarm dogurur ve dongu olusur.
 */
export function startTelegramAlarms(): () => void {
  const lastSentAt = new Map<string, number>();

  return bus.subscribe((event) => {
    if (event.type !== 'log' || event.level !== 'error') return;

    const settings = getSettings();
    if (!telegramConfigured(settings) || settings.killSwitch) return;

    const now = Date.now();
    const previous = lastSentAt.get(event.message);
    if (previous !== undefined && now - previous < ALARM_REPEAT_WINDOW_MS) return;
    lastSentAt.set(event.message, now);

    const text = `⚠️ <b>fb-group-watcher alarmi</b>\n${escapeHtml(event.message)}`;
    void sendTelegramMessage(text, settings).then((result) => {
      if (!result.ok) {
        logEvent('telegram', 'warn', `Alarm Telegram'a iletilemedi: ${result.error}`);
      }
    });
  });
}
