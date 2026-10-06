import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { Platform } from '@/app/platform/types';
import { common, useStrings } from '../i18n';
import { onboardingStrings } from '../i18n/onboarding';
import { useAppStore } from '../state/store';
import { Button } from './common/Button';
import { ChatBubble, Info, Warning } from './common/Icons';
import { Spinner } from './common/Spinner';
import './Onboarding.css';

/** How often the number of open Discord tabs is re-read while the page is visible. */
const TAB_POLL_MS = 3000;

/**
 * Number of open Discord tabs (null until known). Re-read on mount, when the window gains focus or becomes visible, and
 * every few seconds while visible, so the screen follows the user opening / closing Discord.
 */
function useDiscordTabCount(platform: Platform | null): { count: number | null; refresh: () => Promise<void> } {
  const [count, setCount] = useState<number | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (platform === null) return undefined;
    let cancelled = false;
    let inFlight = false;

    const refresh = async (): Promise<void> => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const tabs = await platform.findDiscordTabs();
        if (!cancelled) setCount(tabs.length);
      } catch {
        // Not being able to list tabs is treated like "none": the screen then offers to open Discord.
        if (!cancelled) setCount((previous) => previous ?? 0);
      } finally {
        inFlight = false;
      }
    };
    refreshRef.current = refresh;

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const timer = setInterval(() => void refresh(), TAB_POLL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [platform]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { count, refresh };
}

type Note = { kind: 'reloaded'; count: number } | { kind: 'reload-failed' } | { kind: 'open-failed' };

/** Shown while the app has no usable Discord login: explains what happens and helps the user get one. */
export function Onboarding(): ReactElement {
  const t = useStrings(onboardingStrings);
  const c = useStrings(common);
  const platform = useAppStore((state) => state.platform);
  const reason = useAppStore((state) => state.needsTokenReason);
  const tokenDetected = useAppStore((state) => state.tokenDetected);
  const startDemoMode = useAppStore((state) => state.startDemoMode);
  const { count, refresh } = useDiscordTabCount(platform);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const openDiscord = async (): Promise<void> => {
    if (platform === null) return;
    setBusy(true);
    setNote(null);
    try {
      await platform.openDiscord();
    } catch {
      setNote({ kind: 'open-failed' });
    } finally {
      setBusy(false);
    }
  };

  const reloadTabs = async (): Promise<void> => {
    if (platform === null) return;
    setBusy(true);
    setNote(null);
    try {
      setNote({ kind: 'reloaded', count: await platform.reloadDiscordTabs() });
    } catch {
      setNote({ kind: 'reload-failed' });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const reasonText = reason === 'expired' ? t.reasonExpired : reason === 'invalid' ? t.reasonInvalid : t.reasonNoToken;
  const noteText =
    note === null ? null : note.kind === 'reloaded' ? t.reloadedTabs(note.count) : note.kind === 'reload-failed' ? t.reloadFailed : t.openFailed;

  return (
    <main className="app-center onboarding">
      <section className="onboarding__card" aria-labelledby="onboarding-title">
        <header className="onboarding__header">
          <div className="onboarding__logo" aria-hidden="true">
            <ChatBubble />
          </div>
          <div>
            <p className="onboarding__app">{c.appName}</p>
            <h1 id="onboarding-title" className="onboarding__title">
              {t.title}
            </h1>
            <p className="onboarding__subtitle">{t.subtitle}</p>
          </div>
        </header>

        {tokenDetected ? (
          <p className="onboarding__detected" role="status">
            <Spinner size={18} />
            {t.tokenDetected}
          </p>
        ) : (
          <>
            <p className="onboarding__reason" data-reason={reason} role="status">
              {reason === 'no-token' ? <Info /> : <Warning />}
              {reasonText}
            </p>

            <ol className="onboarding__steps" aria-label={t.stepsLabel}>
              <li>
                <strong>{t.step1Title}</strong>
                <span>{t.step1Body}</span>
              </li>
              <li>
                <strong>{t.step2Title}</strong>
                <span>{t.step2Body}</span>
              </li>
              <li>
                <strong>{t.step3Title}</strong>
                <span>{t.step3Body}</span>
              </li>
            </ol>

            <div className="onboarding__tabs" aria-live="polite">
              {count === null ? t.tabsChecking : count === 0 ? t.tabsNone : t.tabsCount(count)}
            </div>

            {count === null ? null : (
              <div className="onboarding__actions">
                {count === 0 ? (
                  <Button onClick={() => void openDiscord()} disabled={busy}>
                    {t.openDiscord}
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => void reloadTabs()} disabled={busy}>
                      {t.reloadTabs}
                    </Button>
                    <p className="onboarding__hint">{t.reloadHint}</p>
                  </>
                )}
                {noteText === null ? null : (
                  <p className="onboarding__note" role="status">
                    {noteText}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className="onboarding__demo">
          <Button variant="secondary" onClick={() => startDemoMode()}>
            {t.tryDemo}
          </Button>
          <p className="onboarding__hint">{t.demoHint}</p>
        </div>

        <p className="onboarding__notice">{t.notice}</p>
      </section>
    </main>
  );
}
