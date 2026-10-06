import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordApiError, type DiscordClient, type GetMessagesOptions } from '../../../src/lib/discord/client';
import { createMockClient, MOCK_IDS } from '../../../src/lib/discord/mock';
import { MAX_SNOWFLAKE, snowflakeToTimestamp, timestampToSnowflake } from '../../../src/lib/discord/snowflake';
import type { Message, Snowflake, User } from '../../../src/lib/discord/types';
import { htmlFormat } from '../../../src/lib/export/formats/html';
import { jsonFormat } from '../../../src/lib/export/formats/json';
import { mdFormat } from '../../../src/lib/export/formats/md';
import { txtFormat } from '../../../src/lib/export/formats/txt';
import { runExport, type RunExportArgs } from '../../../src/lib/export/runner';
import {
  MAX_EXPORT_LIMIT,
  type ExportFormat,
  type ExportOptions,
  type ExportProgress,
  type ExportScope,
  type ExportTarget,
  type WriterContext,
  type WriterSummary,
} from '../../../src/lib/export/types';

/**
 * The scope of an export: the default one in ExportOptions and the per-target override in ExportTarget.scope.
 * The fake client follows Discord's paging rules (`after` => the OLDEST messages after the cursor, otherwise the NEWEST ones
 * before the cursor, always newest first), so a runner that gets the direction or an inclusive/exclusive cursor wrong fails here.
 */

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const SECOND = 1000;
const NOW = new Date(2026, 9, 6, 12, 0, 0);
const ALICE: User = { id: '1001', username: 'alice', global_name: 'Alice A.' };

/** Message `i` of a channel, created `i` seconds after T0. Its id is the bare snowflake of that millisecond. */
function msg(i: number, overrides: Partial<Message> = {}, channelId = 'big'): Message {
  const ms = T0 + i * SECOND;
  return {
    id: timestampToSnowflake(ms),
    channel_id: channelId,
    author: ALICE,
    content: `message ${i}`,
    timestamp: new Date(ms).toISOString(),
    edited_timestamp: null,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
    ...overrides,
  };
}

function messages(count: number, first = 1): Message[] {
  return Array.from({ length: count }, (_, k) => msg(first + k));
}

/** ISO time of message `i`. */
const at = (i: number): string => new Date(T0 + i * SECOND).toISOString();
const idsOf = (list: readonly Message[]): string[] => list.map((m) => m.id);
const newest = (all: readonly Message[], n: number): Message[] => all.slice(Math.max(0, all.length - n));
const repeat = <T>(value: T, times: number): T[] => Array.from({ length: times }, () => value);

/** A channel of 1,000 messages: 10 full pages, the adversarial size for page boundaries. */
const BIG = messages(1000);

interface Call {
  channelId: Snowflake;
  opts: GetMessagesOptions;
  signal: AbortSignal | undefined;
}

interface FakeOptions {
  /** Throw this error instead of answering. `afterCalls` = number of successful calls for that channel first. */
  errors?: Record<Snowflake, { error: Error; afterCalls?: number }>;
  /** Runs at the start of every call (may abort...). */
  onCall?(call: Call, index: number): void;
  /** Answer with up to 100 messages whatever `limit` says. */
  ignoreLimit?: boolean;
  /** Treat `before` as inclusive (pages overlap): the page then repeats the message the cursor points at, plus `limit` older ones. */
  beforeInclusive?: boolean;
  /** Answer the FIRST request that has a `before` cursor with messages up to this many ms NEWER than the cursor (a sloppy server). */
  firstBeforeSlackMs?: number;
  /** Ignore `before` altogether: every request answers with the newest messages. */
  ignoreBefore?: boolean;
}

class ScopedClient implements DiscordClient {
  readonly kind = 'mock' as const;
  readonly calls: Call[] = [];
  private readonly served = new Map<Snowflake, number>();
  private beforeRequests = 0;

  constructor(
    private readonly channels: Record<Snowflake, Message[]>,
    private readonly fake: FakeOptions = {},
  ) {}

  /** The `limit` request parameters, in order. */
  get limits(): (number | undefined)[] {
    return this.calls.map((c) => c.opts.limit);
  }

  async getMessages(channelId: Snowflake, opts: GetMessagesOptions = {}, signal?: AbortSignal): Promise<Message[]> {
    const call: Call = { channelId, opts, signal };
    this.calls.push(call);
    this.fake.onCall?.(call, this.calls.length - 1);
    if (signal?.aborted) throw new DiscordApiError('aborted', 'aborted');

    const served = this.served.get(channelId) ?? 0;
    this.served.set(channelId, served + 1);
    const failure = this.fake.errors?.[channelId];
    if (failure && served >= (failure.afterCalls ?? 0)) throw failure.error;

    const limit = this.fake.ignoreLimit ? 100 : (opts.limit ?? 50);
    expect(limit).toBeGreaterThanOrEqual(1);
    expect(limit).toBeLessThanOrEqual(100);
    expect(opts.before === undefined || opts.after === undefined, 'the runner never sends both cursors').toBe(true);

    const all = [...(this.channels[channelId] ?? [])].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    if (opts.after !== undefined) {
      const after = BigInt(opts.after);
      return all.filter((m) => BigInt(m.id) > after).slice(0, limit).reverse();
    }
    let older = all;
    let take = limit;
    if (opts.before !== undefined && !this.fake.ignoreBefore) {
      let bound = BigInt(opts.before);
      if (this.fake.firstBeforeSlackMs !== undefined && this.beforeRequests === 0) {
        bound = BigInt(timestampToSnowflake(snowflakeToTimestamp(opts.before) + this.fake.firstBeforeSlackMs));
      }
      this.beforeRequests += 1;
      const inclusive = this.fake.beforeInclusive === true;
      older = all.filter((m) => (inclusive ? BigInt(m.id) <= bound : BigInt(m.id) < bound));
      if (inclusive) take += 1;
    }
    return older.slice(Math.max(0, older.length - take)).reverse();
  }

  private unsupported(): never {
    throw new Error('not used by the export runner');
  }
  getMe(): Promise<User> {
    return this.unsupported();
  }
  getGuilds(): never {
    return this.unsupported();
  }
  getGuildChannels(): never {
    return this.unsupported();
  }
  getActiveThreads(): never {
    return this.unsupported();
  }
  getGuildRoles(): never {
    return this.unsupported();
  }
  getMyMember(): never {
    return this.unsupported();
  }
  getDmChannels(): never {
    return this.unsupported();
  }
}

function target(id: string, overrides: Partial<ExportTarget> = {}): ExportTarget {
  return {
    channelId: id,
    kind: 'text',
    channelName: `chan-${id}`,
    guildId: 'g1',
    guildName: 'Guild',
    categoryName: 'Cat',
    parentChannelName: null,
    topic: null,
    ...overrides,
  };
}

const scope = (after: string | null, before: string | null, limit: number | null): ExportScope => ({ after, before, limit });

const OPTIONS: ExportOptions = {
  format: 'txt',
  after: null,
  before: null,
  limit: null,
  htmlTheme: 'dark',
  locale: 'en',
  timeZone: 'UTC',
};

const withScope = (s: Partial<ExportScope>): ExportOptions => ({ ...OPTIONS, ...s });

interface WriterLog {
  contexts: WriterContext[];
  batches: { channelId: Snowflake; messages: Message[] }[];
  ends: { channelId: Snowflake; summary: WriterSummary }[];
}

/** Text format whose files are "# name", one id per line, "-- count". Records everything the runner hands to writers. */
function recordingFormat(): { format: ExportFormat; log: WriterLog } {
  const log: WriterLog = { contexts: [], batches: [], ends: [] };
  const format: ExportFormat = {
    id: 'txt',
    label: 'Text',
    extension: 'txt',
    mime: 'text/plain',
    createWriter(ctx) {
      log.contexts.push(ctx);
      const channelId = ctx.target.channelId;
      return {
        start: () => [`# ${ctx.target.channelName}\n`],
        write: (batch) => {
          log.batches.push({ channelId, messages: [...batch] });
          return [batch.map((m) => `${m.id}\n`).join('')];
        },
        end: (summary) => {
          log.ends.push({ channelId, summary });
          return [`-- ${summary.messageCount}\n`];
        },
      };
    },
  };
  return { format, log };
}

interface Harness {
  progress: ExportProgress[];
  run(overrides?: Partial<RunExportArgs>): ReturnType<typeof runExport>;
}

function harness(client: DiscordClient, targets: ExportTarget[], format: ExportFormat, base: Partial<RunExportArgs> = {}): Harness {
  const progress: ExportProgress[] = [];
  return {
    progress,
    run: (overrides = {}) =>
      runExport({
        client,
        targets,
        format,
        options: OPTIONS,
        now: () => NOW,
        onProgress: (p) => progress.push(p),
        ...base,
        ...overrides,
      }),
  };
}

/** Everything written for one channel, oldest first; also asserts the batches never overlap and never exceed 100. */
function deliveredFor(log: WriterLog, channelId: Snowflake): string[] {
  const batches = log.batches.filter((b) => b.channelId === channelId);
  for (const batch of batches) expect(batch.messages.length).toBeLessThanOrEqual(100);
  const ids = batches.flatMap((b) => idsOf(b.messages));
  for (let i = 1; i < ids.length; i += 1) expect(BigInt(ids[i]) > BigInt(ids[i - 1]), `ids ascending at ${i}`).toBe(true);
  return ids;
}

async function unzipBlob(blob: Blob): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

const lastOf = <T>(list: T[]): T => list[list.length - 1];

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------------------

describe('newest N messages (a count without dates)', () => {
  // [N, limit parameter of every request]. A page that is full proves nothing about the end of the channel, so asking for more
  // than exists costs one more (empty) request when the last page is full.
  const table: [number, number[]][] = [
    [1, [1]],
    [99, [99]],
    [100, [100]],
    [101, [100, 1]],
    [199, [100, 99]],
    [200, [100, 100]],
    [250, [100, 100, 50]],
    [999, [...repeat(100, 9), 99]],
    [1000, repeat(100, 10)],
    [1001, [...repeat(100, 10), 1]],
    [5000, repeat(100, 11)],
  ];

  it.each(table)('N = %i exports the newest N in order, exactly once, with the expected requests', async (n, limits) => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ options: withScope({ limit: n }) });

    const expected = newest(BIG, n);
    expect(deliveredFor(log, 'big')).toEqual(idsOf(expected));
    expect(out.messageCount).toBe(expected.length);
    expect(client.limits).toEqual(limits);
    expect(out.failures).toEqual([]);
    expect(log.ends[0].summary).toEqual({
      messageCount: expected.length,
      firstTimestamp: expected[0].timestamp,
      lastTimestamp: lastOf(expected).timestamp,
    });
  });

  it('starts at the present (no `before`) and then walks back from the OLDEST id of each page', async () => {
    const client = new ScopedClient({ big: BIG });
    await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ limit: 250 }) });
    expect(client.calls.map((c) => c.opts)).toEqual([
      { limit: 100 },
      { before: BIG[900].id, limit: 100 },
      { before: BIG[800].id, limit: 50 },
    ]);
    expect('before' in client.calls[0].opts).toBe(false);
    expect('after' in client.calls[0].opts).toBe(false);
  });

  it('never gives a writer more than 100 messages per call and feeds the oldest page first', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ limit: 250 }) });
    // pages arrive newest first (100, 100, 50) but the file is written oldest first
    expect(log.batches.map((b) => b.messages.length)).toEqual([50, 100, 100]);
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 250)));
  });

  it('writes nothing until the walk is over: a file cannot start with its oldest message before that is known', async () => {
    const { format, log } = recordingFormat();
    const writtenBeforeRequest: number[] = [];
    const client = new ScopedClient({ big: BIG }, { onCall: () => writtenBeforeRequest.push(log.batches.length) });
    await harness(client, [target('big')], format).run({ options: withScope({ limit: 300 }) });
    expect(writtenBeforeRequest).toEqual([0, 0, 0]);
    expect(log.batches).toHaveLength(3);
  });

  it('is a valid, empty file for an empty channel (one request is enough to know)', async () => {
    const client = new ScopedClient({ big: [] });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big', { channelName: 'quiet' })], format).run({ options: withScope({ limit: 50 }) });
    expect(client.calls.map((c) => c.opts)).toEqual([{ limit: 50 }]);
    expect(out.fileCount).toBe(1);
    expect(out.messageCount).toBe(0);
    expect(await out.blob.text()).toBe('# quiet\n-- 0\n');
    expect(log.ends[0].summary).toEqual({ messageCount: 0, firstTimestamp: null, lastTimestamp: null });
  });

  it('exports a channel smaller than N completely, without an error', async () => {
    const small = messages(30);
    const client = new ScopedClient({ big: small });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ options: withScope({ limit: 100 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(small));
    expect(out.failures).toEqual([]);
    // a short page is the channel start
    expect(client.limits).toEqual([100]);
  });

  it('needs one more (empty) request when the channel size is an exact multiple of the page size', async () => {
    const client = new ScopedClient({ big: messages(200) });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ limit: 500 }) });
    expect(deliveredFor(log, 'big')).toHaveLength(200);
    expect(client.limits).toEqual([100, 100, 100]);
  });

  it('stops at a short page in the middle of a long export', async () => {
    const client = new ScopedClient({ big: messages(250) });
    await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ limit: 1000 }) });
    expect(client.limits).toEqual([100, 100, 100]);
  });

  it('keeps the newest N of a client that returns pages in either order', async () => {
    const reversed = new ScopedClient({ big: BIG });
    const original = reversed.getMessages.bind(reversed);
    vi.spyOn(reversed, 'getMessages').mockImplementation(async (channelId, opts, signal) => (await original(channelId, opts, signal)).reverse());
    const { format, log } = recordingFormat();
    await harness(reversed, [target('big')], format).run({ options: withScope({ limit: 250 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 250)));
  });

  it('works with the real txt writer: newest N in the file, in order', async () => {
    const out = await harness(new ScopedClient({ big: BIG }), [target('big', { channelName: 'general' })], txtFormat).run({ options: withScope({ limit: 3 }) });
    const text = await out.blob.text();
    expect(text).toContain('Range: newest 3 messages\n');
    const bodies = [...text.matchAll(/\n(message \d+)\n/g)].map((m) => m[1]);
    expect(bodies).toEqual(['message 998', 'message 999', 'message 1000']);
    expect(text).toContain('Messages: 3\n');
  });
});

describe('newest N up to a date (before + count)', () => {
  it('includes the message at exactly `before` and starts the walk at the next millisecond', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    const before = at(500);
    await harness(client, [target('big')], format).run({ options: withScope({ before, limit: 10 }) });

    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(490, 500)));
    expect(lastOf(log.batches[0].messages).timestamp).toBe(before);
    const first = client.calls[0].opts;
    expect(first).toEqual({ before: timestampToSnowflake(Date.parse(before) + 1), limit: 10 });
    // `before` is exclusive: the cursor must be past the bare id of the message AT `before`, and not past the next message
    expect(BigInt(first.before as string)).toBeGreaterThan(BigInt(BIG[499].id));
    expect(BigInt(first.before as string)).toBeLessThanOrEqual(BigInt(BIG[500].id));
  });

  it('includes every message of the `before` millisecond, whatever its sequence bits', async () => {
    const twinA = msg(5);
    const twinB = { ...msg(5), id: String(BigInt(msg(5).id) + 3n), content: 'twin' };
    const twinC = { ...msg(5), id: String(BigInt(msg(5).id) + 4_000n), content: 'twin 2' };
    const channel = [...messages(4), twinA, twinB, twinC, ...messages(10, 6)];
    const { format, log } = recordingFormat();
    await harness(new ScopedClient({ big: channel }), [target('big')], format).run({ options: withScope({ before: twinA.timestamp, limit: 100 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf([...messages(4), twinA, twinB, twinC]));
  });

  it('continues backwards from the oldest id of each page', async () => {
    const client = new ScopedClient({ big: BIG });
    await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ before: at(700), limit: 250 }) });
    expect(client.calls.map((c) => c.opts)).toEqual([
      { before: timestampToSnowflake(T0 + 700 * SECOND + 1), limit: 100 },
      { before: BIG[600].id, limit: 100 },
      { before: BIG[500].id, limit: 50 },
    ]);
  });

  it('exports what exists up to `before` when there are fewer than N', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ before: at(30), limit: 100 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(0, 30)));
    expect(client.calls).toHaveLength(1);
  });

  it('is an empty file when `before` precedes every message', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ options: withScope({ before: new Date(T0).toISOString(), limit: 5 }) });
    expect(out.messageCount).toBe(0);
    expect(out.fileCount).toBe(1);
    expect(log.batches).toHaveLength(0);
    expect(client.calls).toHaveLength(1);
  });

  it('behaves like "from now" when `before` is in the future', async () => {
    const { format, log } = recordingFormat();
    await harness(new ScopedClient({ big: BIG }), [target('big')], format).run({ options: withScope({ before: '2099-01-01T00:00:00.000Z', limit: 5 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 5)));
  });

  it('handles a `before` that is not after the Discord epoch', async () => {
    const client = new ScopedClient({ big: BIG });
    await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ before: '2000-01-01T00:00:00.000Z', limit: 5 }) });
    expect(client.calls[0].opts).toEqual({ before: '0', limit: 5 });
  });
});

describe('the first N messages from a start date (after + count)', () => {
  it('starts exactly at `after` (inclusive) and takes N going forward', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    const after = at(100);
    await harness(client, [target('big')], format).run({ options: withScope({ after, limit: 250 }) });

    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(99, 349)));
    expect(log.batches[0].messages[0].timestamp).toBe(after);
    // message 100's id is the bare snowflake of its millisecond: an exclusive cursor must sit just below it
    expect(BigInt(client.calls[0].opts.after as string)).toBe(BigInt(BIG[99].id) - 1n);
    expect(client.calls.map((c) => c.opts.limit)).toEqual([100, 100, 50]);
    expect(client.calls.map((c) => c.opts.after)).toEqual([String(BigInt(BIG[99].id) - 1n), BIG[198].id, BIG[298].id]);
    expect(client.calls.every((c) => c.opts.before === undefined)).toBe(true);
  });

  it('stops as soon as N messages are in hand: no request just to prove the end', async () => {
    const client = new ScopedClient({ big: BIG });
    await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ after: at(1), limit: 100 }) });
    expect(client.limits).toEqual([100]);
    const exact = new ScopedClient({ big: BIG });
    await harness(exact, [target('big')], recordingFormat().format).run({ options: withScope({ after: at(1), limit: 1000 }) });
    expect(exact.limits).toEqual(repeat(100, 10));
  });

  it('takes a single message with N = 1, and asks for one only', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ after: at(42), limit: 1 }) });
    expect(deliveredFor(log, 'big')).toEqual([BIG[41].id]);
    expect(client.limits).toEqual([1]);
  });

  it('writes each page as it arrives (memory stays flat), at most 100 per batch', async () => {
    const { format, log } = recordingFormat();
    const writtenBeforeRequest: number[] = [];
    const client = new ScopedClient({ big: BIG }, { onCall: () => writtenBeforeRequest.push(log.batches.length) });
    await harness(client, [target('big')], format).run({ options: withScope({ after: at(1), limit: 350 }) });
    expect(writtenBeforeRequest).toEqual([0, 1, 2, 3]);
    expect(log.batches.map((b) => b.messages.length)).toEqual([100, 100, 100, 50]);
  });

  it('exports through the end of the channel when fewer than N remain', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ after: at(950), limit: 1000 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(949)));
    expect(client.calls).toHaveLength(1);
  });

  it('needs the empty page after a full last page when the end is not reached by the count', async () => {
    const client = new ScopedClient({ big: BIG });
    await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ after: at(1), limit: 5000 }) });
    expect(client.limits).toEqual(repeat(100, 11));
  });

  it('is an empty file when `after` is later than every message', async () => {
    const client = new ScopedClient({ big: BIG });
    const out = await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ after: '2030-01-01T00:00:00.000Z', limit: 5 }) });
    expect(out.messageCount).toBe(0);
    expect(out.fileCount).toBe(1);
    expect(client.calls).toHaveLength(1);
  });

  describe('with `before` as well', () => {
    it('exports the whole window when it holds fewer than N, and stops once past `before`', async () => {
      const client = new ScopedClient({ big: BIG });
      const { format, log } = recordingFormat();
      await harness(client, [target('big')], format).run({ options: withScope({ after: at(10), before: at(20), limit: 500 }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(9, 20)));
      expect(client.limits).toEqual([100]);
    });

    it('takes only the first N of a larger window', async () => {
      const client = new ScopedClient({ big: BIG });
      const { format, log } = recordingFormat();
      await harness(client, [target('big')], format).run({ options: withScope({ after: at(10), before: at(600), limit: 150 }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(9, 159)));
      expect(client.limits).toEqual([100, 50]);
    });

    it('takes the whole window when it holds exactly N, the boundaries included', async () => {
      const client = new ScopedClient({ big: BIG });
      const { format, log } = recordingFormat();
      await harness(client, [target('big')], format).run({ options: withScope({ after: at(10), before: at(109), limit: 100 }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(9, 109)));
      expect(client.limits).toEqual([100]);
    });

    it('takes N = window size - 1 and leaves the message at `before` out', async () => {
      const { format, log } = recordingFormat();
      await harness(new ScopedClient({ big: BIG }), [target('big')], format).run({ options: withScope({ after: at(10), before: at(20), limit: 10 }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(9, 19)));
    });

    it('treats a window of a single instant as valid', async () => {
      const { format, log } = recordingFormat();
      const out = await harness(new ScopedClient({ big: BIG }), [target('big')], format).run({ options: withScope({ after: at(7), before: at(7), limit: 5 }) });
      expect(deliveredFor(log, 'big')).toEqual([BIG[6].id]);
      expect(out.messageCount).toBe(1);
    });
  });
});

describe('without a count nothing changed', () => {
  it('pages forward with limit 100 and the `after` cursor chain', async () => {
    const client = new ScopedClient({ big: messages(250) });
    await harness(client, [target('big')], recordingFormat().format).run();
    expect(client.calls.map((c) => c.opts)).toEqual([
      { after: '0', limit: 100 },
      { after: messages(250)[99].id, limit: 100 },
      { after: messages(250)[199].id, limit: 100 },
    ]);
  });

  it('keeps the window [after, before] complete, however many messages it holds', async () => {
    const { format, log } = recordingFormat();
    await harness(new ScopedClient({ big: BIG }), [target('big')], format).run({ options: withScope({ after: at(10), before: at(900) }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(9, 900)));
  });
});

describe('misbehaving clients', () => {
  it('forward: never delivers more than N even when the client ignores `limit`', async () => {
    const client = new ScopedClient({ big: BIG }, { ignoreLimit: true });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ options: withScope({ after: at(1), limit: 30 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(0, 30)));
    expect(out.messageCount).toBe(30);
    expect(client.calls).toHaveLength(1);
  });

  it('newest N: keeps the NEWEST N of a page that is longer than asked for', async () => {
    const client = new ScopedClient({ big: BIG }, { ignoreLimit: true });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ limit: 30 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 30)));
    expect(client.calls).toHaveLength(1);
  });

  it('newest N: stays gap-free and ordered when a page in the middle is longer than asked for', async () => {
    const client = new ScopedClient({ big: BIG }, { ignoreLimit: true });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ limit: 150 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 150)));
    expect(client.limits).toEqual([100, 50]);
  });

  it('newest N: writes batches of at most 100 even for a page that is much longer', async () => {
    const huge = new ScopedClient({ big: BIG });
    vi.spyOn(huge, 'getMessages').mockImplementationOnce(async () => newest(BIG, 450).reverse());
    const { format, log } = recordingFormat();
    await harness(huge, [target('big')], format).run({ options: withScope({ limit: 450 }) });
    expect(log.batches.map((b) => b.messages.length)).toEqual([100, 100, 100, 100, 50]);
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 450)));
  });

  it('newest N: drops messages later than `before` that a sloppy cursor lets through, and still delivers N', async () => {
    const client = new ScopedClient({ big: BIG }, { firstBeforeSlackMs: 5 * SECOND });
    const { format, log } = recordingFormat();
    await harness(client, [target('big')], format).run({ options: withScope({ before: at(500), limit: 250 }) });
    // the first page held messages 501..505, which are later than `before`
    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(250, 500)));
  });

  it('newest N: de-duplicates when pages overlap (the client repeats the message the cursor points at)', async () => {
    const client = new ScopedClient({ big: BIG }, { beforeInclusive: true });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ options: withScope({ limit: 250 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 250)));
    expect(new Set(deliveredFor(log, 'big')).size).toBe(250);
    expect(out.messageCount).toBe(250);
  });

  it('newest N: stops instead of looping when the client ignores `before`', async () => {
    const client = new ScopedClient({ big: BIG }, { ignoreBefore: true });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ options: withScope({ limit: 1000 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 100)));
    expect(out.messageCount).toBe(100);
    expect(client.calls).toHaveLength(2);
  });

  it('newest N: a client that ignores `before` cannot smuggle in messages later than `before`', async () => {
    const client = new ScopedClient({ big: BIG }, { ignoreBefore: true });
    const out = await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ before: at(500), limit: 50 }) });
    expect(out.messageCount).toBe(0);
    expect(client.calls).toHaveLength(1);
  });

  it('forward with a count: stops instead of looping when the client ignores `after`', async () => {
    const page = messages(100);
    const stubborn = new ScopedClient({ big: page });
    vi.spyOn(stubborn, 'getMessages').mockImplementation(async () => [...page].reverse());
    const out = await harness(stubborn, [target('big')], recordingFormat().format).run({ options: withScope({ after: at(1), limit: 1000 }) });
    expect(out.messageCount).toBe(100);
    expect(vi.mocked(stubborn.getMessages)).toHaveBeenCalledTimes(2);
  });
});

describe('scopes per target', () => {
  it('exports 200 messages of one channel and everything of the others, in one ZIP', async () => {
    const small = messages(30, 1).map((m) => ({ ...m, channel_id: 's1' }));
    const medium = messages(300).map((m) => ({ ...m, channel_id: 's2' }));
    const client = new ScopedClient({ big: BIG, s1: small, s2: medium });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big', { scope: scope(null, null, 200) }), target('s1'), target('s2')], format).run();

    expect(out.fileCount).toBe(3);
    expect(out.messageCount).toBe(200 + 30 + 300);
    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 200)));
    expect(deliveredFor(log, 's1')).toEqual(idsOf(small));
    expect(deliveredFor(log, 's2')).toEqual(idsOf(medium));
    const files = await unzipBlob(out.blob);
    expect(Object.keys(files)).toEqual(['Guild/Cat/chan-big.txt', 'Guild/Cat/chan-s1.txt', 'Guild/Cat/chan-s2.txt']);
    expect(files['Guild/Cat/chan-big.txt']).toBe(`# chan-big\n${idsOf(newest(BIG, 200)).join('\n')}\n-- 200\n`);
    expect(files['Guild/Cat/chan-s1.txt'].endsWith('-- 30\n')).toBe(true);
    expect(files['Guild/Cat/chan-s2.txt'].endsWith('-- 300\n')).toBe(true);
    // each channel was walked in its own way
    expect(client.calls.filter((c) => c.channelId === 'big').map((c) => c.opts)).toEqual([{ limit: 100 }, { before: BIG[900].id, limit: 100 }]);
    expect(client.calls.filter((c) => c.channelId === 's2').map((c) => c.opts.after)).toEqual(['0', medium[99].id, medium[199].id, medium[299].id]);
  });

  it('lets one channel opt out of a default count: scope {null, null, null} exports everything', async () => {
    const other = messages(1000).map((m) => ({ ...m, channel_id: 'other' }));
    const client = new ScopedClient({ big: BIG, other });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big'), target('other', { scope: scope(null, null, null) })], format).run({ options: withScope({ limit: 50 }) });

    expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 50)));
    expect(deliveredFor(log, 'other')).toEqual(idsOf(other));
    expect(out.messageCount).toBe(1050);
    expect(client.calls.filter((c) => c.channelId === 'big').map((c) => c.opts)).toEqual([{ limit: 50 }]);
    expect(client.calls.filter((c) => c.channelId === 'other')).toHaveLength(11);
  });

  it('replaces all three fields as a unit: the default dates do not leak into a channel with its own scope', async () => {
    const client = new ScopedClient({ big: BIG, again: BIG.map((m) => ({ ...m, channel_id: 'again' })) });
    const { format, log } = recordingFormat();
    await harness(client, [target('big'), target('again', { scope: scope(null, null, 10) })], format).run({
      options: withScope({ after: at(100), before: at(200) }),
    });
    // the first follows the default window, the second takes the newest 10 of the WHOLE history
    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(99, 200)));
    expect(deliveredFor(log, 'again')).toEqual(idsOf(newest(BIG, 10)));
  });

  it('replaces the default count too: a scope with dates only is not capped by the default limit', async () => {
    const client = new ScopedClient({ big: BIG });
    const { format, log } = recordingFormat();
    await harness(client, [target('big', { scope: scope(at(900), null, null) })], format).run({ options: withScope({ limit: 5 }) });
    expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(899)));
  });

  it('mixes every kind of scope in one run without state leaking from one channel to the next', async () => {
    const copy = (id: string): Message[] => BIG.map((m) => ({ ...m, channel_id: id }));
    const client = new ScopedClient({ w: copy('w'), x: copy('x'), y: copy('y'), z: copy('z') });
    const { format, log } = recordingFormat();
    const targets = [
      target('w', { scope: scope(null, null, 7) }),
      target('x', { scope: scope(at(10), at(30), null) }),
      target('y', { scope: scope(at(500), null, 3) }),
      target('z', { scope: scope(null, at(40), 5) }),
    ];
    await harness(client, targets, format).run();
    expect(deliveredFor(log, 'w')).toEqual(idsOf(newest(BIG, 7)));
    expect(deliveredFor(log, 'x')).toEqual(idsOf(BIG.slice(9, 30)));
    expect(deliveredFor(log, 'y')).toEqual(idsOf(BIG.slice(499, 502)));
    expect(deliveredFor(log, 'z')).toEqual(idsOf(BIG.slice(35, 40)));
  });

  it('hands writers the EFFECTIVE scope in their options, and keeps format, theme, locale and time zone global', async () => {
    const client = new ScopedClient({ a: messages(3), b: messages(3), c: messages(3) });
    const { format, log } = recordingFormat();
    const options: ExportOptions = { ...OPTIONS, format: 'md', after: at(1), before: null, limit: 500, htmlTheme: 'light', locale: 'ko', timeZone: 'Asia/Seoul' };
    const own = scope('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 10);
    await harness(client, [target('a'), target('b', { scope: own }), target('c', { scope: scope(null, null, null) })], format).run({ options });

    const [a, b, c] = log.contexts.map((ctx) => ctx.options);
    // no override: the very same options object
    expect(a).toBe(options);
    expect(b).toEqual({ ...options, after: own.after, before: own.before, limit: 10 });
    expect(c).toEqual({ ...options, after: null, before: null, limit: null });
    for (const effective of [a, b, c]) {
      expect(effective).toMatchObject({ format: 'md', htmlTheme: 'light', locale: 'ko', timeZone: 'Asia/Seoul' });
    }
    // the caller's options are not modified
    expect(options).toMatchObject({ after: at(1), before: null, limit: 500 });
    expect(log.contexts.map((ctx) => ctx.target.scope)).toEqual([undefined, own, scope(null, null, null)]);
  });

  it('reports progress per target from that target\'s own scope', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const realId = timestampToSnowflake(T0 - 400 * SECOND);
    const client = new ScopedClient({ big: BIG, [realId]: messages(120, 700) }, { onCall: () => { clock += 1000; } });
    const h = harness(client, [target('big', { scope: scope(null, null, 200) }), target(realId)], recordingFormat().format);
    await h.run();

    const rows = (index: number) => h.progress.map((p) => p.targets[index]).filter((t) => t.status === 'fetching' && t.fetched > 0);
    // counted: ratio is collected / limit, even though 'big' is not a snowflake that could give a creation time
    expect(rows(0).map((t) => [t.fetched, t.ratio])).toEqual([[100, 0.5], [200, 1]]);
    // not counted: the time based estimate, with a start taken from the channel id
    const timed = rows(1);
    expect(timed.length).toBeGreaterThan(0);
    for (const t of timed) expect(t.ratio).not.toBeNull();
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'done']);
    expect(lastOf(h.progress).targets.map((t) => t.ratio)).toEqual([1, 1]);
    expect(lastOf(h.progress).totalMessages).toBe(320);
  });

  it('keeps today\'s shape of an export without any override', async () => {
    const client = new ScopedClient({ a: messages(3) });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('a')], format).run();
    expect(out.messageCount).toBe(3);
    expect(log.contexts[0].options).toBe(OPTIONS);
  });
});

describe('invalid scopes are rejected before the first request', () => {
  const invalidLimits: [string, unknown][] = [
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['MAX_EXPORT_LIMIT + 1', MAX_EXPORT_LIMIT + 1],
    ['2^53', 2 ** 53],
    ['a numeric string', '10'],
    ['undefined', undefined],
  ];

  async function expectRejected(h: Harness, client: ScopedClient, overrides: Partial<RunExportArgs>, message: RegExp): Promise<void> {
    const failure = await h.run(overrides).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RangeError);
    expect((failure as Error).message).toMatch(message);
    expect(client.calls).toHaveLength(0);
    expect(h.progress).toHaveLength(0);
  }

  it.each(invalidLimits)('the default limit %s', async (_name, limit) => {
    const client = new ScopedClient({ a: messages(3) });
    const h = harness(client, [target('a')], recordingFormat().format);
    await expectRejected(h, client, { options: { ...OPTIONS, limit: limit as number } }, /limit/i);
  });

  it.each(invalidLimits)('the limit %s of one target (the others are fine and are not fetched either)', async (_name, limit) => {
    const client = new ScopedClient({ a: messages(3), b: messages(3) });
    const h = harness(client, [target('a'), target('b', { channelName: 'broken', scope: { after: null, before: null, limit: limit as number } })], recordingFormat().format);
    await expectRejected(h, client, {}, /Guild \/ broken/);
  });

  it('accepts the smallest and the largest legal count', async () => {
    const client = new ScopedClient({ a: messages(3) });
    for (const limit of [1, MAX_EXPORT_LIMIT]) {
      const out = await harness(client, [target('a')], recordingFormat().format).run({ options: withScope({ limit }) });
      expect(out.messageCount).toBe(limit === 1 ? 1 : 3);
    }
  });

  it('after later than before (default scope)', async () => {
    const client = new ScopedClient({ a: messages(30) });
    const h = harness(client, [target('a')], recordingFormat().format);
    await expectRejected(h, client, { options: withScope({ after: at(20), before: at(10) }) }, /after.*later than before/);
    await expectRejected(h, client, { options: withScope({ after: at(20), before: at(10), limit: 5 }) }, /after.*later than before/);
  });

  it('after later than before (one target), naming the target', async () => {
    const client = new ScopedClient({ a: messages(30), b: messages(30) });
    const h = harness(client, [target('a'), target('b', { channelName: 'oops', scope: scope(at(20), at(10), null) })], recordingFormat().format);
    await expectRejected(h, client, {}, /Guild \/ oops/);
  });

  it('an unparsable date of one target', async () => {
    const client = new ScopedClient({ a: messages(3) });
    const h = harness(client, [target('a', { scope: scope('yesterday-ish', null, 5) })], recordingFormat().format);
    await expectRejected(h, client, {}, /after.*not a date/);
  });

  it('checks the scope each target really uses: broken defaults are harmless when every target brings its own', async () => {
    const client = new ScopedClient({ a: messages(3) });
    const out = await harness(client, [target('a', { scope: scope(null, null, 2) })], recordingFormat().format).run({ options: withScope({ limit: 0 }) });
    expect(out.messageCount).toBe(2);
  });
});

describe('cancellation and failures while counting', () => {
  it('stops the backward walk the moment the signal fires: no more requests, nothing written', async () => {
    const controller = new AbortController();
    const client = new ScopedClient({ big: BIG }, { onCall: (_call, index) => { if (index === 2) controller.abort(); } });
    const { format, log } = recordingFormat();
    const h = harness(client, [target('big')], format);
    const out = await h.run({ signal: controller.signal, options: withScope({ limit: 1000 }) });

    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(0);
    expect(out.filename).toBe('');
    expect(client.calls).toHaveLength(3);
    expect(log.batches).toHaveLength(0);
    expect(log.ends).toHaveLength(0);
    expect(lastOf(h.progress).targets[0].status).toBe('cancelled');
  });

  it('notices an abort that the client did not see: no further request after the page that was in flight', async () => {
    const controller = new AbortController();
    const client = new ScopedClient({ big: BIG });
    const original = client.getMessages.bind(client);
    vi.spyOn(client, 'getMessages').mockImplementation(async (channelId, opts) => {
      const page = await original(channelId, opts);
      if (client.calls.length === 2) controller.abort();
      return page;
    });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ signal: controller.signal, options: withScope({ limit: 1000 }) });
    expect(out.cancelled).toBe(true);
    expect(client.calls).toHaveLength(2);
    expect(log.batches).toHaveLength(0);
  });

  it('notices an abort that arrives with the last page of a walk: nothing is written and the channel is not done', async () => {
    const controller = new AbortController();
    const client = new ScopedClient({ big: BIG });
    const original = client.getMessages.bind(client);
    vi.spyOn(client, 'getMessages').mockImplementation(async (channelId, opts) => {
      const page = await original(channelId, opts);
      controller.abort();
      return page;
    });
    const { format, log } = recordingFormat();
    const h = harness(client, [target('big')], format);
    const out = await h.run({ signal: controller.signal, options: withScope({ limit: 100 }) });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(0);
    expect(log.batches).toHaveLength(0);
    expect(lastOf(h.progress).targets[0].status).toBe('cancelled');
  });

  it.each([
    ['newest N', withScope({ limit: 500 })],
    ['first N from a date', withScope({ after: at(1), limit: 500 })],
  ])('sends no further request when the progress callback is what aborts (%s)', async (_name, options) => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000)); // every page is reported, none is throttled away
    const controller = new AbortController();
    const client = new ScopedClient({ big: BIG });
    const h = harness(client, [target('big')], recordingFormat().format);
    const out = await h.run({
      signal: controller.signal,
      options,
      onProgress: (p) => {
        h.progress.push(p);
        if (p.targets[0].fetched >= 100) controller.abort();
      },
    });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(0);
    expect(client.calls).toHaveLength(1);
  });

  it('is cancelled before the first request when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new ScopedClient({ big: BIG });
    const out = await harness(client, [target('big')], recordingFormat().format).run({ signal: controller.signal, options: withScope({ limit: 10 }) });
    expect(out.cancelled).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it('stops a forward count between pages and discards the unfinished file', async () => {
    const controller = new AbortController();
    const client = new ScopedClient({ big: BIG }, { onCall: (_call, index) => { if (index === 2) controller.abort(); } });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('big')], format).run({ signal: controller.signal, options: withScope({ after: at(1), limit: 500 }) });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(0);
    expect(log.batches).toHaveLength(2);
    expect(log.ends).toHaveLength(0);
  });

  it('keeps the channels that finished before an abort in the middle of a later walk', async () => {
    const controller = new AbortController();
    const second = BIG.map((m) => ({ ...m, channel_id: 'second' }));
    const client = new ScopedClient({ big: BIG, second }, {
      onCall: (call) => {
        if (call.channelId === 'second' && 'before' in call.opts) controller.abort();
      },
    });
    const h = harness(client, [target('big', { channelName: 'first' }), target('second')], recordingFormat().format);
    const out = await h.run({ signal: controller.signal, options: withScope({ limit: 500 }) });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(1);
    expect(out.filename).toBe('Guild - first.txt');
    expect(out.messageCount).toBe(500);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'cancelled']);
  });

  it('skips a channel on a 403 for the very first backward page, and carries on', async () => {
    const client = new ScopedClient({ b: messages(40) }, { errors: { a: { error: new DiscordApiError('forbidden', 'nope', { status: 403 }) } } });
    const { format, log } = recordingFormat();
    const h = harness(client, [target('a', { channelName: 'locked' }), target('b', { channelName: 'open' })], format);
    const out = await h.run({ options: withScope({ limit: 100 }) });

    expect(out.failures).toEqual([{ channelId: 'a', label: 'Guild / locked', kind: 'skipped', reason: 'No access to this channel (403).' }]);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['skipped', 'done']);
    expect(out.fileCount).toBe(1);
    expect(out.filename).toBe('Guild - open.txt');
    expect(log.batches.map((b) => b.channelId)).toEqual(['b']);
  });

  it('a failure half way through a backward walk leaves nothing of that channel behind', async () => {
    const client = new ScopedClient({ a: BIG, b: messages(5) }, { errors: { a: { error: new DiscordApiError('network', 'offline'), afterCalls: 2 } } });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('a'), target('b')], format).run({ options: withScope({ limit: 500 }) });
    expect(log.batches.map((b) => b.channelId)).toEqual(['b']);
    expect(out.failures.map((f) => [f.channelId, f.kind])).toEqual([['a', 'error']]);
    expect(out.fileCount).toBe(1);
  });

  it('a 401 while walking back ends the run like before: finished channels are returned with authExpired', async () => {
    const bigB = BIG.map((m) => ({ ...m, channel_id: 'b' }));
    const auth = new DiscordApiError('auth', 'bad token', { status: 401 });
    const client = new ScopedClient({ a: messages(10), b: bigB, c: messages(10) }, { errors: { b: { error: auth, afterCalls: 1 } } });
    const { format, log } = recordingFormat();
    const h = harness(client, [target('a'), target('b'), target('c')], format);
    const out = await h.run({ options: withScope({ limit: 500 }) });

    expect(out.authExpired).toBe(true);
    expect(out.cancelled).toBe(false);
    expect(out.fileCount).toBe(1);
    expect(out.failures.map((f) => [f.channelId, f.kind])).toEqual([['b', 'error']]);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'error', 'cancelled']);
    expect(client.calls.some((c) => c.channelId === 'c')).toBe(false);
    expect(log.batches.map((b) => b.channelId)).toEqual(['a']);
  });

  it('a rate limit too long to wait out ends the run while counting, too', async () => {
    const limited = new DiscordApiError('rate-limited', 'slow down', { status: 429, retryAfterMs: 200_000 });
    const client = new ScopedClient({ a: messages(5), c: messages(5) }, { errors: { b: { error: limited } } });
    const h = harness(client, [target('a'), target('b'), target('c')], recordingFormat().format);
    const out = await h.run({ options: withScope({ limit: 3 }) });
    expect(out.cancelled).toBe(false);
    expect(out.fileCount).toBe(1);
    expect(out.failures.map((f) => f.channelId)).toEqual(['b']);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'error', 'cancelled']);
    expect(client.calls.some((c) => c.channelId === 'c')).toBe(false);
  });
});

describe('progress of a counted export', () => {
  const fetchingRows = (h: Harness): ExportProgress['targets'] =>
    h.progress.map((p) => p.targets[0]).filter((t) => t.status === 'fetching' && t.fetched > 0);

  function clocked(channels: Record<Snowflake, Message[]>): ScopedClient {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    return new ScopedClient(channels, { onCall: () => { clock += 1000; } });
  }

  it('newest N: ratio = collected / N after every page, fetched counts the collected messages', async () => {
    const h = harness(clocked({ big: BIG }), [target('big')], recordingFormat().format);
    await h.run({ options: withScope({ limit: 250 }) });
    expect(fetchingRows(h).map((t) => [t.fetched, t.ratio])).toEqual([[100, 0.4], [200, 0.8], [250, 1]]);
    expect(lastOf(h.progress).targets[0]).toMatchObject({ status: 'done', fetched: 250, ratio: 1 });
    expect(lastOf(h.progress).totalMessages).toBe(250);
  });

  it('starts at 0 (knowable from the count alone) even for ids that have no creation time', async () => {
    const h = harness(clocked({ big: BIG }), [target('big')], recordingFormat().format);
    await h.run({ options: withScope({ limit: 250 }) });
    const starting = h.progress.find((p) => p.targets[0].status === 'fetching');
    expect(starting?.targets[0]).toMatchObject({ fetched: 0, ratio: 0 });
  });

  it('forward count: ratio = collected / N as well', async () => {
    const h = harness(clocked({ big: BIG }), [target('big')], recordingFormat().format);
    await h.run({ options: withScope({ after: at(1), limit: 250 }) });
    expect(fetchingRows(h).map((t) => [t.fetched, t.ratio])).toEqual([[100, 0.4], [200, 0.8], [250, 1]]);
  });

  it('a channel with fewer messages than N stays below 1 until it is done', async () => {
    const h = harness(clocked({ big: messages(150) }), [target('big')], recordingFormat().format);
    await h.run({ options: withScope({ limit: 500 }) });
    expect(fetchingRows(h).map((t) => [t.fetched, t.ratio])).toEqual([[100, 0.2], [150, 0.3]]);
    expect(lastOf(h.progress).targets[0]).toMatchObject({ status: 'done', fetched: 150, ratio: 1 });
  });

  it('never goes backwards, with several targets and different scopes', async () => {
    const client = clocked({ a: BIG, b: BIG.map((m) => ({ ...m, channel_id: 'b' })), c: messages(120).map((m) => ({ ...m, channel_id: 'c' })) });
    const h = harness(client, [target('a'), target('b', { scope: scope(at(100), null, 333) }), target('c', { scope: scope(null, null, null) })], recordingFormat().format);
    await h.run({ options: withScope({ limit: 777 }) });

    const previous = [{ fetched: 0, ratio: 0 }, { fetched: 0, ratio: 0 }, { fetched: 0, ratio: 0 }];
    let previousTotal = 0;
    for (const p of h.progress) {
      expect(p.totalMessages).toBeGreaterThanOrEqual(previousTotal);
      previousTotal = p.totalMessages;
      p.targets.forEach((t, i) => {
        expect(t.fetched).toBeGreaterThanOrEqual(previous[i].fetched);
        if (t.ratio !== null) {
          expect(t.ratio).toBeGreaterThanOrEqual(previous[i].ratio);
          expect(t.ratio).toBeLessThanOrEqual(1);
          previous[i] = { fetched: t.fetched, ratio: t.ratio };
        } else {
          previous[i] = { fetched: t.fetched, ratio: previous[i].ratio };
        }
      });
    }
    expect(lastOf(h.progress).totalMessages).toBe(777 + 333 + 120);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'done', 'done']);
  });
});

describe('the headers of a run with scopes', () => {
  const run = (format: ExportFormat, own: ExportScope | undefined, options: ExportOptions): Promise<string> =>
    harness(new ScopedClient({ big: BIG }), [target('big', { channelName: 'general', ...(own ? { scope: own } : {}) })], format)
      .run({ options })
      .then((out) => out.blob.text());

  const EN: ExportOptions = { ...OPTIONS, locale: 'en' };
  const KO: ExportOptions = { ...OPTIONS, locale: 'ko' };
  const OWN = scope(null, '2026-01-01T00:10:00.000Z', 200);

  it('TXT: shows the target\'s own scope, not the default', async () => {
    expect(await run(txtFormat, OWN, { ...EN, limit: 5 })).toContain('Range: until 2026-01-01 00:10:00: newest 200 messages\n');
    expect(await run(txtFormat, OWN, { ...KO, limit: 5 })).toContain('범위: 2026-01-01 00:10:00까지 최근 200개\n');
  });

  it('TXT: shows the default scope of a target without its own', async () => {
    expect(await run(txtFormat, undefined, { ...EN, limit: 5 })).toContain('Range: newest 5 messages\n');
    expect(await run(txtFormat, undefined, { ...KO, limit: 5 })).toContain('범위: 최근 5개 메시지\n');
    expect(await run(txtFormat, undefined, EN)).toContain('Range: all messages\n');
  });

  it('TXT: "everything" overrides a default count', async () => {
    expect(await run(txtFormat, scope(null, null, null), { ...EN, limit: 5 })).toContain('Range: all messages\n');
  });

  it('Markdown: shows the target\'s own scope', async () => {
    expect(await run(mdFormat, OWN, { ...EN, limit: 5 })).toContain('- **Range:** until 2026-01-01 00:10:00: newest 200 messages\n');
    expect(await run(mdFormat, scope(at(1), null, 500), KO)).toContain('- **범위:** 2026-01-01 00:00:01부터 처음 500개\n');
  });

  it('HTML: shows the target\'s own scope in the header card', async () => {
    const html = await run(htmlFormat, scope(at(1), at(60), 500), { ...EN, limit: 5 });
    expect(html).toContain('<dt>Range</dt><dd>2026-01-01 00:00:01 to 2026-01-01 00:01:00: first 500 messages</dd>');
    const ko = await run(htmlFormat, OWN, KO);
    expect(ko).toContain('<dt>범위</dt><dd>2026-01-01 00:10:00까지 최근 200개</dd>');
  });

  it('JSON: records after, before and limit of the effective scope', async () => {
    const own = JSON.parse(await run(jsonFormat, OWN, { ...EN, limit: 5 })) as { range: unknown; messageCount: number; messages: unknown[] };
    expect(own.range).toEqual({ after: null, before: '2026-01-01T00:10:00.000Z', limit: 200 });
    expect(own.messageCount).toBe(200);
    expect(own.messages).toHaveLength(200);
    const inherited = JSON.parse(await run(jsonFormat, undefined, { ...EN, after: at(1), limit: 7 })) as { range: unknown; messageCount: number };
    expect(inherited.range).toEqual({ after: at(1), before: null, limit: 7 });
    expect(inherited.messageCount).toBe(7);
  });

  it('puts a different Range line into each file of one ZIP', async () => {
    const targets = [target('big', { channelName: 'limited', scope: scope(null, null, 3) }), target('other', { channelName: 'everything' })];
    const client = new ScopedClient({ big: BIG, other: messages(4).map((m) => ({ ...m, channel_id: 'other' })) });
    const out = await harness(client, targets, txtFormat).run({ options: EN });
    const files = await unzipBlob(out.blob);
    expect(files['Guild/Cat/limited.txt']).toContain('Range: newest 3 messages\n');
    expect(files['Guild/Cat/everything.txt']).toContain('Range: all messages\n');
  });
});

describe('dates the id space cannot hold, and dates before Discord existed', () => {
  // A date input accepts years up to 9999, but ids stop fitting 64 bits in 2154 (and the API refuses longer ones): such a date
  // must behave like what it means - "until now" / "nothing that late" - and never reach the API as an unusable cursor.
  const FAR = '9999-12-31T23:59:59.999Z';
  const PRE_DISCORD = '2001-01-01T00:00:00.000Z';
  const UINT64 = 1n << 64n;

  function cursorsOf(client: ScopedClient): string[] {
    return client.calls.flatMap((c) => [c.opts.before, c.opts.after]).filter((id): id is string => id !== undefined);
  }

  /** Everything a run does must leave no raw error behind: no failure and no English API text anywhere in the progress. */
  function expectClean(out: Awaited<ReturnType<typeof runExport>>, h: Harness): void {
    expect(out.failures).toEqual([]);
    for (const p of h.progress) for (const t of p.targets) expect(t.error).toBeUndefined();
  }

  describe('newest N (a count without a start date)', () => {
    it('an end date in the far future means "up to now": the walk starts at the present', async () => {
      const client = new ScopedClient({ big: BIG });
      const { format, log } = recordingFormat();
      const h = harness(client, [target('big')], format);
      const out = await h.run({ options: withScope({ before: FAR, limit: 5 }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(newest(BIG, 5)));
      expectClean(out, h);
      expect(client.calls[0].opts).toEqual({ before: MAX_SNOWFLAKE, limit: 5 });
    });

    it('every cursor of a long walk fits the id space, so a strict server would accept all of them', async () => {
      const client = new ScopedClient({ big: BIG });
      await harness(client, [target('big')], recordingFormat().format).run({ options: withScope({ before: '2999-06-15T00:00:00.000Z', limit: 250 }) });
      expect(client.calls).toHaveLength(3);
      for (const id of cursorsOf(client)) expect(BigInt(id) < UINT64, id).toBe(true);
    });

    it('an end date before Discord existed is an empty file, not an error', async () => {
      const client = new ScopedClient({ big: BIG });
      const h = harness(client, [target('big')], recordingFormat().format);
      const out = await h.run({ options: withScope({ before: PRE_DISCORD, limit: 5 }) });
      expect(out.fileCount).toBe(1);
      expect(out.messageCount).toBe(0);
      expectClean(out, h);
    });
  });

  describe('the first N from a start date (after + count)', () => {
    it('a start date in the far future is an empty file with a header, not an error', async () => {
      const client = new ScopedClient({ big: BIG });
      const { format, log } = recordingFormat();
      const h = harness(client, [target('big', { channelName: 'late' })], format);
      const out = await h.run({ options: withScope({ after: FAR, limit: 5 }) });
      expect(out.fileCount).toBe(1);
      expect(out.messageCount).toBe(0);
      expect(await out.blob.text()).toBe('# late\n-- 0\n');
      expect(log.ends[0].summary).toEqual({ messageCount: 0, firstTimestamp: null, lastTimestamp: null });
      expectClean(out, h);
      for (const id of cursorsOf(client)) expect(BigInt(id) < UINT64, id).toBe(true);
    });

    it('so is a window that lies entirely in the far future', async () => {
      const client = new ScopedClient({ big: BIG });
      const h = harness(client, [target('big')], recordingFormat().format);
      const out = await h.run({ options: withScope({ after: '9999-01-01T00:00:00.000Z', before: FAR, limit: 5 }) });
      expect(out.messageCount).toBe(0);
      expectClean(out, h);
    });

    it('a start date before Discord existed means "from the beginning of the channel"', async () => {
      const client = new ScopedClient({ big: BIG });
      const { format, log } = recordingFormat();
      const h = harness(client, [target('big')], format);
      const out = await h.run({ options: withScope({ after: PRE_DISCORD, limit: 5 }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(0, 5)));
      expect(client.calls[0].opts).toEqual({ after: '0', limit: 5 });
      expectClean(out, h);
    });

    it('a far-future end date after a start date is simply "to the end of the channel"', async () => {
      const client = new ScopedClient({ big: BIG });
      const { format, log } = recordingFormat();
      const h = harness(client, [target('big')], format);
      const out = await h.run({ options: withScope({ after: at(990), before: FAR, limit: 50 }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG.slice(989)));
      expectClean(out, h);
    });
  });

  describe('without a count', () => {
    it('a start date in the far future is an empty file with a header', async () => {
      const client = new ScopedClient({ big: BIG });
      const h = harness(client, [target('big')], recordingFormat().format);
      const out = await h.run({ options: withScope({ after: FAR }) });
      expect(out.fileCount).toBe(1);
      expect(out.messageCount).toBe(0);
      expectClean(out, h);
      expect(client.calls).toHaveLength(1);
      for (const id of cursorsOf(client)) expect(BigInt(id) < UINT64, id).toBe(true);
    });

    it('an end date in the far future exports everything from the start date on', async () => {
      const { format, log } = recordingFormat();
      const h = harness(new ScopedClient({ big: BIG }), [target('big')], format);
      const out = await h.run({ options: withScope({ after: at(1), before: FAR }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG));
      expectClean(out, h);
    });

    it('an end date in the far future alone exports the whole channel', async () => {
      const { format, log } = recordingFormat();
      const h = harness(new ScopedClient({ big: BIG }), [target('big')], format);
      const out = await h.run({ options: withScope({ before: FAR }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG));
      expectClean(out, h);
    });

    it('a start date before Discord existed exports the whole channel', async () => {
      const { format, log } = recordingFormat();
      const h = harness(new ScopedClient({ big: BIG }), [target('big')], format);
      const out = await h.run({ options: withScope({ after: PRE_DISCORD }) });
      expect(deliveredFor(log, 'big')).toEqual(idsOf(BIG));
      expectClean(out, h);
    });
  });

  it('applies to a scope of one channel as well, next to channels with their own dates', async () => {
    const client = new ScopedClient({ big: BIG, other: messages(4).map((m) => ({ ...m, channel_id: 'other' })) });
    const h = harness(client, [target('big', { scope: scope(FAR, null, 3) }), target('other', { scope: scope(null, FAR, 2) })], recordingFormat().format);
    const out = await h.run();
    expect(out.fileCount).toBe(2);
    expect(out.messageCount).toBe(2);
    expectClean(out, h);
  });

  it.each([
    ['TXT', txtFormat, 'Range: from 9999-12-31 23:59:59: first 5 messages'],
    ['Markdown', mdFormat, '- **Range:** from 9999-12-31 23:59:59: first 5 messages'],
    ['HTML', htmlFormat, '<dt>Range</dt><dd>from 9999-12-31 23:59:59: first 5 messages</dd>'],
  ])('%s: the file of an empty far-future range is complete and says what was asked', async (_name, format, rangeLine) => {
    const out = await harness(new ScopedClient({ big: BIG }), [target('big')], format).run({ options: withScope({ after: '9999-12-31T23:59:59.000Z', limit: 5 }) });
    expect(out.messageCount).toBe(0);
    expect(await out.blob.text()).toContain(rangeLine);
  });

  it('JSON: records the dates as typed', async () => {
    const out = await harness(new ScopedClient({ big: BIG }), [target('big')], jsonFormat).run({ options: withScope({ after: FAR, limit: 5 }) });
    const file = JSON.parse(await out.blob.text()) as { range: unknown; messageCount: number; messages: unknown[] };
    expect(file.range).toEqual({ after: FAR, before: null, limit: 5 });
    expect(file.messageCount).toBe(0);
    expect(file.messages).toEqual([]);
  });

  it('the progress estimate of an export up to a far-future date follows the real end of the history (now)', async () => {
    const start = T0;
    const end = T0 + 1000 * SECOND;
    const channelId = timestampToSnowflake(start);
    const all = messages(500, 0).map((m) => ({ ...m, channel_id: channelId }));
    const h = harness(new ScopedClient({ [channelId]: all }), [target(channelId)], recordingFormat().format);
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000));
    await h.run({ options: withScope({ before: FAR }), now: () => new Date(end) });
    const fetching = h.progress.filter((p) => p.targets[0].status === 'fetching' && p.targets[0].fetched > 0);
    // After 100 messages the newest is message #99 => 99 s of the 1000 s between the channel's creation and now
    expect(fetching[0].targets[0].ratio).toBeCloseTo(0.099, 5);
  });
});

describe('against the demo world', () => {
  // The demo client is an independent implementation of Discord's paging, with ids and times from a generated history.
  async function fullHistory(client: DiscordClient, channelId: Snowflake): Promise<Message[]> {
    const all: Message[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await client.getMessages(channelId, { before, limit: 100 });
      if (page.length === 0) break;
      all.push(...page);
      before = page[page.length - 1].id;
    }
    return all.reverse();
  }

  const timeOf = (m: Message): number => Date.parse(m.timestamp);

  it('newest N, before + N and after + N match the history the client itself serves', async () => {
    const client = createMockClient({ latencyMs: 0 });
    const all = await fullHistory(client, MOCK_IDS.generalChannel);
    expect(all.length).toBeGreaterThan(2000);
    const general = target(MOCK_IDS.generalChannel, { channelName: 'general' });

    const ids = async (options: ExportOptions): Promise<string[]> => {
      const { format, log } = recordingFormat();
      await runExport({ client, targets: [general], format, options, now: () => NOW });
      return deliveredFor(log, MOCK_IDS.generalChannel);
    };

    expect(await ids(withScope({ limit: 250 }))).toEqual(idsOf(all.slice(-250)));
    expect(await ids(withScope({ limit: all.length + 50 }))).toEqual(idsOf(all));

    const before = all[1500].timestamp;
    const upToBefore = all.filter((m) => timeOf(m) <= Date.parse(before));
    expect(await ids(withScope({ before, limit: 333 }))).toEqual(idsOf(upToBefore.slice(-333)));

    const after = all[400].timestamp;
    const fromAfter = all.filter((m) => timeOf(m) >= Date.parse(after));
    expect(await ids(withScope({ after, limit: 301 }))).toEqual(idsOf(fromAfter.slice(0, 301)));

    const windowEnd = all[900].timestamp;
    const inWindow = fromAfter.filter((m) => timeOf(m) <= Date.parse(windowEnd));
    expect(await ids(withScope({ after, before: windowEnd, limit: 100_000 }))).toEqual(idsOf(inWindow));
    expect(await ids(withScope({ after, before: windowEnd, limit: 77 }))).toEqual(idsOf(inWindow.slice(0, 77)));
  });

  it('far-future and pre-Discord dates work like what they mean (the demo client refuses ids beyond 64 bits, like the real API)', async () => {
    const client = createMockClient({ latencyMs: 0 });
    const all = await fullHistory(client, MOCK_IDS.generalChannel);
    const general = target(MOCK_IDS.generalChannel, { channelName: 'general' });
    const FAR = '9999-12-31T23:59:59.999Z';

    const run = async (options: ExportOptions) => {
      const { format, log } = recordingFormat();
      const out = await runExport({ client, targets: [general], format, options, now: () => NOW });
      expect(out.failures).toEqual([]);
      return deliveredFor(log, MOCK_IDS.generalChannel);
    };

    expect(await run(withScope({ before: FAR, limit: 3 }))).toEqual(idsOf(all.slice(-3)));
    expect(await run(withScope({ before: '2999-01-01T00:00:00.000Z', limit: 250 }))).toEqual(idsOf(all.slice(-250)));
    expect(await run(withScope({ before: FAR }))).toEqual(idsOf(all));
    expect(await run(withScope({ after: FAR, limit: 3 }))).toEqual([]);
    expect(await run(withScope({ after: FAR }))).toEqual([]);
    expect(await run(withScope({ after: all[10].timestamp, before: FAR, limit: 5 }))).toEqual(idsOf(all.slice(10, 15)));
    expect(await run(withScope({ after: '2001-01-01T00:00:00.000Z', limit: 4 }))).toEqual(idsOf(all.slice(0, 4)));
    expect(await run(withScope({ before: '2001-01-01T00:00:00.000Z', limit: 4 }))).toEqual([]);
  });
});
