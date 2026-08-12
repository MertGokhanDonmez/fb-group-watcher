import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pushConfigToAgent } from '../agent/hub.ts';
import { getAgentStatus, isAgentAlive } from '../agent/status.ts';
import { logEvent } from '../repo/events.ts';
import { listAreas } from '../location/extract.ts';
import { discoverTelegramChats, sendTelegramMessage } from '../notify/telegram.ts';
import { ensureAgentToken, getSettings, updateSettings } from '../repo/settings.ts';

const patchSchema = z
  .object({
    dryRun: z.boolean(),
    killSwitch: z.boolean(),
    telegramBotToken: z.string(),
    telegramChatId: z.string(),
    maxActionsPerHour: z.number().int().min(0).max(200),
    maxActionsPerDay: z.number().int().min(0).max(1000),
    minActionGapSec: z.number().int().min(0).max(86_400),
    quietHoursStart: z.number().int().min(0).max(23),
    quietHoursEnd: z.number().int().min(0).max(23),
    pauseCollectionInQuietHours: z.boolean(),
    turkishSuffixMatching: z.boolean(),
    homeLat: z.number().min(-90).max(90),
    homeLon: z.number().min(-180).max(180),
    homeLabel: z.string().max(120),
    notificationsEnabled: z.boolean(),
    notificationsRefreshMs: z.number().int().min(60_000).max(21_600_000),
    groupSweepMs: z.number().int().min(60_000).max(7_200_000),
    cycleGapMs: z.number().int().min(500).max(600_000),
    jitterRatio: z.number().min(0).max(1),
    selectorHealthThreshold: z.number().int().min(1).max(50),
    heartbeatTimeoutSec: z.number().int().min(30).max(3600),
  })
  .partial()
  .strict();

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings', async () => getSettings());

  app.patch('/api/settings', async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Gecersiz ayar', detail: parsed.error.flatten() });
    }
    const before = getSettings();
    const settings = updateSettings(parsed.data);

    if (before.killSwitch !== settings.killSwitch) {
      logEvent('settings', 'warn', settings.killSwitch ? 'Kill switch acildi' : 'Kill switch kapatildi');
    }
    if (before.dryRun !== settings.dryRun) {
      logEvent(
        'settings',
        'warn',
        settings.dryRun ? 'Dry-run acildi (gercek gonderim yok)' : 'Dry-run KAPATILDI - gercek gonderim aktif',
      );
    }
    // Eklentinin plani bu ayarlara bagli; degisikligi hemen bildir.
    pushConfigToAgent();
    return settings;
  });

  /** Ev konumu secimi icin bilinen bolgeler. Mesafe filtresi bunlara dayanir. */
  app.get('/api/areas', async () => listAreas());

  /** Eklentinin secenekler sayfasina yapistirilacak token. */
  app.get('/api/settings/agent-token', async () => ({ token: ensureAgentToken() }));

  app.post('/api/settings/agent-token/regenerate', async () => {
    const token = randomBytes(24).toString('hex');
    updateSettings({ agentToken: token });
    logEvent('settings', 'warn', 'Agent token yenilendi - eklentiye yeni token girilmeli');
    return { token };
  });

  /**
   * Telegram ayarlarini dogrulamanin tek guvenilir yolu gercek bir mesaj
   * gondermektir; token/chat ID hatalari ancak API cevabinda gorunur.
   */
  /**
   * Botun gordugu sohbetleri listeler; kullanici chat ID'yi elle aramak yerine
   * listeden secer. Kurulumun en cok takilan adimi buydu.
   */
  app.get('/api/settings/telegram-chats', async (_request, reply) => {
    const result = await discoverTelegramChats();
    if (!result.ok) return reply.status(502).send({ error: result.error });
    return result.data;
  });

  app.post('/api/settings/telegram-test', async (_request, reply) => {
    const result = await sendTelegramMessage(
      '✅ fb-group-watcher test bildirimi - baglanti calisiyor',
    );
    if (!result.ok) {
      logEvent('telegram', 'warn', `Test bildirimi gonderilemedi: ${result.error}`);
      return reply.status(502).send({ error: result.error });
    }
    logEvent('telegram', 'info', 'Test bildirimi gonderildi');
    return { ok: true };
  });

  app.get('/api/status', async () => {
    const settings = getSettings();
    return {
      agent: getAgentStatus(),
      alive: isAgentAlive(settings.heartbeatTimeoutSec),
      dryRun: settings.dryRun,
      killSwitch: settings.killSwitch,
      telegramConfigured: settings.telegramBotToken !== '' && settings.telegramChatId !== '',
    };
  });
};
