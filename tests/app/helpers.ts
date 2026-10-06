import { vi, type MockInstance } from 'vitest';
import type { StoreDeps } from '@/app/state/context';
import { createAppStore, type AppStore } from '@/app/state/store';
import { DEFAULT_PREFS, type DiscordTabInfo, type Platform, type Prefs } from '@/app/platform/types';
import type { DiscordClient } from '@/lib/discord/client';
import { createMockClient, MOCK_ME } from '@/lib/discord/mock';
import { compareSnowflakes } from '@/lib/discord/snowflake';
import type { Message, User } from '@/lib/discord/types';

export const TOKEN = 'test-user-token.Gabcde.abcdefghijklmnopqrstuvwxyz0123456789';

export interface FakePlatform extends Platform {
  token: string | null;
  tabs: DiscordTabInfo[];
  prefs: Prefs;
  emitToken(token: string | null): void;
  readonly listenerCount: () => number;
  readonly spies: {
    getToken: MockInstance<Platform['getToken']>;
    clearToken: MockInstance<Platform['clearToken']>;
    findDiscordTabs: MockInstance<Platform['findDiscordTabs']>;
    reloadDiscordTabs: MockInstance<Platform['reloadDiscordTabs']>;
    openDiscord: MockInstance<Platform['openDiscord']>;
    loadPrefs: MockInstance<Platform['loadPrefs']>;
    savePrefs: MockInstance<Platform['savePrefs']>;
  };
}

/** In-memory Platform with a controllable token and tab list; every method is a spy. */
export function createFakePlatform(initial: { token?: string | null; prefs?: Prefs; tabs?: DiscordTabInfo[] } = {}): FakePlatform {
  const listeners = new Set<(token: string | null) => void>();
  const fake = {
    kind: 'extension' as const,
    token: initial.token ?? null,
    tabs: initial.tabs ?? [],
    prefs: initial.prefs ?? DEFAULT_PREFS,
    emitToken(token: string | null) {
      fake.token = token;
      for (const listener of [...listeners]) listener(token);
    },
    listenerCount: () => listeners.size,
    getToken: vi.fn(async () => fake.token),
    onTokenChange: vi.fn((callback: (token: string | null) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    }),
    // Compare-and-clear like ChromePlatform: a 401 for an old token must not wipe a newer capture.
    clearToken: vi.fn(async (expectedToken?: string) => {
      if (expectedToken === undefined || fake.token === expectedToken) fake.token = null;
    }),
    findDiscordTabs: vi.fn(async () => [...fake.tabs]),
    reloadDiscordTabs: vi.fn(async () => fake.tabs.length),
    openDiscord: vi.fn(async () => undefined),
    loadPrefs: vi.fn(async () => fake.prefs),
    savePrefs: vi.fn(async (prefs: Prefs) => {
      fake.prefs = prefs;
    }),
  };
  return Object.assign(fake, {
    spies: {
      getToken: fake.getToken,
      clearToken: fake.clearToken,
      findDiscordTabs: fake.findDiscordTabs,
      reloadDiscordTabs: fake.reloadDiscordTabs,
      openDiscord: fake.openDiscord,
      loadPrefs: fake.loadPrefs,
      savePrefs: fake.savePrefs,
    },
  }) as unknown as FakePlatform;
}

export interface SpiedClient {
  client: DiscordClient;
  spies: { [K in 'getMe' | 'getGuilds' | 'getGuildChannels' | 'getActiveThreads' | 'getGuildRoles' | 'getMyMember' | 'getDmChannels' | 'getMessages']: MockInstance<DiscordClient[K]> };
}

/** A zero-latency mock client whose methods are spied on (the real implementation still runs). */
export function createSpiedClient(): SpiedClient {
  const client = createMockClient({ latencyMs: 0 });
  return {
    client,
    spies: {
      getMe: vi.spyOn(client, 'getMe'),
      getGuilds: vi.spyOn(client, 'getGuilds'),
      getGuildChannels: vi.spyOn(client, 'getGuildChannels'),
      getActiveThreads: vi.spyOn(client, 'getActiveThreads'),
      getGuildRoles: vi.spyOn(client, 'getGuildRoles'),
      getMyMember: vi.spyOn(client, 'getMyMember'),
      getDmChannels: vi.spyOn(client, 'getDmChannels'),
      getMessages: vi.spyOn(client, 'getMessages'),
    },
  };
}

export interface BootedDemo extends SpiedClient {
  store: AppStore;
  platform: FakePlatform;
}

/** A store booted through the real demo path (`init()` with ?mock=1) on a zero-latency spied mock client. */
export async function bootDemo(overrides: Partial<StoreDeps> = {}, user: User = MOCK_ME): Promise<BootedDemo> {
  const spied = createSpiedClient();
  const platform = createFakePlatform();
  const store = createAppStore({
    getPlatform: () => platform,
    isMockRequested: () => true,
    loadDemo: async () => ({ client: spied.client, me: user }),
    ...overrides,
  });
  await store.getState().init();
  return { ...spied, store, platform };
}

/**
 * Every message of a demo channel, oldest first. Read through a client of its own, so the requests do not show up in the
 * request log of the client the store under test uses.
 */
export async function fullHistory(channelId: string): Promise<Message[]> {
  const client = createMockClient({ latencyMs: 0 });
  const all: Message[] = [];
  let cursor = '0';
  for (;;) {
    const page = await client.getMessages(channelId, { after: cursor, limit: 100 });
    if (page.length === 0) break;
    const ascending = [...page].sort((a, b) => compareSnowflakes(a.id, b.id));
    all.push(...ascending);
    cursor = ascending[ascending.length - 1].id;
    if (page.length < 100) break;
  }
  return all;
}
