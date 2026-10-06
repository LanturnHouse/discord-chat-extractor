import { DISCORD_APP_URL, LOCAL_KEYS } from '@/shared/constants';
import { normalizePrefs } from './chrome';
import type { DiscordTabInfo, Platform, Prefs } from './types';

/** Plain browser (`npm run dev`, demo mode): there is no extension, so no token and no tabs to manage. */
export class DevPlatform implements Platform {
  readonly kind = 'dev' as const;

  async getToken(): Promise<string | null> {
    return null;
  }

  onTokenChange(_callback: (token: string | null) => void): () => void {
    return () => {};
  }

  async clearToken(_expectedToken?: string): Promise<void> {}

  async findDiscordTabs(): Promise<DiscordTabInfo[]> {
    return [];
  }

  async reloadDiscordTabs(): Promise<number> {
    return 0;
  }

  async openDiscord(): Promise<void> {
    if (typeof window !== 'undefined') window.open(DISCORD_APP_URL, '_blank', 'noopener');
  }

  // localStorage can throw (blocked storage, private mode, quota) or hold garbage: prefs are a convenience, never a failure.
  async loadPrefs(): Promise<Prefs> {
    try {
      const raw = localStorage.getItem(LOCAL_KEYS.prefs);
      return normalizePrefs(raw === null ? null : JSON.parse(raw));
    } catch {
      return normalizePrefs(null);
    }
  }

  async savePrefs(prefs: Prefs): Promise<void> {
    try {
      localStorage.setItem(LOCAL_KEYS.prefs, JSON.stringify(normalizePrefs(prefs)));
    } catch {
      // Not persisted this session; the UI keeps working with the in-memory value.
    }
  }
}
