import { afterEach, describe, expect, it, vi } from 'vitest';
import { common } from '@/app/i18n/common';
import { THREADS_RETRY_INTERVAL_MS } from '@/app/state/trees';
import { createAppStore } from '@/app/state/store';
import { DiscordApiError } from '@/lib/discord/client';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import type { Channel } from '@/lib/discord/types';
import { bootDemo, createFakePlatform, createSpiedClient } from '../helpers';

describe('ensureGuildTree', () => {
  it('fetches nothing for a server until it is opened', async () => {
    const { spies } = await bootDemo();
    expect(spies.getGuildChannels).not.toHaveBeenCalled();
  });

  it('opening a server loads its tree once and opens no channel', async () => {
    const { store, spies } = await bootDemo();
    await store.getState().openGuild(MOCK_IDS.bigGuild);

    const state = store.getState();
    expect(state.view).toEqual({ kind: 'guild', guildId: MOCK_IDS.bigGuild });
    expect(state.activeChannelId).toBeNull();
    expect(state.trees[MOCK_IDS.bigGuild].status).toBe('loaded');
    expect(state.trees[MOCK_IDS.bigGuild].tree?.guildId).toBe(MOCK_IDS.bigGuild);
    expect(spies.getGuildChannels).toHaveBeenCalledTimes(1);
    expect(spies.getMessages).not.toHaveBeenCalled();
  });

  it('filters by permissions: hidden channels get canView false, readable ones true', async () => {
    const { store } = await bootDemo();
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    const { byId } = store.getState().trees[MOCK_IDS.bigGuild].tree!;

    expect(byId[MOCK_IDS.hiddenChannel].canView).toBe(false);
    expect(byId[MOCK_IDS.memberDeniedChannel].canView).toBe(false);
    expect(byId[MOCK_IDS.generalChannel].canView).toBe(true);
    expect(byId[MOCK_IDS.roleOverwriteChannel].canView).toBe(true);
    expect(byId[MOCK_IDS.memberOverwriteChannel].canView).toBe(true);
    expect(byId[MOCK_IDS.conflictingOverwriteChannel].canView).toBe(true);
    // Looks readable according to the permission maths; only a real 403 reveals it is not.
    expect(byId[MOCK_IDS.forbiddenChannel].canView).toBe(true);
  });

  it('lists forum posts and threads under their parents', async () => {
    const { store, spies } = await bootDemo();
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    const tree = store.getState().trees[MOCK_IDS.bigGuild].tree!;

    expect(tree.threadsByParent[MOCK_IDS.forumChannel].map((n) => n.id).sort()).toEqual([...MOCK_IDS.forumThreads].sort());
    expect(tree.threadsByParent[MOCK_IDS.generalChannel]).toHaveLength(2);
    expect(spies.getActiveThreads).toHaveBeenCalledWith(MOCK_IDS.bigGuild, expect.anything());
  });

  it('does not look for threads in a server without forum / media channels', async () => {
    const { store, spies } = await bootDemo();
    await store.getState().ensureGuildTree(MOCK_IDS.englishGuild);
    expect(store.getState().trees[MOCK_IDS.englishGuild].status).toBe('loaded');
    expect(spies.getActiveThreads).not.toHaveBeenCalled();
    // Roles + member are still requested: they decide channel visibility.
    expect(spies.getGuildRoles).toHaveBeenCalledTimes(1);
    expect(spies.getMyMember).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent calls', async () => {
    const { store, spies } = await bootDemo();
    const a = store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    const b = store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(b).toBe(a);
    expect(store.getState().trees[MOCK_IDS.bigGuild].status).toBe('loading');
    await Promise.all([a, b, store.getState().openGuild(MOCK_IDS.bigGuild)]);
    expect(spies.getGuildChannels).toHaveBeenCalledTimes(1);
  });

  it('is idempotent once loaded and keeps the same tree object', async () => {
    const { store, spies } = await bootDemo();
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    const tree = store.getState().trees[MOCK_IDS.bigGuild].tree;
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(store.getState().trees[MOCK_IDS.bigGuild].tree).toBe(tree);
    expect(spies.getGuildChannels).toHaveBeenCalledTimes(1);
  });

  it('keeps other servers untouched', async () => {
    const { store } = await bootDemo();
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    const first = store.getState().trees[MOCK_IDS.bigGuild];
    await store.getState().ensureGuildTree(MOCK_IDS.englishGuild);
    expect(store.getState().trees[MOCK_IDS.bigGuild]).toBe(first);
    expect(Object.keys(store.getState().trees)).toHaveLength(2);
  });

  it('shows everything (access unknown) when the roles cannot be read', async () => {
    const { store, spies } = await bootDemo();
    spies.getGuildRoles.mockRejectedValueOnce(new DiscordApiError('forbidden', 'nope'));
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);

    const entry = store.getState().trees[MOCK_IDS.bigGuild];
    expect(entry.status).toBe('loaded');
    expect(entry.tree?.byId[MOCK_IDS.hiddenChannel].canView).toBeNull();
    expect(entry.tree?.byId[MOCK_IDS.generalChannel].canView).toBeNull();
    expect(store.getState().guildNames[MOCK_IDS.bigGuild].roles).toEqual({});
  });

  it('shows everything (access unknown) when the own member cannot be read', async () => {
    const { store, spies } = await bootDemo();
    spies.getMyMember.mockRejectedValueOnce(new DiscordApiError('not-found', 'no member'));
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(store.getState().trees[MOCK_IDS.bigGuild].tree?.byId[MOCK_IDS.hiddenChannel].canView).toBeNull();
  });

  it('still loads the tree when the thread lookup fails', async () => {
    const { store, spies } = await bootDemo();
    spies.getActiveThreads.mockRejectedValueOnce(new DiscordApiError('server', 'oops'));
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);

    const entry = store.getState().trees[MOCK_IDS.bigGuild];
    expect(entry.status).toBe('loaded');
    expect(entry.tree?.threadsByParent).toEqual({});
    // Access is still known for the regular channels.
    expect(entry.tree?.byId[MOCK_IDS.hiddenChannel].canView).toBe(false);
  });

  it('records a readable error when the channel list fails, and a later call retries', async () => {
    const { store, spies } = await bootDemo();
    spies.getGuildChannels.mockRejectedValueOnce(new DiscordApiError('network', 'offline'));
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);

    const failed = store.getState().trees[MOCK_IDS.bigGuild];
    expect(failed.status).toBe('error');
    expect(failed.tree).toBeNull();
    expect(failed.error).toBeTruthy();
    expect(spies.getGuildRoles).not.toHaveBeenCalled();

    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(store.getState().trees[MOCK_IDS.bigGuild].status).toBe('loaded');
    expect(spies.getGuildChannels).toHaveBeenCalledTimes(2);
  });

  it('the error of a server that failed to load is said again in the new language when the language is switched (NEW-5)', async () => {
    const { store, spies } = await bootDemo();
    store.getState().setPrefs({ locale: 'en' });
    spies.getGuildChannels.mockRejectedValueOnce(new DiscordApiError('unknown', 'Discord API error 403 for GET /guilds/1/channels', { status: 403 }));
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    await store.getState().ensureGuildTree(MOCK_IDS.englishGuild);
    expect(store.getState().trees[MOCK_IDS.bigGuild].error).toBe(common.en.errorBlocked(403));
    const loaded = store.getState().trees[MOCK_IDS.englishGuild];

    store.getState().setPrefs({ locale: 'ko' });
    const failed = store.getState().trees[MOCK_IDS.bigGuild];
    expect(failed.status).toBe('error');
    expect(failed.error).toBe(common.ko.errorBlocked(403));
    expect(store.getState().trees[MOCK_IDS.englishGuild]).toBe(loaded);

    store.getState().setPrefs({ locale: 'en' });
    expect(store.getState().trees[MOCK_IDS.bigGuild].error).toBe(common.en.errorBlocked(403));

    // A successful retry leaves nothing of the failure behind.
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(store.getState().trees[MOCK_IDS.bigGuild].status).toBe('loaded');
    store.getState().setPrefs({ locale: 'ko' });
    expect(store.getState().trees[MOCK_IDS.bigGuild]).not.toHaveProperty('error');
    expect(store.getState().trees[MOCK_IDS.bigGuild]).not.toHaveProperty('errorCause');
  });

  it('an unknown server ends in the error state instead of throwing', async () => {
    const { store } = await bootDemo();
    await expect(store.getState().ensureGuildTree(MOCK_IDS.unknownGuild)).resolves.toBeUndefined();
    expect(store.getState().trees[MOCK_IDS.unknownGuild].status).toBe('error');
  });

  it('a 401 while loading sends the user to the onboarding screen', async () => {
    const { store, spies, platform } = await bootDemo();
    spies.getGuildChannels.mockRejectedValueOnce(new DiscordApiError('auth', 'Unauthorized', { status: 401 }));
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(store.getState().status).toBe('needs-token');
    expect(store.getState().needsTokenReason).toBe('expired');
    expect(platform.spies.clearToken).toHaveBeenCalled();
    expect(store.getState().trees).toEqual({});
  });

  it('builds the id -> name maps used for mentions', async () => {
    const { store } = await bootDemo();
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    const names = store.getState().guildNames[MOCK_IDS.bigGuild];

    expect(names.channels[MOCK_IDS.generalChannel]).toBe('general');
    expect(names.channels[MOCK_IDS.edge400Channel]).toBe('edge-400');
    expect(names.channels[MOCK_IDS.hiddenChannel]).toBe('mod-only');
    expect(names.channels[MOCK_IDS.generalCategory]).toBeTruthy();
    expect(names.channels[MOCK_IDS.forumThreads[0]]).toBeTruthy();
    expect(names.roles[MOCK_IDS.roles.admin]).toBe('Admin');
    expect(names.roles[MOCK_IDS.roles.everyone]).toBe('@everyone');
  });

  it('drops the result when the session ended while it was loading', async () => {
    const spied = createSpiedClient();
    let release: (channels: Channel[]) => void = () => undefined;
    spied.spies.getGuildChannels.mockImplementationOnce(
      () =>
        new Promise<Channel[]>((resolve) => {
          release = resolve;
        }),
    );
    const store = createAppStore({ getPlatform: () => createFakePlatform() });
    await store.getState().initWithClient(spied.client, MOCK_ME);

    const pending = store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(store.getState().trees[MOCK_IDS.bigGuild].status).toBe('loading');
    await store.getState().initWithClient(createSpiedClient().client, MOCK_ME);
    release([]);
    await pending;

    expect(store.getState().trees).toEqual({});
    expect(store.getState().guildNames).toEqual({});
  });
});

describe('forum posts that Discord has not indexed yet (202)', () => {
  const notIndexed = (): DiscordApiError =>
    new DiscordApiError('unknown', 'Discord has not indexed this channel for search yet (HTTP 202); try again later.', {
      status: 202,
      code: 110000,
      retryAfterMs: 1000,
    });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Only `Date` is faked: promises and microtasks keep running. */
  function clock(): { advance(ms: number): void } {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-06T12:00:00Z') });
    return { advance: (ms) => vi.setSystemTime(Date.now() + ms) };
  }

  async function loadWithPendingPosts(): Promise<Awaited<ReturnType<typeof bootDemo>>> {
    const booted = await bootDemo();
    booted.spies.getActiveThreads.mockRejectedValueOnce(notIndexed());
    await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    return booted;
  }

  it('keeps the tree usable and marks its posts as pending instead of treating the empty list as final', async () => {
    clock();
    const { store } = await loadWithPendingPosts();
    const entry = store.getState().trees[MOCK_IDS.bigGuild];
    expect(entry.status).toBe('loaded');
    expect(entry.tree?.byId[MOCK_IDS.generalChannel]).toBeDefined();
    expect(entry.tree?.threadsByParent).toEqual({});
    expect(entry.threadsPendingAt).toBe(Date.now());
  });

  it('every other failure of the lookup is final: nothing is marked pending, and nothing is asked again', async () => {
    const time = clock();
    for (const error of [new DiscordApiError('server', 'oops', { status: 503 }), new DiscordApiError('network', 'offline'), new DiscordApiError('unknown', 'bad', { status: 400 })]) {
      const { store, spies } = await bootDemo();
      spies.getActiveThreads.mockRejectedValueOnce(error);
      await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
      expect(store.getState().trees[MOCK_IDS.bigGuild].threadsPendingAt).toBeUndefined();

      time.advance(10 * THREADS_RETRY_INTERVAL_MS);
      await store.getState().openGuild(MOCK_IDS.bigGuild);
      expect(spies.getActiveThreads).toHaveBeenCalledTimes(1);
    }
  });

  it('re-opening the server asks again, but never more often than every 30 seconds', async () => {
    const time = clock();
    const { store, spies } = await loadWithPendingPosts();
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(1);

    time.advance(THREADS_RETRY_INTERVAL_MS - 1);
    await store.getState().openGuild(MOCK_IDS.bigGuild);
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(1);

    time.advance(1);
    await store.getState().openGuild(MOCK_IDS.bigGuild);
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(2);
    // The mock answers now: the posts are there and the tree is final.
    const entry = store.getState().trees[MOCK_IDS.bigGuild];
    expect(entry.tree?.threadsByParent[MOCK_IDS.forumChannel].map((n) => n.id).sort()).toEqual([...MOCK_IDS.forumThreads].sort());
    expect(entry.threadsPendingAt).toBeUndefined();
    expect(store.getState().guildNames[MOCK_IDS.bigGuild].channels[MOCK_IDS.forumThreads[0]]).toBeTruthy();

    time.advance(10 * THREADS_RETRY_INTERVAL_MS);
    await store.getState().openGuild(MOCK_IDS.bigGuild);
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(2);
  });

  it('a retry that is answered with 202 again waits another 30 seconds', async () => {
    const time = clock();
    const { store, spies } = await loadWithPendingPosts();
    spies.getActiveThreads.mockRejectedValueOnce(notIndexed());
    time.advance(THREADS_RETRY_INTERVAL_MS);
    await store.getState().openGuild(MOCK_IDS.bigGuild);
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(2);
    expect(store.getState().trees[MOCK_IDS.bigGuild].threadsPendingAt).toBe(Date.now());

    time.advance(THREADS_RETRY_INTERVAL_MS - 1);
    await store.getState().openGuild(MOCK_IDS.bigGuild);
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(2);
    time.advance(1);
    await store.getState().openGuild(MOCK_IDS.bigGuild);
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(3);
    expect(store.getState().trees[MOCK_IDS.bigGuild].threadsPendingAt).toBeUndefined();
  });

  it('the tree stays loaded while the lookup repeats, and one that fails leaves the old tree and the hold-off in place', async () => {
    const time = clock();
    const { store, spies } = await loadWithPendingPosts();
    const before = store.getState().trees[MOCK_IDS.bigGuild].tree;
    const seen: string[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.trees[MOCK_IDS.bigGuild].status));

    spies.getGuildChannels.mockRejectedValueOnce(new DiscordApiError('network', 'offline'));
    time.advance(THREADS_RETRY_INTERVAL_MS);
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    unsubscribe();

    const entry = store.getState().trees[MOCK_IDS.bigGuild];
    expect(seen.every((status) => status === 'loaded')).toBe(true);
    expect(entry.status).toBe('loaded');
    expect(entry.tree).toBe(before);
    expect(entry.error).toBeUndefined();
    expect(entry.threadsPendingAt).toBe(Date.now());
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(spies.getGuildChannels).toHaveBeenCalledTimes(2);
  });

  it('concurrent calls share one retry', async () => {
    const time = clock();
    const { store, spies } = await loadWithPendingPosts();
    time.advance(THREADS_RETRY_INTERVAL_MS);
    const first = store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    const second = store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(second).toBe(first);
    await first;
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(2);
  });

  it('opening a channel does not repeat the lookup (it would only queue ahead of the messages)', async () => {
    const time = clock();
    const { store, spies } = await loadWithPendingPosts();
    time.advance(THREADS_RETRY_INTERVAL_MS);
    await store.getState().openChannel(MOCK_IDS.generalChannel, MOCK_IDS.bigGuild);
    expect(spies.getActiveThreads).toHaveBeenCalledTimes(1);
    expect(spies.getGuildChannels).toHaveBeenCalledTimes(1);
  });

  it('selecting the whole server asks again and then includes the posts that turned up', async () => {
    const time = clock();
    const { store } = await loadWithPendingPosts();
    time.advance(THREADS_RETRY_INTERVAL_MS);
    await store.getState().toggleGuild(MOCK_IDS.bigGuild);
    for (const id of MOCK_IDS.forumThreads) expect(store.getState().selection[id]).toBeDefined();
  });

  it('a 401 during the retry sends the user to the onboarding screen', async () => {
    const time = clock();
    const { store, spies } = await loadWithPendingPosts();
    spies.getGuildChannels.mockRejectedValueOnce(new DiscordApiError('auth', 'Unauthorized', { status: 401 }));
    time.advance(THREADS_RETRY_INTERVAL_MS);
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    expect(store.getState().status).toBe('needs-token');
  });
});
