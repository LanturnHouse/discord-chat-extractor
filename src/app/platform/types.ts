import type { ExportFormatId } from '@/lib/export/types';

/** Small, non-sensitive user preferences persisted in `chrome.storage.local` (localStorage in dev mode). */
export interface Prefs {
  exportFormat: ExportFormatId;
  htmlTheme: 'dark' | 'light';
  /** UI + export language. 'auto' => navigator.language (ko* => ko, other languages => en, nothing known => ko). */
  locale: 'auto' | 'ko' | 'en';
}

export const DEFAULT_PREFS: Prefs = { exportFormat: 'html', htmlTheme: 'dark', locale: 'auto' };

export interface DiscordTabInfo {
  id: number;
  url: string;
}

/**
 * Everything the web app needs from the browser/extension environment.
 * - `ChromePlatform`  : real extension (chrome.storage / chrome.tabs).
 * - `DevPlatform`     : plain browser (`npm run dev`, demo mode) — no token, prefs in localStorage, tab ops are no-ops.
 */
export interface Platform {
  readonly kind: 'extension' | 'dev';

  /** Authorization token captured by the background worker. null if none yet. */
  getToken(): Promise<string | null>;
  /** Fires when the stored token changes (new capture or cleared). Returns an unsubscribe fn. */
  onTokenChange(cb: (token: string | null) => void): () => void;
  /**
   * Forget the stored token (after a 401). With `expectedToken` the stored value is removed ONLY if it still equals it:
   * a 401 for an old token must not wipe a newer, valid token that was captured in the meantime.
   */
  clearToken(expectedToken?: string): Promise<void>;

  findDiscordTabs(): Promise<DiscordTabInfo[]>;
  /** Reload all open Discord tabs so Discord re-sends API requests (and a token can be captured). Returns count reloaded. */
  reloadDiscordTabs(): Promise<number>;
  /** Open https://discord.com/app in a new tab. */
  openDiscord(): Promise<void>;

  loadPrefs(): Promise<Prefs>;
  savePrefs(prefs: Prefs): Promise<void>;
}
