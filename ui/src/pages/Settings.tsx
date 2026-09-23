import { useEffect, useRef, useState } from 'react';
import { api, type Area, type Settings } from '../api.ts';
import { parseList } from '../format.ts';

interface Props {
  onSaved: () => void;
}

interface NumberFieldSpec {
  key: keyof Settings;
  label: string;
  hint: string;
  min: number;
  max: number;
  step?: number;
}

const SAFETY_FIELDS: NumberFieldSpec[] = [
  { key: 'maxActionsPerHour', label: 'Saatte max aksiyon', hint: 'Yorum + DM toplami', min: 0, max: 200 },
  { key: 'maxActionsPerDay', label: 'Gunde max aksiyon', hint: 'Yorum + DM toplami', min: 0, max: 1000 },
  { key: 'minActionGapSec', label: 'Aksiyonlar arasi min bosluk (sn)', hint: 'Uzerine rastgele sapma eklenir', min: 0, max: 86_400 },
  { key: 'quietHoursStart', label: 'Sessiz saat baslangici', hint: '0-23 arasi', min: 0, max: 23 },
  { key: 'quietHoursEnd', label: 'Sessiz saat bitisi', hint: '0-23 arasi', min: 0, max: 23 },
];

const TIMING_FIELDS: NumberFieldSpec[] = [
  { key: 'groupSweepMs', label: 'Grup taramasi tur suresi (ms)', hint: 'Tum gruplar bu sureye yayilir. Uzun = daha az sayfa yuklemesi', min: 60_000, max: 7_200_000, step: 30_000 },
  { key: 'cycleGapMs', label: 'Gruplar arasi min bekleme (ms)', hint: 'Tur suresi kisa kalirsa bu taban devreye girer', min: 500, max: 600_000, step: 500 },
  { key: 'jitterRatio', label: 'Rastgele sapma orani', hint: '0-1. Sabit aralik otomasyonun en belirgin izidir', min: 0, max: 1, step: 0.05 },
  { key: 'selectorHealthThreshold', label: 'Selector alarm esigi', hint: 'Kac bos turdan sonra uyarilsin', min: 1, max: 50 },
  { key: 'heartbeatTimeoutSec', label: 'Yasam sinyali zaman asimi (sn)', hint: 'Bu sure sessiz kalirsa cevrimdisi sayilir', min: 30, max: 3600 },
];

export function SettingsPage({ onSaved }: Props): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const [nextSettings, nextAreas] = await Promise.all([api.getSettings(), api.listAreas()]);
      setSettings(nextSettings);
      setAreas(nextAreas);
    })();
  }, []);

  if (!settings) return <div className="empty">Yukleniyor...</div>;

  const save = async (patch: Partial<Settings>): Promise<void> => {
    setError(null);
    try {
      setSettings(await api.updateSettings(patch));
      setMessage('Kaydedildi');
      setTimeout(() => setMessage(null), 2000);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const telegramTest = async (): Promise<void> => {
    setError(null);
    try {
      await api.telegramTest();
      setMessage('Test mesaji gonderildi - Telegram\'i kontrol edin');
      setTimeout(() => setMessage(null), 4000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  /** Bota en son yazan sohbetin ID'sini sunucuya buldurur ve kaydettirir. */
  const findChat = async (): Promise<void> => {
    setError(null);
    try {
      const token = tokenInput.current?.value.trim() || undefined;
      const found = await api.telegramFindChat(token);
      setSettings(await api.getSettings());
      setMessage(`Chat ID bulundu: ${found.chatId} (${found.name})`);
      setTimeout(() => setMessage(null), 5000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const regenerate = async (): Promise<void> => {
    if (!confirm('Token yenilenirse eklenti baglantisi kopar ve yeni tokeni eklentiye girmeniz gerekir. Devam edilsin mi?')) return;
    const { token } = await api.regenerateToken();
    setSettings({ ...settings, agentToken: token });
  };

  const numberField = (spec: NumberFieldSpec): JSX.Element => (
    <div key={String(spec.key)}>
      <label>{spec.label}</label>
      <input
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        defaultValue={String(settings[spec.key])}
        onBlur={(event) => void save({ [spec.key]: Number(event.target.value) } as Partial<Settings>)}
      />
      <div className="hint">{spec.hint}</div>
    </div>
  );

  return (
    <>
      <h2>Ayarlar</h2>
      <p className="subtitle">Baglanti, bildirim ve guvenlik frenleri.</p>

      {message && <div className="banner info">{message}</div>}
      {error && <div className="banner err">{error}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Eklenti baglantisi</h3>
        <label>Agent token</label>
        <code>{settings.agentToken}</code>
        <div className="hint">
          Bu degeri tarayici eklentisinin secenekler sayfasina yapistirin. Token, localhost'taki
          baska bir sayfanin ajan soketine baglanmasini engeller.
        </div>
        <button className="ghost" style={{ marginTop: '0.7rem' }} onClick={() => void regenerate()}>
          Tokeni yenile
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Telegram bildirimi</h3>
        <div className="row">
          <div>
            <label>Bot token</label>
            <input
              ref={tokenInput}
              type="password"
              defaultValue={settings.telegramBotToken}
              placeholder="BotFather'dan alinan token"
              onBlur={(event) => void save({ telegramBotToken: event.target.value.trim() })}
            />
          </div>
          <div>
            <label>Chat ID</label>
            <input
              // Otomatik bulununca alan yeni degerle yeniden olussun diye key degere bagli.
              key={settings.telegramChatId}
              type="text"
              defaultValue={settings.telegramChatId}
              placeholder="orn. 123456789"
              onBlur={(event) => void save({ telegramChatId: event.target.value.trim() })}
            />
          </div>
        </div>
        <ol className="hint" style={{ paddingLeft: '1.2rem' }}>
          <li>Telegram'da @BotFather'a <code>/newbot</code> yazin; isim ve sonu "bot" ile biten bir kullanici adi verin.</li>
          <li>BotFather'in verdigi tokeni yukaridaki alana yapistirin.</li>
          <li>Telegram'da kendi botunuzu acip <strong>Start</strong>'a basin veya bir mesaj atin (bot size ancak bundan sonra yazabilir).</li>
          <li><strong>Chat ID'yi bul</strong>'a basin: bota en son yazan sohbetin ID'si otomatik kaydedilir.</li>
          <li><strong>Test mesaji gonder</strong> ile dogrulayin.</li>
        </ol>
        <div className="hint">
          Bot yalnizca son 24 saatte gelen mesajlari gorur; bulamazsa bota yeni bir mesaj atip tekrar deneyin.
          Eslesme bildirimi icin kurallarda "Bildirim gonder" secenegi acik olmali.
        </div>
        <div style={{ marginTop: '0.7rem', display: 'flex', gap: '0.6rem' }}>
          <button className="ghost" onClick={() => void findChat()}>
            Chat ID'yi bul
          </button>
          <button className="ghost" onClick={() => void telegramTest()}>
            Test mesaji gonder
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Guvenlik frenleri</h3>
        <div className="hint" style={{ marginBottom: '0.5rem' }}>
          Varsayilanlar bilerek muhafazakar. Bu degerleri yukseltmek ban riskini dogrudan artirir.
        </div>
        <div className="grid">{SAFETY_FIELDS.map(numberField)}</div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Ev konumu</h3>
        <div className="hint" style={{ marginBottom: '0.5rem' }}>
          Mesafe filtresi bunu referans alir. Secilmezse mesafe hesaplanmaz ve
          kurallardaki mesafe kosullari yok sayilir. Bu bilgi yalnizca bu bilgisayarda kalir.
        </div>
        <div className="row">
          <div>
            <label>Bolge</label>
            <select
              value={settings.homeLabel}
              onChange={(event) => {
                const area = areas.find((item) => item.name === event.target.value);
                if (!area) {
                  void save({ homeLabel: '', homeLat: 0, homeLon: 0 });
                  return;
                }
                void save({ homeLabel: area.name, homeLat: area.lat, homeLon: area.lon });
              }}
            >
              <option value="">(secilmedi)</option>
              {areas.map((area) => (
                <option key={area.name} value={area.name}>
                  {area.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ maxWidth: '9rem' }}>
            <label>Enlem</label>
            <input
              type="number"
              step="0.0001"
              value={String(settings.homeLat)}
              onChange={(event) => void save({ homeLat: Number(event.target.value) })}
            />
          </div>
          <div style={{ maxWidth: '9rem' }}>
            <label>Boylam</label>
            <input
              type="number"
              step="0.0001"
              value={String(settings.homeLon)}
              onChange={(event) => void save({ homeLon: Number(event.target.value) })}
            />
          </div>
        </div>
        <div className="hint">
          Daha hassas olmasi icin koordinati elle de girebilirsiniz (Google Maps'te bir
          noktaya sag tiklayip koordinati kopyalayabilirsiniz).
          {settings.homeLat === 0 && settings.homeLon === 0 && (
            <strong> Su an ev konumu ayarlanmamis - mesafe filtresi calismaz.</strong>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Yakalama yontemi</h3>
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={settings.notificationsEnabled}
              onChange={(event) => void save({ notificationsEnabled: event.target.checked })}
            />
            Bildirimler sekmesini izle
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.pauseCollectionInQuietHours}
              onChange={(event) =>
                void save({ pauseCollectionInQuietHours: event.target.checked })
              }
            />
            Sessiz saatlerde taramayi da durdur
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.turkishSuffixMatching}
              onChange={(event) => void save({ turkishSuffixMatching: event.target.checked })}
            />
            Turkce ek eslestirmesi
          </label>
        </div>
        <div className="hint">
          Anahtar kelime eslestirmesi dilden bagimsizdir (aksanlar otomatik sadelestirilir).
          <strong> Turkce ek eslestirmesi</strong> yalnizca Turkce gruplar icin: "koltuk"
          aramasi "koltugu" ile de eslesir. Ingilizce gruplarda KAPALI tutun, aksi halde
          "cat" anahtar kelimesi "cadillac" gibi kelimelerle yanlis eslesir.
        </div>
        <div className="hint">
          Bildirim izleme acikken bot, sabit bir Facebook bildirimler sekmesi acik tutar ve
          sayfayi <strong>yenilemez</strong> - yeni gonderileri Facebook kendisi o sekmeye iter.
          Ana yakalama yolu budur; grup taramasi yalnizca guvenlik agidir. Calismasi icin her
          grubun Facebook ayarlarindan <strong>"Tum gonderiler"</strong> bildirimini acmalisiniz.
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Marketplace</h3>
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={settings.marketplaceEnabled}
              onChange={(event) => void save({ marketplaceEnabled: event.target.checked })}
            />
            Marketplace'i izle
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.marketplaceSearchEnabled}
              onChange={(event) => void save({ marketplaceSearchEnabled: event.target.checked })}
            />
            Yedek anahtar kelime aramalari
          </label>
        </div>
        <div className="grid">
          <div>
            <label>Konum</label>
            <input
              type="text"
              defaultValue={settings.marketplaceLocation}
              onBlur={(event) => void save({ marketplaceLocation: event.target.value.trim() })}
            />
            <div className="hint">Facebook'un sehir kisaltmasi (prague) veya sayisal konum kimligi</div>
          </div>
          <div>
            <label>Aday icin max fiyat</label>
            <input
              type="number"
              min={0}
              max={100_000}
              defaultValue={String(settings.marketplaceMaxPrice)}
              onBlur={(event) => void save({ marketplaceMaxPrice: Number(event.target.value) })}
            />
            <div className="hint">Ustundeki ilanlar hic acilmaz. Bedava karari fiyata bakmaz</div>
          </div>
          <div>
            <label>Genel sayfa araligi (ms)</label>
            <input
              type="number"
              min={120_000}
              max={3_600_000}
              step={60_000}
              defaultValue={String(settings.marketplaceBrowseIntervalMs)}
              onBlur={(event) => void save({ marketplaceBrowseIntervalMs: Number(event.target.value) })}
            />
            <div className="hint">Ana yol. 300000 = 5 dk, her turda tek sayfa</div>
          </div>
          <div>
            <label>Yedek arama araligi (ms)</label>
            <input
              type="number"
              min={900_000}
              max={86_400_000}
              step={300_000}
              defaultValue={String(settings.marketplaceSearchIntervalMs)}
              onBlur={(event) => void save({ marketplaceSearchIntervalMs: Number(event.target.value) })}
            />
            <div className="hint">Her kelime bu surede bir kez aranir. 3600000 = 1 saat</div>
          </div>
        </div>
        <div>
          <label>Genel sayfa adresi (istege bagli)</label>
          <input
            type="text"
            defaultValue={settings.marketplaceBrowseUrl}
            placeholder="Bos = konum ve fiyattan otomatik"
            onBlur={(event) => void save({ marketplaceBrowseUrl: event.target.value.trim() })}
          />
          <div className="hint">
            Otomatik adres dogru sonuc vermezse: tarayicida Marketplace'i acip konumu, max fiyati ve
            "en yeni" siralamasini ayarlayin, adres cubugundaki adresi buraya yapistirin.
          </div>
        </div>
        <div className="row">
          <div>
            <label>Bedava ifadeleri (satir basina bir)</label>
            <textarea
              rows={8}
              defaultValue={settings.marketplaceFreePhrases.join('\n')}
              onBlur={(event) => void save({ marketplaceFreePhrases: parseList(event.target.value) })}
            />
            <div className="hint">Sonu * ile biten ifade onek olarak aranir (daruj* = daruji, darujeme)</div>
          </div>
          <div>
            <label>Bedava sayilmayan kaliplar</label>
            <textarea
              rows={8}
              defaultValue={settings.marketplaceNotFreePhrases.join('\n')}
              onBlur={(event) => void save({ marketplaceNotFreePhrases: parseList(event.target.value) })}
            />
            <div className="hint">Bedava ifadesi aranmadan once metinden silinir (doprava zdarma = kargo bedava)</div>
          </div>
        </div>
        <div className="hint">
          Marketplace kendi sekmesinde calisir. Genel sayfadaki kartlardan yalnizca basligi bir
          kurala uyanlar acilir; yedek aramalar kelimenin yalnizca aciklamada gectigi ilanlar icindir.
          Fiyat alanindaki "Zdarma" / "0 Kč" kanit sayilmaz: ilan yalnizca <strong>aciklamasinda</strong>{' '}
          bedava ifadesi geciyorsa eslesir.
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Tarama zamanlamasi</h3>
        <div className="grid">{TIMING_FIELDS.map(numberField)}</div>
      </div>
    </>
  );
}
