import { useEffect, useState } from 'react';
import { api, type Template } from '../api.ts';
import { parseLines } from '../format.ts';

// Faz 3'te (yorum/DM gonderimi) render edilecek degiskenler.
const VARIABLES = ['{{author}}', '{{group}}', '{{location}}'];

export function Templates(): JSX.Element {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'comment' | 'dm'>('comment');
  const [variants, setVariants] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => setTemplates(await api.listTemplates());

  useEffect(() => {
    void reload();
  }, []);

  const add = async (): Promise<void> => {
    setError(null);
    try {
      await api.createTemplate({ name, kind, variants: parseLines(variants) });
      setName('');
      setVariants('');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action();
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const saveVariants = (template: Template, value: string): Promise<void> =>
    run(() => api.updateTemplate(template.id, { variants: parseLines(value) }));

  const remove = (template: Template): Promise<void> => {
    if (!confirm(`"${template.name}" sablonu silinsin mi?`)) return Promise.resolve();
    return run(() => api.deleteTemplate(template.id));
  };

  return (
    <>
      <h2>Sablonlar</h2>
      <p className="subtitle">Gonderilecek yorum ve mesaj metinleri.</p>

      <div className="banner info">
        Her sablon birden fazla <strong>varyant</strong> icermeli. Bot her gonderimde rastgele birini
        secer; ayni metnin tekrar tekrar yazilmasi Facebook'un gordugu en net spam sinyalidir.
      </div>

      <div className="card">
        <div className="row">
          <div>
            <label htmlFor="tpl-name">Sablon adi</label>
            <input id="tpl-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div style={{ maxWidth: '10rem' }}>
            <label htmlFor="tpl-kind">Tur</label>
            <select
              id="tpl-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'comment' | 'dm')}
            >
              <option value="comment">Yorum</option>
              <option value="dm">DM</option>
            </select>
          </div>
        </div>
        <label htmlFor="tpl-variants">Varyantlar (her satir bir varyant)</label>
        <textarea
          id="tpl-variants"
          value={variants}
          placeholder={'Ilgileniyorum, hala duruyor mu?\nMerhaba, hala mevcutsa ben alabilirim.'}
          onChange={(event) => setVariants(event.target.value)}
        />
        <div className="hint">Kullanilabilir degiskenler: {VARIABLES.join(' ')}</div>
        <button
          className="primary"
          style={{ marginTop: '0.8rem' }}
          disabled={name.trim() === '' || parseLines(variants).length === 0}
          onClick={() => void add()}
        >
          Sablon ekle
        </button>
        {error && <div className="banner err" style={{ marginTop: '0.85rem' }}>{error}</div>}
      </div>

      {templates.map((template) => (
        <div className="card" key={template.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>
              {template.name}{' '}
              <span className="badge muted">{template.kind === 'comment' ? 'yorum' : 'dm'}</span>
            </strong>
            <button className="danger" onClick={() => void remove(template)}>
              Sil
            </button>
          </div>
          <textarea
            defaultValue={template.variants.join('\n')}
            onBlur={(event) => void saveVariants(template, event.target.value)}
          />
          <div className="hint">
            {template.variants.length} varyant. Degisiklik alandan cikinca kaydedilir.
            {template.variants.length < 2 && (
              <strong> Tek varyant riskli - en az 2-3 farkli metin girin.</strong>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
