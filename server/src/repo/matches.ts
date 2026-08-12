import { execute, parseJsonArray, queryAll, queryOne } from '../db/index.ts';
import type { Match, MatchDetail, MatchStatus, Post } from '../types.ts';
import { listActionsForMatches } from './actions.ts';

interface MatchRow {
  id: number;
  post_id: number;
  rule_id: number;
  matched_keywords: string;
  status: MatchStatus;
  created_at: number;
}

function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    postId: row.post_id,
    ruleId: row.rule_id,
    matchedKeywords: parseJsonArray(row.matched_keywords),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function getMatch(id: number): Match | null {
  const row = queryOne<MatchRow>('SELECT * FROM matches WHERE id = ?', id);
  return row ? toMatch(row) : null;
}

/**
 * Eslesmeyi kaydeder. UNIQUE(post_id, rule_id) sayesinde ayni post ayni kuralla
 * iki kez islenmez - bu, ayni posta iki kez yorum yazilmasini onleyen korumadir.
 * Zaten varsa null doner.
 */
export function createMatchIfNew(
  postId: number,
  ruleId: number,
  matchedKeywords: string[],
  status: MatchStatus,
): Match | null {
  const result = execute(
    `INSERT OR IGNORE INTO matches (post_id, rule_id, matched_keywords, status, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    postId,
    ruleId,
    JSON.stringify(matchedKeywords),
    status,
    Date.now(),
  );
  if (result.changes === 0) return null;
  return getMatch(result.lastInsertRowid);
}

export function setMatchStatus(id: number, status: MatchStatus): void {
  execute('UPDATE matches SET status = ? WHERE id = ?', status, id);
}

/** Bir kuralin belirli bir andan sonra urettigi aksiyon sayisi (gunluk kota icin). */
export function countSentActionsForRuleSince(ruleId: number, sinceMs: number): number {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total
       FROM actions a
       JOIN matches m ON m.id = a.match_id
      WHERE m.rule_id = ?
        AND a.kind IN ('comment','dm')
        AND a.status IN ('sent','sending','queued')
        AND a.created_at >= ?`,
    ruleId,
    sinceMs,
  );
  return Number(row?.total ?? 0);
}

/** Bir grup icin ayni pencerede uretilmis aksiyon sayisi (grup kotasi icin). */
export function countSentActionsForGroupSince(groupId: number, sinceMs: number): number {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total
       FROM actions a
       JOIN matches m ON m.id = a.match_id
       JOIN posts  p ON p.id = m.post_id
      WHERE p.group_id = ?
        AND a.kind IN ('comment','dm')
        AND a.status IN ('sent','sending','queued')
        AND a.created_at >= ?`,
    groupId,
    sinceMs,
  );
  return Number(row?.total ?? 0);
}

interface DetailRow extends MatchRow {
  rule_name: string;
  group_name: string | null;
  p_id: number;
  p_fb_post_id: string;
  p_group_id: number | null;
  p_permalink: string;
  p_author_name: string | null;
  p_author_profile_url: string | null;
  p_author_user_id: string | null;
  p_text: string;
  p_image_urls: string;
  p_posted_at: number | null;
  p_posted_at_label: string | null;
  p_seen_at: number;
  p_location_name: string | null;
  p_location_lat: number | null;
  p_location_lon: number | null;
  p_distance_km: number | null;
}

const DETAIL_SELECT = `
  SELECT m.*,
         r.name AS rule_name,
         g.name AS group_name,
         p.id                 AS p_id,
         p.fb_post_id         AS p_fb_post_id,
         p.group_id           AS p_group_id,
         p.permalink          AS p_permalink,
         p.author_name        AS p_author_name,
         p.author_profile_url AS p_author_profile_url,
         p.author_user_id     AS p_author_user_id,
         p.text               AS p_text,
         p.image_urls         AS p_image_urls,
         p.posted_at          AS p_posted_at,
         p.posted_at_label    AS p_posted_at_label,
         p.seen_at            AS p_seen_at,
         p.location_name      AS p_location_name,
         p.location_lat       AS p_location_lat,
         p.location_lon       AS p_location_lon,
         p.distance_km        AS p_distance_km
    FROM matches m
    JOIN posts p ON p.id = m.post_id
    JOIN rules r ON r.id = m.rule_id
    LEFT JOIN groups g ON g.id = p.group_id
`;

function toDetail(row: DetailRow, actionsByMatch: Map<number, MatchDetail['actions']>): MatchDetail {
  const post: Post = {
    id: row.p_id,
    fbPostId: row.p_fb_post_id,
    groupId: row.p_group_id,
    permalink: row.p_permalink,
    authorName: row.p_author_name,
    authorProfileUrl: row.p_author_profile_url,
    authorUserId: row.p_author_user_id,
    text: row.p_text,
    imageUrls: parseJsonArray(row.p_image_urls),
    postedAt: row.p_posted_at,
    postedAtLabel: row.p_posted_at_label,
    seenAt: row.p_seen_at,
    locationName: row.p_location_name,
    locationLat: row.p_location_lat,
    locationLon: row.p_location_lon,
    distanceKm: row.p_distance_km,
  };
  return {
    ...toMatch(row),
    post,
    ruleName: row.rule_name,
    groupName: row.group_name,
    actions: actionsByMatch.get(row.id) ?? [],
  };
}

export function listMatchDetails(limit = 50, status?: MatchStatus): MatchDetail[] {
  const rows = status
    ? queryAll<DetailRow>(
        `${DETAIL_SELECT} WHERE m.status = ? ORDER BY m.created_at DESC LIMIT ?`,
        status,
        limit,
      )
    : queryAll<DetailRow>(`${DETAIL_SELECT} ORDER BY m.created_at DESC LIMIT ?`, limit);
  const actionsByMatch = listActionsForMatches(rows.map((row) => row.id));
  return rows.map((row) => toDetail(row, actionsByMatch));
}

export function getMatchDetail(id: number): MatchDetail | null {
  const row = queryOne<DetailRow>(`${DETAIL_SELECT} WHERE m.id = ?`, id);
  if (!row) return null;
  return toDetail(row, listActionsForMatches([row.id]));
}
