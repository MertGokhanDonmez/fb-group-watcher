import { bus } from './bus.ts';
import { isTooOld, matchRule, ruleCoversGroup } from './matcher/match.ts';
import { notifyMatch } from './notify/telegram.ts';
import { logEvent } from './repo/events.ts';
import { createMatchIfNew, getMatchDetail } from './repo/matches.ts';
import { listEnabledRules } from './repo/rules.ts';
import { getSettings } from './repo/settings.ts';
import type { Post } from './types.ts';

/** Marketplace ilaninda anahtar kelime baslikta da olabilir; aciklamaya eklenir. */
function matchableText(post: Post): string {
  return post.title ? `${post.title}\n${post.text}` : post.text;
}

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
    for (const rule of rules) {
      if (post.kind === 'marketplace') {
        // Grup secimi Marketplace'e uygulanmaz; kuralin Marketplace'i kapsamasi yeterli.
        // Aciklamada bedava dogrulanmamis ilan hicbir kuralla eslesmez: fiyat alani kanit degil.
        if (!rule.searchMarketplace || post.freeVerified !== true) continue;
      } else if (!ruleCoversGroup(rule, post.groupId)) {
        continue;
      }

      // Bayat gonderiye tepki vermek anlamsiz: bedava esya saatler icinde gider.
      if (isTooOld(post.postedAt, rule.maxPostAgeMin)) continue;

      // Mesafe filtresi. Konumu cikarilamayan gonderiler ELENMEZ: bilinmeyen bir
      // konum yuzunden gercek bir firsati kacirmak, uzak bir ilani gormekten kotudur.
      if (rule.maxDistanceKm !== null && post.distanceKm !== null) {
        if (post.distanceKm > rule.maxDistanceKm) continue;
      }

      const result = matchRule(matchableText(post), rule, options);
      if (!result.matched) continue;

      const match = createMatchIfNew(post.id, rule.id, result.keywords, 'pending');
      if (!match) continue; // bu gonderi bu kuralla zaten islenmis

      const detail = getMatchDetail(match.id);
      if (detail) {
        bus.emitEvent({ type: 'match', match: detail });
        // Gonderim asenkron; boru hattini bekletmez. Sonuc aksiyon kaydina yazilir.
        if (rule.actionNotify) void notifyMatch(detail);
      }
      logEvent(
        'match',
        'info',
        `"${rule.name}" eslesti: ${result.keywords.join(', ')}`,
        { postId: post.id, permalink: post.permalink },
      );
    }
  }
}
