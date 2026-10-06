import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEYS } from '@/shared/constants';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'test-user-token.Gabcde.abcdefghijklmnopqrstuvwxyz0123456789';

type Listener = (...args: never[]) => unknown;

/** Hand-rolled fake of the chrome APIs the service worker touches; records listener registrations. */
function installFakeChrome() {
  const sessionData: Record<string, unknown> = {};
  const registrations = {
    beforeSendHeaders: [] as Array<{ callback: Listener; filter: unknown; extraInfoSpec: unknown }>,
    storageChanged: [] as Listener[],
    actionClicked: [] as Listener[],
  };
  const tabs = {
    query: vi.fn(async (): Promise<Array<{ id: number; url: string; windowId: number }>> => []),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  };
  const windows = { update: vi.fn(async () => ({})) };
  const session = {
    get: vi.fn(async (key: string) => (key in sessionData ? { [key]: sessionData[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    }),
  };
  const runtime = {
    id: EXTENSION_ID,
    getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
    getContexts: vi.fn(async (): Promise<Array<{ tabId: number; windowId: number; documentUrl: string }>> => []),
  };
  vi.stubGlobal('chrome', {
    runtime,
    storage: {
      session,
      onChanged: { addListener: (cb: Listener) => registrations.storageChanged.push(cb) },
    },
    webRequest: {
      onBeforeSendHeaders: {
        addListener: (callback: Listener, filter: unknown, extraInfoSpec: unknown) =>
          registrations.beforeSendHeaders.push({ callback, filter, extraInfoSpec }),
      },
    },
    action: { onClicked: { addListener: (cb: Listener) => registrations.actionClicked.push(cb) } },
    tabs,
    windows,
  });
  return { sessionData, registrations, tabs, windows, session, runtime };
}

async function loadWorker() {
  vi.resetModules();
  const fake = installFakeChrome();
  await import('@/background/index');
  return fake;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleSpies.push(errorSpy);
});
afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  vi.unstubAllGlobals();
});

describe('service worker listener registration', () => {
  it('registers every listener synchronously at import time', async () => {
    const { registrations } = await loadWorker();
    expect(registrations.beforeSendHeaders).toHaveLength(1);
    expect(registrations.storageChanged).toHaveLength(1);
    expect(registrations.actionClicked).toHaveLength(1);
  });

  it('observes only Discord API XHR traffic, non-blocking, with extraHeaders', async () => {
    const { registrations } = await loadWorker();
    const [{ filter, extraInfoSpec }] = registrations.beforeSendHeaders;
    expect(filter).toEqual({
      urls: [
        'https://discord.com/api/*',
        'https://ptb.discord.com/api/*',
        'https://canary.discord.com/api/*',
        'https://discordapp.com/api/*',
      ],
      types: ['xmlhttprequest'],
    });
    expect(extraInfoSpec).toEqual(['requestHeaders', 'extraHeaders']);
    expect(extraInfoSpec).not.toContain('blocking');
  });
});

describe('token capture wiring', () => {
  const discordRequest = (over: Record<string, unknown> = {}) => ({
    initiator: 'https://discord.com',
    tabId: 3,
    requestHeaders: [{ name: 'Authorization', value: TOKEN }],
    ...over,
  });

  it('stores a token sent by a Discord page and returns nothing (never alters the request)', async () => {
    const { registrations, sessionData } = await loadWorker();
    const listener = registrations.beforeSendHeaders[0].callback as (details: unknown) => unknown;
    expect(listener(discordRequest())).toBeUndefined();
    await flush();
    expect(sessionData[SESSION_KEYS.token]).toBe(TOKEN);
    expect(typeof sessionData[SESSION_KEYS.tokenCapturedAt]).toBe('number');
  });

  it('ignores the extension\'s own requests and writes a changed token only once', async () => {
    const { registrations, sessionData, session } = await loadWorker();
    const listener = registrations.beforeSendHeaders[0].callback as (details: unknown) => unknown;
    listener(discordRequest({ initiator: `chrome-extension://${EXTENSION_ID}`, tabId: -1 }));
    await flush();
    expect(sessionData[SESSION_KEYS.token]).toBeUndefined();

    for (let i = 0; i < 50; i++) listener(discordRequest());
    await flush();
    expect(session.set).toHaveBeenCalledTimes(1);
  });

  it('re-captures after the token was removed from storage', async () => {
    const { registrations, sessionData, session } = await loadWorker();
    const listener = registrations.beforeSendHeaders[0].callback as (details: unknown) => unknown;
    const onChanged = registrations.storageChanged[0] as (changes: unknown, area: string) => void;
    listener(discordRequest());
    await flush();

    delete sessionData[SESSION_KEYS.token];
    onChanged({ [SESSION_KEYS.token]: { oldValue: TOKEN } }, 'session');
    listener(discordRequest());
    await flush();
    expect(session.set).toHaveBeenCalledTimes(2);
    expect(sessionData[SESSION_KEYS.token]).toBe(TOKEN);
  });

  it('never logs', async () => {
    const { registrations } = await loadWorker();
    const listener = registrations.beforeSendHeaders[0].callback as (details: unknown) => unknown;
    listener(discordRequest());
    listener(discordRequest({ initiator: 'https://example.com' }));
    await flush();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('toolbar click wiring', () => {
  const appUrl = `chrome-extension://${EXTENSION_ID}/app.html`;

  it('opens app.html when it is not open yet', async () => {
    const { registrations, tabs } = await loadWorker();
    (registrations.actionClicked[0] as () => void)();
    await flush();
    expect(tabs.create).toHaveBeenCalledWith({ url: appUrl });
  });

  it('focuses an already open app tab (including ?mock=1) instead of opening a duplicate', async () => {
    const { registrations, tabs, windows, runtime } = await loadWorker();
    runtime.getContexts.mockResolvedValueOnce([{ tabId: 8, windowId: 2, documentUrl: `${appUrl}?mock=1` }]);
    (registrations.actionClicked[0] as () => void)();
    await flush();
    expect(runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['TAB'] });
    expect(tabs.update).toHaveBeenCalledWith(8, { active: true });
    expect(windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('falls back to a tabs.query by app url prefix when no context matches', async () => {
    const { registrations, tabs, windows } = await loadWorker();
    tabs.query.mockResolvedValueOnce([{ id: 9, url: `${appUrl}?mock=1`, windowId: 4 }]);
    (registrations.actionClicked[0] as () => void)();
    await flush();
    expect(tabs.query).toHaveBeenCalledWith({ url: `${appUrl}*` });
    expect(tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(windows.update).toHaveBeenCalledWith(4, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('reports a failure to open the tab without an unhandled rejection or any token data', async () => {
    const { registrations, tabs } = await loadWorker();
    tabs.create.mockRejectedValueOnce(new Error('cannot create'));
    (registrations.actionClicked[0] as () => void)();
    await flush();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(TOKEN);
  });
});
