import type { ReactElement } from 'react';
import { common, useStrings } from '@/app/i18n';
import { useActiveChannel, useGuildTree } from '@/app/state';
import type { DmNode } from '@/lib/discord/model';
import { ChevronRight } from '../common/Icons';
import { SafeImg } from '../message/SafeImg';
import { ChannelKindIcon } from './ChannelKindIcon';

const AVATAR_SIZE = 24;

function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first === undefined ? '?' : first.toUpperCase();
}

/** Round avatar of a DM; the picture URL comes from the model (built by cdn.ts), a broken one becomes the initial. */
function DmAvatar({ dm }: { dm: DmNode }): ReactElement {
  const fallback = (
    <span className="topbar__avatar topbar__avatar--fallback" aria-hidden="true">
      {initialOf(dm.name)}
    </span>
  );
  return <SafeImg className="topbar__avatar" src={dm.iconUrl} alt="" width={AVATAR_SIZE} height={AVATAR_SIZE} fallback={fallback} />;
}

/** Left side of the top bar: the open channel (or the app name), and the channel topic on one line. */
export function ChannelTitle(): ReactElement {
  const active = useActiveChannel();
  const c = useStrings(common);
  const tree = useGuildTree(active?.kind === 'guild' ? active.guild.id : null);

  if (active === null) {
    return (
      <div className="topbar__title">
        <span className="topbar__app-name">{c.appName}</span>
      </div>
    );
  }

  if (active.kind === 'dm') {
    return (
      <div className="topbar__title">
        <DmAvatar dm={active.dm} />
        <h1 className="topbar__name">{active.dm.name}</h1>
      </div>
    );
  }

  const { node } = active;
  const parent = node.kind === 'thread' && node.parentId !== null && tree !== null && Object.hasOwn(tree.byId, node.parentId) ? tree.byId[node.parentId] : undefined;
  const topic = node.topic?.trim() ?? '';

  return (
    <div className="topbar__title">
      {parent === undefined ? null : (
        <>
          <ChannelKindIcon kind={parent.kind} className="topbar__icon" />
          <span className="topbar__name topbar__name--parent">{parent.name}</span>
          <ChevronRight className="topbar__crumb-separator" />
        </>
      )}
      <ChannelKindIcon kind={node.kind} className="topbar__icon" />
      <h1 className="topbar__name">{node.name}</h1>
      {topic === '' ? null : (
        <>
          <span className="topbar__divider" aria-hidden="true" />
          <p className="topbar__topic" title={node.topic ?? undefined}>
            {topic}
          </p>
        </>
      )}
    </div>
  );
}
