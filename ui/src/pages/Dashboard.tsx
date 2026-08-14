import { useCallback, useEffect, useState } from 'react';
import { api, type MatchDetail, type Post, type StatusResponse } from '../api.ts';
import { clock, timeAgo, truncate } from '../format.ts';
import { useStream, type StreamEvent } from '../useStream.ts';

interface FeedEntry {
  key: string;
  at: number;
  kind: 'post' | 'match' | 'log';
  level?: 'info' | 'warn' | 'error';
  title: string;
  text: string;
  link?: string;
  place?: string;
  /** Gonderiyi hangi yol yakaladi; bildirim yolunun calisip calismadigini gosterir. */
  via?: 'feed' | 'notification';
  /** Gonderi ilk goruldugunde kac dakikalikti. Gecikmenin dogrudan olcusu. */
  ageMin?: number;
}

const MAX_FEED = 80;

/** "Vinohrady - 2.4 km" seklinde konum rozeti; ikisi de yoksa undefined. */
function placeLabel(post: Post): string | undefined {
  if (!post.locationName) return undefined;
  return post.distanceKm === null ? post.locationName : `${post.locationName} · ${post.distanceKm} km`;
}

/**
 * Gonderi ilk goruldugunde kac dakikalikti. Negatif cikabilir: enrichPost
 * daha taze bir etiketten postedAt'i ileri kaydirirken seenAt ilk yakalamada
 * kalir. Bu durumda 0'a kirpiyoruz.
 * postedAt cikarilamadiysa (etiket okunamadi) undefined - "0 dakika" demek
 * yaniltici olurdu, bilinmiyor demek dogru.
 */
function ageMinutes(post: Post): number | undefined {
  if (post.postedAt === null) return undefined;
  return Math.max(0, Math.round((post.seenAt - post.postedAt) / 60_000));
}

function postEntry(post: Post): FeedEntry {
  return {
    key: `post-${post.id}`,
    at: post.seenAt,
    kind: 'post',
    title: post.authorName ?? 'Bilinmeyen yazar',
    text: truncate(post.text) || '(metin yok)',
    link: post.permalink,
    place: placeLabel(post),
    via: post.source,
    ageMin: ageMinutes(post),
  };
}

function matchEntry(match: MatchDetail): FeedEntry {
  return {
    key: `match-${match.id}`,
    at: match.createdAt,
    kind: 'match',
    title: `${match.ruleName} - ${match.matchedKeywords.join(', ')}`,
    text: truncate(match.post.text),
    link: match.post.permalink,
    place: placeLabel(match.post),
  };
}

interface Props {
  status: StatusResponse | null;
  onStatusChange: () => void;
}

export function Dashboard({ status, onStatusChange }: Props): JSX.Element {
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const push = useCallback((entry: FeedEntry) => {
    setFeed((current) => [entry, ...current.filter((item) => item.key !== entry.key)].slice(0, MAX_FEED));
  }, []);

  const streamConnected = useStream(
    useCallback(
      (event: StreamEvent) => {
        if (event.type === 'post') push(postEntry(event.post));
        else if (event.type === 'match') push(matchEntry(event.match));
        else if (event.type === 'log') {
          push({
            key: `log-${event.at}-${event.message.slice(0, 24)}`,
            at: event.at,
            kind: 'log',
            level: event.level,
            title: 'Sistem',
            text: event.message,
          });
        } else if (event.type === 'status') onStatusChange();
      },
      [push, onStatusChange],
    ),
  );

  // Sayfa yeni acildiginda akis bos olur; son durumu bir kez cekiyoruz.
  useEffect(() => {
    void (async () => {
      const [posts, matches] = await Promise.all([api.listPosts(30), api.listMatches(30)]);
      const initial = [...posts.map(postEntry), ...matches.map(matchEntry)].sort((a, b) => b.at - a.at);
      setFeed(initial.slice(0, MAX_FEED));
    })();
  }, []);

  /** Ayristirici degistiginde eski bozuk kayitlarla temiz baslangic yapmak icin. */
  const clearFeed = async (): Promise<void> => {
    if (!confirm('Yakalanan gonderiler ve eslesmeler silinsin mi? Gruplar, kurallar ve sablonlar korunur.')) {
      return;
    }
    setBusy(true);
    try {
      await api.clearPosts();
      setFeed([]);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (patch: { dryRun?: boolean; killSwitch?: boolean }): Promise<void> => {
    setBusy(true);
    try {
      await api.updateSettings(patch);
      onStatusChange();
    } finally {
      setBusy(false);
    }
  };

  const agent = status?.agent;
  const healthy = status?.alive === true;

  return (
    <>
      <h2>Panel</h2>
      <p className="subtitle">Botun anlik durumu ve canli eslesme akisi.</p>

      {status?.killSwitch === true && (
        <div className="banner err">
          Kill switch acik - toplama ve aksiyonlarin tamami durdurulmus durumda.
        </div>
      )}
      {agent?.lastBlock && (
        <div className="banner err">
          Facebook engeli tespit edildi ({agent.lastBlock.kind}) - {timeAgo(agent.lastBlock.at)}.
          {agent.lastBlock.note ? ` ${agent.lastBlock.note}.` : ''} Devam etmeden once hesabi elle kontrol edin.
        </div>
      )}
      {status?.dryRun === true && (
        <div className="banner info">
          Dry-run acik: eslesmeler kaydedilir ve bildirilir, ancak Facebook'a hicbir sey gonderilmez.
        </div>
      )}
      {agent && agent.consecutiveEmptyRounds >= 3 && (
        <div className="banner warn">
          Son {agent.consecutiveEmptyRounds} turda hic gonderi ayristirilamadi - Facebook sayfa yapisi
          degismis olabilir (selector onarimi gerekebilir).
        </div>
      )}

      <div className="grid">
        <div className="card stat">
          <div className="label">Eklenti</div>
          <div className="value">
            <span className={`badge ${healthy ? 'ok' : 'err'}`}>
              {healthy ? 'Cevrimici' : agent?.connected ? 'Yanit yok' : 'Cevrimdisi'}
            </span>
          </div>
          <div className="hint">Son sinyal: {timeAgo(agent?.lastHeartbeatAt ?? null)}</div>
        </div>

        <div className="card stat">
          <div className="label">Su an taranan</div>
          <div className="value">{agent?.currentGroup ?? '-'}</div>
          <div className="hint">Son tarama: {timeAgo(agent?.lastParseAt ?? null)}</div>
        </div>

        <div className="card stat">
          <div className="label">Mod</div>
          <div className="value">
            <span className={`badge ${status?.dryRun ? 'warn' : 'ok'}`}>
              {status?.dryRun ? 'Dry-run' : 'Canli'}
            </span>
          </div>
          <div className="hint">
            <button className="ghost" disabled={busy} onClick={() => void toggle({ dryRun: !status?.dryRun })}>
              {status?.dryRun ? 'Canliya al' : 'Dry-run yap'}
            </button>
          </div>
        </div>

        <div className="card stat">
          <div className="label">Acil durdurma</div>
          <div className="value">
            <span className={`badge ${status?.killSwitch ? 'err' : 'muted'}`}>
              {status?.killSwitch ? 'Durduruldu' : 'Calisiyor'}
            </span>
          </div>
          <div className="hint">
            <button
              className={status?.killSwitch ? 'ghost' : 'danger'}
              disabled={busy}
              onClick={() => void toggle({ killSwitch: !status?.killSwitch })}
            >
              {status?.killSwitch ? 'Devam ettir' : 'Her seyi durdur'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Canli akis</h3>
          <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button
              className="ghost"
              disabled={busy}
              onClick={() => void clearFeed()}
              title="Yakalanan gonderileri siler. Gruplar, kurallar ve sablonlar korunur."
            >
              Akisi temizle
            </button>
            <span className={`badge ${streamConnected ? 'ok' : 'muted'}`}>
              {streamConnected ? 'Bagli' : 'Baglaniyor'}
            </span>
          </div>
        </div>

        {feed.length === 0 ? (
          <div className="empty">
            Henuz gonderi yok. Grup ekleyip eklentiyi baglayin; yeni gonderiler burada anlik gorunur.
          </div>
        ) : (
          feed.map((entry) => (
            <div className="feed-item" key={entry.key}>
              <div className="feed-meta">
                <span className={`badge ${entry.kind === 'match' ? 'ok' : entry.level === 'error' ? 'err' : 'muted'}`}>
                  {entry.kind === 'match' ? 'ESLESME' : entry.kind === 'log' ? 'SISTEM' : 'GONDERI'}
                </span>
                <strong>{entry.title}</strong>
                <span>{clock(entry.at)}</span>
                {entry.place && <span className="badge muted">{entry.place}</span>}
                {entry.via && (
                  <span className={`badge ${entry.via === 'notification' ? 'ok' : 'muted'}`}>
                    {entry.via === 'notification' ? 'BILDIRIM' : 'TARAMA'}
                  </span>
                )}
                {entry.ageMin !== undefined && (
                  <span className="badge muted">+{entry.ageMin} dk</span>
                )}
                {entry.link && (
                  <a href={entry.link} target="_blank" rel="noreferrer">
                    Facebook'ta ac
                  </a>
                )}
              </div>
              <div className="feed-text">{entry.text}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
