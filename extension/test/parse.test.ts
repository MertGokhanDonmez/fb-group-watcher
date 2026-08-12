// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArticle, parseFeed, parseRelativeTimeLabel, readableText } from '../src/content/parse.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): Document {
  const html = fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');
  const doc = document.implementation.createHTMLDocument('fixture');
  doc.body.innerHTML = html;
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
