import { normalizePrefs } from '@/app/platform/chrome';
import { DEFAULT_PREFS, type Platform } from '@/app/platform/types';
import type { DiscordClient } from '@/lib/discord/client';
import { buildDmNodes, toGuildNode } from '@/lib/discord/tree';
import type { GuildSummary, User } from '@/lib/discord/types';
import { readBrowserLanguage, resolveLocale } from '../i18n/core';
import { isAbortError, isAuthError, type Session, type StoreContext } from './context';
import { relocalizeFailures } from './failures';
import { enterNeedsToken, failBoot, handleAuthFailure, resetData } from './session';
import type { AppActions } from './types';

export type BootActions = Pick<AppActions, 'init' | 'retry' | 'initWithClient' | 'startDemoMode' | 'setPrefs'>;

/**
 * Boot sequence. Only metadata is fetched here: the server list and the DM list (two requests). Everything else
 * (channel trees, messages) is loaded on demand by the other slices.
 *
 *   demo : dynamic import of the demo world -> metadata -> ready
 *   live : token? no => needs-token (+ watch for a captured token) | yes => getMe() -> metadata -> ready
 */
export function createBootActions(ctx: StoreContext): BootActions {
  const { get, set, deps, runtime } = ctx;
  runtime.reconnect = connectLive;
  let bootPromise: Promise<void> | null = null;
  let tokenWatch: (() => void) | null = null;

  function requirePlatform(): Platform {
    const platform = get().platform;
    if (platform === null) throw new Error('The platform is not initialised: call init() first.');
    return platform;
  }

  /** Guilds + DMs in parallel; returns false when the session went stale meanwhile. */
  async function loadMetadata(client: DiscordClient, session: Session): Promise<boolean> {
    const [summaries, dmChannels] = await Promise.all([client.getGuilds(session.signal), client.getDmChannels(session.signal)]);
    if (!session.isCurrent()) return false;
    const guildSummaries: Record<string, GuildSummary> = {};
    for (const summary of summaries) guildSummaries[summary.id] = summary;
    set({ guilds: summaries.map(toGuildNode), guildSummaries, dms: buildDmNodes(dmChannels) });
    return true;
  }

  async function finishBoot(client: DiscordClient, me: User, mode: 'live' | 'demo', session: Session): Promise<void> {
    set({ client, me, mode });
    if (!(await loadMetadata(client, session))) return;
    set({ status: 'ready', tokenDetected: false, fatalError: null, fatalDetail: null });
  }

  async function connectDemo(): Promise<void> {
    const session = runtime.startSession();
    resetData(ctx);
    set({ mode: 'demo', status: 'booting', fatalError: null, fatalDetail: null });
    try {
      const { client, me } = await deps.loadDemo();
      if (!session.isCurrent()) return;
      await finishBoot(client, me, 'demo', session);
    } catch (error) {
      if (session.isCurrent() && !isAbortError(error)) failBoot(ctx, error);
    }
  }

  async function connectLive(): Promise<void> {
    const platform = requirePlatform();
    const session = runtime.startSession();
    resetData(ctx);
    // The onboarding screen stays up while a freshly captured token is being checked ("token detected").
    if (get().status !== 'needs-token') set({ status: 'booting', fatalError: null, fatalDetail: null });
    set({ mode: 'live' });

    let validated = false;
    let sessionToken: string | undefined;
    try {
      const token = await platform.getToken();
      if (!session.isCurrent()) return;
      if (token === null) {
        enterNeedsToken(ctx, 'no-token');
        // A token captured while we were reading storage would otherwise be missed until the next change.
        if ((await platform.getToken()) !== null && get().status === 'needs-token' && !get().tokenDetected) {
          set({ tokenDetected: true });
          await connectLive();
        }
        return;
      }
      sessionToken = token;

      const client = deps.createLiveClient({
        // The session keeps the token it was validated with. Following whatever is stored would let a second signed-in
        // account (or Discord flavour) take over the requests of this one while the lists on screen are still the first's.
        getToken: () => token,
        // While validating, a 401 is reported through getMe()'s rejection below ('invalid'); afterwards it means 'expired'.
        onAuthError: (rejectedToken: string) => {
          if (validated && session.isCurrent()) handleAuthFailure(ctx, 'expired', rejectedToken);
        },
      });
      const me = await client.getMe(session.signal);
      if (!session.isCurrent()) return;
      validated = true;
      await finishBoot(client, me, 'live', session);
    } catch (error) {
      if (!session.isCurrent() || isAbortError(error)) return;
      if (isAuthError(error)) handleAuthFailure(ctx, validated ? 'expired' : 'invalid', sessionToken);
      else failBoot(ctx, error);
    }
  }

  /**
   * Only the onboarding screen reacts to a captured token. A ready session keeps its own login: tokens of other tabs
   * (another account, another Discord flavour) must not re-verify, reload or flip it. A new login is picked up the normal
   * way, after the session's own token was rejected (see `handleAuthFailure`) or when the page is reloaded.
   */
  function watchTokens(platform: Platform): void {
    if (tokenWatch !== null) return;
    tokenWatch = platform.onTokenChange((token) => {
      if (token === null || get().mode !== 'live') return;
      const { status, tokenDetected } = get();
      if (status === 'needs-token' && !tokenDetected) {
        set({ tokenDetected: true });
        void connectLive();
      }
    });
  }

  function runBoot(): Promise<void> {
    if (deps.isMockRequested()) return connectDemo();
    watchTokens(requirePlatform());
    return connectLive();
  }

  async function boot(): Promise<void> {
    const platform = deps.getPlatform();
    let prefs = DEFAULT_PREFS;
    try {
      prefs = await platform.loadPrefs();
    } catch {
      // Preferences are a convenience; defaults keep the app usable.
    }
    set({ platform, prefs, locale: resolveLocale(prefs.locale, readBrowserLanguage()) });
    await runBoot();
  }

  return {
    init() {
      bootPromise ??= boot().catch((error: unknown) => failBoot(ctx, error));
      return bootPromise;
    },

    async retry() {
      if (get().status !== 'fatal') return;
      set({ status: 'booting', fatalError: null, fatalDetail: null });
      try {
        await runBoot();
      } catch (error) {
        failBoot(ctx, error);
      }
    },

    async initWithClient(client, me) {
      const session = runtime.startSession();
      resetData(ctx);
      set({ platform: get().platform ?? deps.getPlatform(), status: 'booting', fatalError: null, fatalDetail: null });
      try {
        await finishBoot(client, me, client.kind === 'mock' ? 'demo' : 'live', session);
      } catch (error) {
        if (session.isCurrent() && !isAbortError(error)) failBoot(ctx, error);
      }
    },

    startDemoMode() {
      deps.navigateToDemo();
    },

    setPrefs(partial) {
      const current = get().prefs;
      const defined = Object.fromEntries(Object.entries(partial).filter(([, value]) => value !== undefined));
      const next = normalizePrefs({ ...current, ...defined });
      if (next.exportFormat === current.exportFormat && next.htmlTheme === current.htmlTheme && next.locale === current.locale) return;
      const locale = resolveLocale(next.locale, readBrowserLanguage());
      // The errors on screen are sentences in the old language: they say themselves again in the new one.
      set((state) => ({ prefs: next, locale, ...(locale === state.locale ? {} : relocalizeFailures(state, locale)) }));
      const platform = get().platform ?? deps.getPlatform();
      void platform.savePrefs(next).catch(() => undefined);
    },
  };
}
