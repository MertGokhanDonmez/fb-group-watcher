# FB Grup Izleyici

Belirlenen Facebook gruplarindaki yeni gonderileri kronolojik akistan izler, anahtar
kelimelere gore eslestirir ve bildirim gonderir. Yonetim yerel bir web panelinden yapilir.

## Nasil calisiyor

Meta, Nisan 2024'te Groups API'sinin feed okuma ve grup adina yazma izinlerini kaldirdi;
uye olunan rastgele bir grubun akisina resmi API ile erisim yok. Bu yuzden mimari, kendi
giris yapmis tarayici oturumun uzerinden calisiyor:

```
Tarayici (senin profilin)
 └─ MV3 eklentisi, iki sekme kullanir:
     ├─ bildirim sekmesi - hic gezinmez, hic yenilenmez.
     │                     Facebook yeni gonderileri acik sekmeye kendisi iter,
     │                     eklenti sadece DOM'u dinler. ANA yakalama yolu.
     ├─ calisma sekmesi  - gruplari yavas bir turda gezer (guvenlik agi).
     └─ WebSocket ile backend'e baglanir
            ▲                     │
            │ komut          olay │
            ▼                     ▼
Node backend (127.0.0.1:8787)
     ├─ eslestirme motoru, sablonlar, guvenlik frenleri
     ├─ SQLite (data/watcher.db)
     └─ web paneli + canli olay akisi (SSE)
```

### Neden bildirim sekmesi?

Her grubu ayri ayri yenilemek cok fazla sayfa yuklemesi uretir - bes grupla saatte
~360, gunde binlerce. Bu profil insan davranisina benzemez.

Bunun yerine her grup icin Facebook'ta **"Tum gonderiler"** bildirimi acilir ve bot
tek bir bildirimler sekmesini acik tutar. Sayfa yenilenmez; Facebook yeni gonderiyi
zaten acik sekmeye kendisi iter. Sonuc: sayfa yuklemesi neredeyse sifir, gecikme
neredeyse yok ve olusan trafik "Facebook'u sekmede acik birakmis kullanici"dan
ayirt edilemez.

Grup taramasi tamamen kalkmiyor ama artik yavas bir guvenlik agi: Facebook bazen
bildirimleri birlestirdigi ("X ve 3 kisi paylasti") icin tam kapsama garanti degil.
Varsayilan tur suresi 7 dakika ve tum gruplar bu sureye esit yayilir.

## Uyari

Bu arac Facebook'un kullanim sartlarina aykiridir ve hesap kisitlama riski tasir.
Tasarim bu riski azaltir (hiz limitleri, sessiz saatler, sablon varyantlari, engel
tespitinde otomatik durdurma, varsayilan dry-run) ama sifirlamaz. Otomatik gonderim
ozelligini acmadan once ikincil bir hesapla test etmek onerilir.

## Kurulum

Gereksinim: Node.js 22.5+ (yerlesik `node:sqlite` icin) ve Chromium tabanli bir
tarayici 116+ (Brave, Edge veya Chrome - eklenti ucunde de calisir, kod ayni).

```bash
npm install
npm run build        # UI + eklenti + sunucu
npm start            # http://127.0.0.1:8787
```

Sunucu ilk acilista bir **agent token** uretir ve konsola yazar.

### Hangi tarayici?

Belirleyici kriter **Facebook oturumunun zaten acik oldugu** tarayicidir. Yeni bir
tarayiciya veya yeni bir profile giris yapmak Facebook icin "yeni cihaz" demektir ve
dogrulama/checkpoint tetikleyebilir - yani tam da kacinmak istedigimiz sey.

### Eklentiyi yukleme

1. `npm run build:ext` (veya `npm run build`) calistir - cikti `extension/dist`
2. Tarayicida eklenti sayfasini ac: `brave://extensions` / `edge://extensions` / `chrome://extensions`
3. **Gelistirici modu**nu ac
4. **Paketlenmemis ogeyi yukle** > `extension/dist` klasorunu sec
5. Eklentinin **Ayrintilar > Uzanti secenekleri** sayfasini ac
6. Panelin Ayarlar sayfasindaki agent tokeni yapistirip kaydet

Panelde **Eklenti: Cevrimici** rozetini gordugunde baglanti kurulmustur.

### Gruplarda bildirimi acmak (sart)

Bildirim izleme yalnizca Facebook sana bildirim gonderiyorsa ise yarar. Her izlenen grup icin:

1. Grubun sayfasini ac
2. **Bildirimler** (zil) menusu > **Tum gonderiler** secenegini isaretle

Bunu yapmazsan bot yalnizca yavas grup taramasina duser ve gecikme artar.

### Brave kullaniyorsan

Brave'in Shields katmani Facebook'ta iki soruna yol acabilir:

- **Fingerprint korumasi ve script engelleme** sayfa davranisini degistirebilir; bu hem
  ayristiriciyi bozabilir hem de Facebook'un anomali tespitini tetikleyebilir.
  Cozum: facebook.com'dayken adres cubugundaki Brave (aslan) simgesine tikla ve
  **Shields'i bu site icin kapat**. Ayar site bazinda kalicidir.
- **Yerel ag istekleri.** Options sayfasi "panele ulasilamadi" diyor ama `npm start`
  calisiyorsa, Brave'in yerel ag engellemesine bakilmali
  (`brave://settings/shields` ve `brave://flags` > private network requests).

## Servis olarak calistirma (Linux)

`npm start`'i terminalden calistirirsan terminal kapaninca surec olmez, arka planda
sahipsiz kalir (bash'te `huponexit` kapali, systemd'de `KillUserProcesses=no`) — ama onu
durdurmak icin PID avlamak gerekir. Acilista otomatik baslamasi ve duzgun
durdurulabilmesi icin systemd --user servisi:

`~/.config/systemd/user/fb-group-watcher.service`

```ini
[Unit]
Description=fb-group-watcher sunucusu
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/gokhan/Desktop/Projects/fb-group-watcher
ExecStart=/home/gokhan/.local/node/bin/node server/dist/index.js
Environment=NODE_ENV=production
Environment=FBW_PORT=8787
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`ExecStart` **tam yol** ister — systemd kabugun `PATH`'ini miras almaz (`which node`).
Servis `server/dist/index.js`'i calistirir; kaynagi degistirdiginde once
`npm run build:server`, sonra `systemctl --user restart fb-group-watcher`.

```bash
systemctl --user daemon-reload
systemctl --user enable --now fb-group-watcher   # simdi baslat + acilista da basla
systemctl --user status fb-group-watcher
systemctl --user restart fb-group-watcher
systemctl --user stop fb-group-watcher
journalctl --user -u fb-group-watcher -f         # canli log
```

Oturumu kapattiginda da calismasi icin bir kez `loginctl enable-linger $USER`
(`loginctl show-user "$USER" -p Linger` → `yes` olmali).

Ayarlanabilir ortam degiskenleri: `FBW_PORT` (8787), `FBW_DB` (`data/watcher.db`),
`FBW_LOG_LEVEL` (`warn`).

## Gelistirme

```bash
npm run dev          # sunucu (watch) + Vite UI (5173) + eklenti (watch)
npm test             # birim ve fixture testleri
npm run typecheck    # uc paketin tamami
```

Dev modda panel http://127.0.0.1:5173 adresinde acilir; `/api` istekleri 8787'ye
proxy'lenir, boylece CORS'a gerek kalmaz ve uretimdeki davranisla ayni olur.

### Eklentisiz tani araci

```bash
node scripts/agent-smoke.mjs
```

Eklentiyi taklit ederek backend'e baglanir, sahte bir gonderi gonderir ve dedupe'un
calistigini dogrular. Bir sorun ciktiginda "backend mi bozuk, eklenti mi?" sorusunu
ayirmanin en hizli yolu budur.

## Facebook sayfa yapisi degisirse

Bu projede en olasi ariza, Facebook'un DOM'unu degistirmesi ve botun sessizce hicbir
gonderi bulamamasidir. Buna karsi iki koruma var:

1. **Tek onarim noktasi.** Tum secililer `extension/src/content/selectors.ts` icinde.
   Yalnizca yapisal/attribute tabanli secililer kullanilir (`role`, `aria-*`, `href`
   kaliplari, `data-ad-preview`); obfuscated sinif isimlerine asla dayanilmaz.
2. **Saglik alarmi.** Ust uste birkac turda hic gonderi ayristirilamazsa panel uyari
   gosterir ve sistem gunlugune hata yazilir.

Onarim icin gercek bir snapshot al:

1. Chrome'da grubu kronolojik gorunumde ac
2. DevTools > Elements > `<html>` uzerinde sag tik > Copy > Copy outerHTML
3. `extension/test/fixtures/` altina kaydet ve `parse.test.ts` icinde referans ver

Boylece onarim sirasinda testler rehber olur.

## Proje yapisi

| Yol | Icerik |
| --- | --- |
| `shared/` | Backend ve eklentinin paylastigi protokol ve URL yardimcilari |
| `server/src/repo/` | SQLite veri erisimi |
| `server/src/agent/` | Eklenti soketi ve ajan durumu |
| `server/src/routes/` | REST API ve SSE |
| `extension/src/content/` | Facebook DOM ayristirma (secililer burada) |
| `extension/src/background.ts` | Soket baglantisi ve grup gezinme dongusu |
| `ui/src/` | Yonetim paneli |

## Durum

- **Faz 0-1 tamam:** toplama, dedupe, panel, canli akis, saglik izleme
- **Faz 2 tamam:** eslestirme motoru, konum filtresi, Telegram bildirimi (eslesme + alarm iletimi)
- **Faz 3 (siradaki):** otomatik yorum (once dry-run, sonra onayli, sonra tam otomatik)
- **Faz 4:** DM, sertlestirme (acilista otomatik baslatma tamam — bkz. *Servis olarak calistirma*)
