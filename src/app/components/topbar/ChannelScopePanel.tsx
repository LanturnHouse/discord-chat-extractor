import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useEffectiveScope, useScopeOverride } from '@/app/state';
import type { ExportScope, ExportTarget } from '@/lib/export/types';
import { focusInitial } from './focus';
import { ScopeEditor } from './ScopeEditor';
import { useScopeEditing } from './scopeEditing';
import { topbarStrings } from './strings';

interface ChannelScopePanelProps {
  target: ExportTarget;
  /** Referenced by the gear's `aria-controls`. */
  id: string;
}

/**
 * The settings of ONE selected channel, unfolded under its row in the selection list: the same date range and message count
 * editor the export options use, there from the moment the panel opens.
 *
 * The editor always shows what the channel will be exported with: its own scope, or - while it has none - the common settings,
 * live. The first valid edit of any field gives the channel its own scope (the values on show with that one field changed);
 * from then on the channel keeps it, even when it happens to equal the common settings, until "Reset to common settings".
 * Input that cannot be exported yet never reaches the store: it lives in the top bar's scope drafts (see `scopeEditing`).
 *
 * The focus moves to the first field when the panel opens and again after a reset; the list closes the panel on Esc and puts
 * the focus back on the gear.
 */
export function ChannelScopePanel({ target, id }: ChannelScopePanelProps): ReactElement {
  const t = useStrings(topbarStrings);
  const { channelId, channelName } = target;
  const override = useScopeOverride(channelId);
  const scope = useEffectiveScope(channelId);
  const setChannelScope = useAppStore((state) => state.setChannelScope);
  const { channelDrafts, setChannelDraft } = useScopeEditing();
  const draft = Object.hasOwn(channelDrafts, channelId) ? channelDrafts[channelId] : null;
  const panelRef = useRef<HTMLDivElement>(null);
  // Counts the resets: the editor starts over each time (a half-typed date has no value React could put back) and the focus follows.
  const [resets, setResets] = useState(0);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    // The popover scrolls: bring a panel that opens near the bottom into view (jsdom has no layout and no such method).
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'nearest' });
    // The first field - or the one with the problem, when the Download button sent the user here.
    focusInitial(panel);
  }, [resets]);

  const onScopeChange = (next: ExportScope): void => setChannelScope(channelId, next);
  const reset = (): void => {
    setChannelDraft(channelId, null);
    setChannelScope(channelId, null);
    setResets((count) => count + 1);
  };

  return (
    <div ref={panelRef} id={id} role="group" aria-label={t.channelSettings(channelName)} tabIndex={-1} className="topbar-scope">
      <ScopeEditor
        key={resets}
        scope={scope}
        draft={draft}
        onDraftChange={(next) => setChannelDraft(channelId, next)}
        onScopeChange={onScopeChange}
        headingLevel={4}
        global={false}
      />
      {override === undefined && draft === null ? null : (
        <button type="button" className="topbar-scope__reset" onClick={reset}>
          {t.resetToCommon}
        </button>
      )}
    </div>
  );
}
