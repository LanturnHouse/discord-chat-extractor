import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS } from '@/app/platform/types';
import { createAppStore } from '@/app/state/store';
import { DiscordApiError } from '@/lib/discord/client';
import type { LiveDiscordClientOptions } from '@/lib/discord/api';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import type { User } from '@/lib/discord/types';
import { TOKEN, bootDemo, createFakePlatform, createSpiedClient } from '../helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The part of the state that must never contain the login (functions and handles are not data). */
function plainState(state: ReturnType<ReturnType<typeof createAppStore>['getState']>): string {
  const { platform: _platform, client: _client, ...data } = state;
  return JSON.stringify(data, (_key, value: unknown) => (typeof value === 'function' ? undefined : value));
}

describe('demo boot', () => {
  it('loads the server list and the DM list - metadata only, no message request', async () => {
    const { store, spies } = await bootDemo();
    const state = store.getState();

    expect(state.status).toBe('ready');
    expect(state.mode).toBe('demo');
    expect(state.me).toEqual(MOCK_ME);
    expect(state.guilds.length).toBeGreaterThan(3);
    expect(state.guilds[0].id).toBe(MOCK_IDS.bigGuild);
    expect(state.dms.length).toBeGreaterThan(20);
    expect(state.view).toEqual({ kind: 'dms' });
    expect(state.activeChannelId).toBeNull();

    expect(spies.getGuilds).toHaveBeenCalledTimes(1);
    expect(spies.getDmChannels).toHaveBeenCalledTimes(1);
    expect(spies.getMessages).not.toHaveBeenCalled();
    expect(spies.getGuildChannels).not.toHaveBeenCalled();
    expect(spies.getActiveThreads).not.toHaveBeenCalled();
    expect(spies.getGuildRoles).not.toHaveBeenCalled();
    expect(spies.getMyMember).not.toHaveBeenCalled();
  });

  it('keeps the raw guild entries next to the view models', async () => {
    const { store } = await bootDemo();
    const { guilds, guildSummaries } = store.getState();
    for (const guild of guilds) {
      expect(guildSummaries[guild.id].name).toBe(guild.name);
    }
    expect(Object.keys(guildSummaries)).toHaveLength(guilds.length);
  });

  it('sorts DMs with the most recent conversation first', async () => {
    const { store } = await bootDemo();
    const { dms } = store.getState();
    const withMessages = dms.filter((dm) => dm.lastMessageId !== null);
    expect(withMessages.length).toBeGreaterThan(5);
    expect(dms.findIndex((dm) => dm.id === MOCK_IDS.dmEmpty)).toBeGreaterThan(dms.indexOf(withMessages[withMessages.length - 1]) - 1);
  });

  it('works with the real lazy demo loader when no loader is injected', async () => {
    const platform = createFakePlatform();
    const store = createAppStore({ getPlatform: () => platform, isMockRequested: () => true });
    await store.getState().init();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().me?.username).toBe(MOCK_ME.username);
  });

  it('init() is idempotent: a StrictMode double effect boots once', async () => {
    const spied = createSpiedClient();
    const platform = createFakePlatform();
    const loadDemo = vi.fn(async () => ({ client: spied.client, me: MOCK_ME }));
    const store = createAppStore({ getPlatform: () => platform, isMockRequested: () => true, loadDemo });

    const first = store.getState().init();
    const second = store.getState().init();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await store.getState().init();

    expect(platform.spies.loadPrefs).toHaveBeenCalledTimes(1);
    expect(loadDemo).toHaveBeenCalledTimes(1);
    expect(spied.spies.getGuilds).toHaveBeenCalledTimes(1);
  });

  it('shows a readable fatal error when the demo cannot load, and retry() recovers', async () => {
    const spied = createSpiedClient();
    spied.spies.getGuilds.mockRejectedValueOnce(new DiscordApiError('network', 'offline'));
    const platform = createFakePlatform({ prefs: { ...DEFAULT_PREFS, locale: 'en' } });
    const store = createAppStore({
      getPlatform: () => platform,
      isMockRequested: () => true,
      loadDemo: async () => ({ client: spied.client, me: MOCK_ME }),
    });
    await store.getState().init();

    expect(store.getState().status).toBe('fatal');
    expect(store.getState().fatalError).toBe('Could not reach Discord. Check your network connection.');

    await store.getState().retry();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().fatalError).toBeNull();
  });

  it('retry() does nothing unless the boot failed', async () => {
    const { store, spies } = await bootDemo();
    await store.getState().retry();
    expect(spies.getGuilds).toHaveBeenCalledTimes(1);
  });
});

describe('initWithClient (test seam)', () => {
  it('boots with the given client and derives the mode from it', async () => {
    const { client, spies } = createSpiedClient();
    const store = createAppStore({ getPlatform: () => createFakePlatform() });
    await store.getState().initWithClient(client, MOCK_ME);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().mode).toBe('demo');
    expect(store.getState().client).toBe(client);
    expect(spies.getMessages).not.toHaveBeenCalled();
  });

  it('a second boot replaces all data of the first one', async () => {
    const first = createSpiedClient();
    const store = createAppStore({ getPlatform: () => createFakePlatform() });
    await store.getState().initWithClient(first.client, MOCK_ME);
    await store.getState().openChannel(MOCK_IDS.edge199Channel, MOCK_IDS.bigGuild);
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    store.getState().toggleChannel(MOCK_IDS.edge199Channel);
    expect(Object.keys(store.getState().messages)).toHaveLength(1);
    expect(Object.keys(store.getState().selection)).toHaveLength(1);

    const second = createSpiedClient();
    await store.getState().initWithClient(second.client, MOCK_ME);
    const state = store.getState();
    expect(state.client).toBe(second.client);
    expect(state.messages).toEqual({});
    expect(state.selection).toEqual({});
    expect(state.trees).toEqual({});
    expect(state.view).toEqual({ kind: 'dms' });
  });
});

describe('preferences and locale', () => {
  it('loads the stored prefs and resolves the locale', async () => {
    const platform = createFakePlatform({ prefs: { exportFormat: 'xlsx', htmlTheme: 'light', locale: 'en' } });
    const { store } = await bootDemo({ getPlatform: () => platform });
    expect(store.getState().prefs).toEqual({ exportFormat: 'xlsx', htmlTheme: 'light', locale: 'en' });
    expect(store.getState().locale).toBe('en');
  });

  it("'auto' follows the browser language", async () => {
    vi.stubGlobal('navigator', { language: 'ko-KR' });
    const korean = await bootDemo();
    expect(korean.store.getState().locale).toBe('ko');

    vi.stubGlobal('navigator', { language: 'fr-FR' });
    const other = await bootDemo();
    expect(other.store.getState().locale).toBe('en');
  });

  it("'auto' without any language information is Korean, the product default; an explicit choice still wins", async () => {
    vi.stubGlobal('navigator', {});
    const unknown = await bootDemo();
    expect(unknown.store.getState().locale).toBe('ko');

    const chosen = await bootDemo({ getPlatform: () => createFakePlatform({ prefs: { ...DEFAULT_PREFS, locale: 'en' } }) });
    expect(chosen.store.getState().locale).toBe('en');

    unknown.store.getState().setPrefs({ locale: 'en' });
    expect(unknown.store.getState().locale).toBe('en');
    unknown.store.getState().setPrefs({ locale: 'auto' });
    expect(unknown.store.getState().locale).toBe('ko');
  });

  it('falls back to the defaults when the prefs cannot be read', async () => {
    const platform = createFakePlatform();
    platform.spies.loadPrefs.mockRejectedValueOnce(new Error('storage unavailable'));
    const { store } = await bootDemo({ getPlatform: () => platform });
    expect(store.getState().status).toBe('ready');
    expect(store.getState().prefs).toEqual(DEFAULT_PREFS);
  });

  it('setPrefs merges, persists and re-resolves the locale', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    const { store, platform } = await bootDemo();
    expect(store.getState().locale).toBe('en');

    store.getState().setPrefs({ exportFormat: 'csv', locale: 'ko' });
    expect(store.getState().prefs).toEqual({ exportFormat: 'csv', htmlTheme: 'dark', locale: 'ko' });
    expect(store.getState().locale).toBe('ko');
    await vi.waitFor(() => expect(platform.spies.savePrefs).toHaveBeenCalledTimes(1));
    expect(platform.spies.savePrefs).toHaveBeenCalledWith({ exportFormat: 'csv', htmlTheme: 'dark', locale: 'ko' });
  });

  it('setPrefs ignores undefined values and unchanged prefs', async () => {
    const { store, platform } = await bootDemo();
    store.getState().setPrefs({ htmlTheme: undefined });
    store.getState().setPrefs({ htmlTheme: 'dark' });
    expect(platform.spies.savePrefs).not.toHaveBeenCalled();
    expect(store.getState().prefs).toEqual(DEFAULT_PREFS);
  });

  it('a failing savePrefs does not break anything', async () => {
    const { store, platform } = await bootDemo();
    platform.spies.savePrefs.mockRejectedValueOnce(new Error('quota'));
    store.getState().setPrefs({ htmlTheme: 'light' });
    await Promise.resolve();
    expect(store.getState().prefs.htmlTheme).toBe('light');
  });
});

describe('live boot', () => {
  function liveSetup(options: { token?: string | null; prefs?: typeof DEFAULT_PREFS } = {}) {
    const platform = createFakePlatform({ token: options.token === undefined ? TOKEN : options.token, prefs: options.prefs ?? { ...DEFAULT_PREFS, locale: 'en' } });
    const spied = createSpiedClient();
    const created: LiveDiscordClientOptions[] = [];
    const store = createAppStore({
      getPlatform: () => platform,
      isMockRequested: () => false,
      createLiveClient: (clientOptions) => {
        created.push(clientOptions);
        return spied.client;
      },
    });
    return { store, platform, spied, created };
  }

  it('with a token: validates it, loads the metadata and is ready', async () => {
    const { store, spied, created, platform } = liveSetup();
    await store.getState().init();

    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.mode).toBe('live');
    expect(state.me).toEqual(MOCK_ME);
    expect(spied.spies.getMe).toHaveBeenCalledTimes(1);
    expect(state.guilds.length).toBeGreaterThan(0);
    expect(spied.spies.getMessages).not.toHaveBeenCalled();

    // The client carries the token the session was validated with; the store state never contains it.
    expect(created).toHaveLength(1);
    expect(await created[0].getToken()).toBe(TOKEN);
    expect(plainState(state)).not.toContain(TOKEN);
    expect(platform.listenerCount()).toBe(1);
  });

  it('without a token: shows the onboarding state and continues by itself when a token appears', async () => {
    const { store, platform, spied } = liveSetup({ token: null });
    await store.getState().init();

    expect(store.getState().status).toBe('needs-token');
    expect(store.getState().needsTokenReason).toBe('no-token');
    expect(store.getState().tokenDetected).toBe(false);
    expect(platform.listenerCount()).toBe(1);
    expect(spied.spies.getMe).not.toHaveBeenCalled();

    platform.emitToken(TOKEN);
    expect(store.getState().tokenDetected).toBe(true);
    expect(store.getState().status).toBe('needs-token');

    await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
    expect(store.getState().tokenDetected).toBe(false);
    expect(store.getState().me).toEqual(MOCK_ME);
    expect(spied.spies.getMe).toHaveBeenCalledTimes(1);
    expect(plainState(store.getState())).not.toContain(TOKEN);
  });

  it('a token cleared again does not start a boot', async () => {
    const { store, platform, spied } = liveSetup({ token: null });
    await store.getState().init();
    platform.emitToken(null);
    await Promise.resolve();
    expect(store.getState().tokenDetected).toBe(false);
    expect(spied.spies.getMe).not.toHaveBeenCalled();
  });

  it('a token that arrives while the storage is being read is not missed', async () => {
    const { store, platform } = liveSetup({ token: null });
    let calls = 0;
    platform.spies.getToken.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? null : TOKEN;
    });
    await store.getState().init();
    await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
  });

  it("a rejected token (getMe 401) leads to 'invalid' and is forgotten", async () => {
    const { store, platform, spied, created } = liveSetup();
    spied.spies.getMe.mockImplementationOnce(async () => {
      // The live client also reports 401 through onAuthError; during validation that must not turn into 'expired'.
      created[0].onAuthError?.(TOKEN);
      throw new DiscordApiError('auth', 'Unauthorized', { status: 401 });
    });
    await store.getState().init();

    expect(store.getState().status).toBe('needs-token');
    expect(store.getState().needsTokenReason).toBe('invalid');
    expect(store.getState().tokenDetected).toBe(false);
    expect(platform.spies.clearToken).toHaveBeenCalledTimes(1);
    expect(platform.spies.clearToken).toHaveBeenCalledWith(TOKEN);
    expect(store.getState().client).toBeNull();
  });

  it('other getMe failures are fatal, readable, and retry() boots again', async () => {
    const { store, spied } = liveSetup();
    spied.spies.getMe.mockRejectedValueOnce(new DiscordApiError('server', 'Bad gateway', { status: 502 }));
    await store.getState().init();

    expect(store.getState().status).toBe('fatal');
    expect(store.getState().fatalError).toBe('Discord server error. Please try again in a moment.');

    await store.getState().retry();
    expect(store.getState().status).toBe('ready');
    expect(spied.spies.getMe).toHaveBeenCalledTimes(2);
  });

  it('a failing server list is fatal too', async () => {
    const { store, spied } = liveSetup();
    spied.spies.getGuilds.mockRejectedValueOnce(new DiscordApiError('rate-limited', 'slow down'));
    await store.getState().init();
    expect(store.getState().status).toBe('fatal');
    expect(store.getState().fatalError).toContain('rate limit');
  });

  it('a 401 after boot sends the user back to the onboarding screen and drops all data', async () => {
    const { store, platform, created } = liveSetup();
    await store.getState().init();
    await store.getState().openChannel(MOCK_IDS.edge199Channel, MOCK_IDS.bigGuild);
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    store.getState().toggleChannel(MOCK_IDS.edge199Channel);
    expect(Object.keys(store.getState().selection)).toHaveLength(1);

    created[0].onAuthError?.(TOKEN);

    const state = store.getState();
    expect(state.status).toBe('needs-token');
    expect(state.needsTokenReason).toBe('expired');
    expect(platform.spies.clearToken).toHaveBeenCalledTimes(1);
    expect(platform.spies.clearToken).toHaveBeenCalledWith(TOKEN);
    expect(state.client).toBeNull();
    expect(state.me).toBeNull();
    expect(state.guilds).toEqual([]);
    expect(state.messages).toEqual({});
    expect(state.selection).toEqual({});
  });

  it('continues automatically with the next captured token after an expiry', async () => {
    const { store, platform, created } = liveSetup();
    await store.getState().init();
    created[0].onAuthError?.(TOKEN);
    expect(store.getState().status).toBe('needs-token');

    platform.emitToken(TOKEN);
    await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
    expect(created).toHaveLength(2);
    expect(store.getState().guilds.length).toBeGreaterThan(0);
  });

  it('a stale client cannot fire onAuthError into a newer session', async () => {
    const { store, platform, created } = liveSetup();
    await store.getState().init();
    created[0].onAuthError?.(TOKEN);
    platform.emitToken(TOKEN);
    await vi.waitFor(() => expect(store.getState().status).toBe('ready'));

    created[0].onAuthError?.(TOKEN);
    expect(store.getState().status).toBe('ready');
  });

  describe('a token captured while the session is ready (SEC-4 / STATE-5)', () => {
    const OTHER_TOKEN = `${TOKEN}-other`;

    it('neither re-verifies nor reloads the session: it keeps its client, its token and its data', async () => {
      const { store, platform, spied, created } = liveSetup();
      await store.getState().init();
      const guildsBefore = store.getState().guilds;
      store.getState().setDmFilter('alice');

      platform.emitToken(OTHER_TOKEN);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(spied.spies.getMe).toHaveBeenCalledTimes(1);
      expect(spied.spies.getGuilds).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect(store.getState().status).toBe('ready');
      expect(store.getState().guilds).toBe(guildsBefore);
      expect(store.getState().dmFilter).toBe('alice');
      // The session keeps signing its requests with the token it was validated with, whatever is stored now.
      expect(await created[0].getToken()).toBe(TOKEN);
    });

    it('two signed-in accounts alternating in storage do not make the app flap, reload or drop the selection', async () => {
      const { store, platform, spied, created } = liveSetup();
      await store.getState().init();
      await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
      store.getState().toggleChannel(MOCK_IDS.edge199Channel);
      const other: User = { ...MOCK_ME, id: '4242', username: 'someone_else', global_name: 'Someone Else' };
      spied.spies.getMe.mockResolvedValue(other);

      for (const token of [OTHER_TOKEN, TOKEN, OTHER_TOKEN, TOKEN, OTHER_TOKEN]) {
        platform.emitToken(token);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(created).toHaveLength(1);
      expect(spied.spies.getMe).toHaveBeenCalledTimes(1);
      expect(store.getState().me).toEqual(MOCK_ME);
      expect(Object.keys(store.getState().selection)).toEqual([MOCK_IDS.edge199Channel]);
      expect(await created[0].getToken()).toBe(TOKEN);
    });

    it("picks the newer token up the normal way: after the session's own token was rejected", async () => {
      const { store, platform, created } = liveSetup();
      await store.getState().init();
      platform.emitToken(OTHER_TOKEN);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(created).toHaveLength(1);

      // The old login is revoked: the request it signed answers 401.
      created[0].onAuthError?.(TOKEN);

      await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
      expect(created).toHaveLength(2);
      expect(await created[1].getToken()).toBe(OTHER_TOKEN);
      expect(platform.token).toBe(OTHER_TOKEN);
      expect(platform.spies.clearToken).toHaveBeenCalledWith(TOKEN);
    });
  });

  describe('a 401 for an old token must not wipe a newer one (SEC-5 / STATE-4)', () => {
    const NEWER_TOKEN = `${TOKEN}-newer`;

    it("the fake platform's clearToken is a compare-and-clear like ChromePlatform's (so tests need no override)", async () => {
      const platform = createFakePlatform({ token: NEWER_TOKEN });
      await platform.clearToken(TOKEN);
      expect(platform.token).toBe(NEWER_TOKEN);
      await platform.clearToken(NEWER_TOKEN);
      expect(platform.token).toBeNull();

      platform.emitToken(TOKEN);
      await platform.clearToken();
      expect(platform.token).toBeNull();
    });

    it('a 401 after boot clears only the token that was rejected, and the newer one is used right away', async () => {
      const { store, platform, created } = liveSetup();
      await store.getState().init();
      platform.emitToken(NEWER_TOKEN);

      created[0].onAuthError?.(TOKEN);

      expect(platform.spies.clearToken).toHaveBeenCalledWith(TOKEN);
      expect(platform.token).toBe(NEWER_TOKEN);
      // No storage change announces a token that was already stored, so the app must go and fetch it itself.
      await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
      expect(created).toHaveLength(2);
      expect(store.getState().tokenDetected).toBe(false);
    });

    it("a stale token that fails validation does not take a newer capture down with it ('invalid' at boot)", async () => {
      const { store, platform, spied, created } = liveSetup();
      spied.spies.getMe.mockImplementationOnce(async () => {
        platform.emitToken(NEWER_TOKEN); // captured while the old one is being validated: ignored by the watcher (booting)
        throw new DiscordApiError('auth', 'Unauthorized', { status: 401 });
      });
      await store.getState().init();

      await vi.waitFor(() => expect(store.getState().status).toBe('ready'));
      expect(platform.spies.clearToken).toHaveBeenCalledWith(TOKEN);
      expect(platform.token).toBe(NEWER_TOKEN);
      expect(created).toHaveLength(2);
      expect(await created[1].getToken()).toBe(NEWER_TOKEN);
    });

    it('does not try the rejected token again when it could not be cleared (no endless boot loop)', async () => {
      const { store, platform, created } = liveSetup();
      platform.spies.clearToken.mockRejectedValue(new Error('storage unavailable'));
      await store.getState().init();

      created[0].onAuthError?.(TOKEN);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(store.getState().status).toBe('needs-token');
      expect(created).toHaveLength(1);
      expect(platform.token).toBe(TOKEN);
    });

    it('a rejected token that was cleared leaves the onboarding screen waiting for the next capture', async () => {
      const { store, platform, created } = liveSetup();
      await store.getState().init();

      created[0].onAuthError?.(TOKEN);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(platform.token).toBeNull();
      expect(store.getState().status).toBe('needs-token');
      expect(store.getState().tokenDetected).toBe(false);
      expect(created).toHaveLength(1);
    });

    it('a failing token read after the clear is not an error either', async () => {
      const { store, platform, created } = liveSetup();
      await store.getState().init();
      platform.spies.getToken.mockRejectedValue(new Error('storage unavailable'));

      created[0].onAuthError?.(TOKEN);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(store.getState().status).toBe('needs-token');
    });
  });

  it('demo mode never watches tokens', async () => {
    const { platform } = await bootDemo();
    expect(platform.listenerCount()).toBe(0);
  });
});

describe('startDemoMode', () => {
  it('asks the environment to reload in demo mode', () => {
    const navigateToDemo = vi.fn();
    const store = createAppStore({ navigateToDemo });
    store.getState().startDemoMode();
    expect(navigateToDemo).toHaveBeenCalledTimes(1);
  });
});
