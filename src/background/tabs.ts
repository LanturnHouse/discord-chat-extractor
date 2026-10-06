/** What `chrome.tabs.query` reports of a tab (`url` / `pendingUrl` are only there when Chrome lets this extension see them). */
export interface TabLike {
  id?: number;
  url?: string;
  pendingUrl?: string;
  windowId?: number;
}

/** The slice of `chrome.tabs` that opening/focusing the app needs. */
export interface TabsLike {
  query(queryInfo: Record<string, never>): Promise<TabLike[]>;
  update(tabId: number, updateProperties: { active: boolean }): Promise<unknown>;
  create(createProperties: { url: string }): Promise<unknown>;
}

/** The slice of `chrome.windows` that opening/focusing the app needs. */
export interface WindowsLike {
  update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>;
}

/** The slice of `chrome.runtime` used to find our own tabs (`getContexts` exists since Chrome 116). */
export interface RuntimeLike {
  getContexts?(filter: { contextTypes: Array<'TAB'> }): Promise<Array<{ tabId?: number; windowId?: number; documentUrl?: string }>>;
}

export interface AppTabDeps {
  /** `chrome.runtime.getURL('app.html')` */
  appUrl: string;
  tabs: TabsLike;
  windows: WindowsLike;
  runtime?: RuntimeLike;
}

export type AppTabResult = 'focused' | 'created';

interface AppTab {
  id: number;
  windowId?: number;
}

/** `app.html`, `app.html?mock=1`, `app.html#x` all count as the app; `app.html.bak` does not. */
function isAppUrl(url: string | undefined, appUrl: string): boolean {
  if (!url) return false;
  return url === appUrl || url.startsWith(`${appUrl}?`) || url.startsWith(`${appUrl}#`);
}

const isId = (value: number | undefined): value is number => typeof value === 'number' && value >= 0;

const toAppTab = (id: number, windowId: number | undefined): AppTab => ({ id, windowId: isId(windowId) ? windowId : undefined });

/**
 * Where the app is open, from what Chrome reports without the `tabs` permission:
 *  1. `runtime.getContexts` lists the documents of our own tabs. It cannot see a tab that Chrome discarded (Memory Saver: no
 *     document is alive) or one whose first navigation has not committed yet.
 *  2. Every tab's `url` / `pendingUrl`. Chrome shows an extension the address of its own pages even without the permission (the
 *     address of a site it has no access to stays hidden), keeps the address of a discarded tab and reports the pending one of a
 *     tab that is still loading. A `tabs.query({ url })` filter is no use for that: it never matches our own pages.
 * Nothing is remembered between clicks: a tab created a moment ago is found like any other, and one that has navigated away since
 * is not mistaken for the app.
 */
async function findAppTab({ appUrl, tabs, runtime }: AppTabDeps): Promise<AppTab | null> {
  if (runtime?.getContexts) {
    try {
      const contexts = await runtime.getContexts({ contextTypes: ['TAB'] });
      const hit = contexts.find((context) => isId(context.tabId) && isAppUrl(context.documentUrl, appUrl));
      if (hit && isId(hit.tabId)) return toAppTab(hit.tabId, hit.windowId);
    } catch {
      // Fall through to the tabs API.
    }
  }
  const all = await tabs.query({});
  const found = all.find((tab) => isId(tab.id) && isAppUrl(tab.url, appUrl)) ?? all.find((tab) => isId(tab.id) && isAppUrl(tab.pendingUrl, appUrl));
  return found && isId(found.id) ? toAppTab(found.id, found.windowId) : null;
}

/** Focuses `tab` and its window; false when the tab is gone (closed between lookup and focus). */
async function focusTab({ tabs, windows }: AppTabDeps, tab: AppTab): Promise<boolean> {
  try {
    await tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await windows.update(tab.windowId, { focused: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The toolbar-click handler: bring the existing app tab to the front (a discarded one reloads when it becomes active), otherwise
 * open a new one, so every click ends with exactly one focused app tab.
 *
 * Clicks are handled one at a time: a worker that was asleep can receive several before the first finished, and every one of
 * them would look for the app tab, find none and create its own. The click that comes next sees the tab the previous one made.
 */
export function createAppTabOpener(deps: AppTabDeps): () => Promise<AppTabResult> {
  let queue: Promise<unknown> = Promise.resolve();

  const openOrFocus = async (): Promise<AppTabResult> => {
    const existing = await findAppTab(deps);
    if (existing && (await focusTab(deps, existing))) return 'focused';
    await deps.tabs.create({ url: deps.appUrl });
    return 'created';
  };

  return () => {
    const result = queue.then(openOrFocus);
    // A failed click must not block the next one.
    queue = result.catch(() => undefined);
    return result;
  };
}
