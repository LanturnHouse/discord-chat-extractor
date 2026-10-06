import { memo, type ReactElement } from 'react';
import { common, useStrings } from '@/app/i18n';
import { selectGuildTreeEntry, useAppStore, useGuildCheck, useSelectionCountForGuild } from '@/app/state';
import type { GuildNode } from '@/lib/discord/model';
import { safeMediaUrl } from '@/lib/markdown';
import { acronymOf, glyphsOf } from '@/lib/message';
import { Checkbox } from '../common/Checkbox';
import { Spinner } from '../common/Spinner';
import { SafeImg } from '../message/SafeImg';
import { RailItem } from './RailItem';
import { SelectionBadge } from './SelectionBadge';
import { railStrings } from './strings';
import type { TooltipControls } from './useRailTooltip';

const ICON_SIZE = 48;
const CHECKBOX_SIZE = 18;

export interface GuildButtonProps {
  guild: GuildNode;
  active: boolean;
  tooltip: TooltipControls;
}

/** One server in the rail: icon (or acronym), corner checkbox "select the whole server" and the selected-channels badge. */
export const GuildButton = memo(function GuildButton({ guild, active, tooltip }: GuildButtonProps): ReactElement {
  const t = useStrings(railStrings);
  const c = useStrings(common);
  const openGuild = useAppStore((state) => state.openGuild);
  const toggleGuild = useAppStore((state) => state.toggleGuild);
  const check = useGuildCheck(guild.id);
  const selectedCount = useSelectionCountForGuild(guild.id);
  // Two primitives instead of the entry object: it is replaced on every load, the rail item only cares about these.
  const status = useAppStore((state) => selectGuildTreeEntry(state, guild.id).status);
  const error = useAppStore((state) => selectGuildTreeEntry(state, guild.id).error);
  const loading = status === 'loading';
  // Ticking a server loads its channel list first; when that failed nothing was selected, and this is the only place to say so.
  const failure = status === 'error' ? (error ?? c.errorUnknown) : null;
  const checkLabel = failure === null ? t.selectGuild(guild.name) : t.selectGuildRetry(guild.name, failure);

  const acronym = acronymOf(guild.name);
  const fallback = (
    <span className="rail__acronym" data-glyphs={glyphsOf(acronym).length} aria-hidden="true">
      {acronym}
    </span>
  );

  return (
    <RailItem label={guild.name} active={active} tooltip={tooltip}>
      <button type="button" className="rail__icon" aria-label={guild.name} aria-current={active ? 'true' : undefined} onClick={() => void openGuild(guild.id)}>
        <SafeImg className="rail__img" src={safeMediaUrl(guild.iconUrl)} alt="" width={ICON_SIZE} height={ICON_SIZE} fallback={fallback} />
      </button>
      {loading ? (
        <span className="rail__check-spinner" aria-hidden="true">
          <Spinner size={10} />
        </span>
      ) : null}
      <Checkbox
        className="rail__check"
        size={CHECKBOX_SIZE}
        state={check}
        ariaLabel={checkLabel}
        title={failure === null ? undefined : checkLabel}
        // The tree is being fetched: a second click would toggle the selection back before the first one was applied.
        // `busy`, not `disabled`: a focused control that turns disabled loses the keyboard focus.
        busy={loading}
        invalid={failure !== null}
        revealOnHover={!loading && failure === null}
        // Also the retry: after a failure `toggleGuild` loads the channel list again before it selects anything.
        onChange={() => void toggleGuild(guild.id)}
      />
      {/* The open server shows the same message (with its own retry button) in the sidebar. */}
      {failure !== null && !active ? (
        <span className="visually-hidden" role="alert">
          {t.guildLoadFailed(guild.name, failure)}
        </span>
      ) : null}
      <SelectionBadge count={selectedCount} />
    </RailItem>
  );
});
