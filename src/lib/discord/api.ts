import { API_BASE } from '@/shared/constants';
import { DiscordApiError } from './client';
import type { DiscordClient, GetMessagesOptions, MyMember } from './client';
import {
  DEFAULT_MIN_GAP_MS,
  MAX_RATE_LIMIT_RETRIES,
  MAX_RATE_LIMIT_WAIT_MS,
  MAX_TRANSIENT_RETRIES,
  RateLimiter,
  SerialQueue,
  abortableSleep,
  abortedError,
  backoffDelayMs,
  parseRateLimitHeaders,
  parseRetryAfter,
  throwIfAborted,
} from './rateLimit';
import { ChannelType } from './types';
import type { Channel, GuildSummary, Message, Role, Snowflake, User } from './types';

const GUILDS_PAGE_SIZE = 200;
/** A user has at most a few hundred guilds; the cap only protects against a server that never returns a short page. */
const MAX_GUILD_PAGES = 25;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const MAX_ERROR_DETAIL_LENGTH = 200;
/** Forum / media search answers at most 25 posts per request; a forum is followed for a few pages only (100 posts). */
const MAX_THREAD_SEARCH_PAGES = 4;
/** Total waits (shared by all forums of one `getActiveThreads` call) for a search index that is "not yet available". */
const MAX_INDEX_WAITS = 2;
const INDEX_RETRY_DEFAULT_MS = 3_000;
const INDEX_RETRY_MAX_MS = 10_000;
/** Discord's `code` for "Index not yet available. Try again later" (HTTP 202 from the thread search). */
const INDEX_NOT_READY_CODE = 110000;
/** Discord error codes behind a 403 that really mean "this account may not read that" (Missing Access, Missing Permissions, verification level). */
const NO_ACCESS_CODES: ReadonlySet<number> = new Set([50001, 50013, 50009]);
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;
const ID_PATTERN = /^\d{1,25}$/;

export interface LiveDiscordClientOptions {
  /** The raw `Authorization` value. Resolved before every attempt (retries included) so a refreshed token is picked up. */
  getToken: () => Promise<string | null> | string | null;
  /**
   * Called when Discord rejects a token (HTTP 401), at most once per distinct token, with the token that was actually sent
   * for the failing request: the stored token may have been replaced since, and only the rejected one should be discarded.
   */
  onAuthError?: (usedToken: string) => void;
  fetch?: typeof fetch;
  /** Default `API_BASE`. The token is only ever sent to URLs inside this base. */
  baseUrl?: string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Jitter source, returns [0, 1). */
  random?: () => number;
  /** Clock for rate-limit bookkeeping (epoch ms). */
  now?: () => number;
  /** Pause between two consecutive requests. Default 0: see `DEFAULT_MIN_GAP_MS`. */
  minGapMs?: number;
}

/**
 * True only for URLs that really live under `baseUrl` (same origin, path below the base path).
 * A plain `startsWith` is not enough: `https://discord.com/api/v9.evil.com` starts with the base URL,
 * and `..` segments or `user@host` tricks must be resolved before comparing.
 */
export function isTrustedApiUrl(url: string, baseUrl: string): boolean {
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  if (target.origin !== base.origin || target.username !== '' || target.password !== '') return false;
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return target.pathname === base.pathname || target.pathname.startsWith(basePath);
}

function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new DiscordApiError('unknown', `Invalid ${label}: expected a numeric id.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Discord's numeric error `code` from a JSON error body (0 means "generic" and is dropped). */
function errorCodeOf(body: unknown): number | undefined {
  return isRecord(body) && typeof body.code === 'number' && Number.isInteger(body.code) && body.code !== 0 ? body.code : undefined;
}

/**
 * A 403 is only "forbidden" when Discord's own error code says the account has no access. Anything else (a Cloudflare HTML
 * page, an anti-abuse block such as 40333, an unknown or missing code) is not a statement about this channel's permissions.
 */
function kindOfStatus(status: number, code: number | undefined): DiscordApiError['kind'] {
  if (status === 401) return 'auth';
  if (status === 403) return code !== undefined && NO_ACCESS_CODES.has(code) ? 'forbidden' : 'unknown';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Discord's `{ message, code }` error body as a short string; '' when there is nothing useful. */
function describeErrorBody(body: unknown): string {
  if (!isRecord(body)) return '';
  const message = typeof body.message === 'string' ? body.message.replace(/\s+/g, ' ').trim() : '';
  const code = typeof body.code === 'number' && body.code !== 0 ? ` (code ${body.code})` : '';
  const text = message.length > MAX_ERROR_DETAIL_LENGTH ? `${message.slice(0, MAX_ERROR_DETAIL_LENGTH)}...` : message;
  return `${text}${code}`.trim();
}

interface RequestOptions {
  /**
   * The endpoint may not be meant for user tokens, so a 401 there says nothing about the token:
   * still reported as 'auth' to the caller, but `onAuthError` is not fired.
   */
  softAuth?: boolean;
  /** Optional data: no 5xx / network retries and no waiting out a 429 (the wait is still recorded for later requests). */
  singleAttempt?: boolean;
  /**
   * The endpoint is an indexed search: Discord answers HTTP 202 / code 110000 "Index not yet available" while it has not
   * indexed the channel. That is thrown as an error with `status` 202 and `retryAfterMs` instead of being returned as a body.
   */
  indexedSearch?: boolean;
}

/** An indexed search that has no results yet: 202 (or Discord's 110000 code) and no `threads` array. */
function isIndexNotReady(status: number, body: unknown): boolean {
  if (isRecord(body) && Array.isArray(body.threads)) return false;
  return status === 202 || (isRecord(body) && body.code === INDEX_NOT_READY_CODE);
}

function retryAfterMsOf(body: unknown): number | undefined {
  if (!isRecord(body) || typeof body.retry_after !== 'number') return undefined;
  return Number.isFinite(body.retry_after) && body.retry_after > 0 ? Math.ceil(body.retry_after * 1000) : undefined;
}

/** Real Discord API client: GET only, sequential, rate-limit aware. Never logs or reports the token. */
export class LiveDiscordClient implements DiscordClient {
  readonly kind = 'live' as const;

  private readonly getToken: LiveDiscordClientOptions['getToken'];
  private readonly onAuthError: ((usedToken: string) => void) | undefined;
  private readonly doFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly queue = new SerialQueue();
  private readonly limiter: RateLimiter;
  /** The last token reported through `onAuthError`: the same rejected token is reported once, a different one again. */
  private lastReportedAuthToken: string | null = null;
  /** guild id -> ids of its forum / media channels, learned from `getGuildChannels` (see `getActiveThreads`). */
  private readonly forumParents = new Map<Snowflake, Snowflake[]>();

  constructor(opts: LiveDiscordClientOptions) {
    this.getToken = opts.getToken;
    this.onAuthError = opts.onAuthError;
    const fetchImpl = opts.fetch;
    // Wrapped so the global fetch is always invoked as a plain function (a detached `fetch` throws "Illegal invocation").
    this.doFetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = (opts.baseUrl ?? API_BASE).replace(/\/+$/, '');
    // Not `URL.canParse`: it needs Chrome 120 and the extension supports Chrome 116+.
    try {
      new URL(this.baseUrl);
    } catch {
      throw new TypeError('LiveDiscordClient: baseUrl is not a valid URL.');
    }
    this.sleep = opts.sleep ?? abortableSleep;
    this.random = opts.random ?? Math.random;
    this.limiter = new RateLimiter(opts.now ?? Date.now, opts.minGapMs ?? DEFAULT_MIN_GAP_MS);
  }

  async getMe(signal?: AbortSignal): Promise<User> {
    const body = await this.get('/users/@me', undefined, signal);
    if (!isRecord(body) || typeof body.id !== 'string') throw this.unexpected('/users/@me');
    return body as unknown as User;
  }

  async getGuilds(signal?: AbortSignal): Promise<GuildSummary[]> {
    const guilds: GuildSummary[] = [];
    const seen = new Set<Snowflake>();
    let after: Snowflake | undefined;
    for (let page = 0; page < MAX_GUILD_PAGES; page++) {
      const query: Record<string, string> = { limit: String(GUILDS_PAGE_SIZE) };
      if (after !== undefined) query.after = after;
      const items = this.expectArray(await this.get('/users/@me/guilds', query, signal), '/users/@me/guilds') as GuildSummary[];
      let added = 0;
      let lastId: Snowflake | undefined;
      for (const guild of items) {
        if (!isRecord(guild) || typeof guild.id !== 'string') continue;
        lastId = guild.id;
        if (seen.has(guild.id)) continue;
        seen.add(guild.id);
        guilds.push(guild);
        added++;
      }
      // A short page is the end. A page without anything new means the cursor did not advance: stop instead of looping.
      if (items.length < GUILDS_PAGE_SIZE || added === 0 || lastId === undefined || !ID_PATTERN.test(lastId)) break;
      after = lastId;
    }
    return guilds;
  }

  async getGuildChannels(guildId: Snowflake, signal?: AbortSignal): Promise<Channel[]> {
    assertId(guildId, 'guild id');
    const channels = this.expectArray(await this.get(`/guilds/${guildId}/channels`, undefined, signal), 'guild channels') as Channel[];
    this.forumParents.set(
      guildId,
      channels
        .filter((c) => isRecord(c) && (c.type === ChannelType.GuildForum || c.type === ChannelType.GuildMedia))
        .map((c) => c.id),
    );
    return channels;
  }

  /**
   * Active threads / forum posts.
   *
   * Research (DiscordChatExporter `DiscordClient.GetChannelThreadsAsync`): for USER tokens the only way to list threads is
   * `GET /channels/{parentId}/threads/search?sort_by=last_message_time&sort_order=desc&archived=false&offset=N`
   * (answers `{ threads: Channel[], has_more: boolean, ... }`, at most 25 per page). `GET /guilds/{id}/threads/active` is what
   * DiscordChatExporter uses for BOT tokens only, so it is not called here.
   *
   * Known limitation, deliberate: THREADS UNDER ORDINARY TEXT / ANNOUNCEMENT CHANNELS ARE NOT LISTED. A user token has no
   * guild-wide thread listing, so finding them would cost one search request per text channel (hundreds in a big server,
   * each a rate-limit and account-risk cost), and unlike the forum request the official client makes when you open a forum,
   * nothing in normal use sends that burst. So only forum / media channels (whose content is nothing but threads) are
   * searched, and ordinary text channels are never scanned. The demo world nests threads under text channels too; the live
   * client cannot, so such threads cannot be ticked or exported from here. None of this could be verified against a live account.
   *
   * Per forum / media channel the search follows `has_more` for at most `MAX_THREAD_SEARCH_PAGES` pages (100 most recently
   * active posts); a busier forum is truncated silently. Discord indexes a channel lazily: while it has not, the search
   * answers HTTP 202 "Index not yet available" without any `threads`. That is waited out (the response's `retry_after`,
   * bounded, at most `MAX_INDEX_WAITS` times per call) and retried instead of being mistaken for "no posts". If the index is
   * still not ready and no thread at all could be listed, this REJECTS (status 202, code 110000, `retryAfterMs`) rather than
   * resolve with [] so a caller can tell "not indexed yet" from "no threads" and must not remember the answer as final.
   *
   * Threads are optional, so any other non-abort failure yields what was collected so far (usually `[]`). A forum the user
   * cannot open (403 "no access" / 404) is skipped; any other failure (wrong endpoint 400, rate limit, 5xx, network, a 403 that
   * is not a permission error) stops further requests. Each request gets a single attempt: no 5xx / network retries and a 429
   * is not waited out (it is remembered, so the next request to that route waits). Because this endpoint may not be meant
   * for user tokens, its 401s never fire `onAuthError`; only a 401 on the guild-channel lookup (a standard endpoint)
   * surfaces as 'auth'. Aborts always propagate.
   */
  async getActiveThreads(guildId: Snowflake, signal?: AbortSignal): Promise<Channel[]> {
    assertId(guildId, 'guild id');
    let parents: Snowflake[];
    try {
      parents = await this.forumParentsOf(guildId, signal);
    } catch (e) {
      if (e instanceof DiscordApiError && (e.kind === 'aborted' || e.kind === 'auth')) throw e;
      return [];
    }
    const threads: Channel[] = [];
    const seen = new Set<Snowflake>();
    let indexWaits = 0;
    let notIndexed: DiscordApiError | null = null;

    forums: for (const parentId of parents) {
      let offset = 0;
      let pages = 0;
      while (pages < MAX_THREAD_SEARCH_PAGES) {
        let body: unknown;
        try {
          body = await this.get(
            `/channels/${parentId}/threads/search`,
            { sort_by: 'last_message_time', sort_order: 'desc', archived: 'false', offset: String(offset) },
            signal,
            { softAuth: true, singleAttempt: true, indexedSearch: true },
          );
        } catch (e) {
          if (!(e instanceof DiscordApiError)) break forums;
          if (e.kind === 'aborted') throw e;
          if (e.status === 202) {
            if (indexWaits < MAX_INDEX_WAITS) {
              indexWaits++;
              try {
                // Outside the request queue on purpose: other requests (messages) are not held up while Discord indexes.
                await this.pause(Math.min(e.retryAfterMs ?? INDEX_RETRY_DEFAULT_MS, INDEX_RETRY_MAX_MS), signal);
              } catch (waitError) {
                if (waitError instanceof DiscordApiError && waitError.kind === 'aborted') throw waitError;
                break forums;
              }
              continue;
            }
            notIndexed ??= e;
            continue forums;
          }
          if (e.kind === 'forbidden' || e.kind === 'not-found') continue forums;
          break forums;
        }

        const list = isRecord(body) && Array.isArray(body.threads) ? (body.threads as unknown[]) : [];
        for (const item of list) {
          if (!isRecord(item) || typeof item.id !== 'string' || seen.has(item.id)) continue;
          const thread = item as unknown as Channel;
          if (thread.thread_metadata?.archived === true) continue;
          seen.add(thread.id);
          threads.push({ ...thread, parent_id: thread.parent_id ?? parentId });
        }
        pages++;
        // An empty page ends the walk even if has_more claims otherwise: the offset would never advance.
        if (!isRecord(body) || body.has_more !== true || list.length === 0) break;
        offset += list.length;
      }
    }
    if (threads.length === 0 && notIndexed !== null) throw notIndexed;
    return threads;
  }

  async getGuildRoles(guildId: Snowflake, signal?: AbortSignal): Promise<Role[]> {
    assertId(guildId, 'guild id');
    return this.expectArray(await this.get(`/guilds/${guildId}/roles`, undefined, signal), 'guild roles') as Role[];
  }

  async getMyMember(guildId: Snowflake, signal?: AbortSignal): Promise<MyMember> {
    assertId(guildId, 'guild id');
    let body: unknown;
    try {
      body = await this.get(`/users/@me/guilds/${guildId}/member`, undefined, signal, { softAuth: true });
    } catch (e) {
      // That endpoint is documented for OAuth2 tokens; fall back to the classic one for anything that looks like "not for you".
      const fallBack = e instanceof DiscordApiError && ['auth', 'forbidden', 'not-found', 'unknown'].includes(e.kind);
      if (!fallBack) throw e;
      body = await this.get(`/guilds/${guildId}/members/@me`, undefined, signal);
    }
    if (!isRecord(body)) throw this.unexpected('guild member');
    const roles = Array.isArray(body.roles) ? body.roles.filter((r): r is string => typeof r === 'string') : [];
    const member: MyMember = { roles };
    if (isRecord(body.user) && typeof body.user.id === 'string') member.user = body.user as unknown as User;
    return member;
  }

  async getDmChannels(signal?: AbortSignal): Promise<Channel[]> {
    return this.expectArray(await this.get('/users/@me/channels', undefined, signal), 'DM channels') as Channel[];
  }

  async getMessages(channelId: Snowflake, opts: GetMessagesOptions = {}, signal?: AbortSignal): Promise<Message[]> {
    assertId(channelId, 'channel id');
    const query: Record<string, string> = { limit: String(clampLimit(opts.limit)) };
    if (opts.before !== undefined) {
      assertId(opts.before, 'before id');
      query.before = opts.before;
    }
    if (opts.after !== undefined) {
      assertId(opts.after, 'after id');
      query.after = opts.after;
    }
    return this.expectArray(await this.get(`/channels/${channelId}/messages`, query, signal), 'messages') as Message[];
  }

  private async forumParentsOf(guildId: Snowflake, signal?: AbortSignal): Promise<Snowflake[]> {
    // An empty task only runs once every request queued before it has finished, so a `getGuildChannels` the caller
    // started just before us has filled the cache by now and we do not ask for the channel list twice.
    await this.queue.run(async () => undefined, signal);
    const cached = this.forumParents.get(guildId);
    if (cached) return cached;
    await this.getGuildChannels(guildId, signal);
    return this.forumParents.get(guildId) ?? [];
  }

  private get(path: string, query: Record<string, string> | undefined, signal: AbortSignal | undefined, opts: RequestOptions = {}): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return this.queue.run(() => this.execute(path, url.href, signal, opts), signal);
  }

  private expectArray(body: unknown, what: string): unknown[] {
    if (!Array.isArray(body)) throw this.unexpected(what);
    return body;
  }

  private unexpected(what: string): DiscordApiError {
    return new DiscordApiError('unknown', `Discord returned an unexpected response for ${what}.`);
  }

  private async execute(path: string, url: string, signal: AbortSignal | undefined, opts: RequestOptions): Promise<unknown> {
    // Last line of defence for the credential: it only ever leaves with requests that stay inside the Discord API.
    if (!isTrustedApiUrl(url, this.baseUrl)) {
      throw new DiscordApiError('unknown', 'Refusing to send credentials to a URL outside the Discord API.');
    }
    // Every token this call has sent: error text must never contain any of them, even if Discord (or a proxy) echoed one back.
    const usedTokens: string[] = [];
    const clean = (text: string): string => usedTokens.reduce((out, used) => out.split(used).join('[redacted]'), text);
    const fail = (
      kind: DiscordApiError['kind'],
      message: string,
      extra: { status?: number; retryAfterMs?: number; code?: number; cause?: unknown } = {},
    ): DiscordApiError => new DiscordApiError(kind, clean(message), extra);

    const pathname = new URL(url).pathname;
    let rateLimitRetries = 0;
    let transientRetries = 0;

    for (;;) {
      throwIfAborted(signal);
      const delay = this.limiter.delayFor(pathname);
      if (delay > MAX_RATE_LIMIT_WAIT_MS) {
        throw fail('rate-limited', `Discord rate limit: would have to wait ${Math.ceil(delay / 1000)} s.`, { retryAfterMs: delay });
      }
      if (delay > 0) await this.pause(delay, signal);

      // Resolved per attempt, after any wait: a token refreshed while a 429 / back-off wait ran must be the one that is sent.
      const token = await this.resolveToken();
      if (!usedTokens.includes(token)) usedTokens.push(token);

      let res: Response;
      try {
        res = await this.doFetch(url, {
          method: 'GET',
          headers: { Authorization: token },
          signal,
          credentials: 'omit',
          redirect: 'error',
        });
      } catch (e) {
        this.limiter.recordFailure();
        if (signal?.aborted) throw abortedError();
        if (!opts.singleAttempt && transientRetries < MAX_TRANSIENT_RETRIES) {
          await this.pause(backoffDelayMs(transientRetries++, this.random), signal);
          continue;
        }
        throw fail('network', 'Could not reach Discord (network error).', { cause: e });
      }

      this.limiter.recordResponse(pathname, parseRateLimitHeaders(res.headers));

      if (res.ok) {
        let body: unknown;
        try {
          body = (await res.json()) as unknown;
        } catch (e) {
          if (signal?.aborted) throw abortedError();
          throw fail('unknown', 'Discord returned an invalid JSON response.', { status: res.status, cause: e });
        }
        if (opts.indexedSearch && isIndexNotReady(res.status, body)) {
          throw fail('unknown', `Discord has not indexed this channel for search yet (HTTP ${res.status}); try again later.`, {
            status: 202,
            code: INDEX_NOT_READY_CODE,
            retryAfterMs: retryAfterMsOf(body),
          });
        }
        return body;
      }

      const errorBody = await this.readErrorBody(res, signal);
      const code = errorCodeOf(errorBody);

      if (res.status === 429) {
        const retry = parseRetryAfter(res.headers, errorBody);
        // Recorded even when we give up, so the next request does not run straight into the same limit.
        this.limiter.recordRateLimited(pathname, retry.ms, retry.global);
        if (opts.singleAttempt || retry.ms > MAX_RATE_LIMIT_WAIT_MS || rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
          throw fail('rate-limited', `Discord rate limit reached (retry in ${Math.ceil(retry.ms / 1000)} s).`, {
            status: 429,
            retryAfterMs: retry.ms,
            code,
          });
        }
        rateLimitRetries++;
        continue;
      }

      if (res.status >= 500 && !opts.singleAttempt && transientRetries < MAX_TRANSIENT_RETRIES) {
        await this.pause(backoffDelayMs(transientRetries++, this.random), signal);
        continue;
      }

      const kind = kindOfStatus(res.status, code);
      if (kind === 'auth') this.reportAuthError(opts, token);
      const detail = describeErrorBody(errorBody);
      // A refused 403 that is not a permission error (Cloudflare / anti-abuse block, unknown code) must not read like "no access".
      const hint = res.status === 403 && kind === 'unknown' ? ' (not a missing-permission error; this may be a temporary block, try again later)' : '';
      throw fail(kind, `Discord API error ${res.status} for GET ${path}${detail ? `: ${detail}` : ''}${hint}`, { status: res.status, code });
    }
  }

  private reportAuthError(opts: RequestOptions, usedToken: string): void {
    if (opts.softAuth || this.lastReportedAuthToken === usedToken) return;
    this.lastReportedAuthToken = usedToken;
    try {
      this.onAuthError?.(usedToken);
    } catch {
      // A broken callback must not hide the real 'auth' error from the caller.
    }
  }

  private async resolveToken(): Promise<string> {
    const raw = await this.getToken();
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (token === '') {
      throw new DiscordApiError('auth', 'No Discord token available. Open Discord in a browser tab and reload it.');
    }
    if (!TOKEN_PATTERN.test(token)) throw new DiscordApiError('auth', 'The Discord token is malformed.');
    return token;
  }

  private async pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
    throwIfAborted(signal);
    try {
      await this.sleep(ms, signal);
    } catch (e) {
      if (signal?.aborted) throw abortedError();
      throw new DiscordApiError('unknown', 'Waiting for Discord was interrupted.', { cause: e });
    }
    throwIfAborted(signal);
  }

  /** Parsed JSON error body, or `undefined` for empty / non-JSON bodies (e.g. a Cloudflare HTML page). */
  private async readErrorBody(res: Response, signal: AbortSignal | undefined): Promise<unknown> {
    let text: string;
    try {
      text = await res.text();
    } catch {
      if (signal?.aborted) throw abortedError();
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_MESSAGE_LIMIT;
  return Math.min(MAX_MESSAGE_LIMIT, Math.max(1, Math.floor(limit)));
}
