import { describe, expect, it, vi } from 'vitest';
import { createAppTabOpener, type RuntimeLike, type TabLike, type TabsLike, type WindowsLike } from '@/background/tabs';

const APP_URL = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/app.html';

type FakeContext = { tabId?: number; windowId?: number; documentUrl?: string };

/** Like Chrome without the "tabs" permission: a url filter never matches the extension's own pages, so only an unfiltered query lists them. */
const listTabs = (openTabs: TabLike[]) => async (queryInfo: object): Promise<TabLike[]> => ('url' in queryInfo ? [] : openTabs);

function setup(openTabs: TabLike[] = []) {
  const tabs = {
    query: vi.fn(listTabs(openTabs)),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  } satisfies TabsLike;
  const windows = { update: vi.fn(async () => ({})) } satisfies WindowsLike;
  return { tabs, windows, run: () => createAppTabOpener({ appUrl: APP_URL, tabs, windows })() };
}

function setupWithContexts(contexts: FakeContext[], openTabs: TabLike[] = []) {
  const base = setup(openTabs);
  const runtime = { getContexts: vi.fn(async () => contexts) } satisfies RuntimeLike;
  return { ...base, runtime, run: () => createAppTabOpener({ appUrl: APP_URL, tabs: base.tabs, windows: base.windows, runtime })() };
}

describe('the app tab opener (tabs.query lookup)', () => {
  it('opens a new tab when the app is not open', async () => {
    const { tabs, windows, run } = setup([]);
    expect(await run()).toBe('created');
    expect(tabs.create).toHaveBeenCalledWith({ url: APP_URL });
    expect(tabs.update).not.toHaveBeenCalled();
    expect(windows.update).not.toHaveBeenCalled();
  });

  it('looks at every tab: a url filter never matches our own pages without the "tabs" permission', async () => {
    const { tabs, run } = setup([]);
    await run();
    expect(tabs.query).toHaveBeenCalledExactlyOnceWith({});
  });

  it('focuses the existing tab and its window instead of opening another', async () => {
    const { tabs, windows, run } = setup([{ id: 11, url: APP_URL, windowId: 3 }]);
    expect(await run()).toBe('focused');
    expect(tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('finds the app among other tabs, whose own urls may be hidden from this extension', async () => {
    const { tabs, run } = setup([
      { id: 1, windowId: 3 },
      { id: 2, url: 'https://discord.com/channels/@me', windowId: 3 },
      { id: 3, url: APP_URL, windowId: 4 },
      { id: 4, windowId: 4 },
    ]);
    expect(await run()).toBe('focused');
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(3, { active: true });
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
      { id: 5, pendingUrl: `${APP_URL}.bak`, windowId: 1 },
      { url: APP_URL, windowId: 1 }, // no id: cannot be addressed
      { url: undefined, pendingUrl: APP_URL, windowId: 1 },
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

  describe('a tab that Chrome shows only by its address (no live document)', () => {
    it('focuses an app tab that Chrome discarded (Memory Saver) instead of opening a second one', async () => {
      // A discarded tab has no document, so getContexts does not list it; its address is all that is left.
      const { tabs, windows, runtime, run } = setupWithContexts([], [{ id: 12, url: APP_URL, windowId: 3 }]);
      expect(await run()).toBe('focused');
      expect(runtime.getContexts).toHaveBeenCalledTimes(1);
      expect(tabs.update).toHaveBeenCalledExactlyOnceWith(12, { active: true });
      expect(windows.update).toHaveBeenCalledExactlyOnceWith(3, { focused: true });
      expect(tabs.create).not.toHaveBeenCalled();
    });

    it('finds an app tab that is still loading by the address it is navigating to', async () => {
      const { tabs, run } = setupWithContexts([], [{ id: 13, pendingUrl: `${APP_URL}?mock=1`, windowId: 3 }]);
      expect(await run()).toBe('focused');
      expect(tabs.update).toHaveBeenCalledExactlyOnceWith(13, { active: true });
      expect(tabs.create).not.toHaveBeenCalled();
    });

    it('prefers a tab that shows the app over one that is only about to', async () => {
      const { tabs, run } = setup([
        { id: 20, url: 'https://discord.com/channels/@me', pendingUrl: APP_URL, windowId: 1 },
        { id: 21, url: APP_URL, windowId: 1 },
      ]);
      await run();
      expect(tabs.update).toHaveBeenCalledExactlyOnceWith(21, { active: true });
    });

    it('does not take a tab that has navigated away for the app, however recently the app was opened in it', async () => {
      const { tabs, run } = setup([
        { id: 30, url: 'https://discord.com/channels/@me', windowId: 1 },
        { id: 31, windowId: 1 }, // another site: Chrome hides its address
      ]);
      expect(await run()).toBe('created');
      expect(tabs.update).not.toHaveBeenCalled();
    });
  });
});

describe('the app tab opener (runtime.getContexts lookup)', () => {
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
    const result = await createAppTabOpener({ appUrl: APP_URL, tabs: base.tabs, windows: base.windows, runtime: {} })();
    expect(result).toBe('focused');
    expect(base.tabs.update).toHaveBeenCalledWith(40, { active: true });
  });

  it('omits the window focus when the context reports no valid window', async () => {
    const { windows, run } = setupWithContexts([{ tabId: 50, windowId: -1, documentUrl: APP_URL }]);
    expect(await run()).toBe('focused');
    expect(windows.update).not.toHaveBeenCalled();
  });

  it('prefers a live document over a discarded tab', async () => {
    const { tabs, run } = setupWithContexts([{ tabId: 60, windowId: 1, documentUrl: APP_URL }], [{ id: 61, url: APP_URL, windowId: 1 }]);
    await run();
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(60, { active: true });
  });
});

describe('the app tab opener (consecutive clicks)', () => {
  /**
   * A browser as Chrome behaves for an extension without the `tabs` permission: a new tab shows its pending address until the document
   * commits, a tab on a site the extension has no access to shows no address at all, and `runtime.getContexts` only lists committed
   * app documents.
   */
  function browser() {
    interface Page extends TabLike {
      id: number;
      committed: boolean;
    }
    let pages: Page[] = [];
    let nextTabId = 100;
    const visible = (): TabLike[] =>
      pages.map(({ id, url, pendingUrl, windowId }) => ({ id, url, pendingUrl, windowId }));
    const tabs = {
      query: vi.fn(async (queryInfo: object) => listTabs(visible())(queryInfo)),
      update: vi.fn(async (tabId: number) => {
        if (!pages.some((page) => page.id === tabId)) throw new Error(`No tab with id: ${tabId}.`);
        return {};
      }),
      create: vi.fn(async ({ url }: { url: string }): Promise<unknown> => {
        const page: Page = { id: nextTabId++, windowId: 7, pendingUrl: url, committed: false };
        pages.push(page);
        return { id: page.id, windowId: page.windowId, pendingUrl: url };
      }),
    } satisfies TabsLike;
    const windows = { update: vi.fn(async () => ({})) } satisfies WindowsLike;
    const runtime = {
      getContexts: vi.fn(async (): Promise<FakeContext[]> =>
        pages.filter((page) => page.committed).map((page) => ({ tabId: page.id, windowId: page.windowId, documentUrl: page.url }))),
    } satisfies RuntimeLike;
    const open = createAppTabOpener({ appUrl: APP_URL, tabs, windows, runtime });
    const only = (): Page => {
      expect(pages).toHaveLength(1);
      return pages[0];
    };
    return {
      tabs,
      windows,
      runtime,
      open,
      /** The first navigation of the tab committed: the document is alive now. */
      commit: (page: Page = only()) => Object.assign(page, { url: page.pendingUrl, pendingUrl: undefined, committed: true }),
      /** The tab went to a page of Discord (its address is visible to the extension) or to any other site (hidden). */
      navigateAway: (to: string | undefined, page: Page = only()) => Object.assign(page, { url: to, pendingUrl: undefined, committed: false }),
      close: (page: Page = only()) => {
        pages = pages.filter((other) => other !== page);
      },
      pages: () => pages,
    };
  }

  it('opens one tab for two clicks that arrive before the first has finished', async () => {
    const { tabs, windows, open } = browser();
    const [first, second] = await Promise.all([open(), open()]);
    expect([first, second]).toEqual(['created', 'focused']);
    expect(tabs.create).toHaveBeenCalledTimes(1);
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(100, { active: true });
    expect(windows.update).toHaveBeenCalledExactlyOnceWith(7, { focused: true });
  });

  it('focuses the tab the first click created when the second comes before its document is alive', async () => {
    const { tabs, open, runtime } = browser();
    expect(await open()).toBe('created');
    expect(await open()).toBe('focused');
    expect(runtime.getContexts).toHaveBeenCalledTimes(2);
    expect(tabs.create).toHaveBeenCalledTimes(1);
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(100, { active: true });
  });

  it('opens one tab however many clicks pile up', async () => {
    const { tabs, open } = browser();
    const results = await Promise.all(Array.from({ length: 6 }, () => open()));
    expect(results).toEqual(['created', ...Array.from({ length: 5 }, () => 'focused')]);
    expect(tabs.create).toHaveBeenCalledTimes(1);
  });

  it('handles clicks strictly one at a time', async () => {
    const { runtime, open } = browser();
    let running = 0;
    let peak = 0;
    runtime.getContexts.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 0));
      running -= 1;
      return [];
    });
    await Promise.all([open(), open(), open()]);
    expect(peak).toBe(1);
  });

  it('finds the tab again once its document is alive', async () => {
    const { tabs, open, commit, runtime } = browser();
    await open();
    commit();
    expect(await open()).toBe('focused');
    expect(runtime.getContexts).toHaveBeenLastCalledWith({ contextTypes: ['TAB'] });
    expect(tabs.update).toHaveBeenLastCalledWith(100, { active: true });
    expect(tabs.create).toHaveBeenCalledTimes(1);
  });

  describe.each([
    ['a page of Discord', 'https://discord.com/channels/@me'],
    ['a site the extension has no access to (its address is hidden)', undefined],
  ])('when the tab it opened has since gone to %s', (_label, destination) => {
    it('opens the app again at once (the tab is no longer the app) and then focuses that one', async () => {
      const { tabs, open, navigateAway, pages } = browser();
      await open(); // tab 100
      navigateAway(destination);
      expect(await open()).toBe('created'); // tab 101
      expect(tabs.update).not.toHaveBeenCalled();
      expect(await open()).toBe('focused');
      expect(tabs.update).toHaveBeenCalledExactlyOnceWith(101, { active: true });
      expect(tabs.create).toHaveBeenCalledTimes(2);
      expect(pages().map((page) => page.id)).toEqual([100, 101]);
    });

    it('does so after its document had been alive too', async () => {
      const { tabs, open, commit, navigateAway } = browser();
      await open();
      commit();
      navigateAway(destination);
      expect(await open()).toBe('created');
      expect(tabs.create).toHaveBeenCalledTimes(2);
    });
  });

  it('opens a new tab when the one it created has been closed', async () => {
    const { tabs, open, close } = browser();
    await open();
    close();
    expect(await open()).toBe('created');
    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledTimes(2);
  });

  it('opens a new tab when the one it found is closed just before it is focused', async () => {
    const { tabs, open, close } = browser();
    await open(); // tab 100
    tabs.update.mockImplementationOnce(async () => {
      close();
      throw new Error('No tab with id: 100.');
    });
    expect(await open()).toBe('created'); // tab 101
    expect(await open()).toBe('focused');
    expect(tabs.update).toHaveBeenLastCalledWith(101, { active: true });
    expect(tabs.create).toHaveBeenCalledTimes(2);
  });

  it('does not depend on what tabs.create resolves with', async () => {
    const { tabs, open } = browser();
    const create = tabs.create.getMockImplementation();
    tabs.create.mockImplementation(async (properties) => {
      await create?.(properties);
      return {};
    });
    await open();
    expect(await open()).toBe('focused');
    expect(tabs.create).toHaveBeenCalledTimes(1);
    expect(tabs.update).toHaveBeenCalledExactlyOnceWith(100, { active: true });
  });

  it('a click whose tab could not be created fails alone: the next click tries again', async () => {
    const { tabs, open } = browser();
    tabs.create.mockRejectedValueOnce(new Error('cannot create'));
    const [failed, retried] = await Promise.allSettled([open(), open()]);
    expect(failed).toMatchObject({ status: 'rejected' });
    expect(retried).toEqual({ status: 'fulfilled', value: 'created' });
    expect(tabs.create).toHaveBeenCalledTimes(2);
  });
});
