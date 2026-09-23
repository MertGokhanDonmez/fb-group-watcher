/**
 * FACEBOOK DOM BILGISININ TEK KAYNAGI.
 *
 * Facebook'un CSS sinif isimleri obfuscated ve duzenli olarak degisiyor; bu yuzden
 * burada YALNIZCA yapisal ve attribute tabanli secici kullaniyoruz (role, aria-*, href
 * kaliplari, data-* ). Sinif ismine dayanan hicbir secici eklenmemeli.
 *
 * Bot bir gun "hicbir gonderi bulamiyorum" demeye baslarsa onarilacak dosya burasidir;
 * baska hicbir yerde secici tanimlanmaz.
 */

/** Her alan icin sirayla denenen stratejiler. Ilk eslesme kazanir. */
export const SELECTORS = {
  /** Grup akisinin kapsayicisi. */
  feed: ['div[role="feed"]'],

  /** Tek bir gonderi. */
  article: ['div[role="article"]'],

  /** Gonderi metni. data-ad-* attribute'lari sinif isimlerinden cok daha kararli. */
  message: [
    'div[data-ad-preview="message"]',
    'div[data-ad-comet-preview="message"]',
    'div[data-testid="post_message"]',
  ],

  /** Giris ekrani gostergeleri (oturum dusmus). */
  loginIndicators: ['input[name="pass"]', 'form[action*="login"]'],

  /** Captcha / checkpoint gostergeleri. */
  captchaIndicators: ['iframe[src*="captcha"]', 'iframe[title*="captcha" i]'],
} as const;

/** Gonderi kalici baglantisini tanimlayan href kaliplari. */
export const POST_LINK_PATTERNS: RegExp[] = [
  /\/groups\/[^/]+\/posts\/\d+/,
  /\/groups\/[^/]+\/permalink\/\d+/,
  /[?&]multi_permalinks=\d+/,
];

/**
 * Yorum baglantisi isareti. Yorum bildirimlerinin ve yorum kalici baglantilarinin
 * href'i gonderi kaliplarina UYAR (/groups/x/posts/123/?comment_id=456), bu yuzden
 * POST_LINK_PATTERNS tek basina yorumu gonderiden ayiramaz. comment_id parametresi
 * tasiyan her baglanti bir yoruma isaret eder; gonderi olarak islenmemeli.
 */
export const COMMENT_LINK_PATTERN = /[?&](comment_id|reply_comment_id)=/;

/** Yazar profilini tanimlayan href kaliplari. Grup akisinda yazar linki /groups/<gid>/user/<uid>/ formatindadir. */
export const AUTHOR_LINK_PATTERNS: RegExp[] = [
  /\/groups\/[^/]+\/user\/\d+/,
  /\/profile\.php\?id=\d+/,
  /^https:\/\/www\.facebook\.com\/[A-Za-z0-9.]+\/?(\?|$)/,
];

/**
 * Facebook'un engel/kisitlama ekranlarinda gecen ifadeler.
 * Bunlardan biri gorulurse bot durur - devam etmek hesabi kalici riske sokar.
 */
export const BLOCK_PHRASES: { kind: 'rate_limit' | 'checkpoint'; phrases: string[] }[] = [
  {
    kind: 'rate_limit',
    phrases: [
      'geçici olarak engellendi',
      'gecici olarak engellendi',
      "you're temporarily blocked",
      'youre temporarily blocked',
      'temporarily restricted',
      'bu özelliği kullanman engellendi',
      'çok hızlı hareket',
    ],
  },
  {
    kind: 'checkpoint',
    phrases: [
      'hesabınızı doğrulayın',
      'hesabini dogrula',
      'confirm your identity',
      'we need to confirm',
      'güvenlik kontrolü',
      'security check',
    ],
  },
];

/* ---------- Marketplace ---------- */

/**
 * Marketplace sayfa bilgisi.
 *
 * DIKKAT: Bu bolum gercek bir sayfa snapshot'i olmadan yazildi; yapisal varsayimlar
 * (ilan kutusunun ilana giden bir baglanti olmasi, ilan sayfasinda gomulu JSON
 * bulunmasi) gercek HTML ile dogrulanmali. Onarim yine yalnizca burada yapilir.
 */
export const MARKETPLACE = {
  /** Arama sonucundaki her ilan kutusu, ilan sayfasina giden bir baglantidir. */
  itemLink: 'a[href*="/marketplace/item/"]',
  /** Ilan sayfasi kapsayicisi: aramadan tiklaninca dialog, adresle acilinca main. */
  itemScope: ['div[role="dialog"]', 'div[role="main"]'],
  title: ['h1'],
  sellerLink: 'a[href*="/marketplace/profile/"]',
  /** Sayfaya gomulu veri bloklari. Aciklamanin kisaltilmamis hali buradadir. */
  dataScripts: 'script[type="application/json"]',
} as const;

/**
 * Gomulu JSON'daki alan adlari. Bunlar Facebook'un GraphQL sema adlari; DOM'dan
 * cok daha kararli ve aciklamayi "Devamini gor" kirpmasi olmadan tasiyorlar.
 */
export const MARKETPLACE_JSON_KEYS = {
  description: 'redacted_description',
  title: 'marketplace_listing_title',
  price: 'formatted_price',
  location: 'location_text',
  creationTime: 'creation_time',
} as const;

/** Fiyat satirini tanir: para birimli tutar veya tek basina bedava etiketi. */
export const PRICE_LINE_PATTERN =
  /^(?:\d[\d\s.,]*\s*(?:kč|kc|czk|€|eur|\$|usd|zł|pln|tl|₺|lei|ft|huf)\.?|(?:czk|€|eur|\$|usd|pln|tl|₺)\s*\d[\d\s.,]*|zdarma|free|bedava|ücretsiz|gratis|kostenlos|zadarmo)$/iu;

/** Uzun aciklamayi acan dugme metinleri (kucuk harf). */
export const SEE_MORE_TEXTS = [
  'see more',
  'zobrazit více',
  'zobrazit vice',
  'zobraziť viac',
  'pokaż więcej',
  'mehr anzeigen',
  'daha fazlasını gör',
  'devamını gör',
];

/** Ilanin yayinlanma zamanini tasiyan satirin isaretleri ("Listed 2 hours ago"). */
export const LISTED_MARKERS = ['listed', 'zveřejněno', 'přidáno', 'listelendi', 'önce', 'ago', 'eingestellt'];

/** Bir kapsayicida secici listesini sirayla dener, ilk bulunani doner. */
export function queryFirst(root: ParentNode, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return null;
}

export function queryAll(root: ParentNode, selectors: readonly string[]): HTMLElement[] {
  for (const selector of selectors) {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (found.length > 0) return found;
  }
  return [];
}

export function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}
