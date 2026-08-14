export interface Group {
  id: number;
  fbGroupId: string;
  name: string;
  url: string;
  dwellMs: number;
  priority: number;
  enabled: boolean;
  dailyActionCap: number;
  createdAt: number;
}

export type TemplateKind = 'comment' | 'dm';

export interface Template {
  id: number;
  name: string;
  kind: TemplateKind;
  /** En az bir varyant olmali; gonderimde rastgele biri secilir. */
  variants: string[];
  createdAt: number;
  updatedAt: number;
}

export type MatchMode = 'any' | 'all';

export interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  matchMode: MatchMode;
  includeKeywords: string[];
  excludeKeywords: string[];
  regex: string | null;
  actionComment: boolean;
  actionDm: boolean;
  actionNotify: boolean;
  requireApproval: boolean;
  commentTemplateId: number | null;
  dmTemplateId: number | null;
  dailyCap: number;
  maxPostAgeMin: number;
  /** Ev konumuna bu mesafeden uzak ilanlar elenir (km). null = filtre yok. */
  maxDistanceKm: number | null;
  priority: number;
  /** Bos dizi = tum aktif gruplara uygulanir. */
  groupIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface Post {
  id: number;
  fbPostId: string;
  groupId: number | null;
  permalink: string;
  authorName: string | null;
  authorProfileUrl: string | null;
  authorUserId: string | null;
  text: string;
  imageUrls: string[];
  postedAt: number | null;
  postedAtLabel: string | null;
  seenAt: number;
  /** Metinden cikarilan bolge adi; cikarilamadiysa null. */
  locationName: string | null;
  locationLat: number | null;
  locationLon: number | null;
  /** Ev konumuna uzaklik (km). Konum veya ev konumu bilinmiyorsa null. */
  distanceKm: number | null;
  /**
   * Gonderiyi hangi yol yakaladi. 'notification' saniyeler icinde gelir,
   * 'feed' grup taramasinin turune bagli oldugu icin dakikalar surer -
   * bildirim yolunun gercekten calisip calismadigi ancak buradan gorulur.
   */
  source: 'feed' | 'notification';
}

export type MatchStatus = 'pending' | 'approved' | 'sent' | 'failed' | 'skipped' | 'ignored';

export interface Match {
  id: number;
  postId: number;
  ruleId: number;
  matchedKeywords: string[];
  status: MatchStatus;
  createdAt: number;
}

export type ActionKind = 'comment' | 'dm' | 'telegram';
export type ActionStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'dry_run' | 'cancelled';

export interface ActionRow {
  id: number;
  matchId: number;
  kind: ActionKind;
  status: ActionStatus;
  text: string;
  verified: boolean;
  error: string | null;
  createdAt: number;
  sentAt: number | null;
}

/** Match + ilgili post/rule/action bilgisini birlestiren UI gorunumu. */
export interface MatchDetail extends Match {
  post: Post;
  ruleName: string;
  groupName: string | null;
  actions: ActionRow[];
}
