import { useEffect, useState } from 'react';
import { api, type Group, type Rule, type Template } from '../api.ts';
import { parseList } from '../format.ts';
import { SUGGESTED_EXCLUDE_KEYWORDS as SUGGESTED_EXCLUDES } from '../../../shared/rules.ts';

export function Rules(): JSX.Element {
  const [rules, setRules] = useState<Rule[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    const [nextRules, nextGroups, nextTemplates] = await Promise.all([
      api.listRules(),
      api.listGroups(),
      api.listTemplates(),
    ]);
    setRules(nextRules);
    setGroups(nextGroups);
    setTemplates(nextTemplates);
  };

  useEffect(() => {
    void reload();
  }, []);

  const add = async (): Promise<void> => {
    setError(null);
    try {
      await api.createRule({
        name,
        includeKeywords: parseList(keywords),
        excludeKeywords: SUGGESTED_EXCLUDES,
      });
      setName('');
      setKeywords('');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const patch = async (rule: Rule, changes: Partial<Rule>): Promise<void> => {
    setError(null);
    try {
      await api.updateRule(rule.id, changes);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const remove = async (rule: Rule): Promise<void> => {
    if (!confirm(`"${rule.name}" kurali silinsin mi?`)) return;
    setError(null);
    try {
      await api.deleteRule(rule.id);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const commentTemplates = templates.filter((item) => item.kind === 'comment');
  const dmTemplates = templates.filter((item) => item.kind === 'dm');

  return (
    <>
      <h2>Kurallar</h2>
      <p className="subtitle">Hangi gonderiler eslesecek ve eslesince ne olacak.</p>

      <div className="card">
        <div className="row">
          <div>
            <label htmlFor="rule-name">Kural adi</label>
            <input id="rule-name" type="text" value={name} placeholder="Koltuk avi" onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label htmlFor="rule-keywords">Anahtar kelimeler (virgul veya satir)</label>
            <input
              id="rule-keywords"
              type="text"
              value={keywords}
              placeholder="koltuk, kanepe, berjer"
              onChange={(event) => setKeywords(event.target.value)}
            />
          </div>
          <button
            className="primary"
            disabled={name.trim() === '' || parseList(keywords).length === 0}
            onClick={() => void add()}
          >
            Kural ekle
          </button>
        </div>
        <div className="hint">
          Yeni kural varsayilan olarak yalnizca bildirim gonderir ve onay bekler. Aksiyonlari asagidan acabilirsiniz.
        </div>
        {error && <div className="banner err" style={{ marginTop: '0.85rem' }}>{error}</div>}
      </div>

      {rules.length === 0 && <div className="card empty">Henuz kural yok.</div>}

      {rules.map((rule) => (
        <div className="card" key={rule.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '1rem' }}>{rule.name}</strong>
            <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <label style={{ margin: 0, display: 'flex', gap: '0.35rem', alignItems: 'center', fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  style={{ width: 'auto' }}
                  onChange={(event) => void patch(rule, { enabled: event.target.checked })}
                />
                Aktif
              </label>
              <button className="danger" onClick={() => void remove(rule)}>
                Sil
              </button>
            </div>
          </div>

          <div className="row">
            <div>
              <label>Iceren kelimeler</label>
              <input
                type="text"
                defaultValue={rule.includeKeywords.join(', ')}
                onBlur={(event) => void patch(rule, { includeKeywords: parseList(event.target.value) })}
              />
            </div>
            <div>
              <label>Haric tutulan kelimeler</label>
              <input
                type="text"
                defaultValue={rule.excludeKeywords.join(', ')}
                onBlur={(event) => void patch(rule, { excludeKeywords: parseList(event.target.value) })}
              />
            </div>
            <div style={{ maxWidth: '9rem' }}>
              <label>Eslesme</label>
              <select
                value={rule.matchMode}
                onChange={(event) => void patch(rule, { matchMode: event.target.value as 'any' | 'all' })}
              >
                <option value="any">Herhangi biri</option>
                <option value="all">Hepsi</option>
              </select>
            </div>
          </div>

          <div className="checks">
            <label>
              <input
                type="checkbox"
                checked={rule.actionNotify}
                onChange={(event) => void patch(rule, { actionNotify: event.target.checked })}
              />
              Bildirim gonder
            </label>
            <label>
              <input
                type="checkbox"
                checked={rule.actionComment}
                onChange={(event) => void patch(rule, { actionComment: event.target.checked })}
              />
              Otomatik yorum
            </label>
            <label>
              <input
                type="checkbox"
                checked={rule.actionDm}
                onChange={(event) => void patch(rule, { actionDm: event.target.checked })}
              />
              Otomatik DM
            </label>
            <label>
              <input
                type="checkbox"
                checked={rule.requireApproval}
                onChange={(event) => void patch(rule, { requireApproval: event.target.checked })}
              />
              Once onay iste
            </label>
            <label>
              <input
                type="checkbox"
                checked={rule.searchMarketplace}
                onChange={(event) => void patch(rule, { searchMarketplace: event.target.checked })}
              />
              Marketplace'te de ara
            </label>
          </div>

          <div className="row">
            <div>
              <label>Yorum sablonu</label>
              <select
                value={rule.commentTemplateId ?? ''}
                onChange={(event) =>
                  void patch(rule, {
                    commentTemplateId: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">(secilmedi)</option>
                {commentTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>DM sablonu</label>
              <select
                value={rule.dmTemplateId ?? ''}
                onChange={(event) =>
                  void patch(rule, {
                    dmTemplateId: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">(secilmedi)</option>
                {dmTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ maxWidth: '8rem' }}>
              <label>Gunluk kota</label>
              <input
                type="number"
                min={0}
                max={500}
                defaultValue={rule.dailyCap}
                onBlur={(event) => void patch(rule, { dailyCap: Number(event.target.value) })}
              />
            </div>
            <div style={{ maxWidth: '10rem' }}>
              <label>Max gonderi yasi (dk)</label>
              <input
                type="number"
                min={1}
                max={1440}
                defaultValue={rule.maxPostAgeMin}
                onBlur={(event) => void patch(rule, { maxPostAgeMin: Number(event.target.value) })}
              />
            </div>
            <div style={{ maxWidth: '10rem' }}>
              <label>Max mesafe (km)</label>
              <input
                type="number"
                min={0.1}
                max={200}
                step={0.5}
                placeholder="sinirsiz"
                defaultValue={rule.maxDistanceKm ?? ''}
                onBlur={(event) =>
                  void patch(rule, {
                    maxDistanceKm: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
              <div className="hint">Bos = filtre yok</div>
            </div>
          </div>

          <label>Gruplar</label>
          <div className="checks">
            {groups.length === 0 && <span className="hint">Once grup ekleyin.</span>}
            {groups.map((group) => (
              <label key={group.id}>
                <input
                  type="checkbox"
                  checked={rule.groupIds.includes(group.id)}
                  onChange={(event) =>
                    void patch(rule, {
                      groupIds: event.target.checked
                        ? [...rule.groupIds, group.id]
                        : rule.groupIds.filter((id) => id !== group.id),
                    })
                  }
                />
                {group.name}
              </label>
            ))}
          </div>
          <div className="hint">
            Grup secimi Marketplace'e uygulanmaz; Marketplace'te yalnizca aciklamasinda bedava
            yazan ilanlar eslesir ve max mesafe arama yaricapi olarak da kullanilir.
          </div>
          <div className="hint">
            Hicbiri secilmezse kural tum aktif gruplara uygulanir. Mesafe filtresi icin
            Ayarlar'da ev konumu secili olmali; konumu metinden cikarilamayan gonderiler
            elenmez (bilinmeyen konum yuzunden firsat kacirmamak icin).
          </div>
        </div>
      ))}
    </>
  );
}
