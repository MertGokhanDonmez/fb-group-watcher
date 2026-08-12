// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseArticle, parseFeed, parseRelativeTimeLabel, readableText } from '../src/content/parse.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fixture'i Chrome'un kuracagi agacin AYNISI olacak sekilde yukler.
 *
 * Facebook profil baglantilarini ic ice <a> olarak yaziyor. HTML ayristiricisi
 * normalde ikinci <a>'yi gorunce distakini kapatir ("adoption agency"); Facebook
 * bunu <object type="nested/pressable"> sarmalayicisiyla engelliyor cunku <object>
 * etkin bicimlendirme listesine bir sinir isareti koyar. happy-dom o isareti
 * uygulamiyor: gercek snapshot'ta agac yeniden sekilleniyor ve akisin ucte ikisi
 * feed'in disina tasiniyor.
 *
 * Icerik script'i gercek tarayicida hazir DOM'u okur, HTML'i yeniden ayristirmaz -
 * yani bu yalnizca test ortaminin kisiti. Baglari once bicimlendirme ogesi OLMAYAN
 * gecici bir etiketle ayristirip sonra <a>'ya cevirerek dogru agaci elde ediyoruz.
 */
function loadFixture(name: string): Document {
  const html = fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');
  const doc = document.implementation.createHTMLDocument('fixture');
  doc.body.innerHTML = html.replace(/<a(\s|>)/g, '<a-link$1').replace(/<\/a>/g, '</a-link>');

  for (const placeholder of Array.from(doc.querySelectorAll('a-link'))) {
    const anchor = doc.createElement('a');
    for (const attr of Array.from(placeholder.attributes)) anchor.setAttribute(attr.name, attr.value);
    while (placeholder.firstChild) anchor.appendChild(placeholder.firstChild);
    placeholder.replaceWith(anchor);
  }
  return doc;
}

describe('parseRelativeTimeLabel', () => {
  const now = new Date('2026-08-09T12:00:00Z').getTime();

  it('Turkce kisaltmalari cozer', () => {
    expect(parseRelativeTimeLabel('2 dk', now)).toBe(now - 2 * 60_000);
    expect(parseRelativeTimeLabel('5 sa', now)).toBe(now - 5 * 3_600_000);
    expect(parseRelativeTimeLabel('3 g', now)).toBe(now - 3 * 86_400_000);
    expect(parseRelativeTimeLabel('45 sn', now)).toBe(now - 45_000);
  });

  it('Turkce uzun birimleri cozer', () => {
    expect(parseRelativeTimeLabel('12 dakika', now)).toBe(now - 12 * 60_000);
    expect(parseRelativeTimeLabel('2 saat', now)).toBe(now - 2 * 3_600_000);
    expect(parseRelativeTimeLabel('4 gün', now)).toBe(now - 4 * 86_400_000);
  });

  it('CSS ile ters cevrilmis etiketi duzeltir', () => {
    // Facebook karakterlerin gorsel sirasini karistiriyor: DOM'da "h19" duran
    // etiket ekranda "19h". Birim basa gecmisse siralama bozulmustur.
    expect(parseRelativeTimeLabel('h19', now)).toBe(now - 19 * 3_600_000);
    expect(parseRelativeTimeLabel('dk46', now)).toBe(now - 46 * 60_000);
    // Bilinmeyen bir onek ters cevrilse bile birim olmadigi icin cozulmez.
    expect(parseRelativeTimeLabel('aug19', now)).toBeNull();
  });

  it('Ingilizce arayuzu de destekler', () => {
    expect(parseRelativeTimeLabel('7 m', now)).toBe(now - 7 * 60_000);
    expect(parseRelativeTimeLabel('3 hours', now)).toBe(now - 3 * 3_600_000);
    expect(parseRelativeTimeLabel('just now', now)).toBe(now);
  });

  it('saniye ve saat kisaltmalarini karistirmaz', () => {
    // 'sa' ile 'saniye' ayni harflerle basliyor; sira hatasi burada yakalanir.
    expect(parseRelativeTimeLabel('1 saniye', now)).toBe(now - 1000);
    expect(parseRelativeTimeLabel('1 saat', now)).toBe(now - 3_600_000);
  });

  it('ozel gun etiketlerini cozer', () => {
    expect(parseRelativeTimeLabel('Dün', now)).toBe(now - 86_400_000);
    expect(parseRelativeTimeLabel('şimdi', now)).toBe(now);
  });

  it('cozemedigi etiketlerde null doner', () => {
    expect(parseRelativeTimeLabel('9 Ağustos 2026', now)).toBeNull();
    expect(parseRelativeTimeLabel('', now)).toBeNull();
  });
});

describe('readableText', () => {
  it('blok elemanlarini satir sonuyla ayirir', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<div><div>bedava koltuk</div><div>alan gelsin</div></div>';
    // textContent kullanilsaydi "bedava koltukalan gelsin" cikardi ve
    // kelime siniri eslestirmesi bozulurdu.
    expect(readableText(doc.body)).toBe('bedava koltuk\nalan gelsin');
  });
});

describe('parseArticle - yorum linki koruması', () => {
  it('comment_id tasiyan linki gonderi linki olarak secmez', () => {
    // Regresyon: one cikan yorumun kalici baglantisi da /posts/<id>/ kalibina uyar.
    // Once o gelirse zaman etiketi yorumdan okunur ve gonderi yasi yanlis cikar.
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = `
      <div role="article">
        <span><a href="/groups/bedava-esya/user/111/">Ali Veli</a></span>
        <a href="/groups/bedava-esya/posts/999000444/?comment_id=5"><span>1 sa</span></a>
        <a href="/groups/bedava-esya/posts/999000444/"><span>2 dk</span></a>
        <div data-ad-preview="message">bedava masa, alan gelsin</div>
      </div>`;
    const article = doc.querySelector<HTMLElement>('div[role="article"]')!;
    const post = parseArticle(article, 'bedava-esya');

    expect(post).not.toBeNull();
    expect(post!.postedAtLabel).toBe('2 dk'); // yorumun '1 sa' etiketi degil
    expect(post!.permalink).toBe('https://www.facebook.com/groups/bedava-esya/posts/999000444/');
  });
});

describe('parseFeed', () => {
  const doc = loadFixture('group-feed.html');
  const result = parseFeed(doc, 'bedava-esya');

  it('yorumlari gonderi saymaz, kalici baglantisi olmayani eler', () => {
    // Fixture'da 3 ust duzey gonderi var; ucuncusunun permalink'i yok.
    expect(result.stats.articlesSeen).toBe(3);
    expect(result.posts).toHaveLength(2);
    expect(result.stats.failures).toBe(1);
  });

  it('kalici baglantiyi takip parametrelerinden arindirir', () => {
    expect(result.posts[0]!.permalink).toBe(
      'https://www.facebook.com/groups/bedava-esya/posts/1234567890/',
    );
    expect(result.posts[0]!.fbPostId).toBe('1234567890');
  });

  it('yazari cikarir, yorum yazarini yazar sanmaz', () => {
    expect(result.posts[0]!.authorName).toBe('Ayşe Yılmaz');
    expect(result.posts[0]!.authorUserId).toBe('100001');
  });

  it('gonderi metnini alir, yorum metnini karistirmaz', () => {
    expect(result.posts[0]!.text).toContain('Bedava koltuk veriyorum');
    expect(result.posts[0]!.text).toContain('Kadıköy');
    expect(result.posts[0]!.text).not.toContain('Ben ilgileniyorum');
  });

  it('data-ad-preview yoksa yedek metin stratejisine duser', () => {
    expect(result.posts[1]!.text).toContain('Ücretsiz buzdolabı');
    expect(result.posts[1]!.authorName).toBe('Zeynep Kaya');
  });

  it('urun gorselini alir, avatari almaz', () => {
    expect(result.posts[0]!.imageUrls).toEqual(['https://scontent.xx.fbcdn.net/koltuk.jpg']);
  });

  it('goreli zamani epoch degerine cevirir', () => {
    expect(result.posts[0]!.postedAtLabel).toBe('2 dk');
    expect(result.posts[0]!.postedAt).not.toBeNull();
    expect(result.posts[1]!.postedAtLabel).toBe('1 sa');
  });
});

describe('parseArticle', () => {
  it('kalici baglanti yoksa null doner (dedupe anahtari uretilemez)', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<div role="article"><div dir="auto">permalinksiz icerik</div></div>';
    const article = doc.querySelector<HTMLElement>('[role="article"]')!;
    expect(parseArticle(article, 'grup')).toBeNull();
  });
});

/**
 * Gercek snapshot (Agustos 2026, free.stuff.in.prague).
 *
 * Bu turdaki bir dosya elle sadelestirilmis fixture'in yakalayamadigi seyleri
 * yakalar: gonderilerde role="article" yok, zaman damgasi tuzak karakterlerle
 * obfuscate edilmis, akisin cogu sanallastirilmis bos kutulardan olusuyor.
 *
 * Dosya .gitignore'da: icinde grup uyelerinin gercek isimleri ve gonderileri var.
 * Bu yuzden blok, snapshot yoksa ATLANIR - onarim yapan kisi kendi snapshot'ini
 * `extension/test/fixtures/group-real-<tarih>.html` olarak kaydedip calistirir.
 * Alma yontemi group-feed.html'in basindaki yorumda anlatiliyor.
 */
const REAL_SNAPSHOT = 'group-real-2026-08.html';
const hasRealSnapshot = fs.existsSync(path.join(here, 'fixtures', REAL_SNAPSHOT));

describe.skipIf(!hasRealSnapshot)('parseFeed - gercek snapshot', () => {
  // Yukleme beforeAll'da: describe govdesi blok atlansa bile toplama sirasinda
  // calisir, dosyayi orada okumak snapshot yokken tum dosyayi cokertirdi.
  let doc: Document;
  let result: ReturnType<typeof parseFeed>;
  beforeAll(() => {
    doc = loadFixture(REAL_SNAPSHOT);
    result = parseFeed(doc, 'free.stuff.in.prague');
  });

  /**
   * Beklenen degerler snapshot'tan TURETILIYOR, teste yazilmiyor.
   *
   * Snapshot repoda degil (gercek kisilerin isim ve gonderileri), dolayisiyla
   * "yazar adi X olmali" gibi bir iddia hem burada kisisel veri tutardi hem de
   * baskasinin kendi snapshot'iyla calistiramayacagi bir test olurdu. Bunun
   * yerine parser'in ciktisini DOM'daki kaynak dugumle karsilastiriyoruz -
   * hangi snapshot verilirse verilsin gecerli, ustelik daha guclu bir iddia.
   */
  const nodeTexts = (selector: string): string[] =>
    Array.from(doc.querySelectorAll<HTMLElement>(selector)).map((node) => readableText(node));

  it('role=article olmadan gonderileri bulur', () => {
    // Sayfada 10 aria-posinset yuvasi var ama yalnizca 3'u render edilmis;
    // role="article" tasiyan 6 dugumun hepsi yorum ya da yukleniyor gostergesi.
    expect(result.stats.articlesSeen).toBe(3);
    expect(result.posts).toHaveLength(3);
    expect(result.stats.failures).toBe(0);
  });

  it('post id\'yi yorum ve fotograf baglantilarindan kurtarir', () => {
    // Gonderinin kendi kalici baglantisi artik post id tasimiyor; buna ragmen
    // her gonderi benzersiz sayisal bir id ve ondan kurulmus permalink almali.
    const ids = result.posts.map((post) => post.fbPostId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const post of result.posts) {
      expect(post.fbPostId).toMatch(/^\d+$/);
      expect(post.permalink).toBe(
        `https://www.facebook.com/groups/free.stuff.in.prague/posts/${post.fbPostId}/`,
      );
    }
  });

  it('yazari yazar blogundan okur', () => {
    const blocks = nodeTexts('[data-ad-rendering-role="profile_name"]');
    expect(blocks).toHaveLength(result.posts.length);
    result.posts.forEach((post, index) => {
      // Yazar blogu bazen "<Ad> is in <Yer>." seklinde ek metin tasiyor;
      // parser yalnizca profil linkini almali, yani blogun bir onekini.
      expect(post.authorName).not.toBeNull();
      expect(blocks[index]).toContain(post.authorName!);
      expect(post.authorUserId).toMatch(/^\d+$/);
    });
  });

  it('yorum yazarini gonderi yazari sanmaz', () => {
    const commentAuthors = nodeTexts('[data-commentid] a[href*="/user/"]')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    expect(commentAuthors.length).toBeGreaterThan(0);
    for (const post of result.posts) {
      expect(commentAuthors).not.toContain(post.authorName);
    }
  });

  it('metni gonderinin kendi story_message blogundan alir', () => {
    // Uc gonderinin yalnizca ikisinde data-ad-preview var; ucu de metin almali.
    const blocks = nodeTexts('[data-ad-rendering-role="story_message"]');
    expect(blocks).toHaveLength(result.posts.length);
    result.posts.forEach((post, index) => {
      expect(post.text).toBe(blocks[index]);
      expect(post.text.length).toBeGreaterThan(20);
    });
  });

  it('obfuscate edilmis zaman damgasindan tuzak karakterleri temizler', () => {
    /*
     * Ham textContent burada onlarca sahte harften olusan bir cop uretiyor.
     * postedAtLabel bilerek HAM etiketi saklar (teshis icin) - bu snapshot'ta
     * ikisi CSS ile ters cevrilmis geliyor ("h19"), duzeltme postedAt
     * hesaplanirken yapiliyor. Etiketin kisa kalmasi tuzaklarin elendiginin,
     * postedAt'in dolu olmasi da ters cevirmenin cozuldugunun kanitidir.
     */
    for (const post of result.posts) {
      expect(post.postedAtLabel).toMatch(/^[a-zçğıöşü]*\s?\d+\s?[a-zçğıöşü]*$/i);
      expect(post.postedAtLabel!.length).toBeLessThan(8);
      expect(post.postedAt).not.toBeNull();
    }
  });

  it('urun gorsellerini alir, avatar ve emojileri almaz', () => {
    const images = result.posts.flatMap((post) => post.imageUrls);
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((url) => url.startsWith('https://'))).toBe(true);
    expect(images.some((url) => url.includes('emoji.php'))).toBe(false);
    expect(images.some((url) => url.startsWith('data:'))).toBe(false);
  });

  it('eslestiriciye kelime siniri tasiyan gercek metin gider', () => {
    /*
     * Zincirin ucu. readableText'in blok elemanlarinda satir sonu eklemesi
     * burada olculuyor: ham textContent "cupboardPick up" gibi birlesik
     * kelimeler uretir ve kelime sinirina dayali eslestirme sessizce coker.
     * Metnin bosluklarla ayrilmis kelimelerden olustugunu dogruluyoruz.
     */
    for (const post of result.posts) {
      const words = post.text.split(/\s+/).filter((word) => word.length > 0);
      expect(words.length).toBeGreaterThan(5);
      // Hicbir "kelime" anormal uzunlukta olmamali - birlesme belirtisi.
      expect(Math.max(...words.map((word) => word.length))).toBeLessThan(40);
    }
    // Bu grup bedava esya grubu; en az bir gonderi bir kurala takilmali.
    const hepsi = result.posts.map((post) => post.text.toLowerCase()).join('\n');
    expect(hepsi).toMatch(/\bfree\b|\bzdarma\b|\bgiving away\b/);
  });
});
