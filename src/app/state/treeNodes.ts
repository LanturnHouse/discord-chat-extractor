import type { ChannelNode, GuildTree } from '@/lib/discord/model';
import type { Snowflake } from '@/lib/discord/types';
import { isExportable } from '@/lib/discord/tree';
import { UNCATEGORIZED, type CategoryKey, type CheckState } from './types';

/*
 * Pure helpers over a loaded GuildTree. "Group" = the channels of one category (or the uncategorized ones) in sidebar order,
 * each channel directly followed by its listed threads / forum posts. Selection, tri-state math and export order are all
 * defined over these groups, so "select server" selects exactly what the sidebar lists.
 */

const groupCache = new WeakMap<GuildTree, Map<CategoryKey, readonly ChannelNode[]>>();

/** Channels + threads of one category (or `UNCATEGORIZED`) in sidebar order. Cached per tree. */
export function groupNodes(tree: GuildTree, key: CategoryKey): readonly ChannelNode[] {
  let perTree = groupCache.get(tree);
  if (!perTree) {
    perTree = new Map();
    groupCache.set(tree, perTree);
  }
  let nodes = perTree.get(key);
  if (!nodes) {
    const channels = key === UNCATEGORIZED ? tree.uncategorized : (tree.categories.find((category) => category.id === key)?.channels ?? []);
    const expanded: ChannelNode[] = [];
    for (const channel of channels) {
      expanded.push(channel, ...(tree.threadsByParent[channel.id] ?? []));
    }
    nodes = expanded;
    perTree.set(key, nodes);
  }
  return nodes;
}

const orderCache = new WeakMap<GuildTree, readonly ChannelNode[]>();

/** Every listed channel and thread of the guild in sidebar order. Cached per tree. */
export function allNodesInOrder(tree: GuildTree): readonly ChannelNode[] {
  let nodes = orderCache.get(tree);
  if (!nodes) {
    nodes = [UNCATEGORIZED, ...tree.categories.map((category) => category.id)].flatMap((key) => groupNodes(tree, key));
    orderCache.set(tree, nodes);
  }
  return nodes;
}

/** Whether a node may be ticked for export (readable kind, not known to be hidden, not known to answer 403). */
export function isSelectable(node: ChannelNode, forbidden: Readonly<Record<Snowflake, true>>): boolean {
  return isExportable(node) && forbidden[node.id] !== true;
}

export function selectableNodes(nodes: readonly ChannelNode[], forbidden: Readonly<Record<Snowflake, true>>): ChannelNode[] {
  return nodes.filter((node) => isSelectable(node, forbidden));
}

export function triState(total: number, selected: number): CheckState {
  if (selected === 0) return 'none';
  return selected === total ? 'all' : 'some';
}

/** Tri-state of the selectable nodes among `nodes`; nothing selectable => 'none'. */
export function checkStateOfNodes(
  nodes: readonly ChannelNode[],
  selection: Readonly<Record<Snowflake, unknown>>,
  forbidden: Readonly<Record<Snowflake, true>>,
): CheckState {
  let total = 0;
  let selected = 0;
  for (const node of nodes) {
    if (!isSelectable(node, forbidden)) continue;
    total += 1;
    if (selection[node.id] !== undefined) selected += 1;
  }
  return triState(total, selected);
}
