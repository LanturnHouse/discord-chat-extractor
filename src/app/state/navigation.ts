import { READABLE_KINDS } from '@/lib/discord/model';
import type { StoreContext } from './context';
import { abortMessageLoadsExcept } from './messages';
import type { AppActions, AppView } from './types';

export type NavigationActions = Pick<AppActions, 'openDms' | 'openGuild' | 'openChannel' | 'toggleCategoryCollapsed' | 'setDmFilter'>;

const DMS_VIEW: AppView = { kind: 'dms' };

export function createNavigationActions(ctx: StoreContext): NavigationActions {
  const { get, set } = ctx;

  return {
    openDms() {
      // Already there: Discord keeps the open conversation.
      if (get().view.kind === 'dms') return;
      abortMessageLoadsExcept(ctx, null);
      set({ view: DMS_VIEW, activeChannelId: null });
    },

    openGuild(guildId) {
      const { view } = get();
      if (view.kind !== 'guild' || view.guildId !== guildId) {
        abortMessageLoadsExcept(ctx, null);
        // Discord reopens the last channel; we show the "pick a channel" state instead of loading anything unasked.
        set({ view: { kind: 'guild', guildId }, activeChannelId: null });
      }
      return get().ensureGuildTree(guildId);
    },

    openChannel(channelId, guildId) {
      const tree = guildId === null ? undefined : get().trees[guildId]?.tree;
      if (tree) {
        // Forums and categories hold no messages of their own (categories are not even in `byId`): only readable
        // channels, threads and forum posts can be opened. Before the tree is loaded there is nothing to judge by.
        const node = tree.byId[channelId];
        if (!node || !READABLE_KINDS.has(node.kind)) return Promise.resolve();
      }
      abortMessageLoadsExcept(ctx, channelId);
      const { view } = get();
      const keepView = guildId === null ? view.kind === 'dms' : view.kind === 'guild' && view.guildId === guildId;
      set({ view: keepView ? view : guildId === null ? DMS_VIEW : { kind: 'guild', guildId }, activeChannelId: channelId });
      // The sidebar needs the tree to show where the channel lives. A loaded one is left alone: opening a channel must not
      // queue the lookup of forum posts that `ensureGuildTree` repeats for a tree whose posts Discord had not indexed yet.
      if (guildId !== null && get().trees[guildId]?.status !== 'loaded') void get().ensureGuildTree(guildId);
      return get().loadInitialMessages(channelId);
    },

    toggleCategoryCollapsed(categoryId) {
      set((state) => {
        const collapsedCategories = { ...state.collapsedCategories };
        if (collapsedCategories[categoryId]) delete collapsedCategories[categoryId];
        else collapsedCategories[categoryId] = true;
        return { collapsedCategories };
      });
    },

    setDmFilter(text) {
      if (get().dmFilter !== text) set({ dmFilter: text });
    },
  };
}
