import { EXPORT_FORMAT_IDS } from '@/lib/export/types';
import { DISCORD_APP_URL, DISCORD_TAB_URL_PATTERNS, LOCAL_KEYS, SESSION_KEYS } from '@/shared/constants';
import { DEFAULT_PREFS, type DiscordTabInfo, type Platform, type Prefs } from './types';

/**
 * Stored prefs are untrusted input (older versions, hand-edited storage, another build): every field is validated on
 * its own and falls back to its default, so a bad value never takes the other settings down with it.
 */
export function normalizePrefs(raw: unknown): Prefs {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { exportFormat, htmlTheme, locale } = source;
  return {
    exportFormat: EXPORT_FORMAT_IDS.find((id) => id === exportFormat) ?? DEFAULT_PREFS.exportFormat,
    htmlTheme: htmlTheme === 'dark' || htmlTheme === 'light' ? htmlTheme : DEFAULT_PREFS.htmlTheme,
    locale: locale === 'auto' || locale === 'ko' || locale === 'en' ? locale : DEFAULT_PREFS.locale,
  };
}

function asToken(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The real extension: token from `chrome.storage.session`, prefs in `chrome.storage.local`. `chrome` is read lazily on every call. */
export class ChromePlatform implements Platform {
  readonly kind = 'extension' as const;

  async getToken(): Promise<string | null> {
    const stored = await chrome.storage.session.get(SESSION_KEYS.token);
    return asToken(stored[SESSION_KEYS.token]);
  }

  onTokenChange(cb: (token: string | null) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
      if (areaName !== 'session') return;
      const change = changes[SESSION_KEYS.token];
      if (change) cb(asToken(change.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  async clearToken(expectedToken?: string): Promise<void> {
    // storage has no compare-and-delete, so this read-then-remove leaves a window of a few milliseconds: far smaller than
    // the seconds a 401 for an old token used to be able to wipe a newer capture.
    if (expectedToken !== undefined && (await this.getToken()) !== expectedToken) return;
    await chrome.storage.session.remove([SESSION_KEYS.token, SESSION_KEYS.tokenCapturedAt]);
  }

  async findDiscordTabs(): Promise<DiscordTabInfo[]> {
    const tabs = await chrome.tabs.query({ url: [...DISCORD_TAB_URL_PATTERNS] });
    const found: DiscordTabInfo[] = [];
    for (const tab of tabs) {
      if (typeof tab.id === 'number' && typeof tab.url === 'string') found.push({ id: tab.id, url: tab.url });
    }
    return found;
  }

  async reloadDiscordTabs(): Promise<number> {
    const tabs = await this.findDiscordTabs();
    const results = await Promise.allSettled(tabs.map((tab) => chrome.tabs.reload(tab.id)));
    return results.filter((result) => result.status === 'fulfilled').length;
  }

  async openDiscord(): Promise<void> {
    await chrome.tabs.create({ url: DISCORD_APP_URL });
  }

  async loadPrefs(): Promise<Prefs> {
    const stored = await chrome.storage.local.get(LOCAL_KEYS.prefs);
    return normalizePrefs(stored[LOCAL_KEYS.prefs]);
  }

  async savePrefs(prefs: Prefs): Promise<void> {
    await chrome.storage.local.set({ [LOCAL_KEYS.prefs]: normalizePrefs(prefs) });
  }
}
