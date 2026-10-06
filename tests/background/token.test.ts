import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTokenCapture,
  DISCORD_API_URL_PATTERNS,
  extractToken,
  isPlausibleToken,
  type RequestDetails,
  type SessionStorageLike,
} from '@/background/token';
import { SESSION_KEYS } from '@/shared/constants';

const TOKEN = 'test-user-token.Gabcde.abcdefghijklmnopqrstuvwxyz0123456789';
const OTHER_TOKEN = 'other-user-token.Gxyzab.zyxwvutsrqponmlkjihgfedcba9876543210';

function request(over: Partial<RequestDetails> & { auth?: string | null } = {}): RequestDetails {
  const { auth = TOKEN, ...rest } = over;
  return {
    initiator: 'https://discord.com',
    tabId: 7,
    requestHeaders: [
      { name: 'Accept', value: '*/*' },
      ...(auth === null ? [] : [{ name: 'Authorization', value: auth }]),
    ],
    ...rest,
  };
}

/** In-memory stand-in for chrome.storage.session with call counters. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const storage = {
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
  } satisfies SessionStorageLike;
  return { storage, data };
}

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});
afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

function expectNothingLogged(): void {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
}

describe('isPlausibleToken', () => {
  it('accepts a normal user token', () => {
    expect(isPlausibleToken(TOKEN)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', 'a'.repeat(19)],
    ['too long', 'a'.repeat(301)],
    ['Bearer scheme', `Bearer ${'a'.repeat(30)}`],
    ['Bot scheme', `Bot ${'a'.repeat(30)}`],
    ['inner whitespace', `${'a'.repeat(15)} ${'b'.repeat(15)}`],
    ['trailing newline', `${TOKEN}\n`],
    ['leading space', ` ${TOKEN}`],
    ['control character', `${'a'.repeat(30)}\u0007`],
    ['non-ASCII', `${'a'.repeat(30)}é`],
  ])('rejects %s', (_label, value) => {
    expect(isPlausibleToken(value)).toBe(false);
  });

  it('keeps the length bounds inclusive (20..300)', () => {
    expect(isPlausibleToken('a'.repeat(20))).toBe(true);
    expect(isPlausibleToken('a'.repeat(300))).toBe(true);
  });
});

describe('extractToken - who may provide a token', () => {
  it.each([
    'https://discord.com',
    'https://ptb.discord.com',
    'https://canary.discord.com',
    'https://discordapp.com',
  ])('accepts requests initiated by %s', (initiator) => {
    expect(extractToken(request({ initiator }))).toBe(TOKEN);
  });

  it('accepts a Discord-initiated request that has no tab (tabId -1, e.g. Discord\'s own worker)', () => {
    expect(extractToken(request({ tabId: -1 }))).toBe(TOKEN);
  });

  it.each([
    ['our own extension page', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'],
    ['another extension', 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
    ['a third-party site', 'https://example.com'],
    ['a lookalike suffix', 'https://evildiscord.com'],
    ['a lookalike subdomain', 'https://discord.com.evil.example'],
    ['a non-client Discord subdomain', 'https://support.discord.com'],
    ['a non-client legacy subdomain', 'https://www.discordapp.com'],
    ['a plain-http page', 'http://discord.com'],
    ['a custom port', 'https://discord.com:8443'],
    ['an opaque origin', 'null'],
    ['garbage', 'not a url'],
    ['no initiator', undefined],
  ])('ignores requests initiated by %s', (_label, initiator) => {
    expect(extractToken(request({ initiator }))).toBeNull();
  });

  it('ignores browser-internal requests without a tab and without a Discord initiator', () => {
    expect(extractToken(request({ tabId: -1, initiator: undefined }))).toBeNull();
    expect(extractToken(request({ tabId: -1, initiator: 'chrome-extension://abc' }))).toBeNull();
  });

  it('matches the Authorization header case-insensitively', () => {
    const details = request({ requestHeaders: [{ name: 'authorization', value: TOKEN }] });
    expect(extractToken(details)).toBe(TOKEN);
  });

  it('ignores requests without an Authorization header or without headers', () => {
    expect(extractToken(request({ auth: null }))).toBeNull();
    expect(extractToken({ initiator: 'https://discord.com', tabId: 1 })).toBeNull();
  });

  it('ignores a header whose value is binary (no string value)', () => {
    const details = request({ requestHeaders: [{ name: 'Authorization' }] });
    expect(extractToken(details)).toBeNull();
  });

  it.each([
    ['Bearer', `Bearer ${'a'.repeat(40)}`],
    ['Bot', `Bot ${'a'.repeat(40)}`],
    ['empty', ''],
    ['short', 'abc'],
  ])('ignores a %s Authorization value', (_label, auth) => {
    expect(extractToken(request({ auth }))).toBeNull();
  });
});

describe('DISCORD_API_URL_PATTERNS', () => {
  it('only covers the REST API of Discord hosts', () => {
    expect(DISCORD_API_URL_PATTERNS).toEqual([
      'https://discord.com/api/*',
      'https://ptb.discord.com/api/*',
      'https://canary.discord.com/api/*',
      'https://discordapp.com/api/*',
    ]);
  });
});

describe('createTokenCapture', () => {
  it('stores a captured token together with its capture time', async () => {
    const { storage, data } = fakeStorage();
    const capture = createTokenCapture({ storage, now: () => 1234 });
    await capture.handle(request());
    expect(data).toEqual({ [SESSION_KEYS.token]: TOKEN, [SESSION_KEYS.tokenCapturedAt]: 1234 });
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  it('writes once for a burst of identical tokens (no write storm)', async () => {
    const { storage } = fakeStorage();
    const capture = createTokenCapture({ storage, now: () => 1 });
    const pending = Array.from({ length: 200 }, () => capture.handle(request()));
    await Promise.all(pending);
    await capture.handle(request());
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.get.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('writes again when the token changes, and keeps the newest on top', async () => {
    const { storage, data } = fakeStorage();
    let clock = 0;
    const capture = createTokenCapture({ storage, now: () => ++clock });
    await capture.handle(request({ auth: TOKEN }));
    await capture.handle(request({ auth: OTHER_TOKEN }));
    await capture.handle(request({ auth: OTHER_TOKEN }));
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(data[SESSION_KEYS.token]).toBe(OTHER_TOKEN);
    expect(data[SESSION_KEYS.tokenCapturedAt]).toBe(2);
  });

  it('applies tokens in arrival order even when they arrive before the first write finishes', async () => {
    const { storage, data } = fakeStorage();
    const capture = createTokenCapture({ storage, now: () => 1 });
    const done = [capture.handle(request({ auth: TOKEN })), capture.handle(request({ auth: OTHER_TOKEN }))];
    await Promise.all(done);
    expect(data[SESSION_KEYS.token]).toBe(OTHER_TOKEN);
  });

  it('never writes for rejected requests', async () => {
    const { storage } = fakeStorage();
    const capture = createTokenCapture({ storage, now: () => 1 });
    await capture.handle(request({ initiator: 'chrome-extension://own-extension-id' }));
    await capture.handle(request({ initiator: 'https://example.com' }));
    await capture.handle(request({ tabId: -1, initiator: undefined }));
    await capture.handle(request({ auth: `Bearer ${'x'.repeat(40)}` }));
    await capture.handle(request({ auth: `Bot ${'x'.repeat(40)}` }));
    await capture.handle(request({ auth: 'short' }));
    await capture.handle(request({ auth: null }));
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  describe('after a service-worker restart (empty memory)', () => {
    it('does not rewrite a token that is already stored', async () => {
      const { storage } = fakeStorage({ [SESSION_KEYS.token]: TOKEN, [SESSION_KEYS.tokenCapturedAt]: 5 });
      const capture = createTokenCapture({ storage, now: () => 99 });
      await capture.handle(request());
      expect(storage.set).not.toHaveBeenCalled();
    });

    it('replaces a stale stored token with the new one', async () => {
      const { storage, data } = fakeStorage({ [SESSION_KEYS.token]: OTHER_TOKEN, [SESSION_KEYS.tokenCapturedAt]: 5 });
      const capture = createTokenCapture({ storage, now: () => 99 });
      await capture.handle(request());
      expect(storage.set).toHaveBeenCalledTimes(1);
      expect(data).toEqual({ [SESSION_KEYS.token]: TOKEN, [SESSION_KEYS.tokenCapturedAt]: 99 });
    });
  });

  describe('storage failures', () => {
    it('does not throw or log, and retries on the next request', async () => {
      const { storage, data } = fakeStorage();
      storage.set.mockRejectedValueOnce(new Error(`quota exceeded while storing ${TOKEN}`));
      const capture = createTokenCapture({ storage, now: () => 1 });
      await expect(capture.handle(request())).resolves.toBeUndefined();
      expect(data[SESSION_KEYS.token]).toBeUndefined();
      await capture.handle(request());
      expect(data[SESSION_KEYS.token]).toBe(TOKEN);
      expect(storage.set).toHaveBeenCalledTimes(2);
      expectNothingLogged();
    });

    it('survives a failing read', async () => {
      const { storage, data } = fakeStorage();
      storage.get.mockRejectedValueOnce(new Error('boom'));
      const capture = createTokenCapture({ storage, now: () => 1 });
      await expect(capture.handle(request())).resolves.toBeUndefined();
      await capture.handle(request());
      expect(data[SESSION_KEYS.token]).toBe(TOKEN);
    });
  });

  describe('onStorageChanged', () => {
    it('captures the same token again after the app cleared it', async () => {
      const { storage, data } = fakeStorage();
      const capture = createTokenCapture({ storage, now: () => 1 });
      await capture.handle(request());
      expect(storage.set).toHaveBeenCalledTimes(1);

      delete data[SESSION_KEYS.token]; // ChromePlatform.clearToken()
      capture.onStorageChanged({ [SESSION_KEYS.token]: { newValue: undefined } }, 'session');
      await capture.handle(request());
      expect(storage.set).toHaveBeenCalledTimes(2);
      expect(data[SESSION_KEYS.token]).toBe(TOKEN);
    });

    it('ignores other areas, other keys and non-removals', async () => {
      const { storage } = fakeStorage();
      const capture = createTokenCapture({ storage, now: () => 1 });
      await capture.handle(request());

      capture.onStorageChanged({ [SESSION_KEYS.token]: { newValue: undefined } }, 'local');
      capture.onStorageChanged({ 'dce.other': { newValue: undefined } }, 'session');
      capture.onStorageChanged({ [SESSION_KEYS.token]: { newValue: TOKEN } }, 'session');
      await capture.handle(request());
      expect(storage.set).toHaveBeenCalledTimes(1);
    });
  });

  it('never logs anything while capturing', async () => {
    const { storage } = fakeStorage();
    const capture = createTokenCapture({ storage, now: () => 1 });
    await capture.handle(request());
    await capture.handle(request({ auth: OTHER_TOKEN }));
    await capture.handle(request({ initiator: 'https://example.com' }));
    capture.onStorageChanged({ [SESSION_KEYS.token]: { newValue: undefined } }, 'session');
    expectNothingLogged();
  });
});
