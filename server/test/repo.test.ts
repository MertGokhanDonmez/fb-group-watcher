import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawPost } from '../../shared/protocol.ts';
import { createGroup, getGroupByFbId, listEnabledGroups, updateGroup } from '../src/repo/groups.ts';
import { createTemplate, listTemplates } from '../src/repo/templates.ts';
import { createRule, getRule, updateRule } from '../src/repo/rules.ts';
import { insertPostIfNew } from '../src/repo/posts.ts';
import { countSentActionsForRuleSince, createMatchIfNew, listMatchDetails } from '../src/repo/matches.ts';
import { countRealActionsSince, createAction, setActionStatus } from '../src/repo/actions.ts';
import { ensureAgentToken, getSettings, updateSettings } from '../src/repo/settings.ts';
import { dropTempDb, useTempDb } from './helpers.ts';

beforeAll(() => useTempDb());
afterAll(() => dropTempDb());

function makeRawPost(overrides: Partial<RawPost> = {}): RawPost {
  return {
    source: 'feed',
    fbPostId: '111',
    fbGroupId: 'bedava-esya',
    permalink: 'https://www.facebook.com/groups/bedava-esya/posts/111/',
    authorName: 'Ayse Yilmaz',
    authorProfileUrl: 'https://www.facebook.com/ayse',
    authorUserId: '900',
    text: 'Bedava koltuk veriyorum, alan gelsin',
    imageUrls: [],
    postedAt: Date.now(),
    postedAtLabel: '2 dk',
    ...overrides,
  };
}

describe('settings', () => {
  it('okunmamis ayarlar icin muhafazakar varsayilanlari doner', () => {
    const settings = getSettings();
    expect(settings.dryRun).toBe(true);
    expect(settings.killSwitch).toBe(false);
    expect(settings.maxActionsPerHour).toBe(6);
    expect(settings.minActionGapSec).toBe(90);
  });

  it('kismi guncelleme yapar ve tipleri korur', () => {
    updateSettings({ maxActionsPerHour: 9, telegramChatId: '123' });
    const settings = getSettings();
    expect(settings.maxActionsPerHour).toBe(9);
    expect(settings.telegramChatId).toBe('123');
    // dokunulmayan alan varsayilaninda kalmali
    expect(settings.dryRun).toBe(true);
  });

  it('agent token uretir ve sonraki cagrilarda ayni tokeni doner', () => {
    const first = ensureAgentToken();
    expect(first).toHaveLength(48);
    expect(ensureAgentToken()).toBe(first);
  });
});

describe('groups', () => {
  it('grup olusturur ve fb id ile bulur', () => {
    const group = createGroup({
      fbGroupId: 'bedava-esya',
      name: 'Bedava Esya',
      url: 'https://www.facebook.com/groups/bedava-esya',
      dwellMs: 8000,
      priority: 2,
      enabled: true,
      dailyActionCap: 10,
    });
    expect(group.id).toBeGreaterThan(0);
    expect(group.enabled).toBe(true);
    expect(getGroupByFbId('bedava-esya')?.name).toBe('Bedava Esya');
  });

  it('devre disi gruplari aktif listesinden cikarir', () => {
    const group = getGroupByFbId('bedava-esya');
    expect(group).not.toBeNull();
    updateGroup(group!.id, { enabled: false });
    expect(listEnabledGroups()).toHaveLength(0);
    updateGroup(group!.id, { enabled: true });
    expect(listEnabledGroups()).toHaveLength(1);
  });
});

describe('posts dedupe', () => {
  it('ayni postu iki kez kaydetmez', () => {
    const group = getGroupByFbId('bedava-esya');
    const first = insertPostIfNew(makeRawPost(), group!.id);
    expect(first).not.toBeNull();
    expect(first!.text).toContain('Bedava koltuk');

    const second = insertPostIfNew(makeRawPost(), group!.id);
    expect(second).toBeNull();
  });

  it('JSON kolonlarini dizi olarak geri okur', () => {
    const group = getGroupByFbId('bedava-esya');
    const post = insertPostIfNew(
      makeRawPost({ fbPostId: '222', imageUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] }),
      group!.id,
    );
    expect(post!.imageUrls).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg']);
  });
});

describe('rules ve templates', () => {
  it('sablon olusturur', () => {
    const template = createTemplate({
      name: 'Ilgileniyorum',
      kind: 'comment',
      variants: ['Ilgileniyorum, hala duruyor mu?', 'Merhaba, benim icin ayirabilir misiniz?'],
    });
    expect(template.variants).toHaveLength(2);
    expect(listTemplates('comment')).toHaveLength(1);
    expect(listTemplates('dm')).toHaveLength(0);
  });

  it('kurali grup baglantilariyla birlikte kaydeder ve geri okur', () => {
    const group = getGroupByFbId('bedava-esya')!;
    const template = listTemplates('comment')[0]!;
    const rule = createRule({
      name: 'Koltuk avi',
      enabled: true,
      matchMode: 'any',
      includeKeywords: ['koltuk', 'kanepe'],
      excludeKeywords: ['satilik'],
      regex: null,
      actionComment: true,
      actionDm: false,
      actionNotify: true,
      requireApproval: true,
      commentTemplateId: template.id,
      dmTemplateId: null,
      dailyCap: 20,
      maxPostAgeMin: 30,
      maxDistanceKm: null,
      searchMarketplace: true,
      priority: 1,
      groupIds: [group.id],
    });
    expect(rule.groupIds).toEqual([group.id]);
    expect(rule.includeKeywords).toEqual(['koltuk', 'kanepe']);
    expect(rule.actionComment).toBe(true);
    expect(rule.actionDm).toBe(false);
  });

  it('grup baglantilarini gunceller', () => {
    const rule = getRule(1)!;
    updateRule(rule.id, { groupIds: [] });
    expect(getRule(rule.id)!.groupIds).toEqual([]);
  });
});

describe('matches ve actions', () => {
  it('ayni post+kural icin ikinci eslesme olusturmaz', () => {
    const first = createMatchIfNew(1, 1, ['koltuk'], 'pending');
    expect(first).not.toBeNull();
    const second = createMatchIfNew(1, 1, ['koltuk'], 'pending');
    expect(second).toBeNull();
  });

  it('eslesme detayini post ve kural bilgisiyle birlestirir', () => {
    const details = listMatchDetails(10);
    expect(details).toHaveLength(1);
    expect(details[0]!.post.fbPostId).toBe('111');
    expect(details[0]!.ruleName).toBe('Koltuk avi');
    expect(details[0]!.groupName).toBe('Bedava Esya');
  });

  it('hiz limiti sayaci kuyruktaki aksiyonlari da sayar', () => {
    const action = createAction(1, 'comment', 'queued', 'Ilgileniyorum');
    expect(countRealActionsSince(0)).toBe(1);
    setActionStatus(action.id, 'sent', { verified: true });
    expect(countRealActionsSince(0)).toBe(1);
    expect(countSentActionsForRuleSince(1, 0)).toBe(1);
  });

  it('telegram aksiyonlarini hiz limitine dahil etmez', () => {
    createAction(1, 'telegram', 'sent', 'bildirim');
    expect(countRealActionsSince(0)).toBe(1);
  });
});
