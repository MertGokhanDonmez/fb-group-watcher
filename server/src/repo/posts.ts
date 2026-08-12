import type { RawPost } from '../../../shared/protocol.ts';
import { execute, parseJsonArray, queryAll, queryOne } from '../db/index.ts';
import type { Post } from '../types.ts';

interface PostRow {
  id: number;
  fb_post_id: string;
  group_id: number | null;
  permalink: string;
  author_name: string | null;
  author_profile_url: string | null;
  author_user_id: string | null;
  text: string;
  image_urls: string;
  posted_at: number | null;
  posted_at_label: string | null;
  seen_at: number;
  location_name: string | null;
  location_lat: number | null;
  location_lon: number | null;
  distance_km: number | null;
}

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    fbPostId: row.fb_post_id,
    groupId: row.group_id,
    permalink: row.permalink,
    authorName: row.author_name,
    authorProfileUrl: row.author_profile_url,
    authorUserId: row.author_user_id,
    text: row.text,
    imageUrls: parseJsonArray(row.image_urls),
    postedAt: row.posted_at,
    postedAtLabel: row.posted_at_label,
    seenAt: row.seen_at,
    locationName: row.location_name,
    locationLat: row.location_lat,
    locationLon: row.location_lon,
    distanceKm: row.distance_km,
  };
}

export function getPost(id: number): Post | null {
  const row = queryOne<PostRow>('SELECT * FROM posts WHERE id = ?', id);
  return row ? toPost(row) : null;
}

export function getPostByFbId(fbPostId: string): Post | null {
  const row = queryOne<PostRow>('SELECT * FROM posts WHERE fb_post_id = ?', fbPostId);
  return row ? toPost(row) : null;
}

/**
 * Postu yalnizca daha once gorulmediyse kaydeder.
 * Daha once gorulduyse null doner - cagiran taraf bunu "yeni degil, isleme" olarak yorumlar.
 * Dedupe'un tek yeri burasi; UNIQUE(fb_post_id) kisiti son savunma hattidir.
 */
export interface PostLocation {
  name: string;
  lat: number;
  lon: number;
  /** Ev konumu ayarlanmamissa null. */
  distanceKm: number | null;
}

export function insertPostIfNew(
  raw: RawPost,
  groupId: number | null,
  location: PostLocation | null = null,
): Post | null {
  const result = execute(
    `INSERT OR IGNORE INTO posts (
       fb_post_id, group_id, permalink, author_name, author_profile_url, author_user_id,
       text, image_urls, posted_at, posted_at_label, seen_at,
       location_name, location_lat, location_lon, distance_km
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    raw.fbPostId,
    groupId,
    raw.permalink,
    raw.authorName,
    raw.authorProfileUrl,
    raw.authorUserId,
    raw.text,
    JSON.stringify(raw.imageUrls),
    raw.postedAt,
    raw.postedAtLabel,
    Date.now(),
    location?.name ?? null,
    location?.lat ?? null,
    location?.lon ?? null,
    location?.distanceKm ?? null,
  );
  if (result.changes === 0) return null;
  return getPostByFbId(raw.fbPostId);
}

/**
 * Bildirimden gelen kayitlarda metin kisaltilmis ve yazar bilgisi eksik olabilir.
 * Ayni gonderi grup taramasindan tam haliyle gelince kaydi zenginlestiriyoruz.
 * Dedupe bozulmaz: kayit yeni sayilmaz, yalnizca eksikler tamamlanir.
 * Hicbir alan asla daha zayif bir degerle ezilmez.
 *
 * `textGrew` alani onemli: bildirimdeki kisaltilmis metin bir anahtar kelimeyi
 * kacirmis, tam metin ise iceriyor olabilir. Bu durumda cagiran taraf postu
 * yeniden eslestirmeden gecirmeli, yoksa guvenlik agi postu yakalar ama
 * hicbir zaman eslestiremez.
 */
export interface EnrichResult {
  post: Post;
  textGrew: boolean;
}

export function enrichPost(
  fbPostId: string,
  incoming: RawPost,
  text: string,
  location: PostLocation | null = null,
): EnrichResult | null {
  const existing = getPostByFbId(fbPostId);
  if (!existing) return null;

  const nextText = text.length > existing.text.length ? text : existing.text;
  const textGrew = nextText.length > existing.text.length;
  const nextImages =
    incoming.imageUrls.length > existing.imageUrls.length ? incoming.imageUrls : existing.imageUrls;
  const nextAuthorName = existing.authorName ?? incoming.authorName;
  const nextProfile = existing.authorProfileUrl ?? incoming.authorProfileUrl;
  const nextUserId = existing.authorUserId ?? incoming.authorUserId;
  const nextPostedAt = existing.postedAt ?? incoming.postedAt;

  // Konum yalnizca daha once bulunamadiysa yazilir; tam metinden cikan bolge
  // bildirimdeki kisaltilmis metinden cikana gore daha guvenilirdir.
  const nextLocationName = existing.locationName ?? location?.name ?? null;
  const nextLat = existing.locationLat ?? location?.lat ?? null;
  const nextLon = existing.locationLon ?? location?.lon ?? null;
  const nextDistance = existing.distanceKm ?? location?.distanceKm ?? null;

  const unchanged =
    nextText === existing.text &&
    nextAuthorName === existing.authorName &&
    nextProfile === existing.authorProfileUrl &&
    nextUserId === existing.authorUserId &&
    nextPostedAt === existing.postedAt &&
    nextLocationName === existing.locationName &&
    nextImages.length === existing.imageUrls.length;
  if (unchanged) return { post: existing, textGrew: false };

  execute(
    `UPDATE posts
        SET text = ?, author_name = ?, author_profile_url = ?, author_user_id = ?,
            image_urls = ?, posted_at = ?,
            location_name = ?, location_lat = ?, location_lon = ?, distance_km = ?
      WHERE fb_post_id = ?`,
    nextText,
    nextAuthorName,
    nextProfile,
    nextUserId,
    JSON.stringify(nextImages),
    nextPostedAt,
    nextLocationName,
    nextLat,
    nextLon,
    nextDistance,
    fbPostId,
  );
  const updated = getPostByFbId(fbPostId);
  return updated ? { post: updated, textGrew } : null;
}

export function listRecentPosts(limit = 100, groupId?: number): Post[] {
  const rows =
    groupId === undefined
      ? queryAll<PostRow>('SELECT * FROM posts ORDER BY seen_at DESC LIMIT ?', limit)
      : queryAll<PostRow>(
          'SELECT * FROM posts WHERE group_id = ? ORDER BY seen_at DESC LIMIT ?',
          groupId,
          limit,
        );
  return rows.map(toPost);
}

/**
 * Yakalanan tum gonderileri siler.
 * Ayristirici degistiginde eski, bozuk kayitlarla temiz bir baslangic yapmak icin.
 * Eslesmeler ve aksiyonlar yabanci anahtar zinciriyle birlikte silinir;
 * gruplar, kurallar ve sablonlar etkilenmez.
 */
export function deleteAllPosts(): number {
  return execute('DELETE FROM posts').changes;
}

/** Disk sismesini onlemek icin eski postlari temizler. */
export function prunePostsOlderThan(cutoffMs: number): number {
  return execute('DELETE FROM posts WHERE seen_at < ?', cutoffMs).changes;
}
