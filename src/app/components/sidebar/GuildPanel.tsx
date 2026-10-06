import { useEffect, type ReactElement } from 'react';
import { common, useStrings } from '@/app/i18n';
import { useAppStore, useGuildCheck, useGuildTreeEntry } from '@/app/state';
import type { Snowflake } from '@/lib/discord/types';
import { Button } from '../common/Button';
import { Checkbox } from '../common/Checkbox';
import { Warning } from '../common/Icons';
import { Spinner } from '../common/Spinner';
import { ChannelTree } from './ChannelTree';
import { handleRowKeys } from './listNav';
import { sidebarStrings } from './strings';
import { TreeSkeleton } from './TreeSkeleton';

/**
 * The sidebar of an open server: header with the "select the whole server" checkbox, then the channel tree (skeleton while it
 * loads, a retry message when it failed). Rendered with `key={guildId}`, so every server starts with a fresh scroll position.
 */
export function GuildPanel({ guildId }: { guildId: Snowflake }): ReactElement | null {
  const t = useStrings(sidebarStrings);
  const c = useStrings(common);
  const guild = useAppStore((state) => state.guilds.find((candidate) => candidate.id === guildId));
  const entry = useGuildTreeEntry(guildId);
  const check = useGuildCheck(guildId);
  const ensureGuildTree = useAppStore((state) => state.ensureGuildTree);
  const toggleGuild = useAppStore((state) => state.toggleGuild);

  // openGuild / openChannel start the load themselves; this covers an entry that was dropped (a cancelled load) while the server is open.
  useEffect(() => {
    if (entry.status === 'idle') void ensureGuildTree(guildId);
  }, [entry.status, ensureGuildTree, guildId]);

  if (guild === undefined) return null;
  const loading = entry.status === 'loading';

  return (
    <>
      <div className="sb-guild-header">
        <h2 className="sb-guild-header__name" title={guild.name}>
          {guild.name}
        </h2>
        <span className="sb-guild-header__check" title={t.selectServer}>
          {loading ? (
            <span className="sb-guild-header__spinner" aria-hidden="true">
              <Spinner size={12} />
            </span>
          ) : null}
          <Checkbox
            state={check}
            ariaLabel={t.selectServer}
            // Waiting for the tree: a second click would undo the first one before it was applied. `busy`, not `disabled`:
            // a focused control that turns disabled loses the keyboard focus.
            busy={loading}
            onChange={() => void toggleGuild(guildId)}
          />
        </span>
      </div>

      <div
        className="sb-scroll"
        role="group"
        aria-label={t.channelsLabel}
        // Focusable by script only: the target of the "skip to channel list" link.
        tabIndex={-1}
        data-skip-target="channels"
        onKeyDown={handleRowKeys}
      >
        {entry.status === 'loaded' && entry.tree !== null ? (
          <ChannelTree guildId={guildId} tree={entry.tree} />
        ) : entry.status === 'error' ? (
          <div className="sb-error" role="alert">
            <Warning className="sb-error__icon" />
            <p className="sb-error__message">{entry.error ?? c.errorUnknown}</p>
            <Button variant="secondary" size="sm" onClick={() => void ensureGuildTree(guildId)}>
              {c.retry}
            </Button>
          </div>
        ) : (
          <TreeSkeleton />
        )}
      </div>
    </>
  );
}
