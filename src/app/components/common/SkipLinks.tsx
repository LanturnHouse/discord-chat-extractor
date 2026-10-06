import type { MouseEvent, ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { skipStrings } from './skipStrings';

/**
 * Where each link lands: the first selector that matches wins, so the messages link still works while no channel is open.
 * The channel list and the message log carry `data-skip-target`; the Download button belongs to the top bar, which does not
 * (yet), so its class is the fallback (the app test suite renders the real shell and would notice a rename).
 */
const TARGETS = {
  channels: ['[data-skip-target="channels"]'],
  messages: ['[data-skip-target="messages"]', '[data-skip-target="chat"]'],
  export: ['[data-skip-target="export"]', '.app-topbar .topbar__split-main'],
} as const;

type TargetKey = keyof typeof TARGETS;

function focusTarget(key: TargetKey): void {
  for (const selector of TARGETS[key]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element !== null) {
      element.focus();
      return;
    }
  }
}

/**
 * Three links, invisible until they take the keyboard focus, as the very first tab stops of the app: the rail and the list of
 * conversations are hundreds of stops long, and the messages and the Download button come after them in the page order.
 */
export function SkipLinks(): ReactElement {
  const t = useStrings(skipStrings);
  const link = (key: TargetKey, label: string): ReactElement => (
    <a
      className="skip-link"
      href={`#skip-${key}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        // The targets are focused directly: a fragment navigation would change the address of the extension page.
        event.preventDefault();
        focusTarget(key);
      }}
    >
      {label}
    </a>
  );
  return (
    <div className="skip-links">
      {link('channels', t.toChannels)}
      {link('messages', t.toMessages)}
      {link('export', t.toExport)}
    </div>
  );
}
