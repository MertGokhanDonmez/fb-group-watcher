import { useEffect, useState } from 'react';
import { api, type Group, type KeywordProbe, type Rule, type Template } from '../api.ts';
import { parseList } from '../format.ts';

/**
 * Bedava esya gruplarinda satis ve "arayan" ilanlarini elemek icin baslangic seti.
 * Gruplar agirlikli olarak Ingilizce oldugu icin terimler Ingilizce.
 */
const SUGGESTED_EXCLUDES = [
  'for sale',
  'selling',
  'swap',
  'trade',
  'wanted',
  'looking for',
  'iso',
  'rent',
];

/** Ayni terimi iki kez eklemeyi onlemek icin kaba karsilastirma. Otorite sunucudaki matcher. */
function sameTerm(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

interface KeywordEditorProps {
  label: string;
  hint?: string;
  keywords: string[];
  variant?: 'include' | 'exclude';
  onChange: (next: string[]) => void;
}

/**
 * Anahtar kelimeleri virgullu tek metin yerine ayri ayri etiket olarak gosterir.
 * Tek metin alani iki sorun uretiyordu: uzun listede bir terimi gozle bulmak zor,
 * ve yanlislikla bir virgulu silmek iki terimi sessizce tek terime yapistiriyordu.
 */
function KeywordEditor({
  label,
  hint,
  keywords,
  variant = 'include',
  onChange,
}: KeywordEditorProps): JSX.Element {
  const [draft, setDraft] = useState('');

  const commit = (): void => {
    // Virgul/satir ile toplu yapistirma da desteklenir; tek tek eklemek sart degil.
    const incoming = parseList(draft);
    if (incoming.length === 0) return;
    const next = [...keywords];
    for (const term of incoming) {
      if (!next.some((existing) => sameTerm(existing, term))) next.push(term);
    }
    setDraft('');
    if (next.length !== keywords.length) onChange(next);
  };

  return (
    <div>
      <label>
        {label} <span className="badge muted">{keywords.length}</span>
      </label>
      {keywords.length === 0 ? (
        <div className="chip-empty">(bos)</div>
      ) : (
        <div className="chips">
          {keywords.map((keyword) => (
            <span key={keyword} className={`chip${variant === 'exclude' ? ' excluded' : ''}`}>
              {keyword}
              <button
                type="button"
                title={`"${keyword}" kaldir`}
                onClick={() => onChange(keywords.filter((item) => item !== keyword))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={draft}
        placeholder="kelime ekle, Enter"
        style={{ marginTop: '0.4rem' }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
      {hint !== undefined && <div className="hint">{hint}</div>}
    </div>
  );
}

const REASON_LABEL: Record<string, string> = {
  excluded: 'haric tutulan bir kelime veto etti',
  'no-include-match': 'listede karsiligi yok',
  'missing-terms': '"hepsi" modunda diger terimler eksik',
  'empty-rule': 'kuralda hic terim yok',
};

interface KeywordSearchProps {
  onAdd: (ruleId: number, keyword: string) => Promise<void>;
}

/**
 * "bed ekli mi?" sorusunu cevaplar. Sorguyu sunucudaki gercek matcher'a gonderir,
 * cunku eslesme onek tabanli: "bed" listede olmasa da "bedroom" arayan bir kural
 * onu yakalayabilir. Burada ikinci bir eslestirme kopyasi yazmak, panelin bota
 * yalan soylemesi demek olurdu.
 */
function KeywordSearch({ onAdd }: KeywordSearchProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [probe, setProbe] = useState<KeywordProbe | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term === '') {
      setProbe(null);
      setFailed(false);
      return;
    }
    // Her tusa basista istek atmamak icin kisa gecikme.
    const timer = setTimeout(() => {
      api
        .probeKeyword(term)
        .then((result) => {
          setProbe(result);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const term = query.trim();
  const anyMatch = probe?.results.some((item) => item.matched) ?? false;

  return (
    <div className="card">
      <label htmlFor="keyword-search">Kelime ara</label>
      <input
        id="keyword-search"
        type="text"
        value={query}
        placeholder="bed"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="hint">
        Bir kelime yazin: hangi kurallarin yakaladigini gorun. Listede birebir yazmasa
        da yakalanabilir - eslestirme kelime basindan onek ile calisir, yani "bed"
        terimi "bedside" gonderisini de tutar.
      </div>

      {failed && <div className="banner err" style={{ marginTop: '0.7rem' }}>Arama basarisiz.</div>}

      {probe && (
        <div style={{ marginTop: '0.8rem' }}>
          {!anyMatch && (
            <div className="banner warn" style={{ marginBottom: '0.5rem' }}>
              "{probe.query}" hicbir kurala takilmaz.
            </div>
          )}
          {probe.results.map((item) => (
            <div className="probe-row" key={item.ruleId}>
              <span className="name">{item.ruleName}</span>
              {item.matched ? (
                <span className="badge ok">yakalar</span>
              ) : (
                <span className="badge muted">yakalamaz</span>
              )}
              {!item.enabled && <span className="badge warn">kural kapali</span>}
              {item.listedIn === 'include' && <span className="badge">listede</span>}
              {item.listedIn === 'exclude' && <span className="badge err">haric listesinde</span>}
              {item.listedIn === null && item.includeHits.length > 0 && (
                <span className="hint" style={{ display: 'inline' }}>
                  onek: {item.includeHits.join(', ')}
                </span>
              )}
              {item.excludeHits.length > 0 && (
                <span className="hint" style={{ display: 'inline' }}>
                  veto: {item.excludeHits.join(', ')}
                </span>
              )}
              {!item.matched && item.reason !== null && (
                <span className="hint" style={{ display: 'inline' }}>
                  {REASON_LABEL[item.reason] ?? item.reason}
                </span>
              )}
              {item.includeHits.length === 0 && (
                <button
                  className="ghost"
                  style={{ marginLeft: 'auto', padding: '0.25rem 0.6rem' }}
                  onClick={() => void onAdd(item.ruleId, term)}
                >
                  bu kurala ekle
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

  const addKeyword = async (ruleId: number, keyword: string): Promise<void> => {
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) return;
    if (rule.includeKeywords.some((item) => sameTerm(item, keyword))) return;
    await patch(rule, { includeKeywords: [...rule.includeKeywords, keyword] });
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

      <KeywordSearch onAdd={addKeyword} />

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

          <KeywordEditor
            label="Iceren kelimeler"
            keywords={rule.includeKeywords}
            onChange={(next) => void patch(rule, { includeKeywords: next })}
          />
          <KeywordEditor
            label="Haric tutulan kelimeler"
            variant="exclude"
            hint="Bu kelimelerden biri gecerse gonderi eslesmez, iceren kelime tutsa bile."
            keywords={rule.excludeKeywords}
            onChange={(next) => void patch(rule, { excludeKeywords: next })}
          />

          <div className="row">
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
            Hicbiri secilmezse kural tum aktif gruplara uygulanir. Mesafe filtresi icin
            Ayarlar'da ev konumu secili olmali; konumu metinden cikarilamayan gonderiler
            elenmez (bilinmeyen konum yuzunden firsat kacirmamak icin).
          </div>
        </div>
      ))}
    </>
  );
}
