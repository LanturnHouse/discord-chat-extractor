/** The slice of `chrome.tabs` that opening/focusing the app needs. */
export interface TabsLike {
  query(queryInfo: { url: string }): Promise<Array<{ id?: number; url?: string; windowId?: number }>>;
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

/**
 * Without the `tabs` permission Chrome may scrub `tab.url` - even for our own pages - so `tabs.query({ url })` can come
 * back empty although the app is open. `runtime.getContexts` reports our own tab documents (with their URL) without any
 * permission, so it is asked first; `tabs.query` stays as the fallback for Chrome < 116.
 */
async function findAppTab({ appUrl, tabs, runtime }: AppTabDeps): Promise<AppTab | null> {
  if (runtime?.getContexts) {
    try {
      const contexts = await runtime.getContexts({ contextTypes: ['TAB'] });
      const hit = contexts.find((context) => isId(context.tabId) && isAppUrl(context.documentUrl, appUrl));
      if (hit && isId(hit.tabId)) return { id: hit.tabId, windowId: isId(hit.windowId) ? hit.windowId : undefined };
    } catch {
      // Fall through to the tabs API.
    }
  }
  const found = (await tabs.query({ url: `${appUrl}*` })).find((tab) => isId(tab.id) && isAppUrl(tab.url, appUrl));
  if (!found || !isId(found.id)) return null;
  return { id: found.id, windowId: isId(found.windowId) ? found.windowId : undefined };
}

/** Toolbar click: bring the existing app tab to the front, otherwise open a new one (never duplicates). */
export async function openOrFocusAppTab(deps: AppTabDeps): Promise<AppTabResult> {
  const existing = await findAppTab(deps);
  if (existing) {
    try {
      await deps.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) await deps.windows.update(existing.windowId, { focused: true });
      return 'focused';
    } catch {
      // The tab was closed between lookup and update: fall through and open a fresh one.
    }
  }
  await deps.tabs.create({ url: deps.appUrl });
  return 'created';
}
