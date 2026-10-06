import { describe, expect, it } from 'vitest';
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
