import fs from 'node:fs';
import { buildApp } from './app.ts';
import { CONFIG } from './config.ts';
import { closeDb, initDb } from './db/index.ts';
import { requeueStuckActions } from './repo/actions.ts';
import { logEvent } from './repo/events.ts';
import { startTelegramAlarms } from './notify/telegram.ts';
import { startTelegramCommands } from './notify/telegramCommands.ts';
import { ensureAgentToken } from './repo/settings.ts';
import { seedDefaults } from './seed.ts';
import { startWatchdog } from './watchdog.ts';

async function main(): Promise<void> {
  initDb();
  seedDefaults();
  const token = ensureAgentToken();

  // Sunucu aksiyon gonderilirken cokerse kayitlar 'sending' durumunda asili kalir.
  const requeued = requeueStuckActions();
  if (requeued > 0) {
    logEvent('startup', 'warn', `${requeued} yarim kalmis aksiyon kuyruga geri alindi`);
  }

  const app = await buildApp();
  startWatchdog();
  // Kritik alarmlar (eklenti cevrimdisi, selector bozulmasi, engel) Telegram'a da gider.
  startTelegramAlarms();
  // Kural/grup yonetimi Telegram komutlariyla da yapilabilir (/yardim).
  startTelegramCommands();
  await app.listen({ host: CONFIG.host, port: CONFIG.port });

  const uiHint = fs.existsSync(CONFIG.publicDir)
    ? `Panel:  http://${CONFIG.host}:${CONFIG.port}`
    : `Panel:  http://127.0.0.1:5173  (dev - kalici surum icin "npm run build:ui")`;
  process.stdout.write(
    [
      '',
      '  fb-group-watcher calisiyor',
      `  ${uiHint}`,
      `  Agent token: ${token}`,
      `  (bu tokeni tarayici eklentisinin secenekler sayfasina yapistirin)`,
      `  Veritabani: ${CONFIG.dbPath}`,
      '',
    ].join('\n'),
  );

  const shutdown = async (): Promise<void> => {
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`Sunucu baslatilamadi: ${String(error)}\n`);
  process.exit(1);
});
