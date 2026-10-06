import { describe, expect, it, vi } from 'vitest';
import { openOrFocusAppTab, type RuntimeLike, type TabsLike, type WindowsLike } from '@/background/tabs';

const APP_URL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/app.html';

type FakeTab = { id?: number; url?: string; windowId?: number };
type FakeContext = { tabId?: number; windowId?: number; documentUrl?: string };

function setup(openTabs: FakeTab[] = []) {
  const tabs = {
    query: vi.fn(async () => openTabs),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  } satisfies TabsLike;
  const windows = { update: vi.fn(async () => ({})) } satisfies WindowsLike;
  return { tabs, windows, run: () => openOrFocusAppTab({ appUrl: APP_URL, tabs, windows }) };
}

function setupWithContexts(contexts: FakeContext[], openTabs: FakeTab[] = []) {
  const base = setup(openTabs);
  const runtime = { getContexts: vi.fn(async () => contexts) } satisfies RuntimeLike;
  return { ...base, runtime, run: () => openOrFocusAppTab({ appUrl: APP_URL, tabs: base.tabs, windows: base.windows, runtime }) };
}

describe('openOrFocusAppTab (tabs.query lookup)', () => {
  it('opens a new tab when the app is not open', async () => {
    const { tabs, windows, run } = setup([]);
    expect(await run()).toBe('created');
    expect(tabs.create).toHaveBeenCalledWith({ url: APP_URL });
    expect(tabs.update).not.toHaveBeenCalled();
    expect(windows.update).not.toHaveBeenCalled();
  });

  it('queries by the app url prefix (so ?mock=1 variants are found)', async () => {
    const { tabs, run } = setup([]);
    await run();
    expect(tabs.query).toHaveBeenCalledWith({ url: `${APP_URL}*` });
  });

  it('focuses the existing tab and its window instead of opening another', async () => {
    const { tabs, windows, run } = setup([{ id: 11, url: APP_URL, windowId: 3 }]);
    expect(await run()).toBe('focused');
    expect(tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it.each([`${APP_URL}?mock=1`, `${APP_URL}#/dm`, `${APP_URL}?mock=1#x`])('counts %s as the app', async (url) => {
    const { tabs, run } = setup([{ id: 4, url, windowId: 1 }]);
    expect(await run()).toBe('focused');
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('does not treat look-alike urls as the app', async () => {
    const { tabs, run } = setup([
      { id: 1, url: `${APP_URL}.bak`, windowId: 1 },
      { id: 2, url: `${APP_URL}x`, windowId: 1 },
      { id: 3, url: undefined, windowId: 1 },
      { url: APP_URL, windowId: 1 }, // no id: cannot be addressed
    ]);
    expect(await run()).toBe('created');
    expect(tabs.update).not.toHaveBeenCalled();
  });

  it('skips the window focus when the tab reports no window', async () => {
    const { tabs, windows, run } = setup([{ id: 5, url: APP_URL }]);
    expect(await run()).toBe('focused');
    expect(tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(windows.update).not.toHaveBeenCalled();
  });

  it('opens a fresh tab if the existing one disappeared before it could be focused', async () => {
    const { tabs, windows, run } = setup([{ id: 9, url: APP_URL, windowId: 2 }]);
    tabs.update.mockRejectedValueOnce(new Error('No tab with id: 9.'));
    expect(await run()).toBe('created');
    expect(windows.update).not.toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledWith({ url: APP_URL });
  });

  it('propagates a failure to create a tab', async () => {
    const { tabs, run } = setup([]);
    tabs.create.mockRejectedValueOnce(new Error('cannot create'));
    await expect(run()).rejects.toThrow('cannot create');
  });
});

describe('openOrFocusAppTab (runtime.getContexts lookup)', () => {
  it('finds the app even when tabs.query cannot see our own tab urls (no "tabs" permission)', async () => {
    const { tabs, windows, runtime, run } = setupWithContexts([{ tabId: 21, windowId: 6, documentUrl: `${APP_URL}?mock=1` }], []);
    expect(await run()).toBe('focused');
    expect(runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['TAB'] });
    expect(tabs.update).toHaveBeenCalledWith(21, { active: true });
    expect(windows.update).toHaveBeenCalledWith(6, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.query).not.toHaveBeenCalled();
  });

  it('ignores look-alike documents and contexts without a usable tab id, then falls back to tabs.query', async () => {
    const { tabs, run } = setupWithContexts(
      [
        { tabId: 1, windowId: 1, documentUrl: `${APP_URL}.bak` },
        { tabId: -1, windowId: -1, documentUrl: APP_URL },
        { windowId: 1, documentUrl: APP_URL },
        { tabId: 2, windowId: 1, documentUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/other.html' },
      ],
      [],
    );
    expect(await run()).toBe('created');
    expect(tabs.query).toHaveBeenCalledTimes(1);
    expect(tabs.create).toHaveBeenCalledWith({ url: APP_URL });
  });

  it('falls back to tabs.query when getContexts finds nothing', async () => {
    const { tabs, run } = setupWithContexts([], [{ id: 30, url: APP_URL, windowId: 8 }]);
    expect(await run()).toBe('focused');
    expect(tabs.update).toHaveBeenCalledWith(30, { active: true });
  });

  it('falls back to tabs.query when getContexts throws', async () => {
    const { tabs, runtime, run } = setupWithContexts([], [{ id: 31, url: APP_URL, windowId: 8 }]);
    runtime.getContexts.mockRejectedValueOnce(new Error('unsupported'));
    expect(await run()).toBe('focused');
    expect(tabs.update).toHaveBeenCalledWith(31, { active: true });
  });

  it('works on Chrome versions without getContexts', async () => {
    const base = setup([{ id: 40, url: APP_URL, windowId: 1 }]);
    const result = await openOrFocusAppTab({ appUrl: APP_URL, tabs: base.tabs, windows: base.windows, runtime: {} });
    expect(result).toBe('focused');
    expect(base.tabs.update).toHaveBeenCalledWith(40, { active: true });
  });

  it('omits the window focus when the context reports no valid window', async () => {
    const { windows, run } = setupWithContexts([{ tabId: 50, windowId: -1, documentUrl: APP_URL }]);
    expect(await run()).toBe('focused');
    expect(windows.update).not.toHaveBeenCalled();
  });
});
