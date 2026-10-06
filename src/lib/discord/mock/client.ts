import { DiscordApiError } from '../client';
import type { DiscordClient, GetMessagesOptions, MyMember } from '../client';
import { compareSnowflakes } from '../snowflake';
import type { Channel, GuildSummary, Message, Role, Snowflake, User } from '../types';
import { MOCK_ME } from './cast';
import { generateMessages } from './generate';
import { getWorld } from './world';
import type { ChannelEntry, GuildData } from './world';

export interface MockClientOptions {
  /** Simulated duration of every call in ms (default 120). 0 => no timer at all. */
  latencyMs?: number;
}

const DEFAULT_LATENCY_MS = 120;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** Results are copies, like parsed JSON from a real response: callers may do what they like with them. */
const copy = <T>(value: T): T => structuredClone(value);

function abortedError(signal: AbortSignal): DiscordApiError {
  return new DiscordApiError('aborted', 'The request was aborted', { cause: signal.reason });
}

function normaliseLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

/** Like the real API, ids that do not fit an unsigned 64-bit integer are refused (about the year 2154 as a date cursor). */
const MAX_UINT64 = (1n << 64n) - 1n;

function parseCursor(value: Snowflake | undefined, name: string): Snowflake | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{1,20}$/.test(value) || BigInt(value) > MAX_UINT64) {
    throw new DiscordApiError('unknown', `Invalid "${name}" snowflake`, { status: 400 });
  }
  return BigInt(value).toString(); // strips leading zeros so string comparison is numeric
}

/** First index whose id is >= `id` in an ascending list. */
function lowerBound(messages: readonly Message[], id: Snowflake): number {
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareSnowflakes(messages[mid].id, id) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose id is > `id` in an ascending list. */
function upperBound(messages: readonly Message[], id: Snowflake): number {
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareSnowflakes(messages[mid].id, id) <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Demo / test implementation of `DiscordClient`. Reproduces the real API's behaviour (newest-first pages, `before` /
 * `after` cursors, 403 / 404 errors, abort handling, latency) over a deterministic fictional world. No network access.
 */
export function createMockClient(opts: MockClientOptions = {}): DiscordClient {
  const latencyMs = opts.latencyMs ?? DEFAULT_LATENCY_MS;
  const world = getWorld();
  const histories = new Map<Snowflake, readonly Message[]>();

  /** Simulated round trip. Rejects as soon as the signal fires, like an aborted fetch. */
  function roundTrip(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortedError(signal));
    if (latencyMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortedError(signal as AbortSignal));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, latencyMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function guildOf(guildId: Snowflake): GuildData {
    const guild = world.guildById.get(guildId);
    if (!guild) throw new DiscordApiError('not-found', 'Unknown Guild', { status: 404 });
    return guild;
  }

  function historyOf(entry: ChannelEntry): readonly Message[] {
    const id = entry.channel.id;
    let history = histories.get(id);
    if (!history) {
      history = entry.profile ? generateMessages(entry.profile) : [];
      histories.set(id, history);
    }
    return history;
  }

  return {
    kind: 'mock',

    async getMe(signal?: AbortSignal): Promise<User> {
      await roundTrip(signal);
      return copy(MOCK_ME);
    },

    async getGuilds(signal?: AbortSignal): Promise<GuildSummary[]> {
      await roundTrip(signal);
      return copy(world.guilds.map((g) => g.summary));
    },

    async getGuildChannels(guildId: Snowflake, signal?: AbortSignal): Promise<Channel[]> {
      await roundTrip(signal);
      return copy(guildOf(guildId).channels);
    },

    async getActiveThreads(guildId: Snowflake, signal?: AbortSignal): Promise<Channel[]> {
      await roundTrip(signal);
      return copy(guildOf(guildId).threads);
    },

    async getGuildRoles(guildId: Snowflake, signal?: AbortSignal): Promise<Role[]> {
      await roundTrip(signal);
      return copy(guildOf(guildId).roles);
    },

    async getMyMember(guildId: Snowflake, signal?: AbortSignal): Promise<MyMember> {
      await roundTrip(signal);
      return { roles: [...guildOf(guildId).myRoles], user: copy(MOCK_ME) };
    },

    async getDmChannels(signal?: AbortSignal): Promise<Channel[]> {
      await roundTrip(signal);
      return copy(world.dms);
    },

    /**
     * `limit` is clamped to 1..100 (default 50). Without a cursor: the newest messages. `before`: the newest messages
     * older than the cursor. `after`: the OLDEST messages newer than the cursor. Always returned newest first.
     * With both cursors the window is bounded by both and `after` decides which end is kept.
     */
    async getMessages(channelId: Snowflake, options: GetMessagesOptions = {}, signal?: AbortSignal): Promise<Message[]> {
      await roundTrip(signal);
      const entry = world.entries.get(channelId);
      if (!entry) throw new DiscordApiError('not-found', 'Unknown Channel', { status: 404 });
      if (entry.access === 'forbidden') throw new DiscordApiError('forbidden', 'Missing Access', { status: 403 });
      if (entry.access === 'unreadable') throw new DiscordApiError('unknown', 'Cannot execute action on this channel type', { status: 400 });

      const before = parseCursor(options.before, 'before');
      const after = parseCursor(options.after, 'after');
      const limit = normaliseLimit(options.limit);
      const history = historyOf(entry);

      const from = after === undefined ? 0 : upperBound(history, after);
      const to = before === undefined ? history.length : lowerBound(history, before);
      if (from >= to) return [];

      const page = after !== undefined ? history.slice(from, Math.min(to, from + limit)) : history.slice(Math.max(from, to - limit), to);
      return copy(page).reverse();
    },
  };
}
