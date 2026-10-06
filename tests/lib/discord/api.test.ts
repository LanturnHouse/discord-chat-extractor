import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveDiscordClient, isTrustedApiUrl } from '@/lib/discord/api';
import type { LiveDiscordClientOptions } from '@/lib/discord/api';
import { DiscordApiError } from '@/lib/discord/client';
import { backoffDelayMs } from '@/lib/discord/rateLimit';
import type { Channel } from '@/lib/discord/types';

const TOKEN = 'SECRET.token-value_123';
const BASE = 'https://discord.com/api/v9';

interface Call {
  url: string;
  init: RequestInit;
}
type Reply = Response | Error | ((call: Call) => Response | Promise<Response>);

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A fake fetch that serves `replies` in order, plus a fake clock whose injected `sleep` records and advances time. */
function setup(replies: Reply[], opts: Partial<LiveDiscordClientOptions> = {}) {
  let now = 1_000_000;
  const sleeps: number[] = [];
  const calls: Call[] = [];
  const pending = [...replies];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const reply = pending.shift();
    if (reply === undefined) throw new Error(`unexpected extra request: ${call.url}`);
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(call) : reply;
  }) as typeof fetch;
  const client = new LiveDiscordClient({
    getToken: () => TOKEN,
    fetch: fakeFetch,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
    minGapMs: 0,
    ...opts,
  });
  return { client, calls, sleeps, urls: () => calls.map((c) => c.url) };
}

async function errorOf(promise: Promise<unknown>): Promise<DiscordApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(DiscordApiError);
    return e as DiscordApiError;
  }
  throw new Error('expected the promise to reject');
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A fetch reply that never answers on its own and rejects like a real fetch when the request is aborted. */
function hangUntilAborted(onStart?: () => void): Reply {
  return (call) =>
    new Promise<Response>((_, reject) => {
      const abort = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (call.init.signal?.aborted) abort();
      call.init.signal?.addEventListener('abort', abort);
      onStart?.();
    });
}

const guild = (n: number) => ({ id: String(100000000000000000n + BigInt(n)), name: `guild ${n}`, icon: null });
const guildPage = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => guild(from + i));

afterEach(() => vi.unstubAllGlobals());

describe('LiveDiscordClient: basics', () => {
  it('is a live client', () => {
    expect(setup([]).client.kind).toBe('live');
  });

  it('sends GET with the raw token (no Bearer prefix) as the only header', async () => {
    const h = setup([json({ id: '1', username: 'me' })]);
    const me = await h.client.getMe();
    expect(me).toEqual({ id: '1', username: 'me' });
    expect(h.calls).toHaveLength(1);
    const { url, init } = h.calls[0]!;
    expect(url).toBe(`${BASE}/users/@me`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: TOKEN });
    expect(init.body).toBeUndefined();
  });

  it('never lets the token follow redirects or ride along with cookies', async () => {
    const h = setup([json({ id: '1', username: 'me' })]);
    await h.client.getMe();
    expect(h.calls[0]!.init.redirect).toBe('error');
    expect(h.calls[0]!.init.credentials).toBe('omit');
  });

  it('resolves the token on every request (async getters, refreshed tokens, stray whitespace)', async () => {
    const tokens = ['  first-token\n', 'second-token'];
    const h = setup([json([]), json([])], { getToken: async () => tokens.shift() ?? null });
    await h.client.getDmChannels();
    await h.client.getDmChannels();
    expect(h.calls.map((c) => (c.init.headers as Record<string, string>).Authorization)).toEqual(['first-token', 'second-token']);
  });

  it('resolves the token again for the retry after a 429 wait, so a refreshed token is the one that is sent', async () => {
    const tokens = ['old-token', 'new-token'];
    const h = setup([json({ retry_after: 5 }, 429), json([])], { getToken: () => tokens.shift() ?? null });
    await h.client.getDmChannels();
    expect(h.calls.map((c) => (c.init.headers as Record<string, string>).Authorization)).toEqual(['old-token', 'new-token']);
  });

  it('resolves the token again for the retry after a 5xx', async () => {
    const tokens = ['old-token', 'new-token'];
    const h = setup([json({}, 503), json([])], { getToken: () => tokens.shift() ?? null });
    await h.client.getDmChannels();
    expect(h.calls.map((c) => (c.init.headers as Record<string, string>).Authorization)).toEqual(['old-token', 'new-token']);
  });

  it('uses the global fetch when none is injected', async () => {
    const globalFetch = vi.fn(async () => json({ id: '1', username: 'via-global' }));
    vi.stubGlobal('fetch', globalFetch);
    const client = new LiveDiscordClient({ getToken: () => TOKEN });
    await expect(client.getMe()).resolves.toMatchObject({ username: 'via-global' });
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid baseUrl up front', () => {
    expect(() => new LiveDiscordClient({ getToken: () => TOKEN, baseUrl: 'not a url' })).toThrow(TypeError);
  });

  it('does not need URL.canParse (missing before Chrome 120; the extension supports Chrome 116+)', () => {
    const urlWithCanParse = URL as unknown as { canParse?: unknown };
    const original = Object.getOwnPropertyDescriptor(URL, 'canParse');
    delete urlWithCanParse.canParse;
    try {
      expect(typeof URL.canParse).toBe('undefined');
      expect(() => new LiveDiscordClient({ getToken: () => TOKEN })).not.toThrow();
      expect(() => new LiveDiscordClient({ getToken: () => TOKEN, baseUrl: 'not a url' })).toThrow(TypeError);
    } finally {
      if (original) Object.defineProperty(URL, 'canParse', original);
    }
  });

  it('honours a custom baseUrl (also with a trailing slash)', async () => {
    const h = setup([json({ id: '1', username: 'me' })], { baseUrl: 'https://proxy.example.test/discord/api/' });
    await h.client.getMe();
    expect(h.urls()).toEqual(['https://proxy.example.test/discord/api/users/@me']);
  });
});

describe('LiveDiscordClient: missing or unusable token', () => {
  it.each([null, '', '   '])('fails with kind "auth" without touching the network for token %j', async (token) => {
    const onAuthError = vi.fn();
    const h = setup([], { getToken: () => token, onAuthError });
    const error = await errorOf(h.client.getMe());
    expect(error.kind).toBe('auth');
    expect(h.calls).toHaveLength(0);
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('refuses a token that is not a valid header value', async () => {
    const h = setup([], { getToken: () => 'abc def\nghi' });
    expect((await errorOf(h.client.getMe())).kind).toBe('auth');
    expect(h.calls).toHaveLength(0);
  });
});

describe('LiveDiscordClient: token confinement', () => {
  it.each([
    ['https://discord.com/api/v9/users/@me', true],
    ['https://discord.com/api/v9', true],
    ['https://discord.com/api/v9/channels/1/messages?limit=5', true],
    ['https://discord.com/api/v9.evil.com/x', false],
    ['https://discord.com/api/v90/x', false],
    ['https://discord.com/api/v9/../../evil', false],
    ['https://discord.com/api/v9/%2e%2e/%2e%2e/evil', false],
    ['https://discord.com.evil.test/api/v9/users/@me', false],
    ['https://evil.test/https://discord.com/api/v9/', false],
    ['https://discord.com@evil.test/api/v9/users/@me', false],
    ['https://user:pw@discord.com/api/v9/users/@me', false],
    ['http://discord.com/api/v9/users/@me', false],
    ['https://discord.com:8443/api/v9/users/@me', false],
    ['https://cdn.discordapp.com/avatars/1/a.png', false],
    ['//evil.test/api/v9/users/@me', false],
    ['not a url', false],
    ['', false],
  ])('isTrustedApiUrl(%s) -> %s', (url, expected) => {
    expect(isTrustedApiUrl(url, BASE)).toBe(expected);
  });

  it('treats an unparsable base as untrusted', () => {
    expect(isTrustedApiUrl('https://discord.com/api/v9/x', 'nope')).toBe(false);
  });

  it('only ever requests URLs inside the base URL, whatever ids are passed in', async () => {
    const h = setup([json([]), json([]), json([]), json([]), json([]), json([])]);
    await h.client.getGuilds();
    await h.client.getGuildChannels('123');
    await h.client.getGuildRoles('123');
    await h.client.getDmChannels();
    await h.client.getMessages('456', { before: '789', after: '790', limit: 3 });
    await h.client.getActiveThreads('123');
    for (const call of h.calls) {
      expect(call.url.startsWith(`${BASE}/`)).toBe(true);
      expect(isTrustedApiUrl(call.url, BASE)).toBe(true);
    }
  });

  it('refuses to send the token when the configured base URL carries credentials', async () => {
    const h = setup([json({ id: '1', username: 'me' })], { baseUrl: 'https://user:pw@discord.com/api/v9' });
    const error = await errorOf(h.client.getMe());
    expect(error.kind).toBe('unknown');
    expect(h.calls).toHaveLength(0);
  });

  it('rejects path-traversal style ids before any request is made', async () => {
    const h = setup([]);
    for (const evil of ['../../../evil', '123/../../x', '1%2f2', '@evil.test', '//evil.test']) {
      expect((await errorOf(h.client.getGuildChannels(evil))).kind).toBe('unknown');
      expect((await errorOf(h.client.getGuildRoles(evil))).kind).toBe('unknown');
      expect((await errorOf(h.client.getMyMember(evil))).kind).toBe('unknown');
      expect((await errorOf(h.client.getActiveThreads(evil))).kind).toBe('unknown');
      expect((await errorOf(h.client.getMessages(evil))).kind).toBe('unknown');
    }
    expect(h.calls).toHaveLength(0);
  });
});

describe('LiveDiscordClient: errors never contain the token', () => {
  const echo = { message: `Invalid token ${TOKEN} supplied`, code: 0 };

  it.each([400, 401, 403, 404, 418])('redacts a token echoed back in a %i response', async (status) => {
    const h = setup([json(echo, status)]);
    const error = await errorOf(h.client.getMe());
    expect(error.message).not.toContain(TOKEN);
    expect(`${error.name}: ${error.message}\n${error.stack ?? ''}`).not.toContain(TOKEN);
    expect(error.message).toContain('[redacted]');
  });

  it('redacts it from persistent 5xx errors', async () => {
    const h = setup([json(echo, 500), json(echo, 500), json(echo, 500), json(echo, 500)]);
    const error = await errorOf(h.client.getMe());
    expect(error.kind).toBe('server');
    expect(error.message).not.toContain(TOKEN);
  });

  it('redacts every token the call used, also one that was refreshed between retries', async () => {
    const tokens = ['first-token-aaa', 'second-token-bbb'];
    const h = setup([json({ retry_after: 1 }, 429), json({ message: 'echo first-token-aaa and second-token-bbb' }, 400)], {
      getToken: () => tokens.shift() ?? null,
    });
    const error = await errorOf(h.client.getDmChannels());
    expect(error.message).not.toContain('first-token-aaa');
    expect(error.message).not.toContain('second-token-bbb');
    expect(error.message).toContain('[redacted]');
  });

  it('keeps the token out of network errors, rate-limit errors and URLs', async () => {
    const network = setup(Array.from({ length: 4 }, () => new TypeError(`fetch failed for ${TOKEN}`)));
    const networkError = await errorOf(network.client.getMe());
    expect(networkError.kind).toBe('network');
    expect(networkError.message).not.toContain(TOKEN);

    const limited = setup([json({ message: `slow down ${TOKEN}`, retry_after: 600 }, 429)]);
    const limitedError = await errorOf(limited.client.getMe());
    expect(limitedError.message).not.toContain(TOKEN);

    for (const call of [...network.calls, ...limited.calls]) expect(call.url).not.toContain(TOKEN);
  });
});

describe('LiveDiscordClient: endpoints', () => {
  it('getGuilds pages with limit=200&after=<last id> until a page is shorter than 200, keeping API order', async () => {
    const h = setup([json(guildPage(1, 200)), json(guildPage(201, 203))]);
    const guilds = await h.client.getGuilds();
    expect(guilds).toHaveLength(203);
    expect(guilds.map((g) => g.name)).toEqual(guildPage(1, 203).map((g) => g.name));
    expect(h.urls()).toEqual([`${BASE}/users/@me/guilds?limit=200`, `${BASE}/users/@me/guilds?limit=200&after=${guild(200).id}`]);
  });

  it('getGuilds makes one request for a short first page', async () => {
    const h = setup([json(guildPage(1, 199))]);
    expect(await h.client.getGuilds()).toHaveLength(199);
    expect(h.calls).toHaveLength(1);
  });

  it('getGuilds needs a second (empty) request when the user has exactly 200 guilds', async () => {
    const h = setup([json(guildPage(1, 200)), json([])]);
    expect(await h.client.getGuilds()).toHaveLength(200);
    expect(h.calls).toHaveLength(2);
  });

  it('getGuilds returns an empty list for no guilds', async () => {
    const h = setup([json([])]);
    expect(await h.client.getGuilds()).toEqual([]);
  });

  it('getGuilds stops when the cursor does not advance (a server repeating the same page)', async () => {
    const h = setup([json(guildPage(1, 200)), json(guildPage(1, 200)), json(guildPage(1, 200))]);
    expect(await h.client.getGuilds()).toHaveLength(200);
    expect(h.calls).toHaveLength(2);
  });

  it('getGuildChannels / getGuildRoles / getDmChannels hit the right endpoints', async () => {
    const channels: Channel[] = [{ id: '5', type: 0, name: 'general' }];
    const roles = [{ id: '9', name: '@everyone', permissions: '1024', position: 0 }];
    const dms: Channel[] = [{ id: '7', type: 1 }];
    const h = setup([json(channels), json(roles), json(dms)]);
    expect(await h.client.getGuildChannels('123')).toEqual(channels);
    expect(await h.client.getGuildRoles('123')).toEqual(roles);
    expect(await h.client.getDmChannels()).toEqual(dms);
    expect(h.urls()).toEqual([`${BASE}/guilds/123/channels`, `${BASE}/guilds/123/roles`, `${BASE}/users/@me/channels`]);
  });

  it('rejects unexpected response shapes with kind "unknown"', async () => {
    const h = setup([json({ nope: true }), json([]), json({ no: 'id' }), json('text')]);
    expect((await errorOf(h.client.getGuildChannels('1'))).kind).toBe('unknown');
    expect(await h.client.getDmChannels()).toEqual([]);
    expect((await errorOf(h.client.getMe())).kind).toBe('unknown');
    expect((await errorOf(h.client.getMyMember('1'))).kind).toBe('unknown');
  });

  it('rejects a 200 response whose body is not JSON', async () => {
    const h = setup([new Response('<html>oops</html>', { status: 200 })]);
    expect((await errorOf(h.client.getDmChannels())).kind).toBe('unknown');
  });
});

describe('LiveDiscordClient: getMyMember', () => {
  it('uses the current-user-guild-member endpoint first and maps the result', async () => {
    const user = { id: '42', username: 'me' };
    const h = setup([json({ roles: ['1', '2'], user, nick: 'ignored', joined_at: 'ignored' })]);
    expect(await h.client.getMyMember('123')).toEqual({ roles: ['1', '2'], user });
    expect(h.urls()).toEqual([`${BASE}/users/@me/guilds/123/member`]);
  });

  it('falls back to /guilds/{id}/members/@me when the first endpoint says no', async () => {
    for (const status of [403, 404, 400]) {
      const h = setup([json({ message: 'nope', code: 0 }, status), json({ roles: ['5'], user: { id: '42', username: 'me' } })]);
      expect(await h.client.getMyMember('123')).toEqual({ roles: ['5'], user: { id: '42', username: 'me' } });
      expect(h.urls()).toEqual([`${BASE}/users/@me/guilds/123/member`, `${BASE}/guilds/123/members/@me`]);
    }
  });

  it('does not treat a 401 from the first (OAuth-oriented) endpoint as an expired token', async () => {
    const onAuthError = vi.fn();
    const h = setup([json({ message: '401: Unauthorized' }, 401), json({ roles: ['5'] })], { onAuthError });
    expect(await h.client.getMyMember('123')).toEqual({ roles: ['5'] });
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('reports a genuine 401 from the fallback endpoint', async () => {
    const onAuthError = vi.fn();
    const h = setup([json({}, 401), json({}, 401)], { onAuthError });
    expect((await errorOf(h.client.getMyMember('123'))).kind).toBe('auth');
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on server errors, rate limits or aborts', async () => {
    const server = setup([json({}, 500), json({}, 500), json({}, 500), json({}, 500)]);
    expect((await errorOf(server.client.getMyMember('123'))).kind).toBe('server');
    expect(server.urls().every((u) => u.endsWith('/users/@me/guilds/123/member'))).toBe(true);

    const controller = new AbortController();
    const aborted = setup([hangUntilAborted(() => controller.abort())]);
    expect((await errorOf(aborted.client.getMyMember('123', controller.signal))).kind).toBe('aborted');
    expect(aborted.calls).toHaveLength(1);
  });

  it('tolerates a member without usable roles', async () => {
    const h = setup([json({ roles: 'none', user: 'nobody' })]);
    expect(await h.client.getMyMember('123')).toEqual({ roles: [] });
  });
});

describe('LiveDiscordClient: getMessages', () => {
  it('builds the query from limit / before / after', async () => {
    const h = setup([json([]), json([]), json([])]);
    await h.client.getMessages('123', { before: '456', limit: 100 });
    await h.client.getMessages('123', { after: '789' });
    await h.client.getMessages('123');
    expect(h.urls()).toEqual([
      `${BASE}/channels/123/messages?limit=100&before=456`,
      `${BASE}/channels/123/messages?limit=50&after=789`,
      `${BASE}/channels/123/messages?limit=50`,
    ]);
  });

  it.each<[number | undefined, number]>([
    [undefined, 50],
    [0, 1],
    [-5, 1],
    [1, 1],
    [99, 99],
    [100, 100],
    [101, 100],
    [500, 100],
    [25.9, 25],
    [Number.NaN, 50],
    [Number.POSITIVE_INFINITY, 100],
    [Number.NEGATIVE_INFINITY, 1],
  ])('clamps limit %s to %i', async (limit, expected) => {
    const h = setup([json([])]);
    await h.client.getMessages('123', { limit });
    expect(new URL(h.calls[0]!.url).searchParams.get('limit')).toBe(String(expected));
  });

  it('returns the messages exactly as the API sent them (newest first)', async () => {
    const page = [{ id: '3' }, { id: '2' }, { id: '1' }];
    const h = setup([json(page)]);
    expect(await h.client.getMessages('123')).toEqual(page);
  });

  it.each(['', 'abc', '12 3', '1/../2', '123?x=1', '1.5', '-1', '1e5', '１２３', '1'.repeat(26)])('rejects the non-numeric id %j', async (bad) => {
    const h = setup([]);
    expect((await errorOf(h.client.getMessages(bad))).kind).toBe('unknown');
    expect((await errorOf(h.client.getMessages('123', { before: bad }))).kind).toBe('unknown');
    expect((await errorOf(h.client.getMessages('123', { after: bad }))).kind).toBe('unknown');
    expect(h.calls).toHaveLength(0);
  });
});

describe('LiveDiscordClient: rate limiting', () => {
  it('waits retry_after (float seconds, from the body) on a 429 and then succeeds', async () => {
    const h = setup([json({ message: 'You are being rate limited.', retry_after: 1.5, global: false }, 429, { 'retry-after': '2' }), json([{ id: '7', type: 1 }])]);
    await expect(h.client.getDmChannels()).resolves.toEqual([{ id: '7', type: 1 }]);
    expect(h.sleeps).toEqual([1500]);
    expect(h.calls).toHaveLength(2);
  });

  it('falls back to the Retry-After header when the 429 body is not JSON (Cloudflare)', async () => {
    const h = setup([new Response('<html>Error 1015</html>', { status: 429, headers: { 'retry-after': '3' } }), json([])]);
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([3000]);
  });

  it('honours a global rate limit', async () => {
    const h = setup([json({ retry_after: 2, global: true }, 429, { 'x-ratelimit-global': 'true' }), json([]), json([])]);
    await h.client.getDmChannels();
    await h.client.getGuildRoles('1');
    expect(h.sleeps).toEqual([2000]);
  });

  it('gives up with "rate-limited" (and the wait it would have needed) when the wait exceeds 60 s', async () => {
    const h = setup([json({ retry_after: 90 }, 429)]);
    const error = await errorOf(h.client.getDmChannels());
    expect(error.kind).toBe('rate-limited');
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(90_000);
    expect(h.sleeps).toEqual([]);
    expect(h.calls).toHaveLength(1);
  });

  it('accepts a wait of exactly 60 s', async () => {
    const h = setup([json({ retry_after: 60 }, 429), json([])]);
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([60_000]);
  });

  it('remembers a rejected long wait: the same route fails fast instead of hammering Discord', async () => {
    const h = setup([json({ retry_after: 90 }, 429), json([])]);
    await errorOf(h.client.getDmChannels());
    const again = await errorOf(h.client.getDmChannels());
    expect(again.kind).toBe('rate-limited');
    expect(again.retryAfterMs).toBeGreaterThan(60_000);
    expect(h.calls).toHaveLength(1);
  });

  it('a 429 that asks for more than 60 s (Cloudflare / IP-ban style) blocks the WHOLE client, not just that route', async () => {
    let now = 5_000_000;
    const h = setup([new Response('<html>Error 1015</html>', { status: 429, headers: { 'retry-after': '3600' } }), json([{ id: '1' }])], { now: () => now });
    const first = await errorOf(h.client.getMessages('111'));
    expect(first).toMatchObject({ kind: 'rate-limited', status: 429, retryAfterMs: 3_600_000 });

    // other channels, other routes: fail fast without sending anything into the ban
    for (const request of [h.client.getMessages('222'), h.client.getMessages('333'), h.client.getGuildRoles('1'), h.client.getMe()]) {
      const error = await errorOf(request);
      expect(error.kind).toBe('rate-limited');
      expect(error.retryAfterMs).toBeGreaterThan(3_500_000);
    }
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);

    // ...and everything works again once the announced time has passed
    now += 3_600_000;
    await expect(h.client.getMessages('222')).resolves.toEqual([{ id: '1' }]);
    expect(h.calls).toHaveLength(2);
  });

  it('a normal per-route 429 (60 s or less) still leaves the other routes alone', async () => {
    const forum: Channel[] = [{ id: '12', type: 15, name: 'help-forum' }];
    // The thread search is never waited out, so its 429 only gets recorded: for that route.
    const h = setup([json(forum), json({ retry_after: 30 }, 429), json([])]);
    expect(await h.client.getActiveThreads('9')).toEqual([]);
    await expect(h.client.getGuildRoles('9')).resolves.toEqual([]);
    expect(h.sleeps).toEqual([]);
    expect(h.calls).toHaveLength(3);
  });

  it('a wait just beyond the 60 s cap is treated as a ban on every route', async () => {
    const h = setup([json({ retry_after: 61 }, 429), json([])]);
    await errorOf(h.client.getGuildRoles('1'));
    expect((await errorOf(h.client.getMessages('111'))).kind).toBe('rate-limited');
    expect(h.calls).toHaveLength(1);
  });

  it('remembers a rejected global limit for every route', async () => {
    const h = setup([json({ retry_after: 90, global: true }, 429)]);
    await errorOf(h.client.getDmChannels());
    expect((await errorOf(h.client.getGuildRoles('1'))).kind).toBe('rate-limited');
    expect(h.calls).toHaveLength(1);
  });

  it('retries a 429 at most 6 times', async () => {
    const h = setup(Array.from({ length: 8 }, () => json({ retry_after: 0.1 }, 429)));
    const error = await errorOf(h.client.getDmChannels());
    expect(error.kind).toBe('rate-limited');
    expect(error.retryAfterMs).toBe(100);
    expect(h.calls).toHaveLength(7);
    expect(h.sleeps).toEqual([100, 100, 100, 100, 100, 100]);
  });

  it('can recover after several 429s in a row', async () => {
    const h = setup([json({ retry_after: 0.5 }, 429), json({ retry_after: 0.5 }, 429), json([])]);
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([500, 500]);
  });

  it('waits for the bucket reset when X-RateLimit-Remaining is 0 (only for that route)', async () => {
    const exhausted = { 'x-ratelimit-bucket': 'bkt', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '2.5' };
    const h = setup([
      json([], 200, exhausted), // DM list: exhausted
      json([]), // guild roles: other route, no wait
      json([], 200, { 'x-ratelimit-bucket': 'bkt', 'x-ratelimit-remaining': '4', 'x-ratelimit-reset-after': '2.5' }), // DM list again, after the wait
      json([]), // DM list a third time: requests remain
    ]);
    await h.client.getDmChannels();
    await h.client.getGuildRoles('1');
    expect(h.sleeps).toEqual([]);
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([2500]);
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([2500]);
  });

  it('does not pause between consecutive requests by default (a timer costs 1 s in a background tab)', async () => {
    const h = setup(Array.from({ length: 6 }, () => json([])), { minGapMs: undefined });
    for (let i = 0; i < 6; i++) await h.client.getMessages('111');
    expect(h.sleeps).toEqual([]);
    expect(h.calls).toHaveLength(6);
  });

  it('keeps a minimum gap between consecutive requests when one is configured', async () => {
    const h = setup([json([]), json([]), json([])], { minGapMs: 50 });
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([]);
    await h.client.getDmChannels();
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([50, 50]);
  });

  it('fails with "rate-limited" instead of sleeping when a bucket reset is far away', async () => {
    const h = setup([json([], 200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '3600' })]);
    await h.client.getDmChannels();
    const error = await errorOf(h.client.getDmChannels());
    expect(error.kind).toBe('rate-limited');
    expect(error.retryAfterMs).toBe(3_600_000);
    expect(h.calls).toHaveLength(1);
  });
});

describe('LiveDiscordClient: error mapping', () => {
  it('maps 401 to "auth" and calls onAuthError only once per rejected token, without retrying', async () => {
    const onAuthError = vi.fn();
    const h = setup([json({ message: '401: Unauthorized', code: 0 }, 401), json({ message: '401: Unauthorized', code: 0 }, 401)], { onAuthError });
    const first = await errorOf(h.client.getMe());
    expect(first).toMatchObject({ kind: 'auth', status: 401 });
    expect((await errorOf(h.client.getGuilds())).kind).toBe('auth');
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toEqual([]);
  });

  it('hands onAuthError the token that was actually sent for the failing request', async () => {
    const onAuthError = vi.fn();
    const h = setup([json({}, 401)], { onAuthError });
    await errorOf(h.client.getMe());
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError).toHaveBeenCalledWith(TOKEN);
  });

  it('reports the token of the attempt that got the 401, not the one resolved first (refreshed during a 429 wait)', async () => {
    const tokens = ['T1-stale', 'T2-fresh'];
    const onAuthError = vi.fn();
    const h = setup([json({ retry_after: 5 }, 429), json({}, 401)], { getToken: () => tokens.shift() ?? null, onAuthError });
    expect((await errorOf(h.client.getDmChannels())).kind).toBe('auth');
    expect(onAuthError).toHaveBeenCalledExactlyOnceWith('T2-fresh');
  });

  it('reports a different rejected token again, but never the same one twice', async () => {
    const tokens = ['T1', 'T1', 'T2', 'T2'];
    const onAuthError = vi.fn();
    const h = setup(Array.from({ length: 4 }, () => json({}, 401)), { getToken: () => tokens.shift() ?? null, onAuthError });
    for (let i = 0; i < 4; i++) await errorOf(h.client.getMe());
    expect(onAuthError.mock.calls).toEqual([['T1'], ['T2']]);
  });

  it('still reports "auth" when the onAuthError callback throws', async () => {
    const h = setup([json({}, 401)], {
      onAuthError: () => {
        throw new Error('callback failure');
      },
    });
    expect((await errorOf(h.client.getMe())).kind).toBe('auth');
  });

  it.each<[number, string]>([
    [400, 'unknown'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'unknown'],
  ])('maps HTTP %i to kind %s with Discord\'s message and code', async (status, kind) => {
    const h = setup([json({ message: 'Missing Access', code: 50001 }, status)]);
    const error = await errorOf(h.client.getMessages('123'));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toBe(`Discord API error ${status} (code 50001): Missing Access`);
    expect(h.calls).toHaveLength(1);
  });

  it('copes with error bodies that are not Discord JSON', async () => {
    const h = setup([new Response('<html>Forbidden</html>', { status: 403 }), json('just a string', 404), json({ message: 'x'.repeat(5000) }, 400)]);
    const forbidden = await errorOf(h.client.getMe());
    expect(forbidden).toMatchObject({ kind: 'unknown', status: 403 });
    expect(forbidden.message).not.toContain('<html>');
    expect((await errorOf(h.client.getMe())).kind).toBe('not-found');
    expect((await errorOf(h.client.getMe())).message.length).toBeLessThan(400);
  });

  describe('HTTP 403', () => {
    it.each([
      [50001, 'Missing Access'],
      [50013, 'Missing Permissions'],
      [50009, 'Channel verification level is too high for you to gain access to this resource'],
    ])('code %i means "forbidden" and the code is exposed', async (code, message) => {
      const h = setup([json({ message, code }, 403)]);
      const error = await errorOf(h.client.getMessages('123'));
      expect(error).toMatchObject({ kind: 'forbidden', status: 403, code });
    });

    it.each([
      [40333, 'internal network error'],
      [10008, 'Unknown Message'],
      [20001, 'Something account level'],
      [999999, 'A code nobody has heard of'],
    ])('code %i (a block, not a missing permission) is "unknown", never "forbidden"', async (code, message) => {
      const h = setup([json({ message, code }, 403)]);
      const error = await errorOf(h.client.getMessages('123'));
      expect(error).toMatchObject({ kind: 'unknown', status: 403, code });
      expect(error.message).toContain(String(code));
      expect(error.message).not.toMatch(/no access/i);
      expect(h.calls).toHaveLength(1);
    });

    it.each([
      ['an HTML (Cloudflare) page', () => new Response('<html>Access denied</html>', { status: 403 })],
      ['an empty body', () => new Response('', { status: 403 })],
      ['a JSON body without a code', () => json({ message: '403: Forbidden' }, 403)],
      ['a generic code 0', () => json({ message: '403: Forbidden', code: 0 }, 403)],
    ])('%s is "unknown" with no code and a message that does not claim "no access"', async (_label, reply) => {
      const h = setup([reply()]);
      const error = await errorOf(h.client.getMessages('123'));
      expect(error).toMatchObject({ kind: 'unknown', status: 403 });
      expect(error.code).toBeUndefined();
      expect(error.message).toContain('403');
      expect(error.message).not.toMatch(/no access|missing access/i);
    });

    it('exposes the Discord error code on other errors too', async () => {
      const h = setup([
        json({ message: 'Unknown Channel', code: 10003 }, 404),
        json({ message: '401: Unauthorized', code: 0 }, 401),
        json({ message: 'Invalid Form Body', code: 50035 }, 400),
        json({ message: 'The resource is being rate limited.', code: 20028, retry_after: 600 }, 429),
      ]);
      expect(await errorOf(h.client.getMe())).toMatchObject({ kind: 'not-found', code: 10003 });
      expect((await errorOf(h.client.getMe())).code).toBeUndefined();
      expect(await errorOf(h.client.getMe())).toMatchObject({ kind: 'unknown', code: 50035 });
      expect(await errorOf(h.client.getMe())).toMatchObject({ kind: 'rate-limited', code: 20028 });
    });
  });

  it('retries 5xx with exponential back-off and jitter, then succeeds', async () => {
    const h = setup([json({ message: 'oops' }, 503), new Response('bad gateway', { status: 502 }), json([])]);
    await h.client.getDmChannels();
    expect(h.sleeps).toEqual([backoffDelayMs(0, () => 0.5), backoffDelayMs(1, () => 0.5)]);
    expect(h.sleeps).toEqual([750, 1500]);
    expect(h.calls).toHaveLength(3);
  });

  it('gives up on 5xx after 3 retries with kind "server"', async () => {
    const h = setup(Array.from({ length: 6 }, () => json({ message: 'down' }, 500)));
    const error = await errorOf(h.client.getDmChannels());
    expect(error).toMatchObject({ kind: 'server', status: 500 });
    expect(h.calls).toHaveLength(4);
    expect(h.sleeps).toHaveLength(3);
    expect(h.sleeps[2]!).toBeGreaterThan(h.sleeps[0]!);
  });

  it('retries network errors, then succeeds', async () => {
    const h = setup([new TypeError('fetch failed'), new TypeError('fetch failed'), json([])]);
    await h.client.getDmChannels();
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toHaveLength(2);
  });

  it('gives up on network errors after 3 retries with kind "network" and keeps the cause', async () => {
    const cause = new TypeError('fetch failed');
    const h = setup(Array.from({ length: 6 }, () => cause));
    const error = await errorOf(h.client.getDmChannels());
    expect(error.kind).toBe('network');
    expect(error.cause).toBe(cause);
    expect(h.calls).toHaveLength(4);
  });

  it('wraps a failing sleep implementation instead of leaking a raw error', async () => {
    const h = setup([json({}, 503), json([])], {
      sleep: async () => {
        throw new Error('timer broke');
      },
    });
    expect((await errorOf(h.client.getDmChannels())).kind).toBe('unknown');
  });
});

describe('LiveDiscordClient: error messages are safe to paste into a bug report', () => {
  // Screens map `kind` / `status` to their own wording; `message` is developer text for logs and bug reports, so it must not
  // carry what identifies the account's data: the request path, its query, or any id.
  const GUILD = '123456789012345678';
  const CHANNEL = '234567890123456789';
  const CURSOR = '345678901234567890';

  const requests: [string, (client: LiveDiscordClient) => Promise<unknown>][] = [
    ['getMe', (c) => c.getMe()],
    ['getGuilds', (c) => c.getGuilds()],
    ['getGuildChannels', (c) => c.getGuildChannels(GUILD)],
    ['getGuildRoles', (c) => c.getGuildRoles(GUILD)],
    ['getMyMember', (c) => c.getMyMember(GUILD)],
    ['getDmChannels', (c) => c.getDmChannels()],
    ['getMessages (before)', (c) => c.getMessages(CHANNEL, { before: CURSOR, limit: 50 })],
    ['getMessages (after)', (c) => c.getMessages(CHANNEL, { after: CURSOR, limit: 50 })],
  ];

  function expectSafe(error: DiscordApiError, label = ''): void {
    expect(error.message, label).not.toMatch(/\d{9,}/);
    expect(error.message, label).not.toMatch(/\/(channels|guilds|users)\b/);
    expect(error.message, label).not.toMatch(/[?&](limit|before|after)=/);
    expect(error.message, label).not.toMatch(/https?:|discord\.com/);
    expect(error.message.length, label).toBeLessThan(300);
  }

  const replies: [string, number, () => Response][] = [
    ['400 with a Discord body', 400, () => json({ message: 'Invalid Form Body', code: 50035 }, 400)],
    ['401', 401, () => json({ message: '401: Unauthorized', code: 0 }, 401)],
    ['403 no access', 403, () => json({ message: 'Missing Access', code: 50001 }, 403)],
    ['403 Cloudflare page', 403, () => new Response('<html>Access denied</html>', { status: 403 })],
    ['404', 404, () => json({ message: 'Unknown Channel', code: 10003 }, 404)],
    ['409', 409, () => json({ message: 'Conflict' }, 409)],
    ['418 with an empty body', 418, () => new Response('', { status: 418 })],
    ['503', 503, () => json({ message: 'down' }, 503)],
  ];

  it.each(requests)('%s: an HTTP error names neither the path, the query nor an id, and carries the numeric status', async (_name, call) => {
    for (const [label, status, reply] of replies) {
      const h = setup(Array.from({ length: 5 }, reply));
      const error = await errorOf(call(h.client));
      expect(error.status, label).toBe(status);
      expect(error.message, label).toContain(String(status));
      expectSafe(error, label);
    }
  });

  it("keeps Discord's own wording but replaces the ids it echoes back", async () => {
    const h = setup([json({ message: `Unknown Channel ${CHANNEL} (guild ${GUILD}), user 1234567890`, code: 10003 }, 404)]);
    const error = await errorOf(h.client.getMessages(CHANNEL));
    expect(error.message).toBe('Discord API error 404 (code 10003): Unknown Channel <id> (guild <id>), user <id>');
  });

  it('says that a 403 without a permission code is no permission error, briefly', async () => {
    const h = setup([new Response('<html>Access denied</html>', { status: 403 })]);
    const error = await errorOf(h.client.getMessages(CHANNEL));
    expect(error.kind).toBe('unknown');
    expect(error.message).toBe('Discord API error 403 (not a permission error; possibly a temporary block)');
  });

  it('carries the status of a rate limit it gave up on, and of an answer that is not JSON', async () => {
    const limited = setup([json({ message: 'You are being rate limited.', retry_after: 600 }, 429)]);
    const limitedError = await errorOf(limited.client.getMessages(CHANNEL));
    expect(limitedError).toMatchObject({ kind: 'rate-limited', status: 429, retryAfterMs: 600_000 });
    expectSafe(limitedError);

    const broken = setup([new Response('<html>oops</html>', { status: 200 })]);
    const brokenError = await errorOf(broken.client.getMessages(CHANNEL));
    expect(brokenError).toMatchObject({ kind: 'unknown', status: 200 });
    expectSafe(brokenError);
  });

  it('keeps the fail-fast rate-limit error and the search-index error free of ids as well', async () => {
    const banned = setup([json({ retry_after: 600 }, 429)]);
    await errorOf(banned.client.getMessages(CHANNEL));
    const refused = await errorOf(banned.client.getMessages(CHANNEL)); // fails without a request
    expect(refused.kind).toBe('rate-limited');
    expect(banned.calls).toHaveLength(1);
    expectSafe(refused);

    const index = setup([
      json([{ id: '12', type: 15, name: 'forum' }]),
      json({ code: 110000, message: 'Index not yet available' }, 202),
      json({ code: 110000 }, 202),
      json({ code: 110000 }, 202),
    ]);
    const notReady = await errorOf(index.client.getActiveThreads(GUILD));
    expect(notReady).toMatchObject({ kind: 'unknown', status: 202, code: 110000 });
    expectSafe(notReady);
  });

  it('keeps the unexpected-shape, bad-id and network errors free of ids too', async () => {
    const shapes = setup(Array.from({ length: 4 }, () => json({ nope: true })));
    for (const call of [() => shapes.client.getGuildChannels(GUILD), () => shapes.client.getGuildRoles(GUILD), () => shapes.client.getMessages(CHANNEL), () => shapes.client.getMe()]) {
      const error = await errorOf(call());
      expect(error.kind).toBe('unknown');
      expectSafe(error);
    }
    const badId = await errorOf(setup([]).client.getMessages('../../secret'));
    expect(badId.kind).toBe('unknown');
    expect(badId.message).not.toContain('secret');
    expectSafe(await errorOf(setup(Array.from({ length: 4 }, () => new TypeError('fetch failed'))).client.getMessages(CHANNEL)));
  });

  it('has no status only where there is no response (network, bad id)', async () => {
    const network = await errorOf(setup(Array.from({ length: 4 }, () => new TypeError('fetch failed'))).client.getMe());
    expect(network).toMatchObject({ kind: 'network', status: undefined });
    const badId = await errorOf(setup([]).client.getGuildChannels('x'));
    expect(badId.status).toBeUndefined();
  });
});

describe('LiveDiscordClient: abort', () => {
  it('rejects without any request when the signal is already aborted', async () => {
    const h = setup([]);
    const controller = new AbortController();
    controller.abort();
    expect((await errorOf(h.client.getDmChannels(controller.signal))).kind).toBe('aborted');
    expect(h.calls).toHaveLength(0);
  });

  it('cancels a rate-limit wait', async () => {
    const entered = deferred();
    const controller = new AbortController();
    const h = setup([json({ retry_after: 30 }, 429), json([])], {
      sleep: (_ms, signal) =>
        new Promise<void>((_, reject) => {
          entered.resolve();
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    const request = errorOf(h.client.getDmChannels(controller.signal));
    await entered.promise;
    controller.abort();
    expect((await request).kind).toBe('aborted');
    expect(h.calls).toHaveLength(1);
  });

  it('cancels a back-off wait after a 5xx', async () => {
    const entered = deferred();
    const controller = new AbortController();
    const h = setup([json({}, 500), json([])], {
      sleep: (_ms, signal) =>
        new Promise<void>((_, reject) => {
          entered.resolve();
          signal?.addEventListener('abort', () => reject(new Error('whatever the sleeper throws')));
        }),
    });
    const request = errorOf(h.client.getDmChannels(controller.signal));
    await entered.promise;
    controller.abort();
    expect((await request).kind).toBe('aborted');
    expect(h.calls).toHaveLength(1);
  });

  it('cancels an in-flight fetch and does not retry it', async () => {
    const started = deferred();
    const controller = new AbortController();
    const h = setup([hangUntilAborted(() => started.resolve()), json([])]);
    const request = errorOf(h.client.getDmChannels(controller.signal));
    await started.promise;
    controller.abort();
    expect((await request).kind).toBe('aborted');
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('passes the signal on to fetch', async () => {
    const controller = new AbortController();
    const h = setup([json([])]);
    await h.client.getDmChannels(controller.signal);
    expect(h.calls[0]!.init.signal).toBe(controller.signal);
  });

  it('cancels a request that is still waiting in the queue, without disturbing the others', async () => {
    const gate = deferred<Response>();
    const h = setup([() => gate.promise, json([{ id: '9', type: 1 }])]);

    const first = h.client.getMe();
    const controller = new AbortController();
    const queued = errorOf(h.client.getGuilds(controller.signal));
    const third = h.client.getDmChannels();

    controller.abort();
    expect((await queued).kind).toBe('aborted');
    expect(h.calls).toHaveLength(1); // the aborted request never reached fetch, the first one is still in flight

    gate.resolve(json({ id: '1', username: 'me' }));
    await expect(first).resolves.toMatchObject({ username: 'me' });
    await expect(third).resolves.toEqual([{ id: '9', type: 1 }]);
    expect(h.urls()).toEqual([`${BASE}/users/@me`, `${BASE}/users/@me/channels`]);
  });

  it('stops paging guilds when aborted between pages', async () => {
    const controller = new AbortController();
    const h = setup([() => {
      controller.abort();
      return json(guildPage(1, 200));
    }, json(guildPage(201, 203))]);
    expect((await errorOf(h.client.getGuilds(controller.signal))).kind).toBe('aborted');
    expect(h.calls).toHaveLength(1);
  });
});

describe('LiveDiscordClient: strictly serial processing', () => {
  it('never has two requests in flight and keeps call order', async () => {
    let active = 0;
    let maxActive = 0;
    const reply: Reply = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
      return json([]);
    };
    const h = setup(Array.from({ length: 6 }, () => reply));
    await Promise.all([
      h.client.getDmChannels(),
      h.client.getGuildChannels('1'),
      h.client.getGuildRoles('2'),
      h.client.getMessages('3'),
      h.client.getGuilds(),
      h.client.getMessages('4', { before: '5' }),
    ]);
    expect(maxActive).toBe(1);
    expect(h.urls()).toEqual([
      `${BASE}/users/@me/channels`,
      `${BASE}/guilds/1/channels`,
      `${BASE}/guilds/2/roles`,
      `${BASE}/channels/3/messages?limit=50`,
      `${BASE}/users/@me/guilds?limit=200`,
      `${BASE}/channels/4/messages?limit=50&before=5`,
    ]);
  });

  it('keeps one request at a time even while another one is retrying', async () => {
    let active = 0;
    let maxActive = 0;
    const track =
      (response: () => Response): Reply =>
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return response();
      };
    const h = setup([track(() => json({}, 503)), track(() => json([])), track(() => json([]))]);
    await Promise.all([h.client.getDmChannels(), h.client.getGuildRoles('1')]);
    expect(maxActive).toBe(1);
    // The retry of the first request goes before the second request starts.
    expect(h.urls()).toEqual([`${BASE}/users/@me/channels`, `${BASE}/users/@me/channels`, `${BASE}/guilds/1/roles`]);
  });
});

describe('LiveDiscordClient: getActiveThreads', () => {
  const guildChannels: Channel[] = [
    { id: '11', type: 0, name: 'general' },
    { id: '12', type: 15, name: 'help-forum' },
    { id: '13', type: 16, name: 'showcase-media' },
    { id: '14', type: 2, name: 'voice' },
    { id: '15', type: 4, name: 'category' },
    { id: '16', type: 5, name: 'news' },
  ];
  const post = (id: string, extra: Partial<Channel> = {}): Channel => ({ id, type: 11, name: `post ${id}`, ...extra });
  const search = (forumId: string, offset = 0) =>
    `${BASE}/channels/${forumId}/threads/search?sort_by=last_message_time&sort_order=desc&archived=false&offset=${offset}`;

  it('asks the search endpoint exactly once per forum / media channel and nothing else about ordinary channels', async () => {
    const h = setup([
      json(guildChannels),
      json({ threads: [post('101', { parent_id: '12' }), post('102', { parent_id: '12', thread_metadata: { archived: true } }), post('101', { parent_id: '12' })], has_more: false }),
      json({ threads: [post('103')], has_more: false }),
    ]);
    await h.client.getGuildChannels('9');
    const threads = await h.client.getActiveThreads('9');

    expect(h.urls()).toEqual([`${BASE}/guilds/9/channels`, search('12'), search('13')]);
    // archived threads are dropped, duplicates collapsed, and a missing parent_id is filled in from the forum it was found in
    expect(threads.map((t) => [t.id, t.parent_id])).toEqual([
      ['101', '12'],
      ['103', '13'],
    ]);
  });

  it('fetches the channel list itself when it has none (one extra request)', async () => {
    const h = setup([json(guildChannels), json({ threads: [] }), json({ threads: [] })]);
    expect(await h.client.getActiveThreads('9')).toEqual([]);
    expect(h.urls()).toEqual([`${BASE}/guilds/9/channels`, search('12'), search('13')]);
  });

  it('does not fetch the channel list twice when it runs right behind getGuildChannels', async () => {
    const h = setup([json(guildChannels), json({ threads: [post('101', { parent_id: '12' })] }), json({ threads: [] })]);
    const [channels, threads] = await Promise.all([h.client.getGuildChannels('9'), h.client.getActiveThreads('9')]);
    expect(channels).toHaveLength(6);
    expect(threads.map((t) => t.id)).toEqual(['101']);
    expect(h.calls).toHaveLength(3);
  });

  it('makes no search request for a guild without forum or media channels', async () => {
    const h = setup([json(guildChannels.filter((c) => c.type !== 15 && c.type !== 16))]);
    expect(await h.client.getActiveThreads('9')).toEqual([]);
    expect(h.calls).toHaveLength(1);
  });

  it('skips a forum the user cannot open (403 / 404) and keeps the others', async () => {
    const h = setup([json(guildChannels), json({ message: 'Missing Access', code: 50001 }, 403), json({ threads: [post('103', { parent_id: '13' })] })]);
    const threads = await h.client.getActiveThreads('9');
    expect(threads.map((t) => t.id)).toEqual(['103']);
    expect(h.calls).toHaveLength(3);

    const h2 = setup([json(guildChannels), json({}, 404), json({ threads: [post('104')] })]);
    expect((await h2.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['104']);
  });

  it('stops asking after any other failure and returns what it already has', async () => {
    const wrongEndpoint = setup([json(guildChannels), json({ message: 'Invalid Form Body', code: 50035 }, 400), json({ threads: [post('1')] })]);
    expect(await wrongEndpoint.client.getActiveThreads('9')).toEqual([]);
    expect(wrongEndpoint.calls).toHaveLength(2);

    const partial = setup([json(guildChannels), json({ threads: [post('101', { parent_id: '12' })] }), json({ message: 'bad' }, 400)]);
    expect((await partial.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['101']);
  });

  it('treats a 401 on the search endpoint as "no threads" without reporting an auth problem', async () => {
    const onAuthError = vi.fn();
    const h = setup([json(guildChannels), json({ message: '401: Unauthorized' }, 401), json({ threads: [post('1')] })], { onAuthError });
    expect(await h.client.getActiveThreads('9')).toEqual([]);
    expect(onAuthError).not.toHaveBeenCalled();
    expect(h.calls).toHaveLength(2);
  });

  it('surfaces a genuine 401 on the channel list as "auth"', async () => {
    const onAuthError = vi.fn();
    const h = setup([json({ message: '401: Unauthorized' }, 401)], { onAuthError });
    expect((await errorOf(h.client.getActiveThreads('9'))).kind).toBe('auth');
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the channel list itself is forbidden', async () => {
    const h = setup([json({ message: 'Missing Access', code: 50001 }, 403)]);
    expect(await h.client.getActiveThreads('9')).toEqual([]);
    const blocked = setup([new Response('<html>blocked</html>', { status: 403 })]);
    expect(await blocked.client.getActiveThreads('9')).toEqual([]);
  });

  it('stops asking when a forum answers 403 for a reason other than missing access (a block, not a permission)', async () => {
    const h = setup([json(guildChannels), json({ message: 'internal network error', code: 40333 }, 403), json({ threads: [post('103')] })]);
    expect(await h.client.getActiveThreads('9')).toEqual([]);
    expect(h.calls).toHaveLength(2);
  });

  describe('paging (has_more / offset)', () => {
    const forum: Channel[] = [{ id: '12', type: 15, name: 'help-forum' }];
    const twoForums: Channel[] = [
      { id: '12', type: 15, name: 'help-forum' },
      { id: '13', type: 15, name: 'showcase' },
    ];
    const posts = (from: number, count: number, parent = '12'): Channel[] =>
      Array.from({ length: count }, (_, i) => post(String(5000 + from + i), { parent_id: parent }));

    it('follows has_more, advancing the offset by the posts received, and stops at the first page that says no more', async () => {
      const h = setup([
        json(forum),
        json({ threads: posts(0, 25), has_more: true }),
        json({ threads: posts(25, 10), has_more: false }),
        json({ threads: posts(35, 25), has_more: true }), // never requested
      ]);
      const threads = await h.client.getActiveThreads('9');
      expect(threads).toHaveLength(35);
      expect(h.urls()).toEqual([`${BASE}/guilds/9/channels`, search('12', 0), search('12', 25)]);
    });

    it('reads at most 4 pages (100 posts) of one forum, however many more there are', async () => {
      const h = setup([
        json(forum),
        ...[0, 25, 50, 75].map((from) => json({ threads: posts(from, 25), has_more: true })),
        json({ threads: posts(100, 25), has_more: true }), // never requested
      ]);
      const threads = await h.client.getActiveThreads('9');
      expect(threads).toHaveLength(100);
      expect(h.urls()).toEqual([`${BASE}/guilds/9/channels`, search('12', 0), search('12', 25), search('12', 50), search('12', 75)]);
    });

    it('pages each forum on its own and keeps the pages in order', async () => {
      const h = setup([
        json(twoForums),
        json({ threads: posts(0, 25, '12'), has_more: true }),
        json({ threads: posts(25, 2, '12'), has_more: false }),
        json({ threads: posts(100, 3, '13'), has_more: false }),
      ]);
      const threads = await h.client.getActiveThreads('9');
      expect(threads.map((t) => t.parent_id)).toEqual([...Array(27).fill('12'), ...Array(3).fill('13')]);
      expect(h.urls().slice(1)).toEqual([search('12', 0), search('12', 25), search('13', 0)]);
    });

    it('never loops on an empty page even if has_more is true, and tolerates repeated posts', async () => {
      const h = setup([json(forum), json({ threads: posts(0, 2), has_more: true }), json({ threads: [], has_more: true }), json({ threads: posts(0, 2), has_more: true })]);
      expect((await h.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['5000', '5001']);
      expect(h.calls).toHaveLength(3);
    });

    it('does not follow a has_more that is not exactly true', async () => {
      const h = setup([json(forum), json({ threads: posts(0, 25), has_more: 'yes' }), json({ threads: posts(25, 1) })]);
      expect(await h.client.getActiveThreads('9')).toHaveLength(25);
      expect(h.calls).toHaveLength(2);
    });

    it('returns what it has when a later page is rate limited (single attempt, not waited out)', async () => {
      const h = setup([json(forum), json({ threads: posts(0, 25), has_more: true }), json({ retry_after: 2 }, 429)]);
      expect(await h.client.getActiveThreads('9')).toHaveLength(25);
      expect(h.sleeps).toEqual([]);
      expect(h.calls).toHaveLength(3);
    });

    it('moves on to the next forum when a later page of a forum is forbidden', async () => {
      const h = setup([
        json(twoForums),
        json({ threads: posts(0, 25, '12'), has_more: true }),
        json({ message: 'Missing Access', code: 50001 }, 403),
        json({ threads: posts(100, 1, '13'), has_more: false }),
      ]);
      expect(await h.client.getActiveThreads('9')).toHaveLength(26);
    });

    it('propagates an abort between pages', async () => {
      const controller = new AbortController();
      const h = setup([
        json(forum),
        () => {
          controller.abort();
          return json({ threads: posts(0, 25), has_more: true });
        },
        json({ threads: posts(25, 1) }),
      ]);
      expect((await errorOf(h.client.getActiveThreads('9', controller.signal))).kind).toBe('aborted');
      expect(h.calls).toHaveLength(2);
    });
  });

  describe('search index not ready (HTTP 202)', () => {
    const forum: Channel[] = [{ id: '12', type: 15, name: 'help-forum' }];
    const twoForums: Channel[] = [
      { id: '12', type: 15, name: 'help-forum' },
      { id: '13', type: 15, name: 'showcase' },
    ];
    const notIndexed = (retryAfter?: number): Response =>
      json({ message: 'Index not yet available. Try again later', code: 110000, documents_indexed: 0, ...(retryAfter === undefined ? {} : { retry_after: retryAfter }) }, 202);

    it('waits retry_after and asks the same page again instead of treating the answer as "no posts"', async () => {
      const h = setup([json(forum), notIndexed(2), json({ threads: [post('101', { parent_id: '12' })], has_more: false })]);
      const threads = await h.client.getActiveThreads('9');
      expect(threads.map((t) => t.id)).toEqual(['101']);
      expect(h.sleeps).toEqual([2000]);
      expect(h.urls()).toEqual([`${BASE}/guilds/9/channels`, search('12'), search('12')]);
    });

    it('uses a short default wait when retry_after is missing or 0', async () => {
      for (const retryAfter of [undefined, 0] as const) {
        const h = setup([json(forum), notIndexed(retryAfter), json({ threads: [post('101')] })]);
        expect((await h.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['101']);
        expect(h.sleeps).toEqual([1000]);
      }
    });

    describe('never blocks the caller for long (a server tree load and a select-all wait for this call)', () => {
      it('does not wait at all when retry_after is longer than the whole budget, and rejects at once', async () => {
        const h = setup([json(forum), notIndexed(8), json({ threads: [post('101')] })]);
        const error = await errorOf(h.client.getActiveThreads('9'));
        expect(error).toMatchObject({ kind: 'unknown', status: 202, code: 110000, retryAfterMs: 8000 });
        expect(h.sleeps).toEqual([]);
        expect(h.calls).toHaveLength(2);
      });

      it('waits for a retry_after that fits exactly into the budget', async () => {
        const h = setup([json(forum), notIndexed(3), json({ threads: [post('101')] })]);
        expect((await h.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['101']);
        expect(h.sleeps).toEqual([3000]);
      });

      it('waits for the first retry_after but not for a second one that would exceed the budget', async () => {
        const h = setup([json(forum), notIndexed(2), notIndexed(2), json({ threads: [post('101')] })]);
        const error = await errorOf(h.client.getActiveThreads('9'));
        expect(error.status).toBe(202);
        expect(h.sleeps).toEqual([2000]);
        expect(h.calls).toHaveLength(3);
      });

      it('never sleeps more than 3 s in total, whatever the answers say', async () => {
        for (const retryAfter of [undefined, 0, 0.001, 0.5, 1, 1.5, 2, 3, 10, 120]) {
          const h = setup([json(twoForums), ...Array.from({ length: 12 }, () => notIndexed(retryAfter))]);
          await errorOf(h.client.getActiveThreads('9'));
          expect(h.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(3000);
          expect(h.sleeps.length).toBeLessThanOrEqual(2);
        }
      });

      it('with the budget gone, a slow-index forum is given up on and a ready one is still read', async () => {
        const h = setup([json(twoForums), notIndexed(8), json({ threads: [post('103', { parent_id: '13' })], has_more: false })]);
        const threads = await h.client.getActiveThreads('9');
        expect(threads.map((t) => t.id)).toEqual(['103']);
        expect(h.sleeps).toEqual([]);
        expect(h.urls().slice(1)).toEqual([search('12'), search('13')]);
      });
    });

    it('also recognises the code 110000 on its own, and a 202 without threads', async () => {
      const codeOnly = setup([json(forum), json({ code: 110000, message: 'Index not yet available', retry_after: 1 }), json({ threads: [post('101')] })]);
      expect((await codeOnly.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['101']);
      expect(codeOnly.sleeps).toEqual([1000]);

      const bare = setup([json(forum), json({}, 202), json({ threads: [post('102')] })]);
      expect((await bare.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['102']);
    });

    it('does not mistake a 202 that carries a threads array for "not ready"', async () => {
      const h = setup([json(forum), json({ threads: [post('101', { parent_id: '12' })], has_more: false }, 202)]);
      expect((await h.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['101']);
      expect(h.sleeps).toEqual([]);
    });

    it('gives up after 2 waits and REJECTS (202 / 110000 / retryAfterMs) instead of answering an empty list', async () => {
      const h = setup([json(forum), notIndexed(1), notIndexed(1), notIndexed(1)]);
      const error = await errorOf(h.client.getActiveThreads('9'));
      expect(error).toMatchObject({ kind: 'unknown', status: 202, code: 110000, retryAfterMs: 1000 });
      expect(h.sleeps).toEqual([1000, 1000]);
      expect(h.calls).toHaveLength(4);
    });

    it('remembers nothing as empty: a later call asks again and gets the posts', async () => {
      const h = setup([json(forum), notIndexed(1), notIndexed(1), notIndexed(1), json({ threads: [post('101', { parent_id: '12' })] })]);
      await errorOf(h.client.getActiveThreads('9'));
      expect((await h.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['101']);
      expect(h.urls().slice(-1)).toEqual([search('12')]);
    });

    it('shares the wait budget between forums and keeps the posts of a forum that is ready', async () => {
      const h = setup([
        json(twoForums),
        notIndexed(1),
        notIndexed(1),
        notIndexed(1), // budget used up: forum 12 is given up on
        json({ threads: [post('103', { parent_id: '13' })], has_more: false }),
      ]);
      const threads = await h.client.getActiveThreads('9');
      expect(threads.map((t) => t.id)).toEqual(['103']);
      expect(h.sleeps).toEqual([1000, 1000]);
    });

    it('with the budget used up, a further forum gets one attempt and no wait', async () => {
      const h = setup([json(twoForums), notIndexed(1), notIndexed(1), notIndexed(1), notIndexed(1)]);
      const error = await errorOf(h.client.getActiveThreads('9'));
      expect(error.status).toBe(202);
      expect(h.sleeps).toEqual([1000, 1000]);
      expect(h.urls().slice(1)).toEqual([search('12'), search('12'), search('12'), search('13')]);
    });

    it('is scoped to the thread search: a 202 elsewhere is an ordinary answer', async () => {
      const h = setup([json([{ id: '7', type: 1 }], 202)]);
      await expect(h.client.getDmChannels()).resolves.toEqual([{ id: '7', type: 1 }]);
    });

    it('does not hold up other requests while it waits for the index', async () => {
      const entered = deferred();
      const release = deferred();
      const h = setup([json(forum), notIndexed(2), json([]), json({ threads: [] })], {
        sleep: async () => {
          entered.resolve();
          await release.promise;
        },
      });
      const threads = h.client.getActiveThreads('9');
      await entered.promise;
      await expect(h.client.getDmChannels()).resolves.toEqual([]);
      release.resolve();
      await expect(threads).resolves.toEqual([]);
    });

    it('can be cancelled while waiting', async () => {
      const entered = deferred();
      const controller = new AbortController();
      const h = setup([json(forum), notIndexed(2), json({ threads: [] })], {
        sleep: (_ms, signal) =>
          new Promise<void>((_, reject) => {
            entered.resolve();
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      });
      const request = errorOf(h.client.getActiveThreads('9', controller.signal));
      await entered.promise;
      controller.abort();
      expect((await request).kind).toBe('aborted');
      expect(h.calls).toHaveLength(2);
    });

    it('returns what it has when the sleeper itself breaks', async () => {
      const h = setup([json(twoForums), json({ threads: [post('101', { parent_id: '12' })] }), notIndexed(1), json({ threads: [post('103')] })], {
        sleep: async () => {
          throw new Error('timer broke');
        },
      });
      expect((await h.client.getActiveThreads('9')).map((t) => t.id)).toEqual(['101']);
    });
  });

  it('never retries a forum search: one request per forum even on 5xx, network errors and 429', async () => {
    const serverError = setup([json(guildChannels), json({}, 500), json({ threads: [] })]);
    expect(await serverError.client.getActiveThreads('9')).toEqual([]);
    expect(serverError.calls).toHaveLength(2);
    expect(serverError.sleeps).toEqual([]);

    const offline = setup([json(guildChannels), new TypeError('fetch failed'), json({ threads: [] })]);
    expect(await offline.client.getActiveThreads('9')).toEqual([]);
    expect(offline.calls).toHaveLength(2);

    const limited = setup([json(guildChannels), json({ retry_after: 2 }, 429), json({ threads: [] }), json({ threads: [] })]);
    expect(await limited.client.getActiveThreads('9')).toEqual([]);
    expect(limited.calls).toHaveLength(2);
    expect(limited.sleeps).toEqual([]);
    // ...but the rate limit is remembered: the next look at that forum waits it out first.
    expect(await limited.client.getActiveThreads('9')).toEqual([]);
    expect(limited.sleeps).toEqual([2000]);
    expect(limited.urls().slice(2)).toEqual([search('12'), search('13')]);
  });

  it('ignores a malformed search response', async () => {
    const h = setup([json(guildChannels), json('nonsense'), json({ threads: 'no' })]);
    expect(await h.client.getActiveThreads('9')).toEqual([]);
    expect(h.calls).toHaveLength(3);
  });

  it('propagates aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const pre = setup([]);
    expect((await errorOf(pre.client.getActiveThreads('9', controller.signal))).kind).toBe('aborted');

    const started = deferred();
    const live = new AbortController();
    const mid = setup([json(guildChannels), hangUntilAborted(() => started.resolve()), json({ threads: [] })]);
    const request = errorOf(mid.client.getActiveThreads('9', live.signal));
    await started.promise;
    live.abort();
    expect((await request).kind).toBe('aborted');
    expect(mid.calls).toHaveLength(2);
  });
});
