import type { ChannelNode, GuildTree } from '@/lib/discord/model';
import { makeDmExportTarget, makeGuildExportTarget } from '@/lib/discord/tree';
import type { Snowflake } from '@/lib/discord/types';
import type { ExportTarget } from '@/lib/export/types';
import type { StoreContext } from './context';
import { pruneOverrides } from './scope';
import { locateGuildChannel, selectFilteredDms } from './selectors';
import { allNodesInOrder, groupNodes, isSelectable, selectableNodes } from './treeNodes';
import type { AppActions, AppState } from './types';

export type SelectionActions = Pick<
  AppActions,
  'toggleChannel' | 'toggleCategory' | 'toggleGuild' | 'toggleAllDms' | 'clearSelection' | 'removeFromSelection'
>;

type Selection = Record<Snowflake, ExportTarget>;

/** A new selection together with the overrides that still have a channel: they go away with the channel's checkbox, in the same update. */
function withSelection(state: AppState, selection: Selection): Pick<AppState, 'selection' | 'exportOverrides'> {
  return { selection, exportOverrides: pruneOverrides(state.exportOverrides, selection) };
}

function without(selection: Selection, channelId: Snowflake): Selection {
  const next = { ...selection };
  delete next[channelId];
  return next;
}

/** The export target for a channel / thread / DM id, or null when it is unknown, not exportable, or known to be forbidden. */
function targetFor(state: AppState, channelId: Snowflake): ExportTarget | null {
  const dm = state.dms.find((candidate) => candidate.id === channelId);
  if (dm) return state.forbiddenChannels[dm.id] === true ? null : makeDmExportTarget(dm);

  const located = locateGuildChannel(state, channelId);
  if (located === null || !isSelectable(located.node, state.forbiddenChannels)) return null;
  const guild = state.guilds.find((candidate) => candidate.id === located.guildId);
  return guild ? makeGuildExportTarget(located.node, guild, located.tree) : null;
}

export function createSelectionActions(ctx: StoreContext): SelectionActions {
  const { get, set } = ctx;

  /** 'all' selected => deselect them all, otherwise select every one that is not selected yet. */
  function toggleNodes(guildId: Snowflake, tree: GuildTree, nodes: readonly ChannelNode[]): void {
    const state = get();
    const guild = state.guilds.find((candidate) => candidate.id === guildId);
    const selectable = selectableNodes(nodes, state.forbiddenChannels);
    if (!guild || selectable.length === 0) return;

    const allSelected = selectable.every((node) => Object.hasOwn(state.selection, node.id));
    const selection = { ...state.selection };
    for (const node of selectable) {
      if (allSelected) delete selection[node.id];
      else if (!Object.hasOwn(selection, node.id)) selection[node.id] = makeGuildExportTarget(node, guild, tree);
    }
    set(withSelection(state, selection));
  }

  return {
    toggleChannel(channelId) {
      const state = get();
      if (Object.hasOwn(state.selection, channelId)) {
        set(withSelection(state, without(state.selection, channelId)));
        return;
      }
      const target = targetFor(state, channelId);
      if (target) set({ selection: { ...state.selection, [channelId]: target } });
    },

    toggleCategory(guildId, categoryId) {
      const tree = get().trees[guildId]?.tree;
      if (tree) toggleNodes(guildId, tree, groupNodes(tree, categoryId));
    },

    async toggleGuild(guildId) {
      await get().ensureGuildTree(guildId);
      const tree = get().trees[guildId]?.tree;
      if (tree) toggleNodes(guildId, tree, allNodesInOrder(tree));
    },

    toggleAllDms() {
      const state = get();
      const visible = selectFilteredDms(state).filter((dm) => state.forbiddenChannels[dm.id] !== true);
      if (visible.length === 0) return;
      const allSelected = visible.every((dm) => Object.hasOwn(state.selection, dm.id));
      const selection = { ...state.selection };
      for (const dm of visible) {
        if (allSelected) delete selection[dm.id];
        else if (!Object.hasOwn(selection, dm.id)) selection[dm.id] = makeDmExportTarget(dm);
      }
      set(withSelection(state, selection));
    },

    clearSelection() {
      const state = get();
      if (Object.keys(state.selection).length > 0) set(withSelection(state, {}));
    },

    removeFromSelection(channelId) {
      const state = get();
      if (Object.hasOwn(state.selection, channelId)) set(withSelection(state, without(state.selection, channelId)));
    },
  };
}
