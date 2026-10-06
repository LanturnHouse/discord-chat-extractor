import { describe, expect, it } from 'vitest';
import { buildTreeRows, isContainer, type TreeRow } from '@/app/components/sidebar/treeRows';
import type { GuildTree } from '@/lib/discord/model';
import { MOCK_IDS } from '@/lib/discord/mock';
import { bootDemo } from '../helpers';

async function bigTree(): Promise<GuildTree> {
  const { store } = await bootDemo();
  await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
  return store.getState().trees[MOCK_IDS.bigGuild].tree as GuildTree;
}

type ChannelRow = Extract<TreeRow, { kind: 'channel' }>;

/** The top-level row of a channel (not the thread rows below a parent). */
function channelRow(rows: readonly TreeRow[], id: string): ChannelRow | undefined {
  return rows.find((row): row is ChannelRow => row.kind === 'channel' && row.node.id === id && row.depth === 0);
}

function describeRows(rows: readonly TreeRow[]): string[] {
  return rows.map((row) => (row.kind === 'category' ? `[${row.category.name}]` : `${row.depth === 1 ? '  ' : ''}${row.node.name}`));
}

describe('buildTreeRows', () => {
  it('lists uncategorized channels, then each category followed by its channels and their threads', async () => {
    const tree = await bigTree();
    const rows = buildTreeRows(tree, {}, null, {});
    const channels = rows.filter((row) => row.kind === 'channel');
    expect(channels).toHaveLength(Object.keys(tree.byId).length);
    expect(rows.filter((row) => row.kind === 'category')).toHaveLength(tree.categories.length);

    const names = describeRows(rows);
    expect(names.slice(0, tree.uncategorized.length)).toEqual(tree.uncategorized.map((node) => node.name));
    const general = rows.findIndex((row) => row.kind === 'channel' && row.node.id === MOCK_IDS.generalChannel);
    const below = rows[general + 1];
    expect(below).toMatchObject({ kind: 'channel', depth: 1 });
    expect(below.kind === 'channel' ? below.node.parentId : null).toBe(MOCK_IDS.generalChannel);
  });

  it('marks forum containers with their unfolded state and everything else with null', async () => {
    const tree = await bigTree();
    const rows = buildTreeRows(tree, {}, null, {});
    const expanded = (id: string): boolean | null | undefined => channelRow(rows, id)?.expanded;
    expect(expanded(MOCK_IDS.forumChannel)).toBe(true);
    expect(expanded(MOCK_IDS.generalChannel)).toBeNull();
    expect(isContainer(tree.byId[MOCK_IDS.forumChannel])).toBe(true);
    expect(isContainer(tree.byId[MOCK_IDS.generalChannel])).toBe(false);

    const postOfForum = MOCK_IDS.forumThreads[1];
    const keptPost = describeRows(buildTreeRows(tree, { [MOCK_IDS.forumChannel]: true }, null, { [postOfForum]: true }));
    expect(keptPost.filter((name) => name.startsWith('  ') && tree.byId[postOfForum].name === name.trim())).toHaveLength(1);
    const folded = buildTreeRows(tree, { [MOCK_IDS.forumChannel]: true }, null, {});
    const forum = folded.findIndex((row) => row.kind === 'channel' && row.node.id === MOCK_IDS.forumChannel);
    expect(folded[forum]).toMatchObject({ expanded: false });
    expect(folded[forum + 1]).toMatchObject({ kind: 'channel', depth: 0 });
    expect(folded).toHaveLength(rows.length - MOCK_IDS.forumThreads.length);
  });

  it('a folded category keeps only the open channel and the ticked ones (a ticked thread brings its parent back); a shown channel brings its threads', async () => {
    const tree = await bigTree();
    const collapsed = { [MOCK_IDS.generalCategory]: true } as const;
    const plain = describeRows(buildTreeRows(tree, collapsed, null, {}));
    expect(plain).toContain('[💬 일반 GENERAL]');
    expect(plain).not.toContain('general');

    const rows = buildTreeRows(tree, collapsed, MOCK_IDS.edge400Channel, { [MOCK_IDS.generalThread]: true });
    const names = describeRows(rows);
    const start = names.indexOf('[💬 일반 GENERAL]');
    expect(names.slice(start, start + 4)).toEqual(['[💬 일반 GENERAL]', 'general', '  v2.0 릴리즈 노트 토론', '  점심 메뉴 투표 🍜']);
    // The open channel lives in another category here, which is not folded: nothing else changes.
    expect(names).toContain('edge-400');
    expect(names).toContain('[🔊 VOICE 음성]');
    expect(names).not.toContain('random');
  });

  it('flags categories without an exportable channel or post', async () => {
    const tree = await bigTree();
    const selectable = Object.fromEntries(
      buildTreeRows(tree, {}, null, {})
        .filter((row) => row.kind === 'category')
        .map((row) => [row.category.id, row.selectable]),
    );
    expect(selectable[MOCK_IDS.generalCategory]).toBe(true);
    expect(selectable[MOCK_IDS.voiceOnlyCategory]).toBe(true);
    expect(selectable[MOCK_IDS.hiddenCategory]).toBe(false);
    expect(selectable[MOCK_IDS.emptyCategory]).toBe(false);
  });

  it('is pure: the same input gives equal rows and nothing is mutated', async () => {
    const tree = await bigTree();
    const collapsed = Object.freeze({ [MOCK_IDS.voiceOnlyCategory]: true } as const);
    const selection = Object.freeze({ [MOCK_IDS.voiceChannel]: true });
    expect(buildTreeRows(tree, collapsed, null, selection)).toEqual(buildTreeRows(tree, collapsed, null, selection));
  });
});
