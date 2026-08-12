import { useEffect, useState } from 'react';
import { api, type Group } from '../api.ts';

export function Groups(): JSX.Element {
  const [groups, setGroups] = useState<Group[]>([]);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async (): Promise<void> => setGroups(await api.listGroups());

  useEffect(() => {
    void reload();
  }, []);

  const add = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.createGroup({ url, name: name.trim() === '' ? undefined : name.trim() });
      setUrl('');
      setName('');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  /** Her yazma islemi hatayi gorunur kilmali; sessiz basarisizlik en kotu sonuctur. */
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action();
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const patch = (group: Group, changes: Partial<Group>): Promise<void> =>
    run(() => api.updateGroup(group.id, changes));

  const remove = (group: Group): Promise<void> => {
    if (!confirm(`"${group.name}" grubu silinsin mi? Bu gruba ait gecmis kayitlar kalir.`)) {
      return Promise.resolve();
    }
    return run(() => api.deleteGroup(group.id));
  };

  return (
    <>
      <h2>Gruplar</h2>
      <p className="subtitle">Izlenecek Facebook gruplari. Bot yalnizca burada aktif olanlari tarar.</p>

      <div className="card">
        <div className="row">
          <div>
            <label htmlFor="group-url">Grup adresi</label>
            <input
              id="group-url"
              type="text"
              value={url}
              placeholder="https://www.facebook.com/groups/bedava-esya"
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="group-name">Ad (opsiyonel)</label>
            <input
              id="group-name"
              type="text"
              value={name}
              placeholder="Bedava Esya Istanbul"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button className="primary" disabled={busy || url.trim() === ''} onClick={() => void add()}>
            Ekle
          </button>
        </div>
        <div className="hint">
          Grup adresi otomatik olarak kronolojik ("Yeni gonderiler") gorunume cevrilir; varsayilan
          siralamada yeni gonderiler gec goruntulendigi icin bu sart.
        </div>
        {error && <div className="banner err" style={{ marginTop: '0.85rem' }}>{error}</div>}
      </div>

      <div className="card">
        {groups.length === 0 ? (
          <div className="empty">Henuz grup eklenmemis.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ad</th>
                <th>Aktif</th>
                <th>Oncelik</th>
                <th>Bekleme (ms)</th>
                <th>Gunluk aksiyon</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td>
                    <strong>{group.name}</strong>
                    <div className="hint">
                      <a href={group.url} target="_blank" rel="noreferrer">
                        {group.fbGroupId}
                      </a>
                    </div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={group.enabled}
                      onChange={(event) => void patch(group, { enabled: event.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={group.priority}
                      style={{ width: '4.5rem' }}
                      onChange={(event) => void patch(group, { priority: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={2000}
                      max={120000}
                      step={1000}
                      value={group.dwellMs}
                      style={{ width: '6.5rem' }}
                      onChange={(event) => void patch(group, { dwellMs: Number(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={group.dailyActionCap}
                      style={{ width: '5rem' }}
                      onChange={(event) =>
                        void patch(group, { dailyActionCap: Number(event.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <button className="danger" onClick={() => void remove(group)}>
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint" style={{ marginTop: '0.75rem' }}>
          <strong>Oncelik</strong>: yuksek oncelikli gruplar bir tam turda birden fazla kez ziyaret
          edilir. <strong>Bekleme</strong>: sayfanin yuklenmesi icin taninan sure.
        </div>
      </div>
    </>
  );
}
