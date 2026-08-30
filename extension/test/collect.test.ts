// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectResponse } from '../src/content/collector.ts';

/**
 * Toplayicinin "akis hazir mi" karari.
 *
 * Bu testin varlik sebebi somut bir ariza: Facebook grup akisini sanallastiriyor,
 * yani aria-posinset tasiyan kapsayicilar sayfa yuklenir yuklenmez BOS yer
 * tutucular olarak olusuyor ve icerik saniyeler sonra doluyor. Toplayici eskiden
 * yalnizca "bir article kapsayicisi var mi" diye baktigi icin ilk bos yer
 * tutucuyu gorup hemen ayristiriyor, parseFeed bos kutulari eliyor ve geriye
 * articlesSeen=0 kaliyordu. Sunucu bunu selector arizasi sanip saatlerce
 * "Grup akisinda hic gonderi bulunamadi" alarmi uretti.
 */

type CollectListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: CollectResponse) => void,
) => boolean;

let listener: CollectListener;

/** Yer tutucu: kapsayici ve aria-posinset var, icerik yok - Facebook'un ilk cizdigi hal. */
function emptySlots(count: number): string {
  return Array.from({ length: count }, (_, index) => `<div aria-posinset="${index + 1}"></div>`).join('');
}

/** Yer tutucularin gec gelen gercek icerigi. */
function fillSlots(doc: Document): void {
  const slots = Array.from(doc.querySelectorAll<HTMLElement>('div[aria-posinset]'));
  slots.forEach((slot, index) => {
    const id = `100000000000${index}`;
    slot.innerHTML = `
      <div data-ad-rendering-role="profile_name">
        <a href="/groups/bedava-esya/user/10000${index}/"><span>Yazar ${index}</span></a>
      </div>
      <a href="/groups/bedava-esya/posts/${id}/"><span>2 dk</span></a>
      <div data-ad-rendering-role="story_message"><div dir="auto">Bedava koltuk ${index}</div></div>
    `;
  });
}

function collect(timeoutMs: number): Promise<CollectResponse> {
  return new Promise((resolve) => {
    listener({ type: 'collect', fbGroupId: 'bedava-esya', timeoutMs }, undefined, resolve);
  });
}

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = `<div role="feed">${emptySlots(3)}</div>`;
  // Modul yuklenirken chrome.runtime'a dokunuyor; dinleyiciyi burada yakaliyoruz.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: (fn: CollectListener) => { listener = fn; } },
      sendMessage: () => undefined,
    },
  };
  await import('../src/content/collector.ts');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('collect - sanallastirilmis akis', () => {
  it('bos yer tutuculari "hazir" saymaz, icerik gelene kadar bekler', async () => {
    // Icerik toplama basladiktan sonra geliyor: gercek sayfadaki durumun aynisi.
    setTimeout(() => fillSlots(document), 600);

    const response = await collect(5_000);

    expect(response.ok).toBe(true);
    expect(response.stats?.articlesSeen).toBe(3);
    expect(response.posts).toHaveLength(3);
  });

  it('ilk gonderiyle yetinmez, akisin geri kalanini da bekler', async () => {
    const feed = document.querySelector('div[role="feed"]')!;
    const slots = Array.from(feed.querySelectorAll<HTMLElement>('div[aria-posinset]'));

    // Yuvalar teker teker doluyor; ilkini gorup donmek digerlerini kacirmak olurdu.
    slots.forEach((_, index) => {
      setTimeout(() => {
        const single = document.implementation.createHTMLDocument('slot');
        single.body.innerHTML = `<div role="feed">${slots[index]!.outerHTML}</div>`;
        fillSlots(single);
        slots[index]!.innerHTML = single.querySelector('div[aria-posinset]')!.innerHTML;
      }, 300 + index * 400);
    });

    const response = await collect(6_000);

    expect(response.posts).toHaveLength(3);
  });

  it('hicbir sey render edilmezse butce dolana kadar bekler ve bos doner', async () => {
    const startedAt = Date.now();
    const response = await collect(1_500);

    expect(response.ok).toBe(true);
    expect(response.stats?.articlesSeen).toBe(0);
    // Erken pes etmek sunucuda yanlis alarm uretiyordu; sure gercekten harcanmali.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_400);
  });
});
