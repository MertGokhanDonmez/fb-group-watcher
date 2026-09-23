/**
 * Eklentiyi taklit eden tani araci.
 *
 * Chrome'u hic acmadan backend'in ajan protokolunu, post kaydini ve dedupe'u
 * dogrular. Bir sorun ciktiginda "backend mi bozuk, eklenti mi?" sorusunu
 * ayirmanin en hizli yolu budur.
 *
 * Kullanim:  node scripts/agent-smoke.mjs
 */
import WebSocket from 'ws';

const BASE = process.env.FBW_BASE ?? 'http://127.0.0.1:8787';
const PROTOCOL_VERSION = 5;

const log = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);

async function json(path, init) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

const { token } = await json('/api/settings/agent-token');
log(`Agent token alindi: ${token.slice(0, 8)}...`);

// Test grubu (yoksa olustur)
const groups = await json('/api/groups');
let group = groups.find((item) => item.fbGroupId === 'smoke-test-group');
if (!group) {
  group = await json('/api/groups', {
    method: 'POST',
    body: JSON.stringify({
      url: 'https://www.facebook.com/groups/smoke-test-group',
      name: 'Smoke Test Grubu',
    }),
  });
  log(`Test grubu olusturuldu (id ${group.id})`);
}

const socket = new WebSocket(`${BASE.replace('http', 'ws')}/agent`);
const send = (message) => socket.send(JSON.stringify(message));

const fbPostId = String(Date.now());
let configReceived = false;

socket.on('open', () => {
  log('Soket acildi, hello gonderiliyor');
  send({
    type: 'hello',
    token,
    protocolVersion: PROTOCOL_VERSION,
    extVersion: 'smoke-0.1',
    instanceId: 'smoke-test',
  });
});

socket.on('message', async (data) => {
  const message = JSON.parse(data.toString());
  log(`<- ${message.type}`);

  if (message.type === 'hello_error') {
    log(`  HATA: ${message.reason}`);
    socket.close();
    process.exitCode = 1;
    return;
  }

  if (message.type === 'hello_ok') {
    send({ type: 'heartbeat', ts: Date.now() });
  }

  if (message.type === 'config') {
    if (configReceived) return;
    configReceived = true;
    log(`  Plandaki grup sayisi: ${message.config.groups.length}`);
    const target = message.config.groups.find((item) => item.fbGroupId === 'smoke-test-group');
    log(`  Kronolojik URL: ${target?.url ?? '(bulunamadi)'}`);
    log(`  dryRun=${message.config.dryRun} killSwitch=${message.config.killSwitch}`);

    const post = {
      source: 'feed',
      fbPostId,
      fbGroupId: 'smoke-test-group',
      permalink: `https://www.facebook.com/groups/smoke-test-group/posts/${fbPostId}/`,
      authorName: 'Test Kullanici',
      authorProfileUrl: 'https://www.facebook.com/test.kullanici',
      authorUserId: 'test.kullanici',
      text: 'Bedava koltuk veriyorum, alan gelsin. Ucretsiz.',
      imageUrls: [],
      postedAt: Date.now(),
      postedAtLabel: '1 dk',
    };

    log('-> posts (ayni post iki kez gonderiliyor, dedupe testi)');
    send({
      type: 'posts',
      fbGroupId: 'smoke-test-group',
      posts: [post, post],
      stats: { articlesSeen: 2, postsParsed: 2, failures: 0 },
    });

    setTimeout(async () => {
      const posts = await json('/api/posts?limit=20');
      const matching = posts.filter((item) => item.fbPostId === fbPostId);
      log(`\nVeritabanindaki kopya sayisi: ${matching.length} (beklenen: 1)`);

      const status = await json('/api/status');
      log(`Ajan bagli mi: ${status.agent.connected} | yasiyor mu: ${status.alive}`);

      const ok = matching.length === 1 && status.agent.connected && status.alive;
      log(ok ? '\nSONUC: BASARILI' : '\nSONUC: BASARISIZ');
      process.exitCode = ok ? 0 : 1;
      socket.close();
    }, 500);
  }
});

socket.on('error', (error) => {
  log(`Soket hatasi: ${error.message}`);
  process.exitCode = 1;
});
