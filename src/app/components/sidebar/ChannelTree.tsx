import { useMemo, type ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { useAppStore } from '@/app/state';
import type { GuildTree } from '@/lib/discord/model';
import type { Snowflake } from '@/lib/discord/types';
import { CategoryRow } from './CategoryRow';
import { ChannelRow } from './ChannelRow';
import { sidebarStrings } from './strings';
import { buildTreeRows } from './treeRows';

export interface ChannelTreeProps {
  guildId: Snowflake;
  tree: GuildTree;
}

/** The loaded channel list: uncategorized channels first, then every category with its channels (see `buildTreeRows`). */
export function ChannelTree({ guildId, tree }: ChannelTreeProps): ReactElement {
  const t = useStrings(sidebarStrings);
  const collapsed = useAppStore((state) => state.collapsedCategories);
  const activeId = useAppStore((state) => state.activeChannelId);
  const rows = useMemo(() => buildTreeRows(tree, collapsed, activeId), [tree, collapsed, activeId]);

  if (rows.length === 0) return <p className="sb-empty">{t.noChannels}</p>;
  return (
    <ul className="sb-list">
      {rows.map((row) =>
        row.kind === 'category' ? (
          <CategoryRow key={`category:${row.category.id}`} guildId={guildId} category={row.category} collapsed={row.collapsed} selectable={row.selectable} />
        ) : (
          <ChannelRow key={`channel:${row.node.id}`} guildId={guildId} node={row.node} depth={row.depth} expanded={row.expanded} />
        ),
      )}
    </ul>
  );
}
