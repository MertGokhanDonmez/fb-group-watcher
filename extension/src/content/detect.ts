import type { BlockKind } from '../../../shared/protocol.ts';
import { BLOCK_PHRASES, SELECTORS, queryFirst } from './selectors.ts';
import { readableText } from './parse.ts';

export interface BlockDetection {
  kind: BlockKind;
  note: string;
}

/**
 * Facebook'un engel/dogrulama ekranlarini tespit eder.
 * Bunlardan biri gorulunce toplama ve aksiyon derhal durur: engellenmis bir hesapla
 * devam etmek gecici kisitlamayi kalici hale getirebilir.
 */
export function detectBlock(doc: Document = document): BlockDetection | null {
  const url = doc.location?.href ?? '';

  if (url.includes('/checkpoint/')) {
    return { kind: 'checkpoint', note: 'checkpoint adresine yonlendirildi' };
  }
  if (url.includes('/login') || queryFirst(doc, SELECTORS.loginIndicators)) {
    return { kind: 'login_required', note: 'oturum kapanmis, giris ekrani goruluyor' };
  }
  if (queryFirst(doc, SELECTORS.captchaIndicators)) {
    return { kind: 'captcha', note: 'captcha cercevesi goruldu' };
  }

  // Metin taramasi pahali oldugu icin en sona birakildi ve ilk ekranla sinirlandi.
  const bodyText = readableText(doc.body ?? doc).slice(0, 4000).toLocaleLowerCase('tr');
  for (const group of BLOCK_PHRASES) {
    for (const phrase of group.phrases) {
      if (bodyText.includes(phrase)) {
        return { kind: group.kind, note: `sayfada "${phrase}" ifadesi goruldu` };
      }
    }
  }

  return null;
}
