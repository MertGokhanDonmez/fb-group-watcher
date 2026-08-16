import { bus } from './bus.ts';
import { isTooOld, matchRule, ruleCoversGroup } from './matcher/match.ts';
import { notifyMatches } from './notify/telegram.ts';
import { logEvent } from './repo/events.ts';
import { createMatchIfNew, getMatchDetail } from './repo/matches.ts';
import { listEnabledRules } from './repo/rules.ts';
import { getSettings } from './repo/settings.ts';
import type { MatchDetail, Post } from './types.ts';

/**
 * Yeni yakalanan gonderileri kurallardan gecirir.
 *
 * Eslesme kaydi UNIQUE(post_id, rule_id) sayesinde tekildir; ayni gonderi
 * bildirimden ve grup taramasindan iki kez gelse bile tek eslesme uretilir.
 */
export function processNewPosts(posts: Post[]): void {
  if (posts.length === 0) return;
  const rules = listEnabledRules();
  if (rules.length === 0) return;
  const options = { turkishSuffixes: getSettings().turkishSuffixMatching };

  for (const post of posts) {
    // Bu gonderiye takilan ve bildirim isteyen eslesmeler. Tek gonderi birden
    // fazla kurala uyabildigi icin toplanip TEK mesaj olarak gonderiliyor;
    // eslesme kayitlari ayri kaliyor (gecmis ve onay akisi kural bazinda).
    const notifiable: MatchDetail[] = [];

    for (const rule of rules) {
      if (!ruleCoversGroup(rule, post.groupId)) continue;

      // Bayat gonderiye tepki vermek anlamsiz: bedava esya saatler icinde gider.
      if (isTooOld(post.postedAt, rule.maxPostAgeMin)) continue;

      // Mesafe filtresi. Konumu cikarilamayan gonderiler ELENMEZ: bilinmeyen bir
      // konum yuzunden gercek bir firsati kacirmak, uzak bir ilani gormekten kotudur.
      if (rule.maxDistanceKm !== null && post.distanceKm !== null) {
        if (post.distanceKm > rule.maxDistanceKm) continue;
      }

      const result = matchRule(post.text, rule, options);
      if (!result.matched) continue;

      const match = createMatchIfNew(post.id, rule.id, result.keywords, 'pending');
      if (!match) continue; // bu gonderi bu kuralla zaten islenmis

      const detail = getMatchDetail(match.id);
      if (detail) {
        bus.emitEvent({ type: 'match', match: detail });
        if (rule.actionNotify) notifiable.push(detail);
      }
      logEvent(
        'match',
        'info',
        `"${rule.name}" eslesti: ${result.keywords.join(', ')}`,
        { postId: post.id, permalink: post.permalink },
      );
    }

    // Gonderim asenkron; boru hattini bekletmez. Sonuc aksiyon kaydina yazilir.
    if (notifiable.length > 0) void notifyMatches(notifiable);
  }
}
