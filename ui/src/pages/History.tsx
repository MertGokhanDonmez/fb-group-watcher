import { useEffect, useState } from 'react';
import { api, type AgentEvent, type MatchDetail } from '../api.ts';
import { clock, timeAgo, truncate } from '../format.ts';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylandi',
  sent: 'Gonderildi',
  failed: 'Basarisiz',
  skipped: 'Atlandi',
  ignored: 'Yoksayildi',
};

const STATUS_STYLE: Record<string, string> = {
  sent: 'ok',
  failed: 'err',
  pending: 'muted',
  approved: 'warn',
  skipped: 'muted',
  ignored: 'muted',
};

export function History(): JSX.Element {
  const [matches, setMatches] = useState<MatchDetail[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [tab, setTab] = useState<'matches' | 'events'>('matches');

  useEffect(() => {
    void (async () => {
      const [nextMatches, nextEvents] = await Promise.all([api.listMatches(100), api.listEvents(150)]);
      setMatches(nextMatches);
      setEvents(nextEvents);
    })();
  }, []);

  return (
    <>
      <h2>Gecmis</h2>
      <p className="subtitle">Tum eslesmeler, gonderilen aksiyonlar ve sistem gunlugu.</p>

      <div className="card">
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <button
            className={tab === 'matches' ? 'primary' : 'ghost'}
            style={{ flex: '0 0 auto' }}
            onClick={() => setTab('matches')}
          >
            Eslesmeler ({matches.length})
          </button>
          <button
            className={tab === 'events' ? 'primary' : 'ghost'}
            style={{ flex: '0 0 auto' }}
            onClick={() => setTab('events')}
          >
            Sistem gunlugu ({events.length})
          </button>
        </div>

        {tab === 'matches' &&
          (matches.length === 0 ? (
            <div className="empty">Henuz eslesme yok.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Zaman</th>
                  <th>Kural / Grup</th>
                  <th>Gonderi</th>
                  <th>Durum</th>
                  <th>Aksiyonlar</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={match.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {clock(match.createdAt)}
                      <div className="hint">{timeAgo(match.createdAt)}</div>
                    </td>
                    <td>
                      <strong>{match.ruleName}</strong>
                      <div className="hint">{match.groupName ?? '-'}</div>
                      <div className="hint">{match.matchedKeywords.join(', ')}</div>
                    </td>
                    <td>
                      <a href={match.post.permalink} target="_blank" rel="noreferrer">
                        {match.post.authorName ?? 'Bilinmeyen'}
                      </a>
                      {match.post.locationName && (
                        <div className="hint">
                          <span className="badge muted">
                            {match.post.locationName}
                            {match.post.distanceKm !== null && ` · ${match.post.distanceKm} km`}
                          </span>
                        </div>
                      )}
                      <div className="hint">{truncate(match.post.text, 140)}</div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_STYLE[match.status] ?? 'muted'}`}>
                        {STATUS_LABEL[match.status] ?? match.status}
                      </span>
                    </td>
                    <td>
                      {match.actions.length === 0 && <span className="hint">-</span>}
                      {match.actions.map((action) => (
                        <div key={action.id} className="hint">
                          {action.kind}: {action.status}
                          {action.kind !== 'telegram' && action.status === 'sent' && !action.verified && (
                            <strong> (dogrulanamadi)</strong>
                          )}
                          {action.error && <div style={{ color: 'var(--err)' }}>{action.error}</div>}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'events' &&
          (events.length === 0 ? (
            <div className="empty">Gunluk bos.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Zaman</th>
                  <th>Tur</th>
                  <th>Mesaj</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{clock(event.createdAt)}</td>
                    <td>
                      <span className={`badge ${event.level === 'error' ? 'err' : event.level === 'warn' ? 'warn' : 'muted'}`}>
                        {event.kind}
                      </span>
                    </td>
                    <td>{event.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </>
  );
}
