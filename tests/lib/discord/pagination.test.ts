import { describe, expect, it } from 'vitest';
import { DiscordApiError } from '@/lib/discord/client';
import type { DiscordClient, GetMessagesOptions } from '@/lib/discord/client';
import { fetchMessagePage } from '@/lib/discord/pagination';
import { compareSnowflakes } from '@/lib/discord/snowflake';
import type { Message } from '@/lib/discord/types';
import { UI_PAGE_SIZE } from '@/shared/constants';

const CHANNEL = '500000000000000000';

function msg(n: number): Message {
  return {
    id: String(1_000_000_000_000_000_000n + BigInt(n)),
    channel_id: CHANNEL,
    author: { id: '1', username: 'u' },
    content: `m${n}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    edited_timestamp: null,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
  };
}

/** A channel holding messages 1..total. Behaves like the real API: newest first, honours `before` and `limit`. */
class FakeClient implements DiscordClient {
  readonly kind = 'mock' as const;
  readonly calls: { opts: GetMessagesOptions; signal: AbortSignal | undefined }[] = [];
  onCall?: (callNumber: number) => void;

  constructor(private readonly total: number) {}

  private all(): Message[] {
    return Array.from({ length: this.total }, (_, i) => msg(this.total - i)); // newest first
  }

  async getMessages(_channelId: string, opts: GetMessagesOptions = {}, signal?: AbortSignal): Promise<Message[]> {
    this.calls.push({ opts, signal });
    this.onCall?.(this.calls.length);
    const older = opts.before === undefined ? this.all() : this.all().filter((m) => compareSnowflakes(m.id, opts.before!) < 0);
    return older.slice(0, opts.limit ?? 50);
  }

  async getMe(): Promise<never> {
    throw new Error('not used');
  }
  async getGuilds(): Promise<never> {
    throw new Error('not used');
  }
  async getGuildChannels(): Promise<never> {
    throw new Error('not used');
  }
  async getActiveThreads(): Promise<never> {
    throw new Error('not used');
  }
  async getGuildRoles(): Promise<never> {
    throw new Error('not used');
  }
  async getMyMember(): Promise<never> {
    throw new Error('not used');
  }
  async getDmChannels(): Promise<never> {
    throw new Error('not used');
  }
}

const numbers = (messages: Message[]): number[] => messages.map((m) => Number(BigInt(m.id) - 1_000_000_000_000_000_000n));

describe('fetchMessagePage', () => {
  it('chains two sequential 100-message requests for a default 200-message page, oldest first', async () => {
    const client = new FakeClient(1000);
    const page = await fetchMessagePage(client, CHANNEL);

    expect(UI_PAGE_SIZE).toBe(200);
    expect(client.calls.map((c) => c.opts.limit)).toEqual([100, 100]);
    expect(client.calls[0]!.opts.before).toBeUndefined();
    expect('before' in client.calls[0]!.opts).toBe(false);
    // The cursor of the 2nd request is the oldest id of the 1st response (message 901).
    expect(client.calls[1]!.opts.before).toBe(msg(901).id);
    expect(page.messages).toHaveLength(200);
    expect(numbers(page.messages)[0]).toBe(801);
    expect(numbers(page.messages).at(-1)).toBe(1000);
    expect(numbers(page.messages)).toEqual(Array.from({ length: 200 }, (_, i) => 801 + i));
    expect(page.hasMore).toBe(true);
  });

  it('passes the "before" cursor to the first request', async () => {
    const client = new FakeClient(1000);
    const page = await fetchMessagePage(client, CHANNEL, { before: msg(500).id });
    expect(client.calls[0]!.opts.before).toBe(msg(500).id);
    expect(numbers(page.messages)).toEqual(Array.from({ length: 200 }, (_, i) => 300 + i));
    expect(page.hasMore).toBe(true);
  });

  it('collects exactly 200 messages from 2 calls even if the channel ends right there, and reports hasMore until it is empty', async () => {
    const client = new FakeClient(200);
    const first = await fetchMessagePage(client, CHANNEL);
    expect(client.calls).toHaveLength(2);
    expect(first.messages).toHaveLength(200);
    expect(first.hasMore).toBe(true); // we cannot know that nothing older exists

    const second = await fetchMessagePage(client, CHANNEL, { before: first.messages[0]!.id });
    expect(client.calls).toHaveLength(3);
    expect(second.messages).toEqual([]);
    expect(second.hasMore).toBe(false);
  });

  it('stops at a short page and reports hasMore=false', async () => {
    const client = new FakeClient(150);
    const page = await fetchMessagePage(client, CHANNEL);
    expect(client.calls.map((c) => c.opts.limit)).toEqual([100, 100]);
    expect(page.messages).toHaveLength(150);
    expect(numbers(page.messages)[0]).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it('does not ask again after a short first page', async () => {
    const client = new FakeClient(37);
    const page = await fetchMessagePage(client, CHANNEL);
    expect(client.calls).toHaveLength(1);
    expect(page.messages).toHaveLength(37);
    expect(page.hasMore).toBe(false);
  });

  it('returns an empty page for an empty channel', async () => {
    const client = new FakeClient(0);
    expect(await fetchMessagePage(client, CHANNEL)).toEqual({ messages: [], hasMore: false });
    expect(client.calls).toHaveLength(1);
  });

  it('asks only for what is missing in the last request', async () => {
    const client = new FakeClient(1000);
    const page = await fetchMessagePage(client, CHANNEL, { size: 250 });
    expect(client.calls.map((c) => c.opts.limit)).toEqual([100, 100, 50]);
    expect(page.messages).toHaveLength(250);
    expect(page.hasMore).toBe(true);

    const small = new FakeClient(1000);
    await fetchMessagePage(small, CHANNEL, { size: 30 });
    expect(small.calls.map((c) => c.opts.limit)).toEqual([30]);
  });

  it('reports hasMore=false when the last, partial request comes back short', async () => {
    const client = new FakeClient(120);
    const page = await fetchMessagePage(client, CHANNEL, { size: 150 });
    expect(client.calls.map((c) => c.opts.limit)).toEqual([100, 50]);
    expect(page.messages).toHaveLength(120);
    expect(page.hasMore).toBe(false);
  });

  it('reports hasMore=true when the last, partial request is full', async () => {
    const client = new FakeClient(1000);
    const page = await fetchMessagePage(client, CHANNEL, { size: 150 });
    expect(page.messages).toHaveLength(150);
    expect(page.hasMore).toBe(true);
  });

  it('clamps nonsensical sizes to at least one message', async () => {
    const client = new FakeClient(10);
    const page = await fetchMessagePage(client, CHANNEL, { size: 0 });
    expect(client.calls.map((c) => c.opts.limit)).toEqual([1]);
    expect(page.messages).toHaveLength(1);
  });

  it('de-duplicates messages that show up in two responses', async () => {
    const newest = Array.from({ length: 100 }, (_, i) => msg(300 - i)); // 300..201
    const overlapping = Array.from({ length: 100 }, (_, i) => msg(205 - i)); // 205..106 (205..201 repeat)
    const responses = [newest, overlapping];
    const client = new FakeClient(0);
    client.getMessages = async (_id, opts = {}) => {
      client.calls.push({ opts, signal: undefined });
      return responses[client.calls.length - 1] ?? [];
    };
    const page = await fetchMessagePage(client, CHANNEL);
    expect(page.messages).toHaveLength(195);
    expect(new Set(page.messages.map((m) => m.id)).size).toBe(195);
    expect(numbers(page.messages)[0]).toBe(106);
    expect(numbers(page.messages).at(-1)).toBe(300);
    // The 2nd request used the oldest id of the 1st response as its cursor; the 3rd (5 missing messages) the oldest seen so far.
    expect(client.calls[1]!.opts.before).toBe(msg(201).id);
    expect(client.calls[2]!.opts).toEqual({ before: msg(106).id, limit: 5 });
  });

  it('stops instead of looping when a full page contains nothing new', async () => {
    const same = Array.from({ length: 100 }, (_, i) => msg(100 - i));
    const client = new FakeClient(0);
    client.getMessages = async (_id, opts = {}) => {
      client.calls.push({ opts, signal: undefined });
      return same;
    };
    const page = await fetchMessagePage(client, CHANNEL, { size: 500 });
    expect(client.calls).toHaveLength(2);
    expect(page.messages).toHaveLength(100);
    expect(page.hasMore).toBe(false);
  });

  it('sorts oldest first even if the API order is odd', async () => {
    const client = new FakeClient(0);
    client.getMessages = async (_id, opts = {}) => {
      client.calls.push({ opts, signal: undefined });
      return [msg(2), msg(9), msg(5)];
    };
    const page = await fetchMessagePage(client, CHANNEL, { size: 10 });
    expect(numbers(page.messages)).toEqual([2, 5, 9]);
  });

  it('forwards the signal to every request', async () => {
    const client = new FakeClient(1000);
    const controller = new AbortController();
    await fetchMessagePage(client, CHANNEL, {}, controller.signal);
    expect(client.calls.map((c) => c.signal)).toEqual([controller.signal, controller.signal]);
  });

  it('rejects with an aborted error, without any request, for an already aborted signal', async () => {
    const client = new FakeClient(1000);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchMessagePage(client, CHANNEL, {}, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
    expect(client.calls).toHaveLength(0);
  });

  it('stops between requests when aborted after the first response', async () => {
    const client = new FakeClient(1000);
    const controller = new AbortController();
    client.onCall = (n) => {
      if (n === 1) controller.abort();
    };
    const error = await fetchMessagePage(client, CHANNEL, {}, controller.signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiscordApiError);
    expect((error as DiscordApiError).kind).toBe('aborted');
    expect(client.calls).toHaveLength(1);
  });

  it('propagates client errors unchanged (the UI retries)', async () => {
    const client = new FakeClient(1000);
    const failure = new DiscordApiError('forbidden', 'Missing Access', { status: 403 });
    client.getMessages = async () => {
      throw failure;
    };
    await expect(fetchMessagePage(client, CHANNEL)).rejects.toBe(failure);
  });

  it('propagates an error from the second request too', async () => {
    const client = new FakeClient(1000);
    const failure = new DiscordApiError('network', 'offline');
    const original = client.getMessages.bind(client);
    client.getMessages = async (id, opts, signal) => {
      if (client.calls.length >= 1) throw failure;
      return original(id, opts, signal);
    };
    await expect(fetchMessagePage(client, CHANNEL)).rejects.toBe(failure);
  });
});
