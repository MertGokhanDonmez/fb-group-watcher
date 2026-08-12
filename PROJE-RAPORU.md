# Proje Raporu — FB Grup İzleyici

**Tarih:** 2026-08-10
**Konum:** `C:\Users\Mert\fb-group-watcher`
**Durum:** Faz 0–2 + Telegram bildirimi tamamlandı, çalışır durumda. Faz 3 (otomatik yorum/DM) henüz yok.
**Güncelleme (2026-08-10):** Telegram gönderim katmanı eklendi — eşleşme bildirimi, alarm iletimi, test endpoint'i ve panel butonu. 115 test geçiyor.

---

## 1. Amaç

Belirlenen Facebook gruplarındaki (ağırlıklı Prag'daki bedava eşya grupları) yeni gönderileri
anında yakalamak, anahtar kelime ve mesafeye göre filtrelemek, eşleşince haber vermek. İnsan
eliyle yetişilemeyecek hızda paylaşılan bedava ürünlere ilk ulaşan olmak.

## 2. Neden bu mimari

Meta, Nisan 2024'te Facebook Groups API'sinin grup akışı okuma ve grup adına yazma izinlerini
kaldırdı. Üye olunan rastgele bir grubun akışına resmi API ile **erişim yok**. Tek gerçekçi yol,
kullanıcının kendi giriş yapmış tarayıcı oturumu üzerinden çalışmak. Bu yüzden:

- **Tarayıcı eklentisi (Brave/MV3)** — gerçek oturumda çalışır, otomasyon parmak izi bırakmaz.
- **Yerel Node backend** — kalıcı veri, eşleştirme motoru, konum, güvenlik frenleri, web paneli.
- İkisi `ws://127.0.0.1:8787` üzerinden konuşur. Backend yalnızca loopback'e bind edilir.

### Kabul edilen risk

Bu araç Facebook'un kullanım şartlarına aykırıdır ve hesap kısıtlama riski taşır. Tasarım riski
azaltır (hız limitleri, sessiz saatler, şablon varyantları, engel tespitinde otomatik durdurma,
varsayılan dry-run) ama sıfırlamaz. Yakalama tarafı (okuma) düşük riskli; asıl risk yazma
tarafındadır (Faz 3, henüz yok).

## 3. Yakalama stratejisi — hibrit

Her grubu ayrı ayrı yenilemek saatte ~360 sayfa yüklemesi üretiyordu; insan davranışına benzemez.
Bunun yerine iki katmanlı yaklaşım:

| Katman | Nasıl çalışır | Rol |
|---|---|---|
| **Bildirim sekmesi** | Facebook bildirimler sayfası açık tutulur, **hiç yenilenmez**. Facebook yeni gönderiyi kendi bağlantısı üzerinden açık sekmeye iter, eklenti DOM'u dinler. | Ana yol. Neredeyse sıfır sayfa yüklemesi, anlık gecikme. |
| **Grup taraması** | Gruplar yavaş bir turda (varsayılan 7 dk) gezilir. | Güvenlik ağı. Facebook bazen bildirimleri birleştirdiği için kapsama garantisi verir. |

Bildirim metni kısaltılmış gelir; grup taraması aynı gönderiyi tam metniyle yakalayınca kayıt
**zenginleştirilir** ve — bu inceleme turunda düzeltilen kritik nokta — metin büyüdüyse yeniden
eşleştirmeye sokulur (aksi halde güvenlik ağı postu yakalar ama asla eşleştiremezdi).

**Yük karşılaştırması:** önce ~8.600 sayfa/gün → şimdi ~765 (sessiz saatler dahil).

## 4. Bileşenler

```
shared/                 Backend + eklenti ortak protokolü, FB URL yardımcıları
server/src/
  db/                   node:sqlite (native derleme yok), migration
  repo/                 Veri erişimi: groups, rules, templates, posts, matches, actions, settings, events
  agent/                Eklenti WebSocket hub'ı + ajan durumu
  matcher/              Dil-bağımsız normalizasyon + kural eşleştirme
  location/             Prag semt sözlüğü + mesafe hesabı
  routes/               REST API + SSE
  ingest.ts             Gelen postları işleme, konum çıkarma, zenginleştirme
  pipeline.ts           Yeni postları kurallardan geçirme
  safety/               Sessiz saatler / duraklatma
  watchdog.ts           Bot sessizce ölürse Telegram/panel uyarısı, veri temizliği
extension/src/
  content/              FB DOM ayrıştırma — TÜM seçiciler selectors.ts'de
  background.ts         Soket bağlantısı, iki-sekme yönetimi, grup gezme döngüsü
ui/src/                 React yönetim paneli (6 sayfa)
```

**Ölçek:** ~5.365 satır kaynak + ~941 satır test, 52 kaynak dosyası, 115 test.

## 5. Öne çıkan tasarım kararları

- **node:sqlite** (Node 24 yerleşik) — Windows'ta native derleme / Visual Studio Build Tools
  derdi yok. `better-sqlite3` yerine tercih edildi.
- **Tek seçici dosyası** (`extension/src/content/selectors.ts`) — Facebook DOM'u değiştiğinde
  onarılacak tek yer. Yalnızca yapısal/attribute seçiciler (`role`, `aria-*`, `href` kalıpları,
  `data-ad-preview`); obfuscated CSS sınıf isimlerine asla dayanılmaz.
- **Selector sağlık alarmı** — üst üste N turda 0 post ayrıştırılamazsa panel + günlük uyarısı.
  Botun sessizce ölmesi en olası arıza; buna karşı özel koruma.
- **Dil-bağımsız eşleştirme** — Unicode NFD tabanlı normalizasyon. İngilizce, Çekçe, Türkçe,
  Lehçe aynı mekanizmayla (`křeslo`→`kreslo`). Türkçe ek yumuşatması opsiyonel ve **kapalı**
  (açık olsa İngilizcede `cat`→`cadillac` yanlış eşleşmesi olurdu).
- **Konum filtresi dış servissiz** — 47 Prag bölgesi gömülü koordinatlarla; metinden semt
  çıkarılıp eve kuş uçuşu mesafe (haversine). Çevrimdışı, anlık, hız limiti yok.
- **Konumu bilinmeyen gönderiler elenmez** — bilinmeyen konum yüzünden fırsat kaçırmak, uzak
  ilanı görmekten kötü.
- **Örnek kimliği (instanceId)** — eklentinin iki kopyası yüklüyse birbirini sonsuza dek
  düşürüyordu; artık ikinci kopya reddedilir, mevcut bağlantı korunur.

## 6. Güvenlik frenleri (hepsi panelden ayarlanır)

- Saatte / günde maksimum aksiyon, aksiyonlar arası minimum boşluk + jitter
- Sessiz saatler (varsayılan 01:00–08:00) — **taramayı da** durdurur
- Grup başına günlük kota, kural başına günlük kota
- `dry_run` varsayılan **açık** — her şey çalışır, aksiyon gönderilmez
- Kill switch (panel + otomatik)
- Engel/checkpoint/captcha tespitinde otomatik durdurma + alarm

## 7. Bu inceleme turunda yapılan düzeltmeler

1. **Zenginleştirme sonrası yeniden eşleştirme (gerçek hata):** Bildirimden gelen kısaltılmış
   metin bir anahtar kelimeyi kaçırırsa, grup taraması tam metni yakalıyor ama post matcher'a
   girmiyordu — güvenlik ağı işlevsizdi. `enrichPost` artık metnin büyüyüp büyümediğini bildiriyor;
   büyüdüyse post yeniden eşleştiriliyor. UNIQUE(post_id, rule_id) sayesinde tekrar eşleşme
   üretilmez. Regresyon testi eklendi.
2. **Şablon değişken tutarlılığı:** İngilizce şablonlarda Türkçe değişken adları vardı
   (`{{yazar_adi}}`); İngilizceye çevrildi (`{{author}}`, `{{group}}`, `{{location}}`).

Not: Önceki turlarda düzeltilen büyük hatalar — grup silme (Content-Type/boş gövde), eklenti
bağlantı döngüsü, bildirim ayrıştırıcının sadece zaman damgası alması, Türkçe varsayımı — hepsi
regresyon testleriyle kilitlendi.

## 8. Test durumu

```
10 dosya, 115 test, hepsi geçiyor
```

- `matcher` — dil-bağımsız normalizasyon, kelime sınırı, include/exclude, regex, yaş
- `location` — semt çıkarma (aksanlı/aksansız/numaralı), mesafe, özel-vs-genel öncelik
- `pipeline` — uçtan uca yakalama→eşleştirme, dedupe, mesafe, zenginleştirme sonrası eşleştirme
- `notifications` / `parse` — DOM ayrıştırma, `role="listitem"` olmadan kapsayıcı bulma
- `agent` — el sıkışma, token, protokol sürümü, yinelenen kopya reddi
- `routes` / `repo` — API, gövdesiz istekler, dedupe, kotalar

**typecheck artık test dosyalarını da kapsıyor** — bu tur iki gerçek hatayı derleme anında yakaladı.

## 9. Eksikler / sıradaki işler

| Öncelik | İş | Not |
|---|---|---|
| ~~Yüksek~~ | ~~**Telegram bildirimi**~~ | **TAMAMLANDI (2026-08-10).** `server/src/notify/telegram.ts`: eşleşme anında telefona mesaj (kuralda "Bildirim gönder" açıksa), hata alarmlarının iletimi (eklenti çevrimdışı, selector bozulması, engel tespiti — aynı alarm 30 dk içinde tekrarlanmaz), panelde "Test mesajı gönder" butonu (`POST /api/settings/telegram-test`). Gönderimler `telegram` türü aksiyon kaydı olarak History'de görünür. Facebook'a dokunmadığı için dry-run'dan etkilenmez; kill switch'e uyar. 12 yeni test. |
| Yüksek | **Faz 3: otomatik yorum** | En riskli parça. Sıra: dry-run → Telegram onaylı yarı otomatik → tam otomatik. Şablon render'ı (`{{author}}` vb.) burada tanımlanacak. |
| Orta | Faz 3: otomatik DM | Opt-in, varsayılan kapalı. |
| Orta | Açılışta otomatik başlatma | Hedef platform Linux'a değişti (2026-08-10): systemd kullanıcı servisi (`systemctl --user enable`). Not: eklenti gerçek tarayıcı oturumu gerektirdiği için makinede masaüstü ortamı + oturum açık Brave/Chromium şart; backend headless sunucuya taşınamaz. |
| Düşük | Git deposu | `git init` yapıldı, commit yok. Kullanıcı kimliği (`user.name`/`email`) tanımlı değil, `gh` CLI kurulu değil. Private depo isteniyor. |
| Düşük | Sokak seviyesi geocoding | Şu an semt merkezi hassasiyeti (±1 km). Daha hassası dış servis gerektirir. |

## 10. Bilinen sınırlamalar

- **Parser gerçek DOM'a bağımlı.** Facebook sayfa yapısını değiştirirse ayrıştırıcı bozulur;
  onarım noktası tek dosya (`selectors.ts`) ve sağlık alarmı var, ama bir tur ayar gerekebilir.
- **Bildirim birleştirme.** Facebook "X ve 3 kişi paylaştı" derse bazı gönderiler bildirimde
  görünmez; grup taraması güvenlik ağı bunun için var.
- **Brave Shields** facebook.com için kapalı olmalı, yoksa fingerprint koruması ayrıştırıcıyı
  bozabilir.
- **Tek eklenti örneği.** Aynı anda tek bağlantı kabul edilir (bilinçli tasarım).

## 11. Çalıştırma

```bash
cd C:\Users\Mert\fb-group-watcher
npm install
npm run build      # UI + eklenti + sunucu
npm start          # http://127.0.0.1:8787

npm test           # 115 test
npm run typecheck  # üç paket, testler dahil
node scripts/status.mjs   # canlı durum teşhisi
```

Eklenti: `brave://extensions` → Geliştirici modu → Paketlenmemiş öğe yükle → `extension\dist`.
Token panelin Ayarlar sayfasında. Detaylar `README.md`'de.
