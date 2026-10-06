import { useEffect, useRef, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useScopeOverride } from '@/app/state';
import type { ExportScope, ExportTarget } from '@/lib/export/types';
import { focusInitial } from './focus';
import { useNumberFormat } from './hooks';
import { ScopeEditor } from './ScopeEditor';
import { useScopeEditing } from './scopeEditing';
import { describeScope } from './scopeText';
import { topbarStrings } from './strings';

interface ChannelScopePanelProps {
  target: ExportTarget;
  /** Referenced by the gear's `aria-controls`. */
  id: string;
}

/**
 * The settings of ONE selected channel, unfolded under its row in the selection list: "Use common settings" (the default),
 * or - with that off - the same date range and message count editor the export options use, starting from the common values.
 * It moves the focus in when it opens; the list closes it on Esc and puts the focus back on the gear.
 */
export function ChannelScopePanel({ target, id }: ChannelScopePanelProps): ReactElement {
  const t = useStrings(topbarStrings);
  const fmt = useNumberFormat();
  const { channelId, channelName } = target;
  const override = useScopeOverride(channelId);
  const commonScope = useAppStore((state) => state.exportSettings);
  const setChannelScope = useAppStore((state) => state.setChannelScope);
  const { channelDrafts, setChannelDraft } = useScopeEditing();
  const draft = Object.hasOwn(channelDrafts, channelId) ? channelDrafts[channelId] : null;
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    // The popover scrolls: bring a panel that opens near the bottom into view (jsdom has no layout and no such method).
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'nearest' });
    focusInitial(panel);
  }, []);

  const useCommon = override === undefined;
  const followCommon = (): void => {
    setChannelDraft(channelId, null);
    setChannelScope(channelId, null);
  };
  const onScopeChange = (scope: ExportScope): void => setChannelScope(channelId, scope);

  return (
    <div ref={panelRef} id={id} role="group" aria-label={t.channelSettings(channelName)} tabIndex={-1} className="topbar-scope">
      <label className="topbar-scope__toggle">
        <input
          ref={toggleRef}
          type="checkbox"
          checked={useCommon}
          onChange={(event) => {
            // Turning it off starts from what the common settings say now, so the user edits from there.
            if (event.currentTarget.checked) followCommon();
            else setChannelScope(channelId, commonScope);
          }}
        />
        <span>{t.useCommonSettings}</span>
      </label>
      {override === undefined ? (
        <p className="topbar-options__help">{t.commonSettingsNow(describeScope(commonScope, t, fmt))}</p>
      ) : (
        <>
          <ScopeEditor
            scope={override}
            draft={draft}
            onDraftChange={(next) => setChannelDraft(channelId, next)}
            onScopeChange={onScopeChange}
            headingLevel={4}
            global={false}
          />
          <button
            type="button"
            className="topbar-scope__reset"
            onClick={() => {
              // The button goes away with the editor: the toggle takes over the focus.
              toggleRef.current?.focus();
              followCommon();
            }}
          >
            {t.resetToCommon}
          </button>
        </>
      )}
    </div>
  );
}
