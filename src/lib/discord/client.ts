import type { Channel, GuildSummary, Message, Role, Snowflake, User } from './types';

export type DiscordErrorKind =
  | 'auth' // 401 — token missing/expired
  | 'forbidden' // 403 whose Discord JSON error code says "no access" (50001 Missing Access, 50013 Missing Permissions, ...). Any other 403 (HTML/Cloudflare block, unknown code) is 'unknown'.
  | 'not-found' // 404
  | 'rate-limited' // 429 and retries exhausted
  | 'network' // fetch threw (offline, DNS, ...)
  | 'server' // 5xx after retries
  | 'aborted' // AbortSignal fired
  | 'unknown';

export class DiscordApiError extends Error {
  readonly kind: DiscordErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  /** Discord's own JSON error code (e.g. 50001), when the response body carried one. */
  readonly code?: number;

  constructor(
    kind: DiscordErrorKind,
    message: string,
    opts: { status?: number; retryAfterMs?: number; code?: number; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'DiscordApiError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.code = opts.code;
  }
}

export interface GetMessagesOptions {
  /** Return messages older than this id. */
  before?: Snowflake;
  /** Return messages newer than this id. */
  after?: Snowflake;
  /** 1..100 (Discord hard limit). Default 50 server-side; we always pass it explicitly. */
  limit?: number;
}

export interface MyMember {
  roles: Snowflake[];
  /** Guild-level communication/timeouts etc. are ignored. */
  user?: User;
}

/**
 * The ONLY door to Discord data. `LiveDiscordClient` (real API) and `MockDiscordClient` (demo / tests) implement it.
 * Every method accepts an AbortSignal and must reject with `DiscordApiError` (never raw fetch errors).
 */
export interface DiscordClient {
  readonly kind: 'live' | 'mock';

  /** `GET /users/@me` */
  getMe(signal?: AbortSignal): Promise<User>;
  /** `GET /users/@me/guilds` (paginates internally; names/icons only). */
  getGuilds(signal?: AbortSignal): Promise<GuildSummary[]>;
  /** `GET /guilds/{id}/channels` — categories + channels, metadata only. */
  getGuildChannels(guildId: Snowflake, signal?: AbortSignal): Promise<Channel[]>;
  /**
   * Active threads / forum posts. A user token cannot use the bot-only `GET /guilds/{id}/threads/active`, so the live client
   * asks the thread-search endpoint for each forum/media channel (up to 4 pages = 100 posts per forum) and never scans
   * ordinary text channels, so threads under those are NOT listed in live mode (the demo world nests some, the real API cannot).
   * Best effort: may return a partial list or [] on non-abort failures — callers treat that as "no threads". It rejects only when
   * Discord's search index is not ready yet (status 202 / code 110000, `retryAfterMs` set) and nothing could be listed.
   */
  getActiveThreads(guildId: Snowflake, signal?: AbortSignal): Promise<Channel[]>;
  /** `GET /guilds/{id}/roles` — used only for best-effort permission filtering. */
  getGuildRoles(guildId: Snowflake, signal?: AbortSignal): Promise<Role[]>;
  /** The current user's member object in the guild (role ids). */
  getMyMember(guildId: Snowflake, signal?: AbortSignal): Promise<MyMember>;
  /** `GET /users/@me/channels` — DM + group DM channels (recipients included, no messages). */
  getDmChannels(signal?: AbortSignal): Promise<Channel[]>;
  /**
   * One raw page, exactly like the API: at most 100 messages, **newest first**.
   * (`after` pages are also returned newest-first within the page.)
   */
  getMessages(channelId: Snowflake, opts?: GetMessagesOptions, signal?: AbortSignal): Promise<Message[]>;
}
