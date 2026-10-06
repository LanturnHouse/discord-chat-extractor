import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordApiError, type DiscordClient, type DiscordErrorKind, type GetMessagesOptions } from '../../../src/lib/discord/client';
import { snowflakeToTimestamp, timestampToSnowflake } from '../../../src/lib/discord/snowflake';
import type { Message, Snowflake, User } from '../../../src/lib/discord/types';
import { createMockClient, MOCK_IDS } from '../../../src/lib/discord/mock';
import { jsonFormat } from '../../../src/lib/export/formats/json';
import { txtFormat } from '../../../src/lib/export/formats/txt';
import { buildNameResolver } from '../../../src/lib/message';
import { runExport, type RunExportArgs } from '../../../src/lib/export/runner';
import * as zipModule from '../../../src/lib/export/zip';
import type {
  ExportFormat,
  ExportOptions,
  ExportProgress,
  ExportTarget,
  WriterContext,
  WriterSummary,
} from '../../../src/lib/export/types';

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const SECOND = 1000;
const NOW = new Date(2026, 9, 6, 12, 0, 0);

const ALICE: User = { id: '1001', username: 'alice', global_name: 'Alice A.' };
const BOB: User = { id: '1002', username: 'bob', global_name: null };

/** Message `i` of a channel, created `i` seconds after T0. Its id is the bare snowflake of that millisecond. */
function msg(i: number, overrides: Partial<Message> = {}, channelId = 'c'): Message {
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

const idsOf = (list: readonly Message[]): string[] => list.map((m) => m.id);

interface Call {
  channelId: Snowflake;
  opts: GetMessagesOptions;
  signal: AbortSignal | undefined;
}

interface FakeOptions {
  /** Throw this error instead of answering. `afterCalls` = number of successful calls for that channel first. */
  errors?: Record<Snowflake, { error: Error; afterCalls?: number }>;
  /** Runs at the start of every call (may abort, throw, advance a clock...). */
  onCall?(call: Call, index: number): void;
  /** Return pages oldest-first instead of the API's newest-first (to prove the runner sorts). */
  oldestFirst?: boolean;
  /** Ignore `limit` (misbehaving client). */
  ignoreLimit?: boolean;
}

/** In-memory client with Discord's `after` semantics: the oldest `limit` messages newer than `after`, returned newest-first. */
class FakeClient implements DiscordClient {
  readonly kind = 'mock' as const;
  readonly calls: Call[] = [];
  private readonly served = new Map<Snowflake, number>();

  constructor(
    private readonly channels: Record<Snowflake, Message[]>,
    private readonly fake: FakeOptions = {},
  ) {}

  async getMessages(channelId: Snowflake, opts: GetMessagesOptions = {}, signal?: AbortSignal): Promise<Message[]> {
    const call: Call = { channelId, opts, signal };
    this.calls.push(call);
    this.fake.onCall?.(call, this.calls.length - 1);
    if (signal?.aborted) throw new DiscordApiError('aborted', 'aborted');

    const served = this.served.get(channelId) ?? 0;
    this.served.set(channelId, served + 1);
    const failure = this.fake.errors?.[channelId];
    if (failure && served >= (failure.afterCalls ?? 0)) throw failure.error;

    const limit = opts.limit ?? 50;
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(100);

    const all = this.channels[channelId] ?? [];
    const after = BigInt(opts.after ?? '0');
    const page = all
      .filter((m) => BigInt(m.id) > after)
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .slice(0, this.fake.ignoreLimit ? undefined : limit);
    return this.fake.oldestFirst ? page : page.reverse();
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

const OPTIONS: ExportOptions = {
  format: 'txt',
  after: null,
  before: null,
  limit: null,
  htmlTheme: 'dark',
  locale: 'en',
  timeZone: 'UTC',
};

interface WriterLog {
  contexts: WriterContext[];
  batches: { channelId: Snowflake; messages: Message[] }[];
  ends: { channelId: Snowflake; summary: WriterSummary }[];
  /** `names.user(...)` answers captured at the moment each batch was written. */
  resolved: Record<string, string | undefined>[];
  /** `names.channel(...)` / `names.role(...)` answers captured when each writer started (the names are per target). */
  started: { channels: Record<string, string | undefined>; roles: Record<string, string | undefined> }[];
}

/** Text format whose files are "# name", one id per line, "-- count". Records everything the runner hands to writers. */
function recordingFormat(
  extra: { probeUsers?: string[]; probeChannels?: string[]; probeRoles?: string[]; throwOnWrite?: Snowflake } = {},
): { format: ExportFormat; log: WriterLog } {
  const log: WriterLog = { contexts: [], batches: [], ends: [], resolved: [], started: [] };
  const format: ExportFormat = {
    id: 'txt',
    label: 'Text',
    extension: 'txt',
    mime: 'text/plain',
    createWriter(ctx) {
      log.contexts.push(ctx);
      const channelId = ctx.target.channelId;
      return {
        start: () => {
          log.started.push({
            channels: Object.fromEntries((extra.probeChannels ?? []).map((id) => [id, ctx.names.channel(id)])),
            roles: Object.fromEntries((extra.probeRoles ?? []).map((id) => [id, ctx.names.role(id)])),
          });
          return [`# ${ctx.target.channelName}\n`];
        },
        write: (batch) => {
          if (extra.throwOnWrite === channelId) throw new Error('writer exploded');
          log.batches.push({ channelId, messages: [...batch] });
          log.resolved.push(Object.fromEntries((extra.probeUsers ?? []).map((id) => [id, ctx.names.user(id)])));
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

async function textOf(blob: Blob): Promise<string> {
  return blob.text();
}

async function unzipBlob(blob: Blob): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

function lastOf<T>(list: T[]): T {
  return list[list.length - 1];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('single target', () => {
  it('writes messages oldest -> newest and returns the file as is', async () => {
    const all = messages(250);
    const client = new FakeClient({ a: all });
    const { format } = recordingFormat();
    const t = target('a', { channelName: 'general' });
    const out = await harness(client, [t], format).run();

    expect(out.fileCount).toBe(1);
    expect(out.messageCount).toBe(250);
    expect(out.cancelled).toBe(false);
    expect(out.failures).toEqual([]);
    expect(out.filename).toBe('Guild - general.txt');
    expect(out.blob.type).toBe('text/plain');
    expect(await textOf(out.blob)).toBe(`# general\n${idsOf(all).join('\n')}\n-- 250\n`);
  });

  it('passes writer context, summary and the abort signal through', async () => {
    const all = messages(3);
    const controller = new AbortController();
    const client = new FakeClient({ a: all });
    const { format, log } = recordingFormat();
    const options = { ...OPTIONS, after: null, locale: 'ko' as const };
    await harness(client, [target('a')], format).run({ signal: controller.signal, options });

    expect(log.contexts).toHaveLength(1);
    expect(log.contexts[0].exportedAt).toEqual(NOW);
    expect(log.contexts[0].options).toBe(options);
    expect(log.contexts[0].target.channelId).toBe('a');
    expect(log.ends[0].summary).toEqual({
      messageCount: 3,
      firstTimestamp: all[0].timestamp,
      lastTimestamp: all[2].timestamp,
    });
    expect(client.calls.every((c) => c.signal === controller.signal)).toBe(true);
  });

  it('is a valid, empty file for a channel without messages', async () => {
    const client = new FakeClient({ a: [] });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('a', { channelName: 'quiet' })], format).run();
    expect(out.fileCount).toBe(1);
    expect(out.messageCount).toBe(0);
    expect(await textOf(out.blob)).toBe('# quiet\n-- 0\n');
    expect(log.ends[0].summary).toEqual({ messageCount: 0, firstTimestamp: null, lastTimestamp: null });
    expect(client.calls).toHaveLength(1);
  });

  it('names a DM export "name.ext"', async () => {
    const dm = target('a', { kind: 'dm', guildId: null, guildName: null, categoryName: null, channelName: 'Alice' });
    const out = await harness(new FakeClient({ a: messages(1) }), [dm], recordingFormat().format).run();
    expect(out.filename).toBe('Alice.txt');
  });

  it('produces valid JSON through the real json format', async () => {
    const all = [msg(1), msg(2, { mentions: [BOB], content: '안녕 <@1002> 😀' }), msg(3)];
    const out = await harness(new FakeClient({ a: all }), [target('a', { channelName: 'general', topic: 'hi' })], jsonFormat).run({
      options: { ...OPTIONS, format: 'json' },
    });
    expect(out.filename).toBe('Guild - general.json');
    expect(out.blob.type).toBe('application/json');
    const doc = JSON.parse(await textOf(out.blob));
    expect(doc.messages).toEqual(all);
    expect(doc.messageCount).toBe(3);
    expect(doc.firstMessageAt).toBe(all[0].timestamp);
    expect(doc.lastMessageAt).toBe(all[2].timestamp);
    expect(doc.channel).toMatchObject({ id: 'a', name: 'general', guild: { id: 'g1', name: 'Guild' }, topic: 'hi' });
  });

  it('produces valid JSON for an empty channel through the real json format', async () => {
    const out = await harness(new FakeClient({ a: [] }), [target('a')], jsonFormat).run();
    expect(JSON.parse(await textOf(out.blob)).messages).toEqual([]);
  });
});

describe('paging', () => {
  it.each([0, 1, 99, 100, 101, 199, 200, 201, 250, 1000])('delivers %i messages exactly once, in order', async (count) => {
    const all = messages(count);
    const client = new FakeClient({ a: all });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('a')], format).run();

    const delivered = log.batches.flatMap((b) => idsOf(b.messages));
    expect(delivered).toEqual(idsOf(all));
    expect(out.messageCount).toBe(count);

    // 1 request per full page plus the short/empty page that proves the end.
    expect(client.calls).toHaveLength(Math.floor(count / 100) + 1);
  });

  it('chains the cursor: first "0", then the newest id of the previous page, always limit 100', async () => {
    const all = messages(250);
    const client = new FakeClient({ a: all });
    await harness(client, [target('a')], recordingFormat().format).run();
    expect(client.calls.map((c) => c.opts)).toEqual([
      { after: '0', limit: 100 },
      { after: all[99].id, limit: 100 },
      { after: all[199].id, limit: 100 },
    ]);
  });

  it('never gives a writer more than 100 messages per call, even if the client over-delivers', async () => {
    const all = messages(250);
    const client = new FakeClient({ a: all }, { ignoreLimit: true });
    const { format, log } = recordingFormat();
    await harness(client, [target('a')], format).run();
    expect(log.batches.map((b) => b.messages.length)).toEqual([100, 100, 50]);
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual(idsOf(all));
  });

  it('keeps every batch within 100 and batches strictly ascending without overlap', async () => {
    const all = messages(730);
    const { format, log } = recordingFormat();
    await harness(new FakeClient({ a: all }), [target('a')], format).run();
    for (const batch of log.batches) expect(batch.messages.length).toBeLessThanOrEqual(100);
    const ids = log.batches.flatMap((b) => idsOf(b.messages)).map(BigInt);
    for (let i = 1; i < ids.length; i += 1) expect(ids[i] > ids[i - 1]).toBe(true);
  });

  it('sorts pages that arrive oldest-first', async () => {
    const all = messages(150);
    const { format, log } = recordingFormat();
    await harness(new FakeClient({ a: all }, { oldestFirst: true }), [target('a')], format).run();
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual(idsOf(all));
  });

  it('de-duplicates messages repeated across or within pages', async () => {
    const all = messages(130);
    const doubled = [...all, ...all.slice(95, 105)]; // overlap around the page boundary, plus in-page duplicates
    const client = new FakeClient({ a: doubled });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('a')], format).run();
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual(idsOf(all));
    expect(out.messageCount).toBe(130);
  });

  it('stops instead of looping when a client ignores `after` and repeats the same page', async () => {
    const page = messages(100);
    const stubborn = new FakeClient({ a: page });
    vi.spyOn(stubborn, 'getMessages').mockImplementation(async () => [...page].reverse());
    const { format, log } = recordingFormat();
    const out = await harness(stubborn, [target('a')], format).run();
    expect(out.messageCount).toBe(100);
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual(idsOf(page));
    expect(vi.mocked(stubborn.getMessages)).toHaveBeenCalledTimes(2);
  });
});

describe('date ranges', () => {
  it('includes messages exactly at `after`, and drops earlier ones', async () => {
    const all = messages(20);
    const client = new FakeClient({ a: all });
    const { format, log } = recordingFormat();
    // message 6's id is the bare snowflake of its millisecond, i.e. exactly the cursor a naive implementation would use
    const after = all[5].timestamp;
    await harness(client, [target('a')], format).run({ options: { ...OPTIONS, after } });
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual(idsOf(all.slice(5)));
    expect(BigInt(client.calls[0].opts.after as string)).toBe(BigInt(all[5].id) - 1n);
  });

  it('includes messages exactly at `before`, and drops later ones', async () => {
    const all = messages(20);
    const { format, log } = recordingFormat();
    await harness(new FakeClient({ a: all }), [target('a')], format).run({ options: { ...OPTIONS, before: all[9].timestamp } });
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual(idsOf(all.slice(0, 10)));
  });

  it('applies both bounds', async () => {
    const all = messages(50);
    const { format, log } = recordingFormat();
    const out = await harness(new FakeClient({ a: all }), [target('a')], format).run({
      options: { ...OPTIONS, after: all[9].timestamp, before: all[29].timestamp },
    });
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual(idsOf(all.slice(9, 30)));
    expect(out.messageCount).toBe(21);
    expect(log.ends[0].summary.firstTimestamp).toBe(all[9].timestamp);
    expect(log.ends[0].summary.lastTimestamp).toBe(all[29].timestamp);
  });

  it('stops requesting pages once past `before`', async () => {
    const all = messages(1000);
    const client = new FakeClient({ a: all });
    await harness(client, [target('a')], recordingFormat().format).run({ options: { ...OPTIONS, before: all[149].timestamp } });
    expect(client.calls).toHaveLength(2);
  });

  it('handles `before` earlier than every message', async () => {
    const client = new FakeClient({ a: messages(10) });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('a')], format).run({ options: { ...OPTIONS, before: new Date(T0).toISOString() } });
    expect(out.messageCount).toBe(0);
    expect(log.batches).toHaveLength(0);
    expect(client.calls).toHaveLength(1);
    expect(out.fileCount).toBe(1);
  });

  it('yields an empty file when `after` is later than every message', async () => {
    const out = await harness(new FakeClient({ a: messages(10) }), [target('a')], recordingFormat().format).run({
      options: { ...OPTIONS, after: '2030-01-01T00:00:00.000Z' },
    });
    expect(out.messageCount).toBe(0);
    expect(out.fileCount).toBe(1);
  });

  it('rejects a range whose start is later than its end before touching the API', async () => {
    const client = new FakeClient({ a: messages(10) });
    const options = { ...OPTIONS, after: new Date(T0 + 9 * SECOND).toISOString(), before: new Date(T0 + 2 * SECOND).toISOString() };
    await expect(harness(client, [target('a')], recordingFormat().format).run({ options })).rejects.toThrow(RangeError);
    expect(client.calls).toHaveLength(0);
  });

  it('accepts a range that starts and ends at the same instant', async () => {
    const all = messages(10);
    const { format, log } = recordingFormat();
    const out = await harness(new FakeClient({ a: all }), [target('a')], format).run({ options: { ...OPTIONS, after: all[4].timestamp, before: all[4].timestamp } });
    expect(out.messageCount).toBe(1);
    expect(log.batches.flatMap((b) => idsOf(b.messages))).toEqual([all[4].id]);
  });

  it('rejects an unparsable date before touching the API', async () => {
    const client = new FakeClient({ a: messages(1) });
    await expect(harness(client, [target('a')], recordingFormat().format).run({ options: { ...OPTIONS, after: 'not a date' } })).rejects.toThrow(
      RangeError,
    );
    await expect(harness(client, [target('a')], recordingFormat().format).run({ options: { ...OPTIONS, before: '' } })).rejects.toThrow(RangeError);
    expect(client.calls).toHaveLength(0);
  });

  it('uses `after` at the Discord epoch edge without producing a negative cursor', async () => {
    const client = new FakeClient({ a: messages(2) });
    await harness(client, [target('a')], recordingFormat().format).run({ options: { ...OPTIONS, after: '2000-01-01T00:00:00.000Z' } });
    expect(client.calls[0].opts.after).toBe('0');
  });
});

describe('errors', () => {
  it('skips a channel on 403, lists it, and carries on', async () => {
    const client = new FakeClient({ a: messages(3), c: messages(4) }, { errors: { b: { error: new DiscordApiError('forbidden', 'nope', { status: 403 }) } } });
    const { format } = recordingFormat();
    const h = harness(client, [target('a', { channelName: 'one' }), target('b', { channelName: 'locked' }), target('c', { channelName: 'three' })], format);
    const out = await h.run();

    expect(out.fileCount).toBe(2);
    expect(out.messageCount).toBe(7);
    expect(out.failures).toEqual([{ channelId: 'b', label: 'Guild / locked', kind: 'skipped', reason: 'No access to this channel (403).' }]);
    const final = lastOf(h.progress);
    expect(final.targets.map((t) => t.status)).toEqual(['done', 'skipped', 'done']);
    expect(final.targets[1].error).toBe('No access to this channel (403).');
    expect(final.currentIndex).toBe(-1);
    expect(Object.keys(await unzipBlob(out.blob))).toHaveLength(2);
  });

  it('skips a channel on 404', async () => {
    const client = new FakeClient({}, { errors: { a: { error: new DiscordApiError('not-found', 'gone', { status: 404 }) } } });
    const h = harness(client, [target('a')], recordingFormat().format);
    const out = await h.run();
    expect(lastOf(h.progress).targets[0].status).toBe('skipped');
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].reason).toBe('Channel not found or deleted (404).');
  });

  it('localises skip reasons', async () => {
    const client = new FakeClient({}, { errors: { a: { error: new DiscordApiError('forbidden', 'nope') } } });
    const out = await harness(client, [target('a')], recordingFormat().format).run({ options: { ...OPTIONS, locale: 'ko' } });
    expect(out.failures[0].reason).toBe('이 채널에 접근할 수 없습니다 (403).');
  });

  it('falls back to English reasons when the locale is not one of the two languages', async () => {
    const options = { ...OPTIONS, locale: 'fr' as ExportOptions['locale'] };
    const forbidden = await harness(new FakeClient({}, { errors: { a: { error: new DiscordApiError('forbidden', 'x') } } }), [target('a')], recordingFormat().format).run({ options });
    expect(forbidden.failures[0].reason).toBe('No access to this channel (403).');
    const h = harness(new FakeClient({}, { errors: { a: { error: new DiscordApiError('auth', 'x') } } }), [target('a'), target('b')], recordingFormat().format);
    await h.run({ options });
    expect(lastOf(h.progress).targets[1].error).toBe('Not exported: the Discord session expired.');
  });

  it('a mid-channel 403 discards the partial file', async () => {
    const client = new FakeClient({ a: messages(300), b: messages(2) }, { errors: { a: { error: new DiscordApiError('forbidden', 'x'), afterCalls: 2 } } });
    const out = await harness(client, [target('a'), target('b')], recordingFormat().format).run();
    expect(out.fileCount).toBe(1);
    expect(out.messageCount).toBe(2);
    expect(out.failures.map((f) => f.channelId)).toEqual(['a']);
  });

  it('returns an empty output (still listing failures) when nothing could be exported', async () => {
    const forbidden = { error: new DiscordApiError('forbidden', 'x') };
    const client = new FakeClient({}, { errors: { a: forbidden, b: forbidden } });
    const out = await harness(client, [target('a'), target('b')], recordingFormat().format).run();
    expect(out.fileCount).toBe(0);
    expect(out.filename).toBe('');
    expect(out.blob.size).toBe(0);
    expect(out.messageCount).toBe(0);
    expect(out.cancelled).toBe(false);
    expect(out.failures).toHaveLength(2);
  });

  describe('a 401 (the session expired)', () => {
    const authError = (): DiscordApiError => new DiscordApiError('auth', 'bad token', { status: 401 });

    it('stops fetching but does not throw: the finished channels are returned with authExpired', async () => {
      const client = new FakeClient({ a: messages(3), c: messages(3), d: messages(3) }, { errors: { b: { error: authError() } } });
      const h = harness(client, [target('a', { channelName: 'one' }), target('b', { channelName: 'two' }), target('c'), target('d')], recordingFormat().format);
      const out = await h.run();

      expect(new Set(client.calls.map((c) => c.channelId))).toEqual(new Set(['a', 'b']));
      expect(out.authExpired).toBe(true);
      expect(out.cancelled).toBe(false);
      expect(out.fileCount).toBe(1);
      expect(out.messageCount).toBe(3);
      expect(out.filename).toBe('Guild - one.txt');
      expect(await textOf(out.blob)).toContain('# one\n');
      expect(out.failures).toEqual([{ channelId: 'b', label: 'Guild / two', kind: 'error', reason: 'Not signed in to Discord (401).' }]);
      const final = lastOf(h.progress);
      expect(final.targets.map((t) => t.status)).toEqual(['done', 'error', 'cancelled', 'cancelled']);
      expect(final.currentIndex).toBe(-1);
      expect(final.phase).toBe('finished');
    });

    it('marks the targets it never fetched with a "session expired" reason, in both languages', async () => {
      const run = async (locale: 'en' | 'ko'): Promise<ExportProgress> => {
        const h = harness(new FakeClient({}, { errors: { a: { error: authError() } } }), [target('a'), target('b'), target('c')], recordingFormat().format);
        await h.run({ options: { ...OPTIONS, locale } });
        return lastOf(h.progress);
      };
      const en = await run('en');
      expect(en.targets.map((t) => t.error)).toEqual(['Not signed in to Discord (401).', 'Not exported: the Discord session expired.', 'Not exported: the Discord session expired.']);
      const ko = await run('ko');
      expect(ko.targets[0].error).toBe('Discord에 로그인되어 있지 않습니다 (401).');
      expect(ko.targets[1].error).toContain('세션이 만료');
      expect(ko.targets[1].status).toBe('cancelled');
    });

    it('packages several finished channels into a ZIP', async () => {
      const client = new FakeClient({ a: messages(2), b: messages(3), d: messages(4) }, { errors: { c: { error: authError() } } });
      const h = harness(client, [target('a'), target('b'), target('c'), target('d')], recordingFormat().format);
      const out = await h.run();

      expect(out.authExpired).toBe(true);
      expect(out.cancelled).toBe(false);
      expect(out.fileCount).toBe(2);
      expect(out.messageCount).toBe(5);
      expect(out.filename).toBe('Discord Export 2026-10-06.zip');
      expect(Object.keys(await unzipBlob(out.blob))).toEqual(['Guild/Cat/chan-a.txt', 'Guild/Cat/chan-b.txt']);
      expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'done', 'error', 'cancelled']);
      expect(client.calls.some((c) => c.channelId === 'd')).toBe(false);
    });

    it('leaves a channel that was half way when the 401 arrived out of the output', async () => {
      const client = new FakeClient({ a: messages(1), b: messages(300) }, { errors: { b: { error: authError(), afterCalls: 2 } } });
      const out = await harness(client, [target('a'), target('b')], recordingFormat().format).run();
      expect(out.fileCount).toBe(1);
      expect(out.messageCount).toBe(1);
      expect(out.failures.map((f) => f.channelId)).toEqual(['b']);
    });

    it('returns an empty authExpired output when the very first channel fails', async () => {
      const h = harness(new FakeClient({}, { errors: { a: { error: authError() } } }), [target('a'), target('b')], recordingFormat().format);
      const out = await h.run();
      expect(out).toMatchObject({ filename: '', fileCount: 0, messageCount: 0, cancelled: false, authExpired: true });
      expect(out.blob.size).toBe(0);
      expect(out.failures).toHaveLength(1);
    });

    it('reports the expired session even when the abort signal fired together with it', async () => {
      // The app ends its session when it sees the 401, which aborts the run before the runner sees the error.
      const controller = new AbortController();
      const client = new FakeClient({ a: messages(2), b: messages(2) });
      const original = client.getMessages.bind(client);
      vi.spyOn(client, 'getMessages').mockImplementation(async (channelId, opts, signal) => {
        if (channelId !== 'b') return original(channelId, opts, signal);
        controller.abort();
        throw authError();
      });
      const out = await harness(client, [target('a'), target('b')], recordingFormat().format).run({ signal: controller.signal });
      expect(out.authExpired).toBe(true);
      expect(out.cancelled).toBe(false);
      expect(out.fileCount).toBe(1);
    });

    it('leaves the flag off for runs that did not hit a 401', async () => {
      const out = await harness(new FakeClient({ a: messages(1) }), [target('a')], recordingFormat().format).run();
      expect(out.authExpired).toBeUndefined();
    });
  });

  it.each<DiscordErrorKind>(['network', 'server', 'rate-limited', 'unknown'])('marks a "%s" error, lists it and continues', async (kind) => {
    const client = new FakeClient({ a: messages(1), c: messages(2) }, { errors: { b: { error: new DiscordApiError(kind, `boom ${kind}`) } } });
    const h = harness(client, [target('a'), target('b', { channelName: 'flaky' }), target('c')], recordingFormat().format);
    const out = await h.run();
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'error', 'done']);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toMatchObject({ channelId: 'b', label: 'Guild / flaky' });
    expect(out.failures[0].reason.length).toBeGreaterThan(0);
    expect(out.fileCount).toBe(2);
  });

  it('uses the raw message for unknown API errors', async () => {
    const client = new FakeClient({}, { errors: { a: { error: new DiscordApiError('unknown', 'HTTP 418 teapot') } } });
    const out = await harness(client, [target('a')], recordingFormat().format).run();
    expect(out.failures[0].reason).toBe('HTTP 418 teapot');
  });

  it('treats unexpected (non-API) errors such as a writer crash as a failure of that target only', async () => {
    const client = new FakeClient({ a: messages(2), b: messages(2) });
    const { format } = recordingFormat({ throwOnWrite: 'a' });
    const h = harness(client, [target('a'), target('b')], format);
    const out = await h.run();
    expect(out.failures).toEqual([{ channelId: 'a', label: 'Guild / chan-a', kind: 'error', reason: 'writer exploded' }]);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['error', 'done']);
    expect(out.fileCount).toBe(1);
  });
});

describe('a long rate limit (the live client refuses every later request)', () => {
  const limited = (retryAfterMs: number | undefined): DiscordApiError =>
    new DiscordApiError('rate-limited', 'Discord rate limit reached', { status: 429, retryAfterMs });

  it('stops the run instead of failing the remaining channels one by one, and returns what was completed', async () => {
    const client = new FakeClient({ a: messages(3), c: messages(3), d: messages(3) }, { errors: { b: { error: limited(200_000) } } });
    const h = harness(client, [target('a', { channelName: 'one' }), target('b', { channelName: 'two' }), target('c'), target('d')], recordingFormat().format);
    const out = await h.run();

    expect(new Set(client.calls.map((c) => c.channelId))).toEqual(new Set(['a', 'b']));
    expect(out.cancelled).toBe(false);
    expect(out.authExpired).toBeUndefined();
    expect(out.fileCount).toBe(1);
    expect(out.messageCount).toBe(3);
    expect(out.filename).toBe('Guild - one.txt');
    expect(await textOf(out.blob)).toContain('# one\n');
    const reason = 'Discord asked us to wait 4 min - try again later.';
    expect(out.failures).toEqual([{ channelId: 'b', label: 'Guild / two', kind: 'error', reason }]);
    const final = lastOf(h.progress);
    expect(final.targets.map((t) => t.status)).toEqual(['done', 'error', 'cancelled', 'cancelled']);
    expect(final.targets.map((t) => t.error)).toEqual([undefined, reason, reason, reason]);
    expect(final.currentIndex).toBe(-1);
    expect(final.phase).toBe('finished');
  });

  it('rounds the wait up to whole minutes', async () => {
    const reasonFor = async (retryAfterMs: number): Promise<string> => {
      const client = new FakeClient({}, { errors: { a: { error: limited(retryAfterMs) } } });
      return (await harness(client, [target('a'), target('b')], recordingFormat().format).run()).failures[0].reason;
    };
    expect(await reasonFor(60_001)).toBe('Discord asked us to wait 2 min - try again later.');
    expect(await reasonFor(120_000)).toBe('Discord asked us to wait 2 min - try again later.');
    expect(await reasonFor(120_001)).toBe('Discord asked us to wait 3 min - try again later.');
    expect(await reasonFor(3_600_000)).toBe('Discord asked us to wait 60 min - try again later.');
  });

  it('says it in Korean too, on the failed channel and on the ones that were not fetched', async () => {
    const client = new FakeClient({ a: messages(1) }, { errors: { b: { error: limited(130_000) } } });
    const h = harness(client, [target('a'), target('b'), target('c')], recordingFormat().format);
    const out = await h.run({ options: { ...OPTIONS, locale: 'ko' } });
    const reason = 'Discord에서 3분 동안 기다려 달라고 요청했습니다. 나중에 다시 시도하세요.';
    expect(out.failures.map((f) => f.reason)).toEqual([reason]);
    expect(lastOf(h.progress).targets.map((t) => t.error)).toEqual([undefined, reason, reason]);
  });

  it('packages several finished channels into a ZIP before stopping', async () => {
    const client = new FakeClient({ a: messages(2), b: messages(3), d: messages(4) }, { errors: { c: { error: limited(900_000) } } });
    const h = harness(client, [target('a'), target('b'), target('c'), target('d')], recordingFormat().format);
    const out = await h.run();

    expect(out.cancelled).toBe(false);
    expect(out.authExpired).toBeUndefined();
    expect(out.fileCount).toBe(2);
    expect(out.filename).toBe('Discord Export 2026-10-06.zip');
    expect(Object.keys(await unzipBlob(out.blob))).toEqual(['Guild/Cat/chan-a.txt', 'Guild/Cat/chan-b.txt']);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'done', 'error', 'cancelled']);
    expect(client.calls.some((c) => c.channelId === 'd')).toBe(false);
  });

  it('returns an empty output (listing the one failure) when the very first channel is already blocked', async () => {
    const client = new FakeClient({}, { errors: { a: { error: limited(300_000) } } });
    const out = await harness(client, [target('a'), target('b'), target('c')], recordingFormat().format).run();
    expect(out).toMatchObject({ filename: '', fileCount: 0, messageCount: 0, cancelled: false });
    expect(out.authExpired).toBeUndefined();
    expect(out.blob.size).toBe(0);
    expect(out.failures).toHaveLength(1);
    expect(client.calls.map((c) => c.channelId)).toEqual(['a']);
  });

  it('a half-fetched channel that hits the limit is left out of the output', async () => {
    const client = new FakeClient({ a: messages(1), b: messages(300) }, { errors: { b: { error: limited(300_000), afterCalls: 2 } } });
    const out = await harness(client, [target('a'), target('b')], recordingFormat().format).run();
    expect(out.fileCount).toBe(1);
    expect(out.messageCount).toBe(1);
    expect(out.failures.map((f) => f.channelId)).toEqual(['b']);
  });

  it('keeps today\'s per-channel behaviour for a wait of at most a minute, or one without a wait hint', async () => {
    for (const retryAfterMs of [60_000, 30_000, 1, undefined]) {
      const client = new FakeClient({ a: messages(1), c: messages(2) }, { errors: { b: { error: limited(retryAfterMs) } } });
      const h = harness(client, [target('a'), target('b'), target('c')], recordingFormat().format);
      const out = await h.run();
      expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'error', 'done']);
      expect(out.failures).toEqual([{ channelId: 'b', label: 'Guild / chan-b', kind: 'error', reason: 'Discord rate limit reached; try again later.' }]);
      expect(out.fileCount).toBe(2);
      expect(client.calls.some((c) => c.channelId === 'c')).toBe(true);
    }
  });

  it('only a rate-limited error stops the run: another kind carrying a long retryAfterMs does not', async () => {
    const client = new FakeClient({ a: messages(1), c: messages(2) }, { errors: { b: { error: new DiscordApiError('unknown', 'index not ready', { status: 202, retryAfterMs: 500_000 }) } } });
    const h = harness(client, [target('a'), target('b'), target('c')], recordingFormat().format);
    const out = await h.run();
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'error', 'done']);
    expect(out.fileCount).toBe(2);
  });

  it('a user cancel that arrives together with the limit is still a cancel', async () => {
    const controller = new AbortController();
    const client = new FakeClient({ a: messages(1) });
    const original = client.getMessages.bind(client);
    vi.spyOn(client, 'getMessages').mockImplementation(async (channelId, opts, signal) => {
      if (channelId !== 'b') return original(channelId, opts, signal);
      controller.abort();
      throw limited(300_000);
    });
    const out = await harness(client, [target('a'), target('b'), target('c')], recordingFormat().format).run({ signal: controller.signal });
    expect(out.cancelled).toBe(true);
    expect(out.failures).toEqual([]);
  });
});

describe('403 that is not a permission error (kind "unknown")', () => {
  // The live client reports a Cloudflare / anti-abuse block as 'unknown' with status 403 (see api.ts): it says nothing about this
  // channel's permissions, so the channel is an error with Discord's own wording - never the fixed "no access" text.
  const blocked = (): DiscordApiError =>
    new DiscordApiError('unknown', 'Discord API error 403 for GET /channels/b/messages (not a missing-permission error; this may be a temporary block, try again later)', {
      status: 403,
      code: 40333,
    });

  it('is listed as an error with its own message, not as "no access", and the run goes on', async () => {
    const client = new FakeClient({ a: messages(1), c: messages(2) }, { errors: { b: { error: blocked() } } });
    const h = harness(client, [target('a'), target('b', { channelName: 'blocked' }), target('c')], recordingFormat().format);
    const out = await h.run();

    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'error', 'done']);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toMatchObject({ channelId: 'b', label: 'Guild / blocked', kind: 'error' });
    expect(out.failures[0].reason).toBe(blocked().message);
    expect(out.failures[0].reason).not.toContain('No access');
    expect(lastOf(h.progress).targets[1].error).toBe(blocked().message);
    expect(out.fileCount).toBe(2);
  });

  it('while a real permission error (kind "forbidden") stays a skip with the fixed text', async () => {
    const client = new FakeClient({}, { errors: { a: { error: new DiscordApiError('forbidden', 'Missing Access', { status: 403, code: 50001 }) } } });
    const out = await harness(client, [target('a')], recordingFormat().format).run();
    expect(out.failures).toEqual([{ channelId: 'a', label: 'Guild / chan-a', kind: 'skipped', reason: 'No access to this channel (403).' }]);
  });
});

describe('cancellation', () => {
  it('stops immediately, marks the rest cancelled and keeps only finished targets', async () => {
    const controller = new AbortController();
    const client = new FakeClient(
      { a: messages(150), b: messages(5), c: messages(5) },
      {
        onCall: (call) => {
          if (call.channelId === 'b') controller.abort();
        },
      },
    );
    const h = harness(client, [target('a', { channelName: 'one' }), target('b'), target('c')], recordingFormat().format);
    const out = await h.run({ signal: controller.signal });

    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(1);
    expect(out.messageCount).toBe(150);
    expect(out.filename).toBe('Guild - one.txt');
    expect((await textOf(out.blob)).startsWith('# one\n')).toBe(true);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'cancelled', 'cancelled']);
    expect(lastOf(h.progress).currentIndex).toBe(-1);
    expect(new Set(client.calls.map((c) => c.channelId))).toEqual(new Set(['a', 'b']));
  });

  it('builds the ZIP of finished targets when cancelled with several completed', async () => {
    const controller = new AbortController();
    const client = new FakeClient(
      { a: messages(3), b: messages(4), c: messages(5) },
      {
        onCall: (call) => {
          if (call.channelId === 'c') controller.abort();
        },
      },
    );
    const out = await harness(client, [target('a'), target('b'), target('c')], recordingFormat().format).run({ signal: controller.signal });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(2);
    expect(out.filename).toBe('Discord Export 2026-10-06.zip');
    expect(Object.keys(await unzipBlob(out.blob))).toEqual(['Guild/Cat/chan-a.txt', 'Guild/Cat/chan-b.txt']);
  });

  it('cancels in the middle of a channel, discarding it', async () => {
    const controller = new AbortController();
    const client = new FakeClient(
      { a: messages(500) },
      {
        onCall: (_call, index) => {
          if (index === 2) controller.abort();
        },
      },
    );
    const { format, log } = recordingFormat();
    const h = harness(client, [target('a')], format);
    const out = await h.run({ signal: controller.signal });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(0);
    expect(out.filename).toBe('');
    expect(out.blob.size).toBe(0);
    expect(lastOf(h.progress).targets[0].status).toBe('cancelled');
    expect(log.batches.length).toBe(2);
    expect(log.ends).toHaveLength(0);
  });

  it('does nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new FakeClient({ a: messages(5), b: messages(5) });
    const h = harness(client, [target('a'), target('b')], recordingFormat().format);
    const out = await h.run({ signal: controller.signal });
    expect(client.calls).toHaveLength(0);
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(0);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('notices an abort even when the client ignores the signal', async () => {
    const controller = new AbortController();
    const client = new FakeClient({ a: messages(300) });
    const original = client.getMessages.bind(client);
    vi.spyOn(client, 'getMessages').mockImplementation(async (channelId, opts) => {
      const page = await original(channelId, opts);
      controller.abort();
      return page;
    });
    const { format, log } = recordingFormat();
    const out = await harness(client, [target('a')], format).run({ signal: controller.signal });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(0);
    expect(log.batches).toHaveLength(0);
  });

  it('treats a client "aborted" rejection as a cancel', async () => {
    const client = new FakeClient({}, { errors: { a: { error: new DiscordApiError('aborted', 'aborted') } } });
    const h = harness(client, [target('a'), target('b')], recordingFormat().format);
    const out = await h.run();
    expect(out.cancelled).toBe(true);
    expect(out.failures).toEqual([]);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('does not report an abort of a finished run as a failure', async () => {
    const controller = new AbortController();
    const client = new FakeClient({ a: messages(3) });
    const out = await harness(client, [target('a')], recordingFormat().format).run({ signal: controller.signal });
    controller.abort();
    expect(out.cancelled).toBe(false);
    expect(out.fileCount).toBe(1);
  });
});

describe('progress', () => {
  it('starts all queued with currentIndex -1 and ends with currentIndex -1', async () => {
    const h = harness(new FakeClient({ a: messages(2), b: messages(2) }), [target('a'), target('b')], recordingFormat().format);
    await h.run();
    expect(h.progress[0].currentIndex).toBe(-1);
    expect(h.progress[0].targets.map((t) => t.status)).toEqual(['queued', 'queued']);
    expect(h.progress[0].totalMessages).toBe(0);
    expect(lastOf(h.progress).currentIndex).toBe(-1);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'done']);
    expect(lastOf(h.progress).totalMessages).toBe(4);
  });

  it('labels targets "Guild / channel", and DMs by name only', async () => {
    const dm = target('b', { kind: 'dm', guildId: null, guildName: null, channelName: 'Alice', categoryName: null });
    const h = harness(new FakeClient({}), [target('a', { channelName: 'general' }), dm], recordingFormat().format);
    await h.run();
    expect(h.progress[0].targets.map((t) => t.label)).toEqual(['Guild / general', 'Alice']);
  });

  it('reports the current target and its status transitions in order', async () => {
    const h = harness(new FakeClient({ a: messages(250), b: messages(1) }), [target('a'), target('b')], recordingFormat().format);
    await h.run();
    const transitions = (index: number): string[] => {
      const seen: string[] = [];
      for (const p of h.progress) {
        const status = p.targets[index].status;
        if (seen[seen.length - 1] !== status) seen.push(status);
      }
      return seen;
    };
    expect(transitions(0)).toEqual(['queued', 'fetching', 'done']);
    expect(transitions(1)).toEqual(['queued', 'fetching', 'done']);
    const fetchingA = h.progress.filter((p) => p.targets[0].status === 'fetching');
    expect(fetchingA.every((p) => p.currentIndex === 0)).toBe(true);
    expect(h.progress.some((p) => p.currentIndex === 1 && p.targets[1].status === 'fetching')).toBe(true);
  });

  it('keeps fetched counts, ratios and the total monotonic, reaching ratio 1 when done', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // Real-looking channel ids: the estimate needs the channel creation time as the start of the range.
    const a = timestampToSnowflake(T0 - 500 * SECOND);
    const b = timestampToSnowflake(T0 - 400 * SECOND);
    const client = new FakeClient(
      { [a]: messages(540), [b]: messages(120, 700) },
      { onCall: () => { clock += 1000; } },
    );
    const h = harness(client, [target(a), target(b)], recordingFormat().format);
    await h.run();

    let previousTotal = 0;
    const previous = [{ fetched: 0, ratio: 0 }, { fetched: 0, ratio: 0 }];
    for (const p of h.progress) {
      expect(p.totalMessages).toBeGreaterThanOrEqual(previousTotal);
      previousTotal = p.totalMessages;
      p.targets.forEach((t, i) => {
        expect(t.fetched).toBeGreaterThanOrEqual(previous[i].fetched);
        expect(t.ratio).not.toBeNull();
        expect(t.ratio as number).toBeGreaterThanOrEqual(previous[i].ratio);
        expect(t.ratio as number).toBeLessThanOrEqual(1);
        previous[i] = { fetched: t.fetched, ratio: t.ratio as number };
      });
    }
    const final = lastOf(h.progress);
    expect(final.targets.map((t) => t.fetched)).toEqual([540, 120]);
    expect(final.targets.map((t) => t.ratio)).toEqual([1, 1]);
    expect(final.totalMessages).toBe(660);
  });

  it('estimates the ratio from the last message time between range start and now', async () => {
    const start = T0;
    const end = T0 + 1000 * SECOND;
    const channelId = timestampToSnowflake(start);
    const all = messages(500, 0).map((m) => ({ ...m, channel_id: channelId }));
    const h = harness(new FakeClient({ [channelId]: all }), [target(channelId)], recordingFormat().format);
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000));
    await h.run({ now: () => new Date(end) });

    expect(snowflakeToTimestamp(channelId)).toBe(start);
    const fetching = h.progress.filter((p) => p.targets[0].status === 'fetching' && p.targets[0].fetched > 0);
    // After 100 messages the newest is message #99 => 99 s of a 1000 s span
    expect(fetching[0].targets[0].fetched).toBe(100);
    expect(fetching[0].targets[0].ratio).toBeCloseTo(0.099, 5);
    expect(lastOf(h.progress).targets[0].ratio).toBe(1);
  });

  it('uses `after` / `before` as the range for the estimate', async () => {
    const all = messages(300);
    const h = harness(new FakeClient({ a: all }), [target('a')], recordingFormat().format);
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000));
    await h.run({
      options: { ...OPTIONS, after: new Date(T0).toISOString(), before: new Date(T0 + 400 * SECOND).toISOString() },
    });
    const first = h.progress.find((p) => p.targets[0].fetched > 0);
    expect(first?.targets[0].ratio).toBeCloseTo(100 / 400, 5);
  });

  it('reports a null ratio when the range is degenerate', async () => {
    const h = harness(new FakeClient({ a: messages(5) }), [target('a')], recordingFormat().format);
    await h.run({ now: () => new Date(T0 - 1_000_000_000_000) });
    const fetching = h.progress.filter((p) => p.targets[0].status === 'fetching');
    expect(fetching.length).toBeGreaterThan(0);
    expect(fetching.every((p) => p.targets[0].ratio === null)).toBe(true);
    expect(lastOf(h.progress).targets[0].ratio).toBe(1);
  });

  it('clamps the ratio to 0..1 when messages are newer than the range end', async () => {
    const h = harness(new FakeClient({ a: messages(150) }), [target('a')], recordingFormat().format);
    await h.run({ now: () => new Date(T0 + 50 * SECOND) });
    for (const p of h.progress) {
      const ratio = p.targets[0].ratio;
      if (ratio !== null) {
        expect(ratio).toBeGreaterThanOrEqual(0);
        expect(ratio).toBeLessThanOrEqual(1);
      }
    }
  });

  it('throttles fetch updates to about 10 per second but always reports status changes', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // 50 pages, each "taking" 30 ms => 1.5 s of simulated time
    const client = new FakeClient({ a: messages(5000), b: messages(10) }, { onCall: () => { clock += 30; } });
    const h = harness(client, [target('a'), target('b')], recordingFormat().format);
    await h.run();

    const statusSignature = (p: ExportProgress): string => p.targets.map((t) => t.status).join(',');
    let previous = statusSignature(h.progress[0]);
    let fetchOnly = 0;
    const statuses = new Set<string>([previous]);
    for (const p of h.progress.slice(1)) {
      const signature = statusSignature(p);
      if (signature === previous) fetchOnly += 1;
      else statuses.add(signature);
      previous = signature;
    }
    expect(fetchOnly).toBeLessThanOrEqual(18);
    expect(fetchOnly).toBeGreaterThanOrEqual(8);
    expect([...statuses]).toEqual(['queued,queued', 'fetching,queued', 'done,queued', 'done,fetching', 'done,done']);
  });

  it('emits few updates when everything happens within a single throttle window', async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => 5);
    const h = harness(new FakeClient({ a: messages(3000) }), [target('a')], recordingFormat().format);
    await h.run();
    // initial + fetching + done + final = 4; fetch-only updates are suppressed
    expect(h.progress.length).toBeLessThanOrEqual(5);
  });

  it('never mutates a snapshot after handing it out', async () => {
    const taken: { snapshot: ExportProgress; json: string }[] = [];
    const h = harness(new FakeClient({ a: messages(250), b: messages(3) }), [target('a'), target('b')], recordingFormat().format);
    await h.run({ onProgress: (p) => taken.push({ snapshot: p, json: JSON.stringify(p) }) });
    expect(taken.length).toBeGreaterThan(4);
    for (const { snapshot, json } of taken) expect(JSON.stringify(snapshot)).toBe(json);
    expect(taken[0].snapshot.targets[0].status).toBe('queued');
  });

  it('works without an onProgress callback and with zero targets', async () => {
    const out = await runExport({
      client: new FakeClient({}),
      targets: [],
      format: recordingFormat().format,
      options: OPTIONS,
    });
    expect(out.fileCount).toBe(0);
    expect(out.failures).toEqual([]);
    expect(out.cancelled).toBe(false);
  });
});

describe('packaging', () => {
  it('zips several channels as Server/Category/channel.ext with Direct Messages for DMs', async () => {
    const targets = [
      target('a', { channelName: 'general', guildName: 'My Server', categoryName: 'Text' }),
      target('b', { channelName: 'random', guildName: 'My Server', categoryName: 'Text' }),
      target('c', { channelName: 'lobby', guildName: 'My Server', categoryName: null }),
      target('d', { kind: 'dm', guildId: null, guildName: null, categoryName: null, channelName: 'Alice' }),
      target('e', { kind: 'thread', channelName: 'bug 42', parentChannelName: 'support', guildName: 'My Server', categoryName: 'Text' }),
    ];
    const client = new FakeClient({ a: messages(2), b: messages(3), c: messages(1), d: messages(4), e: messages(5) });
    const out = await harness(client, targets, recordingFormat().format).run();

    expect(out.fileCount).toBe(5);
    expect(out.messageCount).toBe(15);
    expect(out.filename).toBe('Discord Export 2026-10-06.zip');
    expect(out.blob.type).toBe('application/zip');
    const files = await unzipBlob(out.blob);
    expect(Object.keys(files)).toEqual([
      'My Server/Text/general.txt',
      'My Server/Text/random.txt',
      'My Server/lobby.txt',
      'Direct Messages/Alice.txt',
      'My Server/Text/support - bug 42.txt',
    ]);
    expect(files['My Server/Text/general.txt']).toBe(`# general\n${idsOf(messages(2)).join('\n')}\n-- 2\n`);
    expect(files['Direct Messages/Alice.txt'].endsWith('-- 4\n')).toBe(true);
  });

  it('disambiguates colliding names (case-insensitively) with the channel id', async () => {
    const targets = [
      target('111', { channelName: 'General' }),
      target('222', { channelName: 'general' }),
      target('333', { channelName: 'GENERAL' }),
    ];
    const out = await harness(new FakeClient({}), targets, recordingFormat().format).run();
    expect(Object.keys(await unzipBlob(out.blob))).toEqual([
      'Guild/Cat/General.txt',
      'Guild/Cat/general [222].txt',
      'Guild/Cat/GENERAL [333].txt',
    ]);
  });

  it('sanitises hostile names into safe entry paths', async () => {
    const targets = [
      target('1', { guildName: '../../evil', categoryName: 'a/b', channelName: 'con' }),
      target('2', { guildName: 'ok', categoryName: null, channelName: '..' }),
    ];
    const out = await harness(new FakeClient({}), targets, recordingFormat().format).run();
    const names = Object.keys(await unzipBlob(out.blob));
    for (const name of names) {
      expect(name.split('/')).not.toContain('..');
      expect(name.startsWith('/')).toBe(false);
    }
    expect(names).toHaveLength(2);
  });

  it('uses the injected clock for the ZIP name', async () => {
    const out = await harness(new FakeClient({}), [target('a'), target('b')], recordingFormat().format).run({
      now: () => new Date(2031, 1, 3, 4, 5, 6),
    });
    expect(out.filename).toBe('Discord Export 2031-02-03.zip');
  });

  it('keeps a single survivor unzipped even when others failed', async () => {
    const client = new FakeClient({ a: messages(2) }, { errors: { b: { error: new DiscordApiError('forbidden', 'x') } } });
    const out = await harness(client, [target('a', { channelName: 'x' }), target('b')], recordingFormat().format).run();
    expect(out.fileCount).toBe(1);
    expect(out.filename).toBe('Guild - x.txt');
    expect(out.blob.type).toBe('text/plain');
    expect(out.failures).toHaveLength(1);
  });
});

describe('name resolver', () => {
  it('knows authors and mentioned users by the time their batch is written', async () => {
    const batch = [msg(1, { author: ALICE, mentions: [BOB] }), msg(2, { author: { id: '1003', username: 'carol', global_name: '' } })];
    const { format, log } = recordingFormat({ probeUsers: ['1001', '1002', '1003', '9999'] });
    await harness(new FakeClient({ a: batch }), [target('a')], format).run();
    expect(log.resolved[0]).toEqual({ '1001': 'Alice A.', '1002': 'bob', '1003': 'carol', '9999': undefined });
  });

  it('learns from each batch before writing it, not from later ones', async () => {
    const early = messages(100);
    const late = [msg(101, { mentions: [BOB] })];
    const { format, log } = recordingFormat({ probeUsers: ['1002'] });
    await harness(new FakeClient({ a: [...early, ...late] }), [target('a')], format).run();
    expect(log.resolved.map((r) => r['1002'])).toEqual([undefined, 'bob']);
  });

  it('also learns users from replied-to messages and forwarded snapshots', async () => {
    const replied = msg(1, { author: BOB });
    const reply = msg(2, {
      type: 19,
      referenced_message: replied,
      message_snapshots: [{ message: { content: 'fwd', mentions: [{ id: '1004', username: 'dave', global_name: 'Dave' }] } }],
    });
    const { format, log } = recordingFormat({ probeUsers: ['1002', '1004'] });
    await harness(new FakeClient({ a: [reply] }), [target('a')], format).run();
    expect(log.resolved[0]).toEqual({ '1002': 'bob', '1004': 'Dave' });
  });

  it('shares learned users across channels of the run', async () => {
    const { format, log } = recordingFormat({ probeUsers: ['1002'] });
    await harness(new FakeClient({ a: [msg(1, { mentions: [BOB] })], b: [msg(2)] }), [target('a'), target('b')], format).run();
    expect(log.resolved.map((r) => r['1002'])).toEqual(['bob', 'bob']);
  });

  it('resolves channels and roles through the callbacks with the target guild id', async () => {
    const channelNames = vi.fn((guildId: Snowflake | null) => (guildId === 'g1' ? { '10': 'general' } : undefined));
    const roleNames = vi.fn((guildId: Snowflake | null) => (guildId === 'g1' ? { '20': 'Moderators' } : undefined));
    const dm = target('b', { kind: 'dm', guildId: null, guildName: null, categoryName: null });
    const { format, log } = recordingFormat({ probeChannels: ['10', '11'], probeRoles: ['20', '21'] });
    await harness(new FakeClient({}), [target('a'), dm], format).run({ channelNames, roleNames });

    // Each writer sees the names of its own target's guild, not those of the one before it.
    const [guildStart, dmStart] = log.started;
    expect(guildStart).toEqual({ channels: { '10': 'general', '11': undefined }, roles: { '20': 'Moderators', '21': undefined } });
    expect(dmStart).toEqual({ channels: { '10': undefined, '11': undefined }, roles: { '20': undefined, '21': undefined } });
    expect(channelNames).toHaveBeenCalledWith('g1');
    expect(roleNames).toHaveBeenCalledWith(null);
  });

  it('falls back to the exported channels for #mentions of themselves', async () => {
    const { format, log } = recordingFormat({ probeChannels: ['b', 'zzz'] });
    await harness(new FakeClient({}), [target('a', { channelName: 'general' }), target('b', { channelName: 'random' })], format).run();
    expect(log.started[0].channels).toEqual({ b: 'random', zzz: undefined });
  });

  it('prefers the provided channel names over the fallback', async () => {
    const { format, log } = recordingFormat({ probeChannels: ['a'] });
    await harness(new FakeClient({}), [target('a', { channelName: 'old-name' })], format).run({ channelNames: () => ({ a: 'renamed' }) });
    expect(log.started[0].channels).toEqual({ a: 'renamed' });
  });

  it('does not resolve prototype keys', async () => {
    const { format, log } = recordingFormat({ probeUsers: ['constructor'], probeChannels: ['constructor'], probeRoles: ['__proto__', 'toString'] });
    await harness(new FakeClient({ a: messages(1) }), [target('a')], format).run({ channelNames: () => ({}), roleNames: () => ({}) });
    expect(log.started[0]).toEqual({ channels: { constructor: undefined }, roles: { __proto__: undefined, toString: undefined } });
    expect(log.resolved[0]).toEqual({ constructor: undefined });
  });

  it('keeps own properties called like prototype members (a hostile guild response)', async () => {
    const { format, log } = recordingFormat({ probeChannels: ['__proto__', 'constructor'], probeRoles: ['toString'] });
    const hostile = JSON.parse('{"__proto__": "own-proto", "constructor": "own-ctor"}') as Record<string, string>;
    await harness(new FakeClient({}), [target('a')], format).run({ channelNames: () => hostile, roleNames: () => JSON.parse('{"toString": "own-role"}') as Record<string, string> });
    expect(log.started[0].channels).toEqual(Object.fromEntries([['__proto__', 'own-proto'], ['constructor', 'own-ctor']]));
    expect(log.started[0].roles).toEqual({ toString: 'own-role' });
  });

  it('learns channel names from mention_channels and users from interactions, like the app', async () => {
    const crossposted = msg(1, {
      content: 'see <#999999999999999999> and <@555555555555555555>',
      mention_channels: [{ id: '999999999999999999', guild_id: '9', type: 0, name: 'other-guild-chan' }],
      interaction: { id: '1', type: 2, name: 'ping', user: { id: '555555555555555555', username: 'slashuser' } },
    });
    const out = await harness(new FakeClient({ a: [crossposted] }), [target('a')], txtFormat).run({ options: { ...OPTIONS, format: 'txt' } });
    expect(await textOf(out.blob)).toContain('\nsee #other-guild-chan and @slashuser\n');
  });

  it('uses the display name rule of the app: a blank global_name falls back to the username', async () => {
    const blank: User = { id: '1003', username: 'dave', global_name: '   ' };
    const { format, log } = recordingFormat({ probeUsers: ['1003', '1004'] });
    const padded: User = { id: '1004', username: 'eve', global_name: '  Eve  ' };
    await harness(new FakeClient({ a: [msg(1, { mentions: [blank, padded] })] }), [target('a')], format).run();
    expect(log.resolved[0]).toEqual({ '1003': 'dave', '1004': 'Eve' });
  });

  it('gives the guild channel tree priority over names learned from messages', async () => {
    const m = msg(1, { content: '<#10>', mention_channels: [{ id: '10', guild_id: '9', type: 0, name: 'stale-name' }] });
    const withTree = await harness(new FakeClient({ a: [m] }), [target('a')], txtFormat).run({ channelNames: () => ({ '10': 'general' }) });
    expect(await textOf(withTree.blob)).toContain('\n#general\n');
    const withoutTree = await harness(new FakeClient({ a: [m] }), [target('a')], txtFormat).run();
    expect(await textOf(withoutTree.blob)).toContain('\n#stale-name\n');
  });

  it('resolves every mention of the demo showcase channel exactly like the app resolver does', async () => {
    const client = createMockClient({ latencyMs: 0 });
    const all: Message[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await client.getMessages(MOCK_IDS.showcaseChannel, { before, limit: 100 });
      if (page.length === 0) break;
      all.push(...page);
      before = page[page.length - 1].id;
    }
    all.reverse();
    const channels = Object.fromEntries((await client.getGuildChannels(MOCK_IDS.bigGuild)).map((c) => [c.id, c.name ?? '']));
    const roles = Object.fromEntries((await client.getGuildRoles(MOCK_IDS.bigGuild)).map((r) => [r.id, r.name]));
    const showcase = target(MOCK_IDS.showcaseChannel, { guildId: MOCK_IDS.bigGuild, guildName: 'Dev Lounge', channelName: 'showcase' });

    const exported = await runExport({
      client,
      targets: [showcase],
      format: txtFormat,
      options: { ...OPTIONS, locale: 'ko' },
      channelNames: () => channels,
      roleNames: () => roles,
      now: () => NOW,
    });

    const appNames = buildNameResolver({ channels, roles });
    appNames.addMessages(all);
    const writer = txtFormat.createWriter({ target: showcase, options: { ...OPTIONS, locale: 'ko' }, exportedAt: NOW, names: appNames });
    const chunks = [...writer.start(), ...writer.write(all)];
    const first = all[0].timestamp;
    const last = all[all.length - 1].timestamp;
    chunks.push(...writer.end({ messageCount: all.length, firstTimestamp: first, lastTimestamp: last }));
    const expected = chunks.map((c) => (typeof c === 'string' ? c : new TextDecoder().decode(c))).join('');

    expect(await textOf(exported.blob)).toBe(expected);
    expect(expected).toMatch(/@\S/);
  });
});

describe('late cancellation and callback failures', () => {
  /** Format whose writers append `size` zero bytes and run `onEnd(channelId)` when a channel is finished. */
  function bulkFormat(size: number, onEnd: (channelId: Snowflake) => void): ExportFormat {
    return {
      id: 'txt',
      label: 'Bulk',
      extension: 'txt',
      mime: 'text/plain',
      createWriter: (ctx) => ({
        start: () => [],
        write: () => [],
        end: () => {
          onEnd(ctx.target.channelId);
          return [new Uint8Array(size)];
        },
      }),
    };
  }

  it('an abort right after the last channel finished still returns what completed, flagged cancelled', async () => {
    const controller = new AbortController();
    const format = bulkFormat(10, (id) => {
      if (id === 'b') controller.abort();
    });
    const out = await harness(new FakeClient({}), [target('a'), target('b')], format).run({ signal: controller.signal });
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(2);
    expect(Object.keys(await unzipBlob(out.blob))).toHaveLength(2);
  });

  it('an abort while the ZIP is being built still delivers the finished archive, flagged cancelled', async () => {
    const controller = new AbortController();
    const format = bulkFormat(6 * 1024 * 1024, (id) => {
      if (id === 'b') setTimeout(() => controller.abort(), 0);
    });
    const h = harness(new FakeClient({}), [target('a'), target('b')], format);
    const out = await h.run({ signal: controller.signal });
    expect(controller.signal.aborted).toBe(true);
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(2);
    expect(out.filename).toBe('Discord Export 2026-10-06.zip');
    expect(out.blob.size).toBeGreaterThan(0);
    expect(Object.keys(await unzipBlob(out.blob))).toEqual(['Guild/Cat/chan-a.txt', 'Guild/Cat/chan-b.txt']);
    expect(lastOf(h.progress).targets.map((t) => t.status)).toEqual(['done', 'done']);
    expect(lastOf(h.progress).phase).toBe('finished');
  });

  it('an abort the moment packaging starts does not lose the completed channels either', async () => {
    const controller = new AbortController();
    const client = new FakeClient({ a: messages(3), b: messages(4), c: messages(5) });
    const h = harness(client, [target('a'), target('b'), target('c')], recordingFormat().format);
    const out = await h.run({
      signal: controller.signal,
      onProgress: (p) => {
        h.progress.push(p);
        if (p.phase === 'packaging') controller.abort();
      },
    });
    expect(h.progress.some((p) => p.phase === 'packaging')).toBe(true);
    expect(out.cancelled).toBe(true);
    expect(out.fileCount).toBe(3);
    expect(out.messageCount).toBe(12);
    expect(Object.keys(await unzipBlob(out.blob))).toHaveLength(3);
  });

  it('does not hand the abort signal to the packaging step', async () => {
    const controller = new AbortController();
    const zipSpy = vi.spyOn(zipModule, 'buildZip');
    await harness(new FakeClient({ a: messages(1), b: messages(1) }), [target('a'), target('b')], recordingFormat().format).run({ signal: controller.signal });
    expect(zipSpy).toHaveBeenCalledTimes(1);
    expect(zipSpy.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it('a throwing onProgress callback does not fail the export', async () => {
    const client = new FakeClient({ a: messages(250), b: messages(2) });
    const out = await runExport({
      client,
      targets: [target('a'), target('b')],
      format: recordingFormat().format,
      options: OPTIONS,
      now: () => NOW,
      onProgress: () => {
        throw new Error('UI bug');
      },
    });
    expect(out.failures).toEqual([]);
    expect(out.fileCount).toBe(2);
    expect(out.messageCount).toBe(252);
  });
});
