import type {
  Group,
  MatchDetail,
  Post,
  Rule,
  Template,
} from '../../server/src/types.ts';

export type { Group, MatchDetail, Post, Rule, Template };

export interface Settings {
  agentToken: string;
  dryRun: boolean;
  killSwitch: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  maxActionsPerHour: number;
  maxActionsPerDay: number;
  minActionGapSec: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  pauseCollectionInQuietHours: boolean;
  turkishSuffixMatching: boolean;
  homeLat: number;
  homeLon: number;
  homeLabel: string;
  notificationsEnabled: boolean;
  notificationsRefreshMs: number;
  groupSweepMs: number;
  cycleGapMs: number;
  jitterRatio: number;
  selectorHealthThreshold: number;
  heartbeatTimeoutSec: number;
}

export interface TelegramChat {
  id: string;
  title: string;
  /** private | group | supergroup | channel */
  type: string;
}

export interface TelegramDiscovery {
  botUsername: string;
  chats: TelegramChat[];
}

export interface RuleProbe {
  ruleId: number;
  ruleName: string;
  enabled: boolean;
  /** Metni bu terimden ibaret bir gonderi bu kurala takilir miydi. */
  matched: boolean;
  reason: string | null;
  includeHits: string[];
  excludeHits: string[];
  /** Terim listede birebir yaziyor mu. Onek eslesmesi varken null olabilir. */
  listedIn: 'include' | 'exclude' | null;
}

export interface KeywordProbe {
  query: string;
  results: RuleProbe[];
}

export interface AgentStatus {
  connected: boolean;
  lastHeartbeatAt: number | null;
  extVersion: string | null;
  lastBlock: { kind: string; at: number; url: string; note?: string } | null;
  consecutiveEmptyRounds: number;
  lastParseAt: number | null;
  currentGroup: string | null;
}

export interface StatusResponse {
  agent: AgentStatus;
  alive: boolean;
  dryRun: boolean;
  killSwitch: boolean;
  telegramConfigured: boolean;
}

export interface AgentEvent {
  id: number;
  kind: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  payload: unknown;
  createdAt: number;
}

/** Sunucudan gelen hata mesajini kullaniciya oldugu gibi gosterebilmek icin. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Content-Type yalnizca gercekten govde varsa gonderilir. Govdesiz bir istege
  // (DELETE, govdesiz POST) application/json eklemek sunucunun JSON ayristiricisini
  // bos govde uzerinde calistirir ve istek 400 ile reddedilir.
  if (init?.body !== undefined && init.body !== null) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`/api${path}`, { ...init, headers });

  if (!response.ok) {
    let message = `Istek basarisiz (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* govde JSON degilse varsayilan mesaj kalir */
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const body = (value: unknown): RequestInit['body'] => JSON.stringify(value);

export interface Area {
  name: string;
  lat: number;
  lon: number;
}

export const api = {
  status: () => request<StatusResponse>('/status'),
  listAreas: () => request<Area[]>('/areas'),

  getSettings: () => request<Settings>('/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PATCH', body: body(patch) }),
  regenerateToken: () =>
    request<{ token: string }>('/settings/agent-token/regenerate', { method: 'POST' }),
  telegramTest: () => request<{ ok: boolean }>('/settings/telegram-test', { method: 'POST' }),
  telegramChats: () => request<TelegramDiscovery>('/settings/telegram-chats'),

  listGroups: () => request<Group[]>('/groups'),
  createGroup: (input: { url: string; name?: string }) =>
    request<Group>('/groups', { method: 'POST', body: body(input) }),
  updateGroup: (id: number, patch: Partial<Group>) =>
    request<Group>(`/groups/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteGroup: (id: number) => request<void>(`/groups/${id}`, { method: 'DELETE' }),

  listRules: () => request<Rule[]>('/rules'),
  probeKeyword: (query: string) =>
    request<KeywordProbe>(`/rules/probe?q=${encodeURIComponent(query)}`),
  createRule: (input: Partial<Rule> & { name: string; includeKeywords: string[] }) =>
    request<Rule>('/rules', { method: 'POST', body: body(input) }),
  updateRule: (id: number, patch: Partial<Rule>) =>
    request<Rule>(`/rules/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteRule: (id: number) => request<void>(`/rules/${id}`, { method: 'DELETE' }),

  listTemplates: () => request<Template[]>('/templates'),
  createTemplate: (input: Pick<Template, 'name' | 'kind' | 'variants'>) =>
    request<Template>('/templates', { method: 'POST', body: body(input) }),
  updateTemplate: (id: number, patch: Partial<Template>) =>
    request<Template>(`/templates/${id}`, { method: 'PATCH', body: body(patch) }),
  deleteTemplate: (id: number) => request<void>(`/templates/${id}`, { method: 'DELETE' }),

  listPosts: (limit = 50) => request<Post[]>(`/posts?limit=${limit}`),
  clearPosts: () => request<{ removed: number }>('/posts', { method: 'DELETE' }),
  listMatches: (limit = 50) => request<MatchDetail[]>(`/matches?limit=${limit}`),
  listEvents: (limit = 100) => request<AgentEvent[]>(`/events?limit=${limit}`),
};
