import { describe, expect, it } from 'vitest';
import { common } from '@/app/i18n/common';
import { createAppStore } from '@/app/state/store';
import { DiscordApiError } from '@/lib/discord/client';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import { compareSnowflakes } from '@/lib/discord/snowflake';
import type { Message, Snowflake } from '@/lib/discord/types';
import { bootDemo, createFakePlatform, createSpiedClient } from '../helpers';

const GUILD = MOCK_IDS.bigGuild;

function expectAscendingUnique(items: readonly Message[]): void {
  for (let i = 1; i < items.length; i += 1) {
    expect(compareSnowflakes(items[i - 1].id, items[i].id)).toBeLessThan(0);
  }
}

async function open(booted: Awaited<ReturnType<typeof bootDemo>>, channelId: Snowflake): Promise<void> {
  await booted.store.getState().openChannel(channelId, GUILD);
}

describe('opening a channel', () => {
  it('loads the newest 200 messages with exactly two API calls', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.edge400Channel);

    expect(booted.spies.getMessages).toHaveBeenCalledTimes(2);
    expect(booted.spies.getMessages.mock.calls[0][1]).toEqual({ limit: 100 });
    const entry = booted.store.getState().messages[MOCK_IDS.edge400Channel];
    expect(entry.status).toBe('loaded');
    expect(entry.items).toHaveLength(200);
    expect(entry.hasMore).toBe(true);
    expect(entry.loadingOlder).toBe(false);
    expectAscendingUnique(entry.items);
    // The second call continues from the oldest message of the first one.
    const firstPageOldest = booted.spies.getMessages.mock.calls[1][1]?.before;
    expect(firstPageOldest).toBe(entry.items[100].id);
    // They are the NEWEST 200 of 400: the next older page starts right before them.
    expect(entry.items[199].id).toBe((await booted.client.getMessages(MOCK_IDS.edge400Channel, { limit: 1 }))[0].id);
  });

  it('sets the view and the active channel, and fetches nothing else', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.edge400Channel);
    const state = booted.store.getState();
    expect(state.view).toEqual({ kind: 'guild', guildId: GUILD });
    expect(state.activeChannelId).toBe(MOCK_IDS.edge400Channel);
    expect(Object.keys(state.messages)).toEqual([MOCK_IDS.edge400Channel]);
  });

  it('opens a DM without a guild', async () => {
    const booted = await bootDemo();
    await booted.store.getState().openChannel(MOCK_IDS.dmFriend, null);
    const state = booted.store.getState();
    expect(state.view).toEqual({ kind: 'dms' });
    expect(state.activeChannelId).toBe(MOCK_IDS.dmFriend);
    expect(state.messages[MOCK_IDS.dmFriend].items).toHaveLength(200);
    expect(booted.spies.getGuildChannels).not.toHaveBeenCalled();
  });

  it('does not refetch a channel that is loaded or loading', async () => {
    const booted = await bootDemo();
    const first = booted.store.getState().openChannel(MOCK_IDS.edge200Channel, GUILD);
    const second = booted.store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
    await Promise.all([first, second]);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(2);

    await open(booted, MOCK_IDS.edge200Channel);
    await booted.store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(2);
  });

  it('keeps the messages of channels visited before', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.edge200Channel);
    await open(booted, MOCK_IDS.edge199Channel);
    await open(booted, MOCK_IDS.edge200Channel);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(4);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].items).toHaveLength(200);
  });

  it('shows the loading state while the first page is on its way', async () => {
    const booted = await bootDemo();
    const pending = booted.store.getState().openChannel(MOCK_IDS.edge200Channel, GUILD);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel]).toMatchObject({ status: 'loading', items: [], loadingOlder: false });
    await pending;
  });

  it('ignores forums and categories (they hold no messages)', async () => {
    const booted = await bootDemo();
    await booted.store.getState().ensureGuildTree(GUILD);
    await booted.store.getState().openChannel(MOCK_IDS.forumChannel, GUILD);
    await booted.store.getState().openChannel(MOCK_IDS.generalCategory, GUILD);
    expect(booted.spies.getMessages).not.toHaveBeenCalled();
    expect(booted.store.getState().activeChannelId).toBeNull();
    // Forum posts are readable.
    await booted.store.getState().openChannel(MOCK_IDS.forumThreads[0], GUILD);
    expect(booted.store.getState().messages[MOCK_IDS.forumThreads[0]].status).toBe('loaded');
  });
});

describe('channel sizes and hasMore', () => {
  it('an empty channel: one request, nothing more to load', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.emptyChannel);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(1);
    expect(booted.store.getState().messages[MOCK_IDS.emptyChannel]).toMatchObject({ status: 'loaded', items: [], hasMore: false });
    await booted.store.getState().loadOlderMessages(MOCK_IDS.emptyChannel);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(1);
  });

  it('199 messages: everything in the first page, the start is known', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.edge199Channel);
    const entry = booted.store.getState().messages[MOCK_IDS.edge199Channel];
    expect(entry.items).toHaveLength(199);
    expect(entry.hasMore).toBe(false);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(2);
    await booted.store.getState().loadOlderMessages(MOCK_IDS.edge199Channel);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(2);
  });

  it('exactly 200 messages: one more look finds nothing and flips hasMore', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.edge200Channel);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel]).toMatchObject({ hasMore: true });
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].items).toHaveLength(200);

    await booted.store.getState().loadOlderMessages(MOCK_IDS.edge200Channel);
    const entry = booted.store.getState().messages[MOCK_IDS.edge200Channel];
    expect(entry.items).toHaveLength(200);
    expect(entry.hasMore).toBe(false);
    expect(entry.loadingOlder).toBe(false);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(3);
  });

  it('201 messages: the older page holds the single remaining one', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.edge201Channel);
    await booted.store.getState().loadOlderMessages(MOCK_IDS.edge201Channel);
    const entry = booted.store.getState().messages[MOCK_IDS.edge201Channel];
    expect(entry.items).toHaveLength(201);
    expect(entry.hasMore).toBe(false);
    expectAscendingUnique(entry.items);
  });

  it('400 messages: older pages prepend 200 without duplicates, then the start is reached', async () => {
    const booted = await bootDemo();
    const id = MOCK_IDS.edge400Channel;
    await open(booted, id);
    const firstPage = booted.store.getState().messages[id].items;

    await booted.store.getState().loadOlderMessages(id);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(4);
    let entry = booted.store.getState().messages[id];
    expect(entry.items).toHaveLength(400);
    expect(entry.hasMore).toBe(true); // a full page: the channel might continue
    expectAscendingUnique(entry.items);
    expect(new Set(entry.items.map((m) => m.id)).size).toBe(400);
    // Prepended: the previously loaded messages keep their identity and sit at the end.
    expect(entry.items[200]).toBe(firstPage[0]);
    expect(entry.items[399]).toBe(firstPage[199]);

    await booted.store.getState().loadOlderMessages(id);
    entry = booted.store.getState().messages[id];
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(5);
    expect(entry.items).toHaveLength(400);
    expect(entry.hasMore).toBe(false);
  });

  it('401 messages: 200 + 200 + 1', async () => {
    const booted = await bootDemo();
    const id = MOCK_IDS.edge401Channel;
    await open(booted, id);
    await booted.store.getState().loadOlderMessages(id);
    expect(booted.store.getState().messages[id].items).toHaveLength(400);
    await booted.store.getState().loadOlderMessages(id);
    const entry = booted.store.getState().messages[id];
    expect(entry.items).toHaveLength(401);
    expect(entry.hasMore).toBe(false);
    expectAscendingUnique(entry.items);
  });

  it('never mutates the previous array', async () => {
    const booted = await bootDemo();
    const id = MOCK_IDS.edge400Channel;
    await open(booted, id);
    const before = booted.store.getState().messages[id].items;
    await booted.store.getState().loadOlderMessages(id);
    expect(before).toHaveLength(200);
    expect(booted.store.getState().messages[id].items).not.toBe(before);
  });
});

describe('loadOlderMessages guards', () => {
  it('does nothing for a channel that was never opened', async () => {
    const booted = await bootDemo();
    await booted.store.getState().loadOlderMessages(MOCK_IDS.edge400Channel);
    expect(booted.spies.getMessages).not.toHaveBeenCalled();
    expect(booted.store.getState().messages).toEqual({});
  });

  it('runs one older load at a time per channel', async () => {
    const booted = await bootDemo();
    const id = MOCK_IDS.edge400Channel;
    await open(booted, id);
    const a = booted.store.getState().loadOlderMessages(id);
    expect(booted.store.getState().messages[id].loadingOlder).toBe(true);
    const b = booted.store.getState().loadOlderMessages(id);
    await Promise.all([a, b]);
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(4);
    expect(booted.store.getState().messages[id].items).toHaveLength(400);
  });

  it('does not run while the first page is still loading', async () => {
    const booted = await bootDemo();
    const id = MOCK_IDS.edge400Channel;
    const opening = booted.store.getState().openChannel(id, GUILD);
    await booted.store.getState().loadOlderMessages(id);
    await opening;
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(2);
  });
});

describe('errors', () => {
  it('a failed first page shows an error and can be retried', async () => {
    const booted = await bootDemo();
    booted.spies.getMessages.mockRejectedValueOnce(new DiscordApiError('network', 'offline'));
    await open(booted, MOCK_IDS.edge200Channel);

    let entry = booted.store.getState().messages[MOCK_IDS.edge200Channel];
    expect(entry.status).toBe('error');
    expect(entry.error).toBeTruthy();
    expect(entry.items).toEqual([]);

    await booted.store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
    entry = booted.store.getState().messages[MOCK_IDS.edge200Channel];
    expect(entry.status).toBe('loaded');
    expect(entry.error).toBeUndefined();
    expect(entry.items).toHaveLength(200);
  });

  it('a failed older page keeps the messages, reports the error and can be retried', async () => {
    const booted = await bootDemo();
    const id = MOCK_IDS.edge400Channel;
    await open(booted, id);
    booted.spies.getMessages.mockRejectedValueOnce(new DiscordApiError('rate-limited', 'slow'));
    await booted.store.getState().loadOlderMessages(id);

    let entry = booted.store.getState().messages[id];
    expect(entry.status).toBe('loaded');
    expect(entry.items).toHaveLength(200);
    expect(entry.olderError).toBeTruthy();
    expect(entry.loadingOlder).toBe(false);
    expect(entry.hasMore).toBe(true);

    await booted.store.getState().loadOlderMessages(id);
    entry = booted.store.getState().messages[id];
    expect(entry.items).toHaveLength(400);
    expect(entry.olderError).toBeUndefined();
  });

  it('403 marks the channel forbidden for good', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.forbiddenChannel);
    const state = booted.store.getState();
    expect(state.messages[MOCK_IDS.forbiddenChannel]).toMatchObject({ status: 'forbidden', items: [], hasMore: false });
    expect(state.forbiddenChannels[MOCK_IDS.forbiddenChannel]).toBe(true);

    const calls = booted.spies.getMessages.mock.calls.length;
    await booted.store.getState().loadInitialMessages(MOCK_IDS.forbiddenChannel);
    await booted.store.getState().loadOlderMessages(MOCK_IDS.forbiddenChannel);
    expect(booted.spies.getMessages.mock.calls.length).toBe(calls);
  });

  it('a channel hidden by permissions still gets one try and ends up forbidden', async () => {
    const booted = await bootDemo();
    await open(booted, MOCK_IDS.hiddenChannel);
    expect(booted.store.getState().messages[MOCK_IDS.hiddenChannel].status).toBe('forbidden');
    expect(booted.store.getState().forbiddenChannels[MOCK_IDS.hiddenChannel]).toBe(true);
  });

  it('a channel that does not exist is an error, not a lock', async () => {
    const booted = await bootDemo();
    await booted.store.getState().openChannel(MOCK_IDS.unknownChannel, null);
    const state = booted.store.getState();
    expect(state.messages[MOCK_IDS.unknownChannel].status).toBe('error');
    expect(state.forbiddenChannels[MOCK_IDS.unknownChannel]).toBeUndefined();
  });

  describe('a 403 that is not a permission error (kind "unknown": anti-abuse / Cloudflare block)', () => {
    const blocked = (): DiscordApiError =>
      new DiscordApiError('unknown', 'Discord API error 403 for GET /channels/1/messages (not a missing-permission error; this may be a temporary block, try again later)', {
        status: 403,
        code: 40333,
      });

    it('shows its own message instead of "no access", does not lock the channel and keeps it selected', async () => {
      const booted = await bootDemo();
      booted.store.getState().setPrefs({ locale: 'en' });
      await booted.store.getState().ensureGuildTree(GUILD);
      booted.store.getState().toggleChannel(MOCK_IDS.edge200Channel);
      booted.spies.getMessages.mockRejectedValueOnce(blocked());
      await open(booted, MOCK_IDS.edge200Channel);

      const state = booted.store.getState();
      const entry = state.messages[MOCK_IDS.edge200Channel];
      expect(entry.status).toBe('error');
      // Built from the status only: the request path and the client's English text never reach the screen.
      expect(entry.error).toBe(common.en.errorBlocked(403));
      expect(entry.error).not.toContain('/channels/');
      expect(entry.error).not.toBe('You do not have access to this.');
      expect(state.forbiddenChannels[MOCK_IDS.edge200Channel]).toBeUndefined();
      expect(Object.keys(state.selection)).toEqual([MOCK_IDS.edge200Channel]);

      // Not a lock: a retry goes to the API again and can succeed.
      await booted.store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
      expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].status).toBe('loaded');
    });

    it('an older page that fails this way is a retryable error, not a lock either', async () => {
      const booted = await bootDemo();
      booted.store.getState().setPrefs({ locale: 'ko' });
      await open(booted, MOCK_IDS.edge400Channel);
      booted.spies.getMessages.mockRejectedValueOnce(blocked());
      await booted.store.getState().loadOlderMessages(MOCK_IDS.edge400Channel);

      const state = booted.store.getState();
      expect(state.messages[MOCK_IDS.edge400Channel].status).toBe('loaded');
      expect(state.messages[MOCK_IDS.edge400Channel].olderError).toBe(common.ko.errorBlocked(403));
      expect(state.forbiddenChannels[MOCK_IDS.edge400Channel]).toBeUndefined();
    });
  });

  it('a rate limit that bans the client for a long time says how many minutes to wait (and keeps saying it on every retry)', async () => {
    const booted = await bootDemo();
    booted.store.getState().setPrefs({ locale: 'en' });
    const banned = (waitMs: number): DiscordApiError => new DiscordApiError('rate-limited', `Discord rate limit: would have to wait ${waitMs / 1000} s.`, { retryAfterMs: waitMs });
    booted.spies.getMessages.mockRejectedValueOnce(banned(3_600_000)).mockRejectedValueOnce(banned(3_540_000));
    await open(booted, MOCK_IDS.edge200Channel);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].error).toBe(common.en.errorRateLimitedWait(60));

    // "Try again" while the ban lasts: the client refuses again, and the message tells how much is left.
    await booted.store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].error).toBe(common.en.errorRateLimitedWait(59));
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].status).toBe('error');

    // Once the client lets requests through again the same button works.
    await booted.store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].status).toBe('loaded');
  });

  describe('a language switch while an error is on screen (NEW-5)', () => {
    const blocked = (): DiscordApiError => new DiscordApiError('unknown', 'Discord API error 403 for GET /channels/1/messages', { status: 403, code: 40333 });
    const banned = (): DiscordApiError => new DiscordApiError('rate-limited', 'Discord rate limit: would have to wait 3600 s.', { retryAfterMs: 3_600_000 });

    it('says the sentence of the first page again in the new language, both ways, and keeps saying it on a retry', async () => {
      const booted = await bootDemo();
      const { store } = booted;
      store.getState().setPrefs({ locale: 'en' });
      booted.spies.getMessages.mockRejectedValueOnce(blocked());
      await open(booted, MOCK_IDS.edge200Channel);
      expect(store.getState().messages[MOCK_IDS.edge200Channel].error).toBe(common.en.errorBlocked(403));

      store.getState().setPrefs({ locale: 'ko' });
      let entry = store.getState().messages[MOCK_IDS.edge200Channel];
      expect(entry.status).toBe('error');
      expect(entry.error).toBe(common.ko.errorBlocked(403));
      store.getState().setPrefs({ locale: 'en' });
      expect(store.getState().messages[MOCK_IDS.edge200Channel].error).toBe(common.en.errorBlocked(403));

      // The retry fails too, now in Korean: the sentence is made in the language of the moment, and follows the next switch.
      store.getState().setPrefs({ locale: 'ko' });
      booted.spies.getMessages.mockRejectedValueOnce(banned());
      await store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
      entry = store.getState().messages[MOCK_IDS.edge200Channel];
      expect(entry.error).toBe(common.ko.errorRateLimitedWait(60));
      store.getState().setPrefs({ locale: 'en' });
      expect(store.getState().messages[MOCK_IDS.edge200Channel].error).toBe(common.en.errorRateLimitedWait(60));
    });

    it('does the same for the message of a failed older page, and leaves the messages themselves alone', async () => {
      const booted = await bootDemo();
      const { store } = booted;
      store.getState().setPrefs({ locale: 'en' });
      await open(booted, MOCK_IDS.edge400Channel);
      booted.spies.getMessages.mockRejectedValueOnce(banned());
      await store.getState().loadOlderMessages(MOCK_IDS.edge400Channel);
      const before = store.getState().messages[MOCK_IDS.edge400Channel];
      expect(before.olderError).toBe(common.en.errorRateLimitedWait(60));

      store.getState().setPrefs({ locale: 'ko' });
      const after = store.getState().messages[MOCK_IDS.edge400Channel];
      expect(after.olderError).toBe(common.ko.errorRateLimitedWait(60));
      expect(after.status).toBe('loaded');
      expect(after.items).toBe(before.items);

      // Retrying clears it for good: nothing of it comes back with a later switch.
      await store.getState().loadOlderMessages(MOCK_IDS.edge400Channel);
      expect(store.getState().messages[MOCK_IDS.edge400Channel].olderError).toBeUndefined();
      store.getState().setPrefs({ locale: 'en' });
      expect(store.getState().messages[MOCK_IDS.edge400Channel].olderError).toBeUndefined();
      expect(store.getState().messages[MOCK_IDS.edge400Channel].items).toHaveLength(400);
    });

    it('touches only what holds an error: the entries of other channels stay the very same objects', async () => {
      const booted = await bootDemo();
      const { store } = booted;
      store.getState().setPrefs({ locale: 'en' });
      await open(booted, MOCK_IDS.edge400Channel);
      booted.spies.getMessages.mockRejectedValueOnce(blocked());
      await open(booted, MOCK_IDS.edge200Channel);
      const healthy = store.getState().messages[MOCK_IDS.edge400Channel];

      store.getState().setPrefs({ locale: 'ko' });
      expect(store.getState().messages[MOCK_IDS.edge400Channel]).toBe(healthy);
      expect(store.getState().messages[MOCK_IDS.edge200Channel].error).toBe(common.ko.errorBlocked(403));

      // A preference that does not change the language changes no sentence either.
      const messages = store.getState().messages;
      store.getState().setPrefs({ exportFormat: 'csv' });
      expect(store.getState().messages).toBe(messages);
    });
  });

  it('a 401 sends the user to the onboarding screen', async () => {
    const booted = await bootDemo();
    booted.spies.getMessages.mockRejectedValueOnce(new DiscordApiError('auth', 'Unauthorized', { status: 401 }));
    await open(booted, MOCK_IDS.edge200Channel);
    expect(booted.store.getState().status).toBe('needs-token');
    expect(booted.platform.spies.clearToken).toHaveBeenCalled();
    expect(booted.store.getState().messages).toEqual({});
  });

  it('an aborted request is not shown to the user', async () => {
    const booted = await bootDemo();
    booted.spies.getMessages.mockRejectedValueOnce(new DiscordApiError('aborted', 'The request was aborted'));
    await open(booted, MOCK_IDS.edge200Channel);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel]).toBeUndefined();

    await booted.store.getState().loadInitialMessages(MOCK_IDS.edge200Channel);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].status).toBe('loaded');
  });
});

describe('navigating away', () => {
  /** getMessages calls that stay open until resolved; they reject like a real aborted fetch when their signal fires. */
  function holdRequests(booted: Awaited<ReturnType<typeof bootDemo>>) {
    const held: Array<{ channelId: Snowflake; resolve: (messages: Message[]) => void }> = [];
    booted.spies.getMessages.mockImplementation(
      (channelId, _options, signal) =>
        new Promise<Message[]>((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DiscordApiError('aborted', 'The request was aborted')));
          held.push({ channelId, resolve });
        }),
    );
    return held;
  }

  it('cancels the load of the channel that is no longer shown', async () => {
    const booted = await bootDemo();
    const held = holdRequests(booted);
    const first = booted.store.getState().openChannel(MOCK_IDS.edge200Channel, GUILD);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].status).toBe('loading');
    const second = booted.store.getState().openChannel(MOCK_IDS.edge199Channel, GUILD);

    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel]).toBeUndefined();
    expect(booted.store.getState().activeChannelId).toBe(MOCK_IDS.edge199Channel);
    held.find((request) => request.channelId === MOCK_IDS.edge199Channel)?.resolve([]);
    await Promise.all([first, second]);

    expect(booted.store.getState().messages[MOCK_IDS.edge199Channel].status).toBe('loaded');
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel]).toBeUndefined();

    // Coming back loads it again.
    booted.spies.getMessages.mockRestore();
    await booted.store.getState().openChannel(MOCK_IDS.edge200Channel, GUILD);
    expect(booted.store.getState().messages[MOCK_IDS.edge200Channel].items).toHaveLength(200);
  });

  it('cancels an older-page load but keeps what is loaded', async () => {
    const booted = await bootDemo();
    const id = MOCK_IDS.edge400Channel;
    await open(booted, id);
    const held = holdRequests(booted);
    const older = booted.store.getState().loadOlderMessages(id);
    expect(booted.store.getState().messages[id].loadingOlder).toBe(true);

    booted.store.getState().openDms();
    await older;
    expect(held).toHaveLength(1);
    expect(booted.store.getState().messages[id]).toMatchObject({ status: 'loaded', loadingOlder: false, hasMore: true });
    expect(booted.store.getState().messages[id].items).toHaveLength(200);
  });

  it('opening a server or the DM list cancels pending loads too', async () => {
    const booted = await bootDemo();
    holdRequests(booted);
    void booted.store.getState().openChannel(MOCK_IDS.edge200Channel, GUILD);
    await booted.store.getState().openGuild(MOCK_IDS.englishGuild);
    expect(booted.store.getState().messages).toEqual({});
    expect(booted.store.getState().activeChannelId).toBeNull();
  });

  it('a result that arrives after the session was replaced is dropped', async () => {
    const spied = createSpiedClient();
    const held: Array<(messages: Message[]) => void> = [];
    spied.spies.getMessages.mockImplementation(
      () =>
        new Promise<Message[]>((resolve) => {
          held.push(resolve);
        }),
    );
    const store = createAppStore({ getPlatform: () => createFakePlatform() });
    await store.getState().initWithClient(spied.client, MOCK_ME);
    const pending = store.getState().openChannel(MOCK_IDS.edge200Channel, GUILD);
    await store.getState().initWithClient(createSpiedClient().client, MOCK_ME);
    for (const resolve of held) resolve([]);
    await pending;
    expect(store.getState().messages).toEqual({});
  });
});
