import type { ReactElement } from 'react';
import { getPlatform } from '@/app/platform';
import { common, useStrings } from '@/app/i18n';
import { useAppStore, useConnectedAs } from '@/app/state';
import { topbarStrings } from './strings';

/** Reloads this page without `?mock=1`, so the app boots with the real account (or asks for the login). */
function leaveDemo(): void {
  window.location.assign(window.location.pathname);
}

/**
 * Tiny static "Connected as X" line (an account sanity check, deliberately not a profile panel) plus a DEMO pill in demo mode.
 * Inside the extension the pill is the way out of the demo; the plain dev server has no live mode to go to.
 */
export function AccountLabel(): ReactElement | null {
  const name = useConnectedAs();
  const demo = useAppStore((state) => state.mode === 'demo');
  const c = useStrings(common);
  const t = useStrings(topbarStrings);
  if (name === null && !demo) return null;

  const text = name === null ? null : c.connectedAs(name);
  const canLeaveDemo = demo && getPlatform().kind === 'extension';
  return (
    <div className="topbar__account">
      {text === null ? null : (
        <span className="topbar__account-text" title={text}>
          {text}
        </span>
      )}
      {canLeaveDemo ? (
        <button type="button" className="topbar__demo topbar__demo--exit" onClick={leaveDemo}>
          {t.leaveDemo}
        </button>
      ) : demo ? (
        <span className="topbar__demo">{t.demoBadge}</span>
      ) : null}
    </div>
  );
}
