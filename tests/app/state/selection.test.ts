import { describe, expect, it } from 'vitest';
import {
  selectCategoryCheck,
  selectChannelCheck,
  selectConnectedAs,
  selectDmCheck,
  selectFilteredDms,
  selectGuildCheck,
  selectSelectedTargets,
  selectSelectionCount,
  selectSelectionCountForGuild,
} from '@/app/state/selectors';
import { UNCATEGORIZED } from '@/app/state/types';
import type { GuildTree } from '@/lib/discord/model';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import { isExportable } from '@/lib/discord/tree';
import type { Snowflake } from '@/lib/discord/types';
import { bootDemo } from '../helpers';

type Booted = Awaited<ReturnType<typeof bootDemo>>;

const BIG = MOCK_IDS.bigGuild;

async function bootWithBigTree(): Promise<Booted & { tree: GuildTree }> {
  const booted = await bootDemo();
  await booted.store.getState().ensureGuildTree(BIG);
  return { ...booted, tree: booted.store.getState().trees[BIG].tree as GuildTree };
}

/** Independent of the store's own traversal: everything the sidebar lists that can be exported. */
function exportableIds(tree: GuildTree): Snowflake[] {
  return Object.values(tree.byId)
    .filter((node) => isExportable(node))
    .map((node) => node.id);
}

function selectedIds(booted: Booted): Snowflake[] {
  return Object.keys(booted.store.getState().selection).sort();
}

describe('toggleChannel', () => {
  it('selects and deselects a guild channel, building its export target', async () => {
    const { store, tree } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);

    const target = store.getState().selection[MOCK_IDS.generalChannel];
    expect(target).toMatchObject({
      channelId: MOCK_IDS.generalChannel,
      kind: 'text',
      channelName: 'general',
      guildId: BIG,
      guildName: store.getState().guilds[0].name,
      categoryName: tree.categories.find((c) => c.id === MOCK_IDS.generalCategory)?.name,
      parentChannelName: null,
    });
    expect(selectChannelCheck(store.getState(), MOCK_IDS.generalChannel)).toBe('all');

    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    expect(store.getState().selection).toEqual({});
    expect(selectChannelCheck(store.getState(), MOCK_IDS.generalChannel)).toBe('none');
  });

  it('threads carry their parent channel', async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.forumThreads[0]);
    expect(store.getState().selection[MOCK_IDS.forumThreads[0]]).toMatchObject({
      kind: 'thread',
      parentChannelName: '질문-게시판',
      guildId: BIG,
    });
  });

  it('selects a DM without any tree', async () => {
    const { store } = await bootDemo();
    store.getState().toggleChannel(MOCK_IDS.dmFriend);
    expect(store.getState().selection[MOCK_IDS.dmFriend]).toMatchObject({ kind: 'dm', guildId: null, guildName: null, categoryName: null });
  });

  it('refuses what cannot be exported', async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.hiddenChannel); // canView false
    store.getState().toggleChannel(MOCK_IDS.forumChannel); // a container without messages
    store.getState().toggleChannel(MOCK_IDS.generalCategory); // categories are not selectable
    store.getState().toggleChannel(MOCK_IDS.unknownChannel);
    expect(store.getState().selection).toEqual({});
  });

  it('ignores a channel whose server tree was never loaded', async () => {
    const { store } = await bootDemo();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    expect(store.getState().selection).toEqual({});
  });

  it('survives navigation', async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    store.getState().toggleChannel(MOCK_IDS.dmFriend);
    await store.getState().openGuild(MOCK_IDS.englishGuild);
    store.getState().openDms();
    await store.getState().openChannel(MOCK_IDS.edge199Channel, BIG);
    expect(Object.keys(store.getState().selection)).toHaveLength(2);
  });

  it('removeFromSelection and clearSelection', async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    store.getState().toggleChannel(MOCK_IDS.dmFriend);
    store.getState().removeFromSelection(MOCK_IDS.generalChannel);
    expect(Object.keys(store.getState().selection)).toEqual([MOCK_IDS.dmFriend]);

    const before = store.getState().selection;
    store.getState().removeFromSelection(MOCK_IDS.unknownChannel);
    expect(store.getState().selection).toBe(before);

    store.getState().clearSelection();
    expect(store.getState().selection).toEqual({});
    const empty = store.getState().selection;
    store.getState().clearSelection();
    expect(store.getState().selection).toBe(empty);
  });
});

describe('toggleCategory (tri-state)', () => {
  function categoryLeaves(tree: GuildTree, categoryId: Snowflake): Snowflake[] {
    const category = tree.categories.find((c) => c.id === categoryId);
    if (!category) throw new Error('unknown category');
    return category.channels.flatMap((channel) => [channel, ...(tree.threadsByParent[channel.id] ?? [])]).filter(isExportable).map((n) => n.id);
  }

  it('none -> all -> none, including listed threads', async () => {
    const { store, tree } = await bootWithBigTree();
    const leaves = categoryLeaves(tree, MOCK_IDS.generalCategory);
    expect(leaves.length).toBeGreaterThan(12);
    expect(leaves).toContain(MOCK_IDS.generalThread);

    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.generalCategory)).toBe('none');
    store.getState().toggleCategory(BIG, MOCK_IDS.generalCategory);
    expect(Object.keys(store.getState().selection).sort()).toEqual([...leaves].sort());
    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.generalCategory)).toBe('all');

    store.getState().toggleCategory(BIG, MOCK_IDS.generalCategory);
    expect(store.getState().selection).toEqual({});
    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.generalCategory)).toBe('none');
  });

  it("a partly selected category is 'some', and toggling it selects the rest", async () => {
    const { store, tree } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.generalCategory)).toBe('some');

    store.getState().toggleCategory(BIG, MOCK_IDS.generalCategory);
    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.generalCategory)).toBe('all');
    expect(Object.keys(store.getState().selection)).toHaveLength(categoryLeaves(tree, MOCK_IDS.generalCategory).length);
  });

  it('deselecting one channel of a full category makes it partial again', async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleCategory(BIG, MOCK_IDS.generalCategory);
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.generalCategory)).toBe('some');
  });

  it('skips what cannot be exported: hidden channels, forums', async () => {
    const { store, tree } = await bootWithBigTree();
    store.getState().toggleCategory(BIG, MOCK_IDS.hiddenCategory); // only hidden channels
    expect(store.getState().selection).toEqual({});
    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.hiddenCategory)).toBe('none');

    const development = tree.categories.find((c) => c.channels.some((ch) => ch.id === MOCK_IDS.forumChannel));
    if (!development) throw new Error('forum category missing');
    store.getState().toggleCategory(BIG, development.id);
    expect(store.getState().selection[MOCK_IDS.forumChannel]).toBeUndefined();
    for (const threadId of MOCK_IDS.forumThreads) expect(store.getState().selection[threadId]).toBeDefined();
    expect(selectCategoryCheck(store.getState(), BIG, development.id)).toBe('all');
  });

  it('handles the channels without a category', async () => {
    const { store, tree } = await bootWithBigTree();
    store.getState().toggleCategory(BIG, UNCATEGORIZED);
    expect(Object.keys(store.getState().selection).sort()).toEqual(tree.uncategorized.map((n) => n.id).sort());
    expect(selectCategoryCheck(store.getState(), BIG, UNCATEGORIZED)).toBe('all');
    store.getState().toggleCategory(BIG, UNCATEGORIZED);
    expect(store.getState().selection).toEqual({});
  });

  it('does nothing before the tree is loaded', async () => {
    const { store } = await bootDemo();
    store.getState().toggleCategory(BIG, MOCK_IDS.generalCategory);
    expect(store.getState().selection).toEqual({});
    expect(selectCategoryCheck(store.getState(), BIG, MOCK_IDS.generalCategory)).toBe('none');
  });
});

describe('toggleGuild (tri-state)', () => {
  it('loads the tree first, then selects every exportable channel including threads', async () => {
    const booted = await bootDemo();
    expect(booted.store.getState().trees[BIG]).toBeUndefined();
    expect(selectGuildCheck(booted.store.getState(), BIG)).toBe('none');

    const pending = booted.store.getState().toggleGuild(BIG);
    expect(booted.store.getState().trees[BIG].status).toBe('loading');
    await pending;

    const tree = booted.store.getState().trees[BIG].tree as GuildTree;
    expect(selectedIds(booted)).toEqual(exportableIds(tree).sort());
    expect(selectedIds(booted)).toContain(MOCK_IDS.generalThread);
    expect(selectedIds(booted)).toContain(MOCK_IDS.forumThreads[2]);
    expect(selectedIds(booted)).not.toContain(MOCK_IDS.forumChannel);
    expect(selectedIds(booted)).not.toContain(MOCK_IDS.hiddenChannel);
    expect(selectGuildCheck(booted.store.getState(), BIG)).toBe('all');
    expect(selectSelectionCountForGuild(booted.store.getState(), BIG)).toBe(exportableIds(tree).length);
  });

  it('works for a server whose tree is not loaded and leaves other servers alone', async () => {
    const booted = await bootDemo();
    await booted.store.getState().toggleGuild(MOCK_IDS.englishGuild);
    expect(booted.spies.getGuildChannels).toHaveBeenCalledTimes(1);
    const tree = booted.store.getState().trees[MOCK_IDS.englishGuild].tree as GuildTree;
    expect(selectedIds(booted)).toEqual(exportableIds(tree).sort());
    expect(selectGuildCheck(booted.store.getState(), MOCK_IDS.englishGuild)).toBe('all');
    expect(selectGuildCheck(booted.store.getState(), BIG)).toBe('none');
    expect(selectSelectionCountForGuild(booted.store.getState(), BIG)).toBe(0);
  });

  it('all -> none, and a single channel makes it partial', async () => {
    const booted = await bootDemo();
    await booted.store.getState().toggleGuild(BIG);
    await booted.store.getState().toggleGuild(BIG);
    expect(booted.store.getState().selection).toEqual({});
    expect(selectGuildCheck(booted.store.getState(), BIG)).toBe('none');

    booted.store.getState().toggleChannel(MOCK_IDS.generalChannel);
    expect(selectGuildCheck(booted.store.getState(), BIG)).toBe('some');
    await booted.store.getState().toggleGuild(BIG);
    expect(selectGuildCheck(booted.store.getState(), BIG)).toBe('all');
  });

  it("with an unloaded tree a selection of that server counts as 'some'", async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    const selected = store.getState().selection;
    // Same selection, but the tree is not there (yet).
    store.setState({ trees: {}, selection: selected });
    expect(selectGuildCheck(store.getState(), BIG)).toBe('some');
    store.setState({ selection: {} });
    expect(selectGuildCheck(store.getState(), BIG)).toBe('none');
  });

  it('does nothing when the tree cannot be loaded', async () => {
    const booted = await bootDemo();
    await booted.store.getState().toggleGuild(MOCK_IDS.unknownGuild);
    expect(booted.store.getState().selection).toEqual({});
    expect(booted.store.getState().trees[MOCK_IDS.unknownGuild].status).toBe('error');
  });
});

describe('forbidden channels', () => {
  it('a channel that answers 403 is dropped from the selection and cannot be selected again', async () => {
    const booted = await bootWithBigTree();
    const { store } = booted;
    store.getState().toggleChannel(MOCK_IDS.forbiddenChannel);
    expect(selectChannelCheck(store.getState(), MOCK_IDS.forbiddenChannel)).toBe('all');

    await store.getState().openChannel(MOCK_IDS.forbiddenChannel, BIG);
    expect(store.getState().selection).toEqual({});

    store.getState().toggleChannel(MOCK_IDS.forbiddenChannel);
    expect(store.getState().selection).toEqual({});
  });

  it('bulk selections skip it and still report a full state', async () => {
    const booted = await bootWithBigTree();
    const { store, tree } = booted;
    await store.getState().openChannel(MOCK_IDS.forbiddenChannel, BIG);

    await store.getState().toggleGuild(BIG);
    expect(selectedIds(booted)).not.toContain(MOCK_IDS.forbiddenChannel);
    expect(selectedIds(booted)).toHaveLength(exportableIds(tree).length - 1);
    expect(selectGuildCheck(store.getState(), BIG)).toBe('all');
    const edgeCategory = tree.categories.find((c) => c.channels.some((ch) => ch.id === MOCK_IDS.forbiddenChannel));
    expect(selectCategoryCheck(store.getState(), BIG, edgeCategory?.id ?? '')).toBe('all');
  });
});

describe('DMs', () => {
  it('toggleAllDms selects every DM and deselects them again', async () => {
    const { store } = await bootDemo();
    const total = store.getState().dms.length;
    expect(selectDmCheck(store.getState())).toBe('none');

    store.getState().toggleAllDms();
    expect(selectSelectionCount(store.getState())).toBe(total);
    expect(selectDmCheck(store.getState())).toBe('all');

    store.getState().toggleAllDms();
    expect(store.getState().selection).toEqual({});
    expect(selectDmCheck(store.getState())).toBe('none');
  });

  it('applies to the filtered list only', async () => {
    const { store } = await bootDemo();
    store.getState().setDmFilter('alex');
    const visible = selectFilteredDms(store.getState());
    expect(visible.length).toBeGreaterThan(1);
    expect(visible.length).toBeLessThan(store.getState().dms.length);

    store.getState().toggleAllDms();
    expect(selectedIds({ store } as Booted)).toEqual(visible.map((dm) => dm.id).sort());
    expect(selectDmCheck(store.getState())).toBe('all');

    // Without the filter the same selection is only partial; toggling then selects the rest.
    store.getState().setDmFilter('');
    expect(selectDmCheck(store.getState())).toBe('some');
    store.getState().toggleAllDms();
    expect(selectSelectionCount(store.getState())).toBe(store.getState().dms.length);
    expect(selectDmCheck(store.getState())).toBe('all');
  });

  it('deselecting with a filter leaves the selection outside of it', async () => {
    const { store } = await bootDemo();
    store.getState().toggleAllDms();
    store.getState().setDmFilter('legacy');
    expect(selectDmCheck(store.getState())).toBe('all');
    store.getState().toggleAllDms();
    expect(selectSelectionCount(store.getState())).toBe(store.getState().dms.length - 1);
    expect(selectDmCheck(store.getState())).toBe('none');
  });

  it('does nothing when the filter matches no DM', async () => {
    const { store } = await bootDemo();
    store.getState().setDmFilter('no such person');
    expect(selectDmCheck(store.getState())).toBe('none');
    store.getState().toggleAllDms();
    expect(store.getState().selection).toEqual({});
  });

  it('the filter is case-insensitive and matches names and recipient usernames', async () => {
    const { store } = await bootDemo();
    const names = (): string[] => selectFilteredDms(store.getState()).map((dm) => dm.name);

    store.getState().setDmFilter('  ALEX  ');
    expect(names()).toContain('Alex Rivera');
    expect(names()).toContain('Alex Rivera, Sam Patel, Jordan Lee'); // group DM, matched by member
    store.getState().setDmFilter('alex_r'); // a username that is not the display name
    expect(names()).toContain('Alex Rivera');
    store.getState().setDmFilter('김민준');
    expect(names()[0]).toBe('김민준');
    expect(names().every((name) => name.includes('김민준'))).toBe(true); // 1:1 DM and a group that he is in
    store.getState().setDmFilter('minjun_kim'); // only the username matches
    expect(names()[0]).toBe('김민준');
    expect(names().length).toBeGreaterThanOrEqual(2);
    store.getState().setDmFilter('');
    expect(selectFilteredDms(store.getState())).toBe(store.getState().dms);
  });

  it('keeps the filtered list referentially stable while nothing relevant changes', async () => {
    const { store } = await bootDemo();
    store.getState().setDmFilter('alex');
    const first = selectFilteredDms(store.getState());
    store.getState().setExportAfter('2026-01-01T00:00:00.000Z');
    store.getState().toggleChannel(MOCK_IDS.dmFriend);
    expect(selectFilteredDms(store.getState())).toBe(first);
    store.getState().setDmFilter('alexa');
    expect(selectFilteredDms(store.getState())).not.toBe(first);
  });
});

describe('selected targets order', () => {
  it('servers in list order, sidebar order inside a server, DMs last', async () => {
    const booted = await bootWithBigTree();
    const { store, tree } = booted;
    await store.getState().ensureGuildTree(MOCK_IDS.englishGuild);
    const englishTree = store.getState().trees[MOCK_IDS.englishGuild].tree as GuildTree;
    const englishChannel = englishTree.uncategorized[0].id;

    // Selected in the "wrong" order on purpose.
    store.getState().toggleChannel(MOCK_IDS.dmFriendEnglish);
    store.getState().toggleChannel(englishChannel);
    store.getState().toggleChannel(MOCK_IDS.edge400Channel);
    store.getState().toggleChannel(MOCK_IDS.dmFriend);
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    store.getState().toggleChannel(MOCK_IDS.welcomeChannel);

    const categoryIndex = (id: Snowflake): number => tree.categories.findIndex((c) => c.channels.some((ch) => ch.id === id));
    expect(tree.uncategorized.some((n) => n.id === MOCK_IDS.welcomeChannel)).toBe(true);
    expect(categoryIndex(MOCK_IDS.generalChannel)).toBeLessThan(categoryIndex(MOCK_IDS.edge400Channel));

    const dmIds = store.getState().dms.map((dm) => dm.id);
    expect(dmIds.indexOf(MOCK_IDS.dmFriend)).toBeLessThan(dmIds.indexOf(MOCK_IDS.dmFriendEnglish));

    expect(selectSelectedTargets(store.getState()).map((t) => t.channelId)).toEqual([
      MOCK_IDS.welcomeChannel,
      MOCK_IDS.generalChannel,
      MOCK_IDS.edge400Channel,
      englishChannel,
      MOCK_IDS.dmFriend,
      MOCK_IDS.dmFriendEnglish,
    ]);
  });

  it('is memoised: same array until the selection (or the data it depends on) changes', async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    const first = selectSelectedTargets(store.getState());
    store.getState().setDmFilter('x');
    expect(selectSelectedTargets(store.getState())).toBe(first);
    store.getState().toggleChannel(MOCK_IDS.edge400Channel);
    expect(selectSelectedTargets(store.getState())).not.toBe(first);
  });

  it('counts', async () => {
    const { store } = await bootWithBigTree();
    store.getState().toggleChannel(MOCK_IDS.generalChannel);
    store.getState().toggleChannel(MOCK_IDS.edge400Channel);
    store.getState().toggleChannel(MOCK_IDS.dmFriend);
    expect(selectSelectionCount(store.getState())).toBe(3);
    expect(selectSelectionCountForGuild(store.getState(), BIG)).toBe(2);
    expect(selectSelectionCountForGuild(store.getState(), MOCK_IDS.englishGuild)).toBe(0);
  });
});

describe('connectedAs', () => {
  it('is the display name of the signed-in user', async () => {
    const { store } = await bootDemo();
    expect(selectConnectedAs(store.getState())).toBe(MOCK_ME.global_name);
  });

  it('falls back to the username, and is null before boot', async () => {
    const { store } = await bootDemo({}, { ...MOCK_ME, global_name: null });
    expect(selectConnectedAs(store.getState())).toBe(MOCK_ME.username);
    store.setState({ me: null });
    expect(selectConnectedAs(store.getState())).toBeNull();
  });
});
