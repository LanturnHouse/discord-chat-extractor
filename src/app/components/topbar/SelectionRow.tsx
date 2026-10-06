import { useId, type MouseEvent, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { scopeIssue, useScopeOverride } from '@/app/state';
import type { Snowflake } from '@/lib/discord/types';
import type { ExportTarget } from '@/lib/export/types';
import { ChevronRight, Close } from '../common/Icons';
import { ChannelKindIcon } from './ChannelKindIcon';
import { ChannelScopePanel } from './ChannelScopePanel';
import { GearIcon } from './GearIcon';
import { useNumberFormat } from './hooks';
import { useScopeEditing } from './scopeEditing';
import { describeScope } from './scopeText';
import { topbarStrings } from './strings';

interface SelectionRowProps {
  target: ExportTarget;
  /** The settings panel of this row is unfolded. */
  open: boolean;
  onToggle: (channelId: Snowflake) => void;
  /** The list needs the gear back when it closes the panel with Esc. */
  registerGear: (channelId: Snowflake, element: HTMLButtonElement | null) => void;
  onRemove: (event: MouseEvent<HTMLButtonElement>, channelId: Snowflake) => void;
}

/**
 * One selected chat: its kind icon and name, the gear (own export settings) and the x (remove). A chat with settings of its
 * own says them under its name and has a lit gear; one that follows the common settings (it has none of its own) says nothing.
 * A chat whose settings cannot be exported yet says so, in red - with or without settings of its own.
 */
export function SelectionRow({ target, open, onToggle, registerGear, onRemove }: SelectionRowProps): ReactElement {
  const t = useStrings(topbarStrings);
  const fmt = useNumberFormat();
  const { channelId, channelName } = target;
  const override = useScopeOverride(channelId);
  const { channelDrafts } = useScopeEditing();
  const panelId = useId();
  const summaryId = useId();

  const invalid = Object.hasOwn(channelDrafts, channelId) || (override !== undefined && scopeIssue(override) !== null);
  const summary = invalid ? t.settingsNeedAttention : override === undefined ? null : describeScope(override, t, fmt);

  return (
    <li className="topbar-sel__row">
      <div className="topbar-sel__line">
        <ChannelKindIcon kind={target.kind} className="topbar-sel__icon" />
        <span className="topbar-sel__name" title={channelName}>
          {target.kind === 'thread' && target.parentChannelName !== null ? (
            <>
              <span className="topbar-sel__parent">{target.parentChannelName}</span>
              <ChevronRight className="topbar-sel__separator" />
            </>
          ) : null}
          {channelName}
        </span>
        <button
          ref={(element) => registerGear(channelId, element)}
          type="button"
          className="topbar-sel__gear"
          aria-label={t.channelSettings(channelName)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-describedby={summary === null ? undefined : summaryId}
          data-active={override !== undefined && !invalid ? '' : undefined}
          data-invalid={invalid ? '' : undefined}
          onClick={() => onToggle(channelId)}
        >
          <GearIcon />
        </button>
        <button
          type="button"
          className="topbar-sel__remove"
          aria-label={t.removeFromSelection(channelName)}
          onClick={(event) => onRemove(event, channelId)}
        >
          <Close />
        </button>
      </div>
      {summary === null ? null : (
        <p id={summaryId} className="topbar-sel__scope" data-invalid={invalid ? '' : undefined}>
          {summary}
        </p>
      )}
      {open ? <ChannelScopePanel target={target} id={panelId} /> : null}
    </li>
  );
}
