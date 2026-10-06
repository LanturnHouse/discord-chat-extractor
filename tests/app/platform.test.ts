// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromePlatform, normalizePrefs } from '@/app/platform/chrome';
import { DevPlatform } from '@/app/platform/dev';
import { DEFAULT_PREFS, type Prefs } from '@/app/platform/types';
import { DISCORD_APP_URL, DISCORD_TAB_URL_PATTERNS, LOCAL_KEYS, SESSION_KEYS } from '@/shared/constants';

const TOKEN = 'test-user-token.Gabcde.abcdefghijklmnopqrstuvwxyz0123456789';

type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: StorageChanges, areaName: string) => void;

/** Hand-rolled fake of chrome.storage / chrome.tabs with real change-event plumbing. */
function installFakeChrome(options: { session?: boolean; runtimeId?: string | null } = {}) {
  const { session = true, runtimeId = 'abcdefghijklmnopabcdefghijklmnop' } = options;
  const sessionData: Record<string, unknown> = {};
  const localData: Record<string, unknown> = {};
  const listeners = new Set<ChangeListener>();

  const area = (data: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  });

  const fake = {
    runtime: { id: runtimeId ?? undefined },
    storage: {
      local: area(localData),
      ...(session ? { session: area(sessionData) } : {}),
      onChanged: {
        addListener: vi.fn((cb: ChangeListener) => listeners.add(cb)),
        removeListener: vi.fn((cb: ChangeListener) => listeners.delete(cb)),
      },
    },
    tabs: {
      query: vi.fn(async (): Promise<Array<{ id?: number; url?: string }>> => []),
      reload: vi.fn(async (_tabId: number) => {}),
      create: vi.fn(async () => ({})),
    },
  };
  vi.stubGlobal('chrome', fake);
  return {
    fake,
    sessionData,
    localData,
    listeners,
    fire: (changes: StorageChanges, areaName: string) => listeners.forEach((cb) => cb(changes, areaName)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

describe('normalizePrefs', () => {
  it('passes valid prefs through unchanged', () => {
    const prefs: Prefs = { exportFormat: 'xlsx', htmlTheme: 'light', locale: 'ko' };
    expect(normalizePrefs(prefs)).toEqual(prefs);
  });

  it.each(['html', 'txt', 'md', 'xlsx', 'csv', 'json'] as const)('accepts export format %s', (exportFormat) => {
    expect(normalizePrefs({ exportFormat }).exportFormat).toBe(exportFormat);
  });

  it('falls back to defaults per field, keeping the valid ones', () => {
    expect(normalizePrefs({ exportFormat: 'pdf', htmlTheme: 'light', locale: 'fr' })).toEqual({
      ...DEFAULT_PREFS,
      htmlTheme: 'light',
    });
    expect(normalizePrefs({ exportFormat: 'csv', htmlTheme: 'blue', locale: 'en' })).toEqual({
      ...DEFAULT_PREFS,
      exportFormat: 'csv',
      locale: 'en',
    });
  });

  it('fills in missing fields from the defaults', () => {
    expect(normalizePrefs({ locale: 'en' })).toEqual({ ...DEFAULT_PREFS, locale: 'en' });
  });

  it.each([null, undefined, 42, 'html', true, [], [1, 2]])('returns defaults for %j', (raw) => {
    expect(normalizePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('rejects values of the wrong type (not just wrong strings)', () => {
    expect(normalizePrefs({ exportFormat: 3, htmlTheme: { a: 1 }, locale: ['ko'] })).toEqual(DEFAULT_PREFS);
  });

  it('drops unknown keys and never aliases the shared defaults object', () => {
    const result = normalizePrefs({ ...DEFAULT_PREFS, token: TOKEN, extra: 1 });
    expect(result).toEqual(DEFAULT_PREFS);
    expect(Object.keys(result).sort()).toEqual(['exportFormat', 'htmlTheme', 'locale']);
    expect(result).not.toBe(DEFAULT_PREFS);
  });
});

describe('ChromePlatform', () => {
  describe('token', () => {
    it('reads the token from storage.session', async () => {
      const { sessionData } = installFakeChrome();
      sessionData[SESSION_KEYS.token] = TOKEN;
      expect(await new ChromePlatform().getToken()).toBe(TOKEN);
    });

    it.each([[undefined], [''], [123], [null]])('treats a stored value of %j as "no token"', async (value) => {
      const { sessionData } = installFakeChrome();
      if (value !== undefined) sessionData[SESSION_KEYS.token] = value;
      expect(await new ChromePlatform().getToken()).toBeNull();
    });

    it('clearToken removes the token and its capture time from storage.session only', async () => {
      const { fake, sessionData, localData } = installFakeChrome();
      sessionData[SESSION_KEYS.token] = TOKEN;
      sessionData[SESSION_KEYS.tokenCapturedAt] = 1;
      localData['dce.keep'] = 'x';
      await new ChromePlatform().clearToken();
      expect(sessionData).toEqual({});
      expect(localData).toEqual({ 'dce.keep': 'x' });
      expect(fake.storage.local.remove).not.toHaveBeenCalled();
    });

    it('clearToken(expected) removes the token only while it is still the expected one - a newer capture survives a 401 for an old token', async () => {
      const { fake, sessionData } = installFakeChrome();
      const OLD = `${TOKEN}-old`;
      sessionData[SESSION_KEYS.token] = TOKEN;
      sessionData[SESSION_KEYS.tokenCapturedAt] = 2;

      await new ChromePlatform().clearToken(OLD);
      expect(sessionData).toEqual({ [SESSION_KEYS.token]: TOKEN, [SESSION_KEYS.tokenCapturedAt]: 2 });
      expect(fake.storage.session?.remove).not.toHaveBeenCalled();

      await new ChromePlatform().clearToken(TOKEN);
      expect(sessionData).toEqual({});
      expect(fake.storage.session?.remove).toHaveBeenCalledTimes(1);
    });

    it('clearToken(expected) with nothing stored does nothing, and clearToken() stays unconditional', async () => {
      const { fake, sessionData } = installFakeChrome();
      await new ChromePlatform().clearToken(TOKEN);
      expect(fake.storage.session?.remove).not.toHaveBeenCalled();

      sessionData[SESSION_KEYS.token] = TOKEN;
      await new ChromePlatform().clearToken();
      expect(sessionData).toEqual({});
    });

    it('onTokenChange reports captures and clears of the session token', async () => {
      const { fire } = installFakeChrome();
      const cb = vi.fn();
      new ChromePlatform().onTokenChange(cb);
      fire({ [SESSION_KEYS.token]: { newValue: TOKEN } }, 'session');
      fire({ [SESSION_KEYS.token]: { oldValue: TOKEN } }, 'session');
      expect(cb.mock.calls).toEqual([[TOKEN], [null]]);
    });

    it('onTokenChange ignores other areas and other keys', async () => {
      const { fire } = installFakeChrome();
      const cb = vi.fn();
      new ChromePlatform().onTokenChange(cb);
      fire({ [SESSION_KEYS.token]: { newValue: TOKEN } }, 'local');
      fire({ [SESSION_KEYS.token]: { newValue: TOKEN } }, 'sync');
      fire({ [SESSION_KEYS.tokenCapturedAt]: { newValue: 5 } }, 'session');
      fire({ unrelated: { newValue: 'x' } }, 'session');
      expect(cb).not.toHaveBeenCalled();
    });

    it('onTokenChange returns an unsubscribe function', async () => {
      const { fire, listeners } = installFakeChrome();
      const cb = vi.fn();
      const unsubscribe = new ChromePlatform().onTokenChange(cb);
      expect(listeners.size).toBe(1);
      unsubscribe();
      expect(listeners.size).toBe(0);
      fire({ [SESSION_KEYS.token]: { newValue: TOKEN } }, 'session');
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('tabs', () => {
    it('findDiscordTabs queries the Discord url patterns and drops tabs without id/url', async () => {
      const { fake } = installFakeChrome();
      fake.tabs.query.mockResolvedValueOnce([
        { id: 1, url: 'https://discord.com/channels/@me' },
        { id: 2 },
        { url: 'https://discord.com/app' },
        { id: 3, url: 'https://ptb.discord.com/app' },
      ]);
      const tabs = await new ChromePlatform().findDiscordTabs();
      expect(fake.tabs.query).toHaveBeenCalledWith({ url: [...DISCORD_TAB_URL_PATTERNS] });
      expect(tabs).toEqual([
        { id: 1, url: 'https://discord.com/channels/@me' },
        { id: 3, url: 'https://ptb.discord.com/app' },
      ]);
    });

    it('reloadDiscordTabs reloads every Discord tab and counts the successes', async () => {
      const { fake } = installFakeChrome();
      fake.tabs.query.mockResolvedValueOnce([
        { id: 1, url: 'https://discord.com/app' },
        { id: 2, url: 'https://discord.com/app' },
        { id: 3, url: 'https://discord.com/app' },
      ]);
      fake.tabs.reload.mockImplementation(async (tabId: number) => {
        if (tabId === 2) throw new Error('No tab with id: 2.');
      });
      expect(await new ChromePlatform().reloadDiscordTabs()).toBe(2);
      expect(fake.tabs.reload.mock.calls.map(([id]) => id)).toEqual([1, 2, 3]);
    });

    it('reloadDiscordTabs returns 0 when there is no Discord tab', async () => {
      const { fake } = installFakeChrome();
      expect(await new ChromePlatform().reloadDiscordTabs()).toBe(0);
      expect(fake.tabs.reload).not.toHaveBeenCalled();
    });

    it('openDiscord opens discord.com/app in a new tab', async () => {
      const { fake } = installFakeChrome();
      await new ChromePlatform().openDiscord();
      expect(fake.tabs.create).toHaveBeenCalledWith({ url: DISCORD_APP_URL });
    });
  });

  describe('prefs', () => {
    it('returns the defaults when nothing is stored', async () => {
      installFakeChrome();
      expect(await new ChromePlatform().loadPrefs()).toEqual(DEFAULT_PREFS);
    });

    it('round-trips through storage.local under LOCAL_KEYS.prefs', async () => {
      const { localData } = installFakeChrome();
      const platform = new ChromePlatform();
      const prefs: Prefs = { exportFormat: 'json', htmlTheme: 'light', locale: 'en' };
      await platform.savePrefs(prefs);
      expect(localData[LOCAL_KEYS.prefs]).toEqual(prefs);
      expect(await platform.loadPrefs()).toEqual(prefs);
    });

    it('validates what it loads and merges it with the defaults', async () => {
      const { localData } = installFakeChrome();
      localData[LOCAL_KEYS.prefs] = { exportFormat: 'docx', htmlTheme: 'light', locale: 'xx', junk: true };
      expect(await new ChromePlatform().loadPrefs()).toEqual({ ...DEFAULT_PREFS, htmlTheme: 'light' });

      localData[LOCAL_KEYS.prefs] = 'garbage';
      expect(await new ChromePlatform().loadPrefs()).toEqual(DEFAULT_PREFS);
    });

    it('validates what it saves and writes nothing but the prefs key (no token in storage.local)', async () => {
      const { fake, localData, sessionData } = installFakeChrome();
      sessionData[SESSION_KEYS.token] = TOKEN;
      const dirty = { exportFormat: 'csv', htmlTheme: 'neon', locale: 'ko', token: TOKEN } as unknown as Prefs;
      await new ChromePlatform().savePrefs(dirty);
      expect(localData[LOCAL_KEYS.prefs]).toEqual({ exportFormat: 'csv', htmlTheme: 'dark', locale: 'ko' });
      expect(Object.keys(localData)).toEqual([LOCAL_KEYS.prefs]);
      expect(JSON.stringify(fake.storage.local.set.mock.calls)).not.toContain(TOKEN);
    });
  });
});

describe('DevPlatform', () => {
  const dev = () => new DevPlatform();

  it('identifies as dev and never has a token', async () => {
    expect(dev().kind).toBe('dev');
    expect(await dev().getToken()).toBeNull();
    await expect(dev().clearToken()).resolves.toBeUndefined();
    await expect(dev().clearToken(TOKEN)).resolves.toBeUndefined();
  });

  it('onTokenChange never fires and returns a callable unsubscribe', () => {
    const cb = vi.fn();
    const unsubscribe = dev().onTokenChange(cb);
    expect(() => unsubscribe()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it('tab operations are no-ops', async () => {
    expect(await dev().findDiscordTabs()).toEqual([]);
    expect(await dev().reloadDiscordTabs()).toBe(0);
  });

  it('openDiscord opens discord.com/app in a new tab with noopener', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await dev().openDiscord();
    expect(open).toHaveBeenCalledWith(DISCORD_APP_URL, '_blank', 'noopener');
  });

  describe('prefs in localStorage', () => {
    it('returns the defaults when nothing is stored', async () => {
      expect(await dev().loadPrefs()).toEqual(DEFAULT_PREFS);
    });

    it('round-trips', async () => {
      const prefs: Prefs = { exportFormat: 'md', htmlTheme: 'light', locale: 'ko' };
      await dev().savePrefs(prefs);
      expect(JSON.parse(localStorage.getItem(LOCAL_KEYS.prefs) ?? 'null')).toEqual(prefs);
      expect(await dev().loadPrefs()).toEqual(prefs);
    });

    it('validates stored values and tolerates corrupt JSON', async () => {
      localStorage.setItem(LOCAL_KEYS.prefs, JSON.stringify({ exportFormat: 'exe', htmlTheme: 'light' }));
      expect(await dev().loadPrefs()).toEqual({ ...DEFAULT_PREFS, htmlTheme: 'light' });

      localStorage.setItem(LOCAL_KEYS.prefs, '{not json');
      expect(await dev().loadPrefs()).toEqual(DEFAULT_PREFS);

      localStorage.setItem(LOCAL_KEYS.prefs, 'null');
      expect(await dev().loadPrefs()).toEqual(DEFAULT_PREFS);
    });

    describe('when localStorage is unusable', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      afterEach(() => {
        if (original) Object.defineProperty(globalThis, 'localStorage', original);
      });

      it('survives getItem/setItem throwing (quota, blocked storage)', async () => {
        const failing = {
          getItem: () => {
            throw new DOMException('denied', 'SecurityError');
          },
          setItem: () => {
            throw new DOMException('full', 'QuotaExceededError');
          },
        };
        vi.stubGlobal('localStorage', failing);
        expect(await dev().loadPrefs()).toEqual(DEFAULT_PREFS);
        await expect(dev().savePrefs({ exportFormat: 'csv', htmlTheme: 'dark', locale: 'en' })).resolves.toBeUndefined();
      });

      it('survives the localStorage accessor itself throwing (cookies blocked)', async () => {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          },
        });
        expect(await dev().loadPrefs()).toEqual(DEFAULT_PREFS);
        await expect(dev().savePrefs(DEFAULT_PREFS)).resolves.toBeUndefined();
      });

      it('survives localStorage not existing at all', async () => {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
        expect(await dev().loadPrefs()).toEqual(DEFAULT_PREFS);
        await expect(dev().savePrefs(DEFAULT_PREFS)).resolves.toBeUndefined();
      });
    });
  });
});

describe('getPlatform / isMockRequested', () => {
  async function load() {
    vi.resetModules();
    return import('@/app/platform/index');
  }

  beforeEach(() => {
    history.replaceState(null, '', '/app.html');
  });

  it('picks DevPlatform outside an extension (no chrome global)', async () => {
    const { getPlatform } = await load();
    expect(getPlatform().kind).toBe('dev');
  });

  it('picks ChromePlatform inside an extension page', async () => {
    installFakeChrome();
    const { getPlatform } = await load();
    expect(getPlatform().kind).toBe('extension');
  });

  it('falls back to DevPlatform when chrome exists but is not an extension context', async () => {
    installFakeChrome({ runtimeId: null });
    const { getPlatform: withoutId } = await load();
    expect(withoutId().kind).toBe('dev');

    vi.unstubAllGlobals();
    installFakeChrome({ session: false });
    const { getPlatform: withoutSession } = await load();
    expect(withoutSession().kind).toBe('dev');

    vi.stubGlobal('chrome', {}); // regular web page that exposes a bare `chrome` object
    const { getPlatform: bare } = await load();
    expect(bare().kind).toBe('dev');
  });

  it('caches the platform instance', async () => {
    installFakeChrome();
    const { getPlatform } = await load();
    expect(getPlatform()).toBe(getPlatform());
  });

  describe('isMockRequested', () => {
    it('is true when the platform is dev, with or without the query flag', async () => {
      const { isMockRequested } = await load();
      expect(isMockRequested()).toBe(true);
      history.replaceState(null, '', '/app.html?mock=1');
      expect(isMockRequested()).toBe(true);
    });

    it('is false in the extension without ?mock=1', async () => {
      installFakeChrome();
      const { isMockRequested } = await load();
      expect(isMockRequested()).toBe(false);
      history.replaceState(null, '', '/app.html?mock=0');
      expect(isMockRequested()).toBe(false);
      history.replaceState(null, '', '/app.html?mock');
      expect(isMockRequested()).toBe(false);
    });

    it('is true in the extension with ?mock=1 (demo mode from the onboarding screen)', async () => {
      installFakeChrome();
      history.replaceState(null, '', '/app.html?foo=bar&mock=1');
      const { isMockRequested } = await load();
      expect(isMockRequested()).toBe(true);
    });
  });
});
