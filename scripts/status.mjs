/**
 * Botun o anki durumunu tek ekranda gosterir.
 *
 * Kullanim:  node scripts/status.mjs
 *
 * "Neden hicbir sey olmuyor?" sorusunun cevabi genelde burada: ajan bagli mi,
 * son tarama ne zaman, hangi gruplar izleniyor, sistem gunlugunde ne var.
 */
const BASE = process.env.FBW_BASE ?? 'http://127.0.0.1:8787';

const out = (line = '') => process.stdout.write(`${line}\n`);

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
  return response.json();
}

const time = (ms) =>
  ms === null || ms === undefined
    ? '-'
    : new Date(ms).toLocaleTimeString('tr-TR', { hour12: false });

const ago = (ms) => {
  if (ms === null || ms === undefined) return 'hic';
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds} sn once`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk once`;
  return `${Math.round(seconds / 3600)} sa once`;
};

let status;
try {
  status = await get('/api/status');
} catch {
  out('Sunucuya ulasilamadi. Calisiyor mu?  ->  npm start');
  process.exit(1);
}

const [groups, posts, matches, events, settings] = await Promise.all([
  get('/api/groups'),
  get('/api/posts?limit=10'),
  get('/api/matches?limit=10'),
  get('/api/events?limit=25'),
  get('/api/settings'),
]);

out('=== AJAN ===');
out(`bagli          : ${status.agent.connected ? 'evet' : 'HAYIR'}`);
out(`yasiyor        : ${status.alive ? 'evet' : 'HAYIR'}`);
out(`eklenti surumu : ${status.agent.extVersion ?? '-'}`);
out(`son yasam sinyali : ${time(status.agent.lastHeartbeatAt)} (${ago(status.agent.lastHeartbeatAt)})`);
out(`son tarama        : ${time(status.agent.lastParseAt)} (${ago(status.agent.lastParseAt)})`);
out(`su an             : ${status.agent.currentGroup ?? '-'}`);
out(`bos tur serisi    : ${status.agent.consecutiveEmptyRounds}`);
if (status.agent.lastBlock) {
  out(`ENGEL           : ${status.agent.lastBlock.kind} - ${status.agent.lastBlock.note ?? ''}`);
}

out();
out('=== MOD ===');
out(`dryRun     : ${settings.dryRun}   killSwitch: ${settings.killSwitch}`);
out(`bildirim izleme : ${settings.notificationsEnabled}`);
out(`sessiz saat     : ${settings.quietHoursStart}:00-${settings.quietHoursEnd}:00  (taramayi durdur: ${settings.pauseCollectionInQuietHours})`);
const hour = new Date().getHours();
const inQuiet =
  settings.quietHoursStart === settings.quietHoursEnd
    ? false
    : settings.quietHoursStart < settings.quietHoursEnd
      ? hour >= settings.quietHoursStart && hour < settings.quietHoursEnd
      : hour >= settings.quietHoursStart || hour < settings.quietHoursEnd;
out(`su an sessiz saatte mi : ${inQuiet ? 'EVET - toplama duraklatilmis olmali' : 'hayir'}`);

out();
out(`=== GRUPLAR (${groups.length}) ===`);
if (groups.length === 0) out('(hic grup eklenmemis - grup taramasi bos calisir)');
for (const group of groups) {
  out(`  ${group.enabled ? '[aktif]' : '[kapali]'} ${group.name}  (oncelik ${group.priority})`);
}

out();
out(`=== SON GONDERILER (${posts.length}) ===`);
if (posts.length === 0) out('(henuz gonderi yakalanmadi)');
for (const post of posts.slice(0, 8)) {
  const text = post.text.replace(/\s+/g, ' ').slice(0, 70);
  out(`  ${time(post.seenAt)}  ${post.authorName ?? '?'}: ${text}`);
}

out();
out(`=== ESLESMELER (${matches.length}) ===`);
if (matches.length === 0) out('(henuz eslesme yok)');
for (const match of matches.slice(0, 8)) {
  out(`  ${time(match.createdAt)}  ${match.ruleName} [${match.status}] ${match.matchedKeywords.join(', ')}`);
}

out();
out(`=== SISTEM GUNLUGU (son ${Math.min(events.length, 20)}) ===`);
if (events.length === 0) out('(bos)');
for (const event of events.slice(0, 20)) {
  out(`  ${time(event.createdAt)}  [${event.level}] ${event.kind}: ${event.message}`);
}
