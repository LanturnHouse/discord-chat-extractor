import { memo, useMemo, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useSelectedTargets } from '@/app/state';
import { ChatBubble } from '../common/Icons';
import { RailItem } from './RailItem';
import { SelectionBadge } from './SelectionBadge';
import { railStrings } from './strings';
import type { TooltipControls } from './useRailTooltip';

export interface DmButtonProps {
  active: boolean;
  tooltip: TooltipControls;
}

/** The "Direct Messages" entry at the top of the rail (our own speech-bubble glyph) with the number of selected DMs. */
export const DmButton = memo(function DmButton({ active, tooltip }: DmButtonProps): ReactElement {
  const t = useStrings(railStrings);
  const openDms = useAppStore((state) => state.openDms);
  const targets = useSelectedTargets();
  const selectedCount = useMemo(() => targets.filter((target) => target.guildId === null).length, [targets]);

  return (
    <RailItem label={t.directMessages} active={active} tooltip={tooltip}>
      <button
        type="button"
        className="rail__icon rail__icon--home"
        aria-label={t.directMessages}
        aria-current={active ? 'true' : undefined}
        onClick={() => openDms()}
      >
        <ChatBubble className="rail__home-glyph" />
      </button>
      <SelectionBadge count={selectedCount} />
    </RailItem>
  );
});
