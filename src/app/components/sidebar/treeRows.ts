import type { CategoryNode, ChannelNode, GuildTree } from '@/lib/discord/model';
import { isExportable } from '@/lib/discord/tree';
import type { Snowflake } from '@/lib/discord/types';

export type TreeRow =
  | {
      kind: 'category';
      category: CategoryNode;
      collapsed: boolean;
      /** At least one channel / post below it can be ticked: otherwise its checkbox would do nothing and is left out. */
      selectable: boolean;
    }
  | {
      kind: 'channel';
      node: ChannelNode;
      /** 1 = a thread / forum post shown below its parent channel. */
      depth: 0 | 1;
      /** Forum / media containers only: whether their post list is unfolded. */
      expanded: boolean | null;
    };

export function isContainer(node: ChannelNode): boolean {
  return node.kind === 'forum' || node.kind === 'media';
}

/**
 * The visible rows of a server in Discord's order: channels without a category, then every category followed by its channels,
 * each channel followed by its threads / forum posts.
 *
 * A folded category hides all of its channels except the open one (the user must not lose sight of where they are); the parent
 * of an open thread / post stays as its context. What is ticked for export is NOT kept visible: the category's tri-state box
 * and the badge on the rail already show it, and a fold that cannot fold would contradict `aria-expanded`. A channel that is
 * shown brings its threads along, except forum / media posts, which are listed only while the forum is unfolded and its
 * category is not folded (the open post always stays). `collapsed` holds the ids of folded categories and forums.
 */
export function buildTreeRows(tree: GuildTree, collapsed: Readonly<Record<Snowflake, true>>, activeId: Snowflake | null): TreeRow[] {
  const rows: TreeRow[] = [];

  const pushChannel = (channel: ChannelNode, categoryFolded: boolean): void => {
    const threads = tree.threadsByParent[channel.id] ?? [];
    const container = isContainer(channel);
    const postsFolded = container && collapsed[channel.id] === true;
    const openThreads = threads.filter((thread) => thread.id === activeId);
    if (categoryFolded && channel.id !== activeId && openThreads.length === 0) return;
    const shownThreads = container && (categoryFolded || postsFolded) ? openThreads : threads;

    rows.push({ kind: 'channel', node: channel, depth: 0, expanded: container ? !postsFolded : null });
    for (const thread of shownThreads) rows.push({ kind: 'channel', node: thread, depth: 1, expanded: null });
  };

  for (const channel of tree.uncategorized) pushChannel(channel, false);
  for (const category of tree.categories) {
    const folded = collapsed[category.id] === true;
    const selectable = category.channels.some((channel) => isExportable(channel) || (tree.threadsByParent[channel.id] ?? []).some(isExportable));
    rows.push({ kind: 'category', category, collapsed: folded, selectable });
    for (const channel of category.channels) pushChannel(channel, folded);
  }
  return rows;
}
