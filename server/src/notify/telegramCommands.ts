import { extractGroupId } from '../../../shared/protocol.ts';
import { normalizeGroupUrl } from '../../../shared/facebook.ts';
import { SUGGESTED_EXCLUDE_KEYWORDS } from '../../../shared/rules.ts';
import { pushConfigToAgent } from '../agent/hub.ts';
import { logEvent, listEvents } from '../repo/events.ts';
import { createGroup, deleteGroup, getGroupByFbId, listGroups } from '../repo/groups.ts';
import { listMatchDetails } from '../repo/matches.ts';
import { createRule, deleteRule, listRules, updateRule } from '../repo/rules.ts';
import { getSettings, updateSettings, type Settings } from '../repo/settings.ts';
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '../repo/templates.ts';
import type { TemplateKind } from '../types.ts';
import { escapeHtml, sendTelegramMessage, telegramConfigured } from './telegram.ts';

/**
 * Telegram uzerinden tam yonetim (getUpdates long-poll).
 *
 * Sadece ayarlarda kayitli telegramChatId'den gelen mesajlar islenir; baska
 * hicbir sohbet botu kontrol edemez. Webhook yerine polling kullanilir cunku
 * sunucu 127.0.0.1'e bind (disariya acik degil) - Telegram bize webhook POST
 * atamaz, biz onlara sormak zorundayiz.
 *
 * Panel (web UI) hala calisir durumda kalir ama gunluk kullanimda gerek
 * kalmamasi icin panelin butun CRUD yuzeyi (kurallar, gruplar, sablonlar,
 * ayarlar, gecmis) burada komut olarak da sunuluyor.
 */

const POLL_TIMEOUT_S = 25;
const IDLE_RETRY_MS = 5000;

interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number | string }; text?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HELP_TEXT = [
  '<b>Kurallar</b>',
  '/kurallar - liste',
  '/kural_ekle isim | kelime1, kelime2 [| haric1, haric2]',
  '  (haric verilmezse panel ile ayni varsayilan liste kullanilir: for sale, selling, swap, trade, wanted, looking for, iso, rent)',
  '/kural_ac id  /kural_kapat id  /kural_sil id',
  '/kural_market id ac|kapat - marketplace aramasini ac/kapat (yeni kurallarda varsayilan acik)',
  '',
  '<b>Gruplar</b>',
  '/gruplar - liste',
  '/grup_ekle facebook-grup-linki | ad(opsiyonel)',
  '/grup_sil id',
  '',
  '<b>Sablonlar</b>',
  '/sablonlar - liste',
  '/sablon_ekle (asagidaki formatta, ayri satirlar)',
  '  tur: comment veya dm',
  '  isim: sablon adi',
  '  metin:',
  '  ilk varyant metni',
  '  ---',
  '  ikinci varyant metni (opsiyonel, --- ile ayir)',
  '/sablon_sil id',
  '',
  '<b>Ayarlar</b>',
  '/durum - dryRun / kill switch',
  '/dryrun_ac  /dryrun_kapat',
  '/kill_ac  /kill_kapat',
  '/ayarlar - tum ince ayarlar',
  '/ayar anahtar deger - bir ayari degistir (anahtar listesi icin /ayarlar)',
  '',
  '<b>Gecmis</b>',
  '/gecmis [adet] - son eslesmeler (varsayilan 10)',
  '/olaylar [adet] - son sistem gunlugu (varsayilan 10)',
  '',
  '/yardim - bu mesaj',
].join('\n');

function parseIdArg(raw: string): number | null {
  const id = Number(raw.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------- kurallar

function formatRules(): string {
  const rules = listRules();
  if (rules.length === 0) return 'Henuz kural yok. /kural_ekle ile ekleyebilirsin.';
  return rules
    .map((rule) => {
      const state = rule.enabled ? '✅' : '⏸️';
      const market = rule.searchMarketplace ? '🛒 marketplace: acik' : '🛒 marketplace: kapali';
      const keywords = rule.includeKeywords.join(', ') || '(kelime yok)';
      return `${state} <b>#${rule.id} ${escapeHtml(rule.name)}</b>\n${market}\n${escapeHtml(keywords)}`;
    })
    .join('\n\n');
}

// ------------------------------------------------------------------ gruplar

function formatGroups(): string {
  const groups = listGroups();
  if (groups.length === 0) return 'Henuz grup yok. /grup_ekle ile ekleyebilirsin.';
  return groups
    .map((group) => {
      const state = group.enabled ? '✅' : '⏸️';
      return `${state} <b>#${group.id} ${escapeHtml(group.name)}</b>\n${escapeHtml(group.url)}`;
    })
    .join('\n\n');
}

// ----------------------------------------------------------------- sablonlar

function formatTemplates(): string {
  const templates = listTemplates();
  if (templates.length === 0) return 'Henuz sablon yok. /sablon_ekle ile ekleyebilirsin.';
  return templates
    .map((template) => {
      const preview = template.variants[0]?.slice(0, 80) ?? '';
      const extra = template.variants.length > 1 ? ` (+${template.variants.length - 1} varyant)` : '';
      return `<b>#${template.id} [${template.kind}] ${escapeHtml(template.name)}</b>${extra}\n${escapeHtml(preview)}`;
    })
    .join('\n\n');
}

/** "tur: ...\nisim: ...\nmetin:\n<varyant>\n---\n<varyant>" blogunu ayristirir. */
function parseTemplateBlock(
  args: string,
): { kind: TemplateKind; name: string; variants: string[] } | string {
  const lines = args.split('\n');
  let kind: TemplateKind | null = null;
  let name: string | null = null;
  const metinIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'metin:');

  const headerLines = metinIndex === -1 ? lines : lines.slice(0, metinIndex);
  for (const line of headerLines) {
    const [rawKey, ...rawRest] = line.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rawRest.join(':').trim();
    if (key === 'tur') {
      if (value !== 'comment' && value !== 'dm') return 'tur "comment" veya "dm" olmali';
      kind = value;
    } else if (key === 'isim') {
      name = value;
    }
  }

  if (!kind) return 'tur: comment veya dm belirtilmeli';
  if (!name) return 'isim: belirtilmeli';
  if (metinIndex === -1) return 'metin: satirindan sonra en az bir varyant olmali';

  const body = lines.slice(metinIndex + 1).join('\n');
  const variants = body
    .split(/^\s*---\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '');
  if (variants.length === 0) return 'metin: satirindan sonra en az bir varyant olmali';

  return { kind, name, variants };
}

// ------------------------------------------------------------------- ayarlar

type SettingKind = 'bool' | 'int' | 'float' | 'string';

interface SettingAlias {
  key: keyof Settings;
  kind: SettingKind;
  min?: number;
  max?: number;
  maxLen?: number;
  label: string;
}

const SETTING_ALIASES: Record<string, SettingAlias> = {
  saatlik_limit: { key: 'maxActionsPerHour', kind: 'int', min: 0, max: 200, label: 'saatlik aksiyon limiti' },
  gunluk_limit: { key: 'maxActionsPerDay', kind: 'int', min: 0, max: 1000, label: 'gunluk aksiyon limiti' },
  min_bosluk_sn: { key: 'minActionGapSec', kind: 'int', min: 0, max: 86_400, label: 'iki aksiyon arasi min saniye' },
  sessiz_baslangic: { key: 'quietHoursStart', kind: 'int', min: 0, max: 23, label: 'sessiz saat baslangici' },
  sessiz_bitis: { key: 'quietHoursEnd', kind: 'int', min: 0, max: 23, label: 'sessiz saat bitisi' },
  sessizde_dur: { key: 'pauseCollectionInQuietHours', kind: 'bool', label: 'sessiz saatte toplamayi da durdur' },
  turkce_ekler: { key: 'turkishSuffixMatching', kind: 'bool', label: 'turkce ek eslestirme' },
  ev_lat: { key: 'homeLat', kind: 'float', min: -90, max: 90, label: 'ev enlemi' },
  ev_lon: { key: 'homeLon', kind: 'float', min: -180, max: 180, label: 'ev boylami' },
  ev_etiket: { key: 'homeLabel', kind: 'string', maxLen: 120, label: 'ev etiketi' },
  bildirim_izleme: { key: 'notificationsEnabled', kind: 'bool', label: 'bildirim sekmesini izle' },
  bildirim_yenileme_ms: {
    key: 'notificationsRefreshMs',
    kind: 'int',
    min: 60_000,
    max: 21_600_000,
    label: 'bildirim sekmesi yenileme (ms)',
  },
  grup_tur_araligi_ms: { key: 'groupSweepMs', kind: 'int', min: 60_000, max: 7_200_000, label: 'grup turu araligi (ms)' },
  cevrim_araligi_ms: { key: 'cycleGapMs', kind: 'int', min: 500, max: 600_000, label: 'ziyaretler arasi bosluk (ms)' },
  rastgelelik: { key: 'jitterRatio', kind: 'float', min: 0, max: 1, label: 'zamanlama rastgeleligi' },
  selector_esigi: { key: 'selectorHealthThreshold', kind: 'int', min: 1, max: 50, label: 'selector alarm esigi' },
  heartbeat_sn: { key: 'heartbeatTimeoutSec', kind: 'int', min: 30, max: 3600, label: 'heartbeat zaman asimi (sn)' },
};

function formatSettingsList(): string {
  const settings = getSettings();
  const lines = [
    `dryRun: ${settings.dryRun ? 'acik' : 'KAPALI'}`,
    `kill switch: ${settings.killSwitch ? 'ACIK' : 'kapali'}`,
    '',
  ];
  for (const [alias, def] of Object.entries(SETTING_ALIASES)) {
    lines.push(`${alias} = ${String(settings[def.key])}  <i>(${escapeHtml(def.label)})</i>`);
  }
  lines.push('', 'Degistirmek icin: /ayar anahtar deger');
  return lines.join('\n');
}

function applySetting(alias: string, rawValue: string): string {
  const def = SETTING_ALIASES[alias];
  if (!def) return `Bilinmeyen ayar: ${alias}\n\nAnahtar listesi icin /ayarlar`;

  let value: string | number | boolean;
  if (def.kind === 'bool') {
    const normalized = rawValue.trim().toLowerCase();
    if (['evet', 'true', 'ac', 'acik', '1'].includes(normalized)) value = true;
    else if (['hayir', 'false', 'kapat', 'kapali', '0'].includes(normalized)) value = false;
    else return `${alias} icin evet/hayir bekleniyor`;
  } else if (def.kind === 'int' || def.kind === 'float') {
    const num = Number(rawValue.trim());
    if (!Number.isFinite(num)) return `${alias} icin sayi bekleniyor`;
    if (def.kind === 'int' && !Number.isInteger(num)) return `${alias} icin tam sayi bekleniyor`;
    if (def.min !== undefined && num < def.min) return `${alias} en az ${def.min} olmali`;
    if (def.max !== undefined && num > def.max) return `${alias} en fazla ${def.max} olmali`;
    value = num;
  } else {
    const trimmed = rawValue.trim();
    if (def.maxLen !== undefined && trimmed.length > def.maxLen) {
      return `${alias} en fazla ${def.maxLen} karakter olmali`;
    }
    value = trimmed;
  }

  updateSettings({ [def.key]: value } as Partial<Settings>);
  pushConfigToAgent();
  return `${alias} = ${String(value)} olarak kaydedildi`;
}

// ------------------------------------------------------------------- gecmis

function parseCountArg(raw: string, fallback: number, max: number): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 1) return fallback;
  return Math.min(num, max);
}

const MATCH_STATUS_LABEL: Record<string, string> = {
  pending: 'bekliyor',
  approved: 'onaylandi',
  sent: 'gonderildi',
  failed: 'basarisiz',
  skipped: 'atlandi',
  ignored: 'yoksayildi',
};

function formatHistory(count: number): string {
  const matches = listMatchDetails(count);
  if (matches.length === 0) return 'Henuz eslesme yok.';
  return matches
    .map((match) => {
      const status = MATCH_STATUS_LABEL[match.status] ?? match.status;
      const when = new Date(match.createdAt).toLocaleString('tr-TR');
      const group = match.groupName ? ` • ${escapeHtml(match.groupName)}` : '';
      return `<b>${escapeHtml(match.ruleName)}</b> (${status})${group}\n${escapeHtml(when)}\n<a href="${escapeHtml(match.post.permalink)}">Gonderi</a>`;
    })
    .join('\n\n');
}

function formatEvents(count: number): string {
  const events = listEvents(count);
  if (events.length === 0) return 'Henuz olay yok.';
  const icon: Record<string, string> = { info: 'ℹ️', warn: '⚠️', error: '🛑' };
  return events
    .map((event) => {
      const when = new Date(event.createdAt).toLocaleString('tr-TR');
      return `${icon[event.level] ?? ''} <b>${escapeHtml(event.kind)}</b> ${escapeHtml(when)}\n${escapeHtml(event.message)}`;
    })
    .join('\n\n');
}

// -------------------------------------------------------------------- komut

/** Sadece ilk kelimeyi (komutu) ayirir; kalan metin (satir sonlari dahil) oldugu gibi korunur. */
function splitCommand(text: string): { cmd: string; args: string } {
  const trimmed = text.trim();
  const spaceIndex = trimmed.search(/\s/);
  if (spaceIndex === -1) return { cmd: trimmed.toLowerCase(), args: '' };
  return { cmd: trimmed.slice(0, spaceIndex).toLowerCase(), args: trimmed.slice(spaceIndex + 1).trim() };
}

async function runCommand(text: string): Promise<string> {
  const { cmd, args } = splitCommand(text);

  switch (cmd) {
    case '/start':
    case '/yardim':
      return HELP_TEXT;

    // --- kurallar ---
    case '/kurallar':
      return formatRules();

    case '/kural_ekle': {
      const [namePart, keywordPart, excludePart] = args.split('|');
      const name = namePart?.trim();
      const keywords = (keywordPart ?? '')
        .split(',')
        .map((word) => word.trim())
        .filter((word) => word !== '');
      if (!name || keywords.length === 0) {
        return 'Kullanim: /kural_ekle isim | kelime1, kelime2 [| haric1, haric2]';
      }
      // Ucuncu bolum verilmezse panel ile ayni varsayilan haric listesi kullanilir
      // (satis/arayan ilanlarini elemek icin).
      const excludeKeywords =
        excludePart === undefined
          ? SUGGESTED_EXCLUDE_KEYWORDS
          : excludePart
              .split(',')
              .map((word) => word.trim())
              .filter((word) => word !== '');
      const rule = createRule({
        name,
        enabled: true,
        matchMode: 'any',
        includeKeywords: keywords,
        excludeKeywords,
        regex: null,
        actionComment: false,
        actionDm: false,
        actionNotify: true,
        requireApproval: true,
        searchMarketplace: true,
        commentTemplateId: null,
        dmTemplateId: null,
        dailyCap: 20,
        maxPostAgeMin: 30,
        maxDistanceKm: null,
        priority: 1,
        groupIds: [],
      });
      pushConfigToAgent();
      return `Kural eklendi: #${rule.id} ${escapeHtml(rule.name)}`;
    }

    case '/kural_ac':
    case '/kural_kapat': {
      const id = parseIdArg(args);
      if (id === null) return 'Kullanim: /kural_ac id  (veya /kural_kapat id)';
      const enabled = cmd === '/kural_ac';
      const updated = updateRule(id, { enabled });
      if (!updated) return `#${id} numarali kural bulunamadi`;
      pushConfigToAgent();
      return `#${id} ${enabled ? 'etkinlestirildi' : 'devre disi birakildi'}`;
    }

    case '/kural_market': {
      const [idRaw, stateRaw] = args.split(/\s+/);
      const id = parseIdArg(idRaw ?? '');
      const state = (stateRaw ?? '').toLowerCase();
      if (id === null || (state !== 'ac' && state !== 'kapat')) {
        return 'Kullanim: /kural_market id ac  (veya /kural_market id kapat)';
      }
      const searchMarketplace = state === 'ac';
      const updated = updateRule(id, { searchMarketplace });
      if (!updated) return `#${id} numarali kural bulunamadi`;
      pushConfigToAgent();
      return `#${id} marketplace aramasi ${searchMarketplace ? 'ACIK' : 'kapali'}`;
    }

    case '/kural_sil': {
      const id = parseIdArg(args);
      if (id === null) return 'Kullanim: /kural_sil id';
      const removed = deleteRule(id);
      if (!removed) return `#${id} numarali kural bulunamadi`;
      pushConfigToAgent();
      return `#${id} silindi`;
    }

    // --- gruplar ---
    case '/gruplar':
      return formatGroups();

    case '/grup_ekle': {
      const [urlPart, namePart] = args.split('|');
      const rawUrl = urlPart?.trim();
      if (!rawUrl) return 'Kullanim: /grup_ekle facebook-grup-linki | ad(opsiyonel)';
      let normalizedUrl: string;
      try {
        normalizedUrl = normalizeGroupUrl(rawUrl);
      } catch {
        return 'Grup adresi cozulemedi';
      }
      const fbGroupId = extractGroupId(normalizedUrl);
      if (!fbGroupId) return 'Adres bir Facebook grup adresi degil (facebook.com/groups/... bekleniyor)';
      if (getGroupByFbId(fbGroupId)) return 'Bu grup zaten ekli';
      const group = createGroup({
        fbGroupId,
        name: namePart?.trim() || fbGroupId,
        url: normalizedUrl,
        dwellMs: 8000,
        priority: 1,
        enabled: true,
        dailyActionCap: 10,
      });
      pushConfigToAgent();
      return `Grup eklendi: #${group.id} ${escapeHtml(group.name)}\nUnutma: grubun Facebook sayfasinda zil menusunden "Tum gonderiler"i ac.`;
    }

    case '/grup_sil': {
      const id = parseIdArg(args);
      if (id === null) return 'Kullanim: /grup_sil id';
      const removed = deleteGroup(id);
      if (!removed) return `#${id} numarali grup bulunamadi`;
      pushConfigToAgent();
      return `#${id} silindi`;
    }

    // --- sablonlar ---
    case '/sablonlar':
      return formatTemplates();

    case '/sablon_ekle': {
      const parsed = parseTemplateBlock(args);
      if (typeof parsed === 'string') {
        return `${parsed}\n\nOrnek:\n/sablon_ekle\ntur: comment\nisim: Karsilama\nmetin:\nMerhaba, hala mevcut mu?\n---\nSelam, hala var mi?`;
      }
      const template = createTemplate(parsed);
      return `Sablon eklendi: #${template.id} [${template.kind}] ${escapeHtml(template.name)} (${template.variants.length} varyant)`;
    }

    case '/sablon_sil': {
      const id = parseIdArg(args);
      if (id === null) return 'Kullanim: /sablon_sil id';
      const removed = deleteTemplate(id);
      if (!removed) return `#${id} numarali sablon bulunamadi`;
      return `#${id} silindi`;
    }

    // --- guvenlik anahtarlari ---
    case '/durum': {
      const settings = getSettings();
      return [
        `dryRun: ${settings.dryRun ? 'acik (gercek gonderim yok)' : 'KAPALI (gercek gonderim aktif)'}`,
        `kill switch: ${settings.killSwitch ? 'ACIK (her sey durdu)' : 'kapali'}`,
      ].join('\n');
    }

    case '/dryrun_ac':
    case '/dryrun_kapat': {
      const dryRun = cmd === '/dryrun_ac';
      updateSettings({ dryRun });
      pushConfigToAgent();
      return dryRun ? 'dryRun acik: gercek gonderim yok' : 'dryRun KAPALI: gercek gonderim aktif';
    }

    case '/kill_ac':
    case '/kill_kapat': {
      const killSwitch = cmd === '/kill_ac';
      updateSettings({ killSwitch });
      pushConfigToAgent();
      return killSwitch ? 'Kill switch ACIK: toplama ve aksiyonlar durdu' : 'Kill switch kapali';
    }

    // --- ince ayarlar ---
    case '/ayarlar':
      return formatSettingsList();

    case '/ayar': {
      const spaceIndex = args.search(/\s/);
      if (spaceIndex === -1) return 'Kullanim: /ayar anahtar deger  (anahtar listesi icin /ayarlar)';
      const alias = args.slice(0, spaceIndex).trim().toLowerCase();
      const value = args.slice(spaceIndex + 1).trim();
      return applySetting(alias, value);
    }

    // --- gecmis ---
    case '/gecmis':
      return formatHistory(parseCountArg(args, 10, 50));

    case '/olaylar':
      return formatEvents(parseCountArg(args, 10, 50));

    default:
      return `Anlamadim: ${escapeHtml(text)}\n\n${HELP_TEXT}`;
  }
}

async function handleUpdate(update: TelegramUpdate, settings: Settings): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  if (String(message.chat.id) !== settings.telegramChatId) return;

  let reply: string;
  try {
    reply = await runCommand(message.text);
  } catch (error) {
    reply = `Komut basarisiz: ${String(error)}`;
  }
  const result = await sendTelegramMessage(reply, settings);
  if (!result.ok) {
    logEvent('telegram', 'warn', `Komut cevabi gonderilemedi: ${result.error}`);
  }
}

/** getUpdates long-poll dongusunu baslatir. Durdurma fonksiyonu doner. */
export function startTelegramCommands(): () => void {
  let stopped = false;
  let offset = 0;

  async function loop(): Promise<void> {
    while (!stopped) {
      const settings = getSettings();
      if (!telegramConfigured(settings)) {
        await sleep(IDLE_RETRY_MS);
        continue;
      }
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${settings.telegramBotToken}/getUpdates` +
            `?timeout=${POLL_TIMEOUT_S}&offset=${offset}`,
          { signal: AbortSignal.timeout((POLL_TIMEOUT_S + 10) * 1000) },
        );
        if (!response.ok) {
          await sleep(IDLE_RETRY_MS);
          continue;
        }
        const body = (await response.json()) as { ok: boolean; result?: TelegramUpdate[] };
        if (!body.ok || !body.result) {
          await sleep(IDLE_RETRY_MS);
          continue;
        }
        for (const update of body.result) {
          offset = update.update_id + 1;
          await handleUpdate(update, settings);
        }
      } catch {
        await sleep(IDLE_RETRY_MS);
      }
    }
  }

  void loop();
  return () => {
    stopped = true;
  };
}
