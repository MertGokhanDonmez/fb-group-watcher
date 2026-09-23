// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { extractListingId, parsePriceAmount } from '../../shared/marketplace.ts';
import {
  expandDescription,
  parseMarketplaceItem,
  parseMarketplaceSearch,
  readEmbeddedListing,
} from '../src/content/marketplace.ts';

/*
 * DIKKAT: Bu testlerdeki HTML SENTETIK - gercek Marketplace sayfasindan alinmadi.
 * Ayristiricinin mantigini kilitler ama Facebook'un gercek yapisini dogrulamaz.
 * Gercek snapshot gelince test/fixtures altina eklenip buradaki varsayimlar
 * (kart metin sirasi, gomulu JSON alan adlari) onunla dogrulanmali.
 */

function doc(html: string): Document {
  const created = document.implementation.createHTMLDocument('fixture');
  created.body.innerHTML = html;
  return created;
}

describe('parsePriceAmount', () => {
  it('bedava etiketlerini 0 sayar', () => {
    expect(parsePriceAmount('Zdarma')).toBe(0);
    expect(parsePriceAmount('Free')).toBe(0);
    expect(parsePriceAmount('Ücretsiz')).toBe(0);
  });

  it('binlik ayiraclarini ve para birimini cozer', () => {
    expect(parsePriceAmount('1 200 Kč')).toBe(1200);
    expect(parsePriceAmount('1 200 Kč')).toBe(1200);
    expect(parsePriceAmount('CZK1,200')).toBe(1200);
    expect(parsePriceAmount('0 Kč')).toBe(0);
    expect(parsePriceAmount('12,50 €')).toBe(12.5);
  });

  it('cozemedigi metinde null doner', () => {
    expect(parsePriceAmount(null)).toBeNull();
    expect(parsePriceAmount('Dohodou')).toBeNull();
  });
});

describe('extractListingId', () => {
  it('ilan adresinden kimligi cikarir', () => {
    expect(extractListingId('/marketplace/item/1234567890/?ref=search')).toBe('1234567890');
    expect(extractListingId('/marketplace/prague/')).toBeNull();
  });
});

describe('parseMarketplaceSearch', () => {
  it('karttan fiyat, baslik ve konumu okur', () => {
    const page = doc(`
      <div role="main">
        <a href="/marketplace/item/111/?ref=search">
          <img src="https://scontent.example/a.jpg" />
          <div><span>Zdarma</span></div>
          <div><span>Rohový gauč</span></div>
          <div><span>Praha, Hlavní město Praha</span></div>
        </a>
        <a href="/marketplace/item/222/">
          <div><span>5 Kč</span></div>
          <div><span>10 Kč</span></div>
          <div><span>Stůl</span></div>
          <div><span>Praha 5</span></div>
        </a>
        <a href="/marketplace/item/111/">tekrar eden baglanti</a>
      </div>`);
    const { cards, stats } = parseMarketplaceSearch(page);

    expect(stats).toEqual({ articlesSeen: 2, postsParsed: 2, failures: 0 });
    expect(cards[0]).toEqual({
      listingId: '111',
      url: 'https://www.facebook.com/marketplace/item/111/',
      title: 'Rohový gauč',
      priceText: 'Zdarma',
      priceAmount: 0,
      locationText: 'Praha, Hlavní město Praha',
      imageUrl: 'https://scontent.example/a.jpg',
    });
    // Indirimli ilanda eski fiyat baslik sanilmamali.
    expect(cards[1]).toMatchObject({ title: 'Stůl', priceText: '5 Kč', priceAmount: 5, locationText: 'Praha 5' });
  });

  it('ilan baglantisi yoksa bos doner', () => {
    expect(parseMarketplaceSearch(doc('<div role="main">Nic nenalezeno</div>')).cards).toEqual([]);
  });
});

const EMBEDDED = (id: string, description: string, extra = ''): string =>
  `<script type="application/json">{"data":{"target":{"__typename":"GroupCommerceProductItem","id":"${id}",` +
  `"marketplace_listing_title":"Gau\\u010d","formatted_price":{"text":"Zdarma"},` +
  `"location_text":{"text":"Praha 3"},"creation_time":1758000000,` +
  `"redacted_description":{"text":${JSON.stringify(description)}}${extra}}}}</script>`;

describe('readEmbeddedListing', () => {
  it('gomulu veriden kisaltilmamis aciklamayi ve alanlari okur', () => {
    const page = doc(EMBEDDED('555', 'Daruji gauč.\nJen osobní odběr, Žižkov.'));
    expect(readEmbeddedListing(page, '555')).toEqual({
      title: 'Gauč',
      description: 'Daruji gauč.\nJen osobní odběr, Žižkov.',
      priceText: 'Zdarma',
      locationText: 'Praha 3',
      postedAt: 1758000000 * 1000,
    });
  });

  it('birden fazla ilan varsa kimligi eslesen ilanin aciklamasini secer', () => {
    const page = doc(EMBEDDED('999', 'Baska ilan, 500 Kč') + EMBEDDED('555', 'Daruji stůl'));
    expect(readEmbeddedListing(page, '555')?.description).toBe('Daruji stůl');
  });

  it('gomulu veri yoksa null doner', () => {
    expect(readEmbeddedListing(doc('<div></div>'), '555')).toBeNull();
  });
});

describe('parseMarketplaceItem', () => {
  it('gomulu veri yoksa DOM yedegiyle okur', () => {
    const now = new Date('2026-09-19T12:00:00Z').getTime();
    const page = doc(`
      <div role="main">
        <div><h1><span>Knihovna</span></h1><div><span>Zdarma</span></div></div>
        <span>Listed 2 hours ago in Praha</span>
        <div dir="auto">Daruji knihovnu, musí se rozebrat. Odvoz z Karlína.</div>
        <a href="/marketplace/profile/42/"><span>Petr Novák</span></a>
        <a href="/marketplace/item/777/"><div dir="auto">Benzer ilan metni cok daha uzun olsa bile aciklama sayilmamali</div></a>
      </div>`);
    const listing = parseMarketplaceItem(page, '123', now);

    expect(listing).toMatchObject({
      listingId: '123',
      title: 'Knihovna',
      description: 'Daruji knihovnu, musí se rozebrat. Odvoz z Karlína.',
      priceText: 'Zdarma',
      priceAmount: 0,
      sellerName: 'Petr Novák',
      sellerProfileUrl: 'https://www.facebook.com/marketplace/profile/42/',
      postedAt: now - 2 * 3_600_000,
      postedAtLabel: 'Listed 2 hours ago in Praha',
    });
  });

  it('gomulu veri varsa aciklamayi oradan alir', () => {
    const page = doc(
      `<div role="main"><h1>Gauč</h1><div dir="auto">Daruji gauč... Zobrazit více</div></div>` +
        EMBEDDED('555', 'Daruji gauč, celý text bez zkrácení. Zdarma.'),
    );
    expect(parseMarketplaceItem(page, '555')?.description).toBe(
      'Daruji gauč, celý text bez zkrácení. Zdarma.',
    );
  });

  it('ne baslik ne aciklama varsa null doner', () => {
    expect(parseMarketplaceItem(doc('<div role="main"></div>'), '1')).toBeNull();
  });
});

describe('expandDescription', () => {
  it('"Zobrazit vice" dugmesine tiklar', () => {
    const page = doc('<div role="main"><div role="button">Zobrazit více</div></div>');
    let clicked = false;
    page.querySelector('[role="button"]')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(expandDescription(page)).toBe(true);
    expect(clicked).toBe(true);
  });

  it('dugme yoksa false doner', () => {
    expect(expandDescription(doc('<div role="main"></div>'))).toBe(false);
  });
});
