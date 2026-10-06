import { memo, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore, useChannelCheck, useIsForbidden } from '@/app/state';
import type { ChannelKind, ChannelNode } from '@/lib/discord/model';
import { isExportable } from '@/lib/discord/tree';
import type { Snowflake } from '@/lib/discord/types';
import { Checkbox } from '../common/Checkbox';
import { ChevronDown, Forum, Hash, HashLocked, Lock, Megaphone, Speaker, SpeakerLocked, Stage, Thread } from '../common/Icons';
import { rowTitle } from './rowTitle';
import { sidebarStrings } from './strings';
import { isContainer } from './treeRows';

const CHECKBOX_SIZE = 18;

/** Kinds whose icon has a locked variant of its own; every other locked row gets a small padlock after the name instead. */
const HAS_LOCKED_ICON: ReadonlySet<ChannelKind> = new Set<ChannelKind>(['text', 'voice', 'other']);

function ChannelIcon({ kind, locked }: { kind: ChannelKind; locked: boolean }): ReactElement {
  switch (kind) {
    case 'voice':
      return locked ? <SpeakerLocked className="sb-channel__icon" /> : <Speaker className="sb-channel__icon" />;
    case 'announcement':
      return <Megaphone className="sb-channel__icon" />;
    case 'stage':
      return <Stage className="sb-channel__icon" />;
    case 'forum':
    case 'media':
      return <Forum className="sb-channel__icon" />;
    case 'thread':
      return <Thread className="sb-channel__icon" />;
    default:
      return locked ? <HashLocked className="sb-channel__icon" /> : <Hash className="sb-channel__icon" />;
  }
}

export interface ChannelRowProps {
  node: ChannelNode;
  guildId: Snowflake;
  /** 1 = a thread / forum post under its parent channel (indented, thread icon). */
  depth: 0 | 1;
  /** Forum / media containers: whether their post list is unfolded; null for every other row. */
  expanded: boolean | null;
}

/**
 * One channel, thread or forum post. Click opens it (forum / media containers fold their post list instead, as they have no
 * messages); the checkbox on the right selects it for export. A channel the user cannot read stays clickable, so the main
 * pane can explain why it is empty, but is dimmed and has no checkbox.
 */
export const ChannelRow = memo(function ChannelRow({ node, guildId, depth, expanded }: ChannelRowProps): ReactElement {
  const t = useStrings(sidebarStrings);
  const openChannel = useAppStore((state) => state.openChannel);
  const toggleChannel = useAppStore((state) => state.toggleChannel);
  const toggleCollapsed = useAppStore((state) => state.toggleCategoryCollapsed);
  const active = useAppStore((state) => state.activeChannelId === node.id);
  const check = useChannelCheck(node.id);
  const forbidden = useIsForbidden(node.id);

  const container = isContainer(node);
  const locked = node.canView === false || forbidden;
  const selectable = !container && !forbidden && isExportable(node);

  const classes = ['sb-row', 'sb-channel', 'dce-reveal-host'];
  if (depth === 1) classes.push('sb-channel--thread');
  if (active) classes.push('sb-row--active');
  if (locked) classes.push('sb-channel--locked');
  if (container && expanded === false) classes.push('sb-channel--folded');

  return (
    <li className={classes.join(' ')} data-sb-row="">
      <button
        type="button"
        className="sb-row__main sb-channel__main"
        data-sb-nav=""
        aria-current={active ? 'page' : undefined}
        aria-expanded={container ? expanded === true : undefined}
        title={rowTitle(node.name, locked ? t.noAccess : null)}
        onClick={() => {
          if (container) toggleCollapsed(node.id);
          else void openChannel(node.id, guildId);
        }}
      >
        <ChannelIcon kind={node.kind} locked={locked} />
        <span className="sb-channel__name">{node.name}</span>
        {locked && !HAS_LOCKED_ICON.has(node.kind) ? <Lock className="sb-channel__lock" /> : null}
      </button>
      {container ? <ChevronDown className="sb-channel__chevron" /> : null}
      {selectable ? (
        <Checkbox
          className="sb-row__check"
          size={CHECKBOX_SIZE}
          state={check}
          ariaLabel={t.selectForExport(node.name)}
          revealOnHover
          onChange={() => toggleChannel(node.id)}
        />
      ) : null}
    </li>
  );
});
