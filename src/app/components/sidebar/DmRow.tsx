import { memo, useRef, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useChannelCheck, useIsForbidden } from '@/app/state';
import type { DmNode } from '@/lib/discord/model';
import type { Snowflake } from '@/lib/discord/types';
import { safeMediaUrl } from '@/lib/markdown';
import { initialOf } from '@/lib/message';
import { Checkbox } from '../common/Checkbox';
import { Lock } from '../common/Icons';
import { SafeImg } from '../message/SafeImg';
import { rowTitle } from './rowTitle';
import { sidebarStrings } from './strings';

const AVATAR_SIZE = 32;
const CHECKBOX_SIZE = 18;

export interface DmRowProps {
  dm: DmNode;
  /** Passed down (not read from the store here) so a list of hundreds of rows subscribes to far fewer things. */
  onOpen: (dmId: Snowflake) => void;
  onToggle: (dmId: Snowflake) => void;
}

/** One conversation: avatar, name (+ member count for groups) and the export checkbox on the right. */
export const DmRow = memo(function DmRow({ dm, onOpen, onToggle }: DmRowProps): ReactElement {
  const t = useStrings(sidebarStrings);
  const active = useAppStore((state) => state.activeChannelId === dm.id);
  const check = useChannelCheck(dm.id);
  const forbidden = useIsForbidden(dm.id);
  const main = useRef<HTMLButtonElement>(null);
  // Discord counts yourself among the members; `recipients` leaves you out.
  const members = dm.kind === 'group-dm' ? dm.recipients.length + 1 : null;

  const classes = ['sb-row', 'sb-dm', 'dce-reveal-host'];
  if (active) classes.push('sb-row--active');
  if (forbidden) classes.push('sb-row--locked');

  const fallback = (
    <span className="sb-dm__fallback" aria-hidden="true">
      {initialOf(dm.name)}
    </span>
  );

  return (
    <li className={classes.join(' ')} data-sb-row="">
      <button
        ref={main}
        type="button"
        className="sb-row__main sb-dm__main"
        data-sb-nav=""
        aria-current={active ? 'page' : undefined}
        title={rowTitle(dm.name, forbidden ? t.noAccess : null)}
        onClick={() => onOpen(dm.id)}
      >
        <span className="sb-dm__avatar">
          <SafeImg className="sb-dm__img" src={safeMediaUrl(dm.iconUrl)} alt="" width={AVATAR_SIZE} height={AVATAR_SIZE} fallback={fallback} />
        </span>
        <span className="sb-dm__text">
          <span className="sb-dm__name">{dm.name}</span>
          {members === null ? null : <span className="sb-dm__sub">{t.groupMembers(members)}</span>}
        </span>
      </button>
      {forbidden ? (
        <Lock className="sb-row__lock" />
      ) : (
        <Checkbox
          className="sb-row__check"
          size={CHECKBOX_SIZE}
          state={check}
          ariaLabel={t.selectForExport(dm.name)}
          revealOnHover
          // A 403 on this conversation takes the box away: the focus stays in the row.
          focusOnRemove={main}
          onChange={() => onToggle(dm.id)}
        />
      )}
    </li>
  );
});
