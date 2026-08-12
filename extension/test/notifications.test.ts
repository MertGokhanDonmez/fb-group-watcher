// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseNotifications } from '../src/content/notifications.ts';

function build(html: string): Document {
  const doc = document.implementation.createHTMLDocument('bildirimler');
  doc.body.innerHTML = html;
  return doc;
}

const FIXTURE = `
<div role="main">
  <div role="listitem">
    <a href="/groups/bedava-esya/posts/555000111/?notif_id=abc">
      <strong>Ayşe Yılmaz</strong>
      <span>, Bedava Eşya İstanbul grubunda bir gönderi paylaştı: Bedava koltuk veriyorum, alan gelsin</span>
      <span>2 dk</span>
    </a>
  </div>

  <!-- Begeni bildirimi: grup gonderisi linki tasimadigi icin elenmeli -->
  <div role="listitem">
    <a href="/photo/?fbid=999"><strong>Mehmet Demir</strong><span> fotoğrafını beğendi</span></a>
  </div>

  <div role="listitem">
    <a href="/groups/ucretsiz-esya/posts/777000222/">
      <strong>Zeynep Kaya</strong>
      <span>, Ücretsiz Eşya grubunda bir gönderi paylaştı: Buzdolabı veriyorum</span>
    </a>
  </div>

  <!-- Ayni gonderiye ikinci bir link (Facebook sik sik tekrarlar) -->
  <div role="listitem">
    <a href="/groups/bedava-esya/posts/555000111/?notif_id=xyz"><span>tekrar</span></a>
  </div>

  <!-- Yorum bildirimi: gonderi linki kalibina uyar ama comment_id tasir, elenmeli -->
  <div role="listitem">
    <a href="/groups/bedava-esya/posts/888000333/?comment_id=42&notif_id=q">
      <strong>Dian Bonn</strong>
      <span> gönderiye yorum yaptı: Hello can I have them</span>
    </a>
  </div>
  <div role="listitem">
    <a href="/groups/bedava-esya/posts/888000333/?comment_id=42&reply_comment_id=77">
      <strong>Jah Dee</strong>
      <span> yoruma yanıt verdi: Take all please tanx</span>
    </a>
  </div>
</div>
`;

describe('parseNotifications', () => {
  const posts = parseNotifications(build(FIXTURE));

  it('yalnizca grup gonderisi bildirimlerini alir', () => {
    // Begeni bildirimi elenmeli, tekrar eden link tekillestirilmeli.
    expect(posts).toHaveLength(2);
  });

  it('yorum bildirimlerini gonderi sanmaz', () => {
    // Regresyon: yorum bildirimi de /groups/x/posts/id/ kalibina uyar (comment_id ile).
    // Elenmezse yorumun metni gonderi icerigi olarak kaydedilir.
    expect(posts.map((post) => post.fbPostId)).not.toContain('888000333');
    expect(posts.every((post) => !post.text.includes('Hello can I have them'))).toBe(true);
  });

  it('gonderi ve grup kimligini kalici baglantidan cikarir', () => {
    expect(posts[0]!.fbPostId).toBe('555000111');
    expect(posts[0]!.fbGroupId).toBe('bedava-esya');
    expect(posts[0]!.permalink).toBe(
      'https://www.facebook.com/groups/bedava-esya/posts/555000111/',
    );
  });

  it('takip parametrelerini kalici baglantidan temizler', () => {
    expect(posts[0]!.permalink).not.toContain('notif_id');
  });

  it('kaynagi bildirim olarak isaretler', () => {
    expect(posts[0]!.source).toBe('notification');
    expect(posts[1]!.source).toBe('notification');
  });

  it('kalin yazilan kismi yazar adi olarak alir', () => {
    expect(posts[0]!.authorName).toBe('Ayşe Yılmaz');
    expect(posts[1]!.authorName).toBe('Zeynep Kaya');
  });

  it('ham metni tasir (onek temizligi sunucuda yapilir)', () => {
    expect(posts[0]!.text).toContain('Bedava koltuk veriyorum');
    expect(posts[1]!.text).toContain('Buzdolabı veriyorum');
  });

  it('grup gonderisi olmayan sayfada bos doner', () => {
    expect(parseNotifications(build('<div role="main"><a href="/settings">Ayarlar</a></div>'))).toEqual([]);
  });
});

/**
 * Regresyon: gercek Facebook bildirimler sayfasinda role="listitem" YOK ve
 * baglanti yalnizca zaman damgasini sariyor. Ilk surum kapsayici olarak
 * anchor.parentElement'e dusuyor ve metin olarak sadece "52m" kaydediyordu.
 */
const GERCEK_YAPI = `
<div role="main">
  <div>
    <div>
      <span><b>Ayşe Yılmaz</b></span>
      <span>, Bedava Eşya İstanbul grubunda bir gönderi paylaştı: Bedava koltuk veriyorum, durumu iyi, alan gelsin</span>
    </div>
    <a href="/groups/368680083335007/posts/3310548849148101/"><span>52m</span></a>
  </div>
  <div>
    <div>
      <span><b>Zeynep Kaya</b></span>
      <span>, Ücretsiz Eşya grubunda bir gönderi paylaştı: Buzdolabı veriyorum, çalışır durumda</span>
    </div>
    <a href="/groups/575732029944050/posts/2284852302365339/"><span>9h</span></a>
  </div>
</div>
`;

describe('kapsayici bulma (listitem olmadan)', () => {
  const posts = parseNotifications(build(GERCEK_YAPI));

  it('iki bildirimi de bulur', () => {
    expect(posts).toHaveLength(2);
  });

  it('metin olarak sadece zaman damgasini almaz', () => {
    expect(posts[0]!.text).not.toBe('52m');
    expect(posts[0]!.text).toContain('Bedava koltuk veriyorum');
  });

  it('komsu bildirimin metnini yutmaz', () => {
    // Yukari yuruyus ikinci gonderi baglantisini goren seviyede durmali.
    expect(posts[0]!.text).not.toContain('Buzdolabı');
    expect(posts[1]!.text).not.toContain('koltuk');
  });

  it('zaman etiketini ayrica cikarir ve metnin sonundan temizler', () => {
    expect(posts[0]!.postedAtLabel).toBe('52m');
    expect(posts[0]!.postedAt).not.toBeNull();
    expect(posts[0]!.text.endsWith('52m')).toBe(false);
  });

  it('yazari kalin metinden alir', () => {
    expect(posts[0]!.authorName).toBe('Ayşe Yılmaz');
    expect(posts[1]!.authorName).toBe('Zeynep Kaya');
  });
});
