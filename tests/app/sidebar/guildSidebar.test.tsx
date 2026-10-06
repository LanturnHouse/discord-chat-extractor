// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerRail } from '@/app/components/rail/ServerRail';
import { Sidebar } from '@/app/components/sidebar/Sidebar';
import { selectCategoryCheck, selectGuildCheck, selectSelectedTargets, selectSelectionCountForGuild } from '@/app/state/selectors';
import { appStore } from '@/app/state/store';
import { DiscordApiError } from '@/lib/discord/client';
import type { ChannelNode, GuildTree } from '@/lib/discord/model';
import { MOCK_IDS } from '@/lib/discord/mock';
import { isExportable } from '@/lib/discord/tree';
import { bootApp, gateGuildChannels, settle, trackConsole } from '../rail/helpers';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

const BIG = MOCK_IDS.bigGuild;
const SERVER_BOX = 'Select every channel of this server';
const GENERAL = '💬 일반 GENERAL';

let consoleWatch: ReturnType<typeof trackConsole>;

beforeEach(() => {
  consoleWatch = trackConsole();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  consoleWatch.expectQuiet();
  consoleWatch.restore();
});

async function setup(options: Parameters<typeof bootApp>[0] = {}): Promise<void> {
  await bootApp(options);
  render(
    <>
      <ServerRail />
      <Sidebar />
    </>,
  );
}

async function openGuild(guildId: string): Promise<void> {
  await act(async () => {
    await appStore.getState().openGuild(guildId);
  });
}

async function openBig(): Promise<void> {
  await openGuild(BIG);
}

function sidebar(): HTMLElement {
  return screen.getByRole('complementary');
}

function button(name: string): HTMLElement {
  return within(sidebar()).getByRole('button', { name });
}

function rowOf(name: string): HTMLElement {
  const row = button(name).closest('li');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

function box(name: string): HTMLElement {
  return within(sidebar()).getByRole('checkbox', { name });
}

function channelBox(name: string): HTMLElement {
  return box(`Select ${name} for export`);
}

function categoryBox(name: string): HTMLElement {
  return box(`Select every channel in ${name}`);
}

function checked(element: HTMLElement): string | null {
  return element.getAttribute('aria-checked');
}

/** The visible rows in order: categories as `[name]`, threads indented by two spaces. */
function layout(): string[] {
  return Array.from(sidebar().querySelectorAll('[data-sb-row]')).map((row) => {
    if (row.classList.contains('sb-category')) return `[${row.querySelector('.sb-category__name')?.textContent}]`;
    return `${row.classList.contains('sb-channel--thread') ? '  ' : ''}${row.querySelector('.sb-channel__name')?.textContent}`;
  });
}

function bigTree(): GuildTree {
  return appStore.getState().trees[BIG].tree as GuildTree;
}

function exportableCount(tree: GuildTree): number {
  return Object.values(tree.byId).filter((node) => isExportable(node)).length;
}

function railBadge(name: string): string | null {
  const item = within(screen.getByRole('navigation')).getByRole('button', { name }).closest('.rail__item');
  return item?.querySelector('.rail__badge')?.textContent ?? null;
}

describe('loading a server', () => {
  it('shows the skeleton while the channel list loads, then the channels', async () => {
    const client = await bootApp();
    const { release } = gateGuildChannels(client);
    render(
      <>
        <ServerRail />
        <Sidebar />
      </>,
    );
    expect(screen.getByRole('complementary', { name: 'Direct Messages' })).toBeTruthy();

    const bigName = appStore.getState().guilds[0].name;
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: bigName }));

    expect(screen.getByRole('complementary', { name: 'Channels' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: bigName })).toBeTruthy();
    const skeleton = screen.getByRole('status', { name: 'Loading…' });
    expect(skeleton.querySelectorAll('.sb-skeleton__header')).toHaveLength(2);
    expect(skeleton.querySelectorAll('.sb-skeleton__row')).toHaveLength(8);
    expect(skeleton.querySelectorAll('.sb-skeleton__bar').length).toBeGreaterThanOrEqual(10);
    expect(sidebar().querySelectorAll('[data-sb-row]')).toHaveLength(0);
    // The header checkbox waits too, with a spinner on it (busy, not disabled: a focused control must not lose the focus).
    expect((box(SERVER_BOX) as HTMLButtonElement).disabled).toBe(false);
    expect(box(SERVER_BOX).getAttribute('aria-busy')).toBe('true');
    expect(sidebar().querySelector('.sb-guild-header__spinner')).not.toBeNull();

    await act(async () => {
      release();
    });
    await settle();
    expect(screen.queryByRole('status', { name: 'Loading…' })).toBeNull();
    expect(sidebar().querySelector('.sb-guild-header__spinner')).toBeNull();
    expect(box(SERVER_BOX).getAttribute('aria-busy')).toBeNull();
    expect(button('general')).toBeTruthy();
  });

  it('also covers the idle state: an open server whose tree was never requested loads by itself', async () => {
    await bootApp();
    appStore.setState({ view: { kind: 'guild', guildId: BIG } });
    render(<Sidebar />);
    await settle();
    expect(appStore.getState().trees[BIG].status).toBe('loaded');
    expect(button('general')).toBeTruthy();
  });

  it('shows a message and a retry button when the load failed', async () => {
    const client = await bootApp();
    const spy = vi.spyOn(client, 'getGuildChannels').mockRejectedValueOnce(new DiscordApiError('network', 'offline'));
    render(<Sidebar />);
    await openBig();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not reach Discord. Check your network connection.');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(sidebar().querySelectorAll('[data-sb-row]')).toHaveLength(0);

    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    });
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button('general')).toBeTruthy();
  });

  it('shows a friendly line for a server without channels and nothing for an unknown server', async () => {
    await bootApp();
    render(<Sidebar />);
    await openBig();
    appStore.setState({ trees: { [BIG]: { status: 'loaded', tree: { guildId: BIG, uncategorized: [], categories: [], threadsByParent: {}, byId: {} } } } });
    await settle();
    expect(screen.getByText('There are no channels to show')).toBeTruthy();

    act(() => appStore.setState({ view: { kind: 'guild', guildId: 'does-not-exist' } }));
    expect(sidebar().childElementCount).toBe(0);
  });

  it('speaks Korean when the locale is ko', async () => {
    await setup({ locale: 'ko' });
    await openBig();
    expect(screen.getByRole('complementary', { name: '채널 목록' })).toBeTruthy();
    expect(within(sidebar()).getByRole('checkbox', { name: '서버의 모든 채널 선택' })).toBeTruthy();
    expect(within(sidebar()).getByRole('checkbox', { name: 'general 내보내기 선택' })).toBeTruthy();
    expect(within(sidebar()).getByRole('checkbox', { name: '💬 일반 GENERAL 카테고리의 모든 채널 선택' })).toBeTruthy();
    expect(button('mod-only').getAttribute('title')).toBe('mod-only - 접근 권한 없음');
  });
});

describe('channel tree in Discord order', () => {
  it('lists uncategorized channels first, then every category with its channels (voice after text) and threads under their parent', async () => {
    await setup();
    await openBig();
    const rows = layout();

    expect(rows.slice(0, 5)).toEqual(['👋｜welcome', '📣｜공지사항', '❓｜오늘의-질문', '🔊 로비 Lobby', '[💬 일반 GENERAL]']);
    expect(rows.slice(5, 9)).toEqual(['general', '  v2.0 릴리즈 노트 토론', '  점심 메뉴 투표 🍜', '잡담']);
    expect(rows.filter((row) => row.startsWith('['))).toEqual(['[💬 일반 GENERAL]', '[🔊 VOICE 음성]', '[🛡️ STAFF ONLY]', '[📌 INFORMATION]', '[💻 DEVELOPMENT]', '[🔐 PERMISSIONS]', '[🧪 TEST · EDGE CASES]', '[🗃️ ARCHIVE]']);
    // A category lists its text channels before its voice channels.
    expect(rows[rows.indexOf('[🔊 VOICE 음성]') - 1]).toBe('🎧 잡담 음성');
    expect(rows[rows.indexOf('photos') + 1]).toBe('🎧 잡담 음성');
    // Every channel and thread of the tree is on screen, exactly once.
    const tree = bigTree();
    const expected = Object.values(tree.byId).length + tree.categories.length;
    expect(rows).toHaveLength(expected);
  });

  it('draws the right icon for every kind of channel', async () => {
    await setup();
    await openBig();
    const iconOf = (name: string): string => rowOf(name).querySelector('.sb-channel__icon')?.innerHTML ?? '';
    const distinct = new Set([iconOf('general'), iconOf('📣｜공지사항'), iconOf('🎧 잡담 음성'), iconOf('Town Hall 타운홀'), iconOf('질문-게시판'), iconOf('v2.0 릴리즈 노트 토론'), iconOf('mod-only')]);
    expect(distinct.size).toBe(7);
    expect(iconOf('general')).toBe(iconOf('random'));
    expect(iconOf('🎧 잡담 음성')).toBe(iconOf('스터디룸 1'));
    // Every icon is decorative: the row's name is its text.
    for (const svg of sidebar().querySelectorAll('.sb-channel__icon')) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks the category headers as foldable buttons with the right state', async () => {
    await setup();
    await openBig();
    expect(button(GENERAL).getAttribute('aria-expanded')).toBe('true');
    expect(rowOf(GENERAL).classList.contains('sb-category--collapsed')).toBe(false);
  });

  it('shows the uncategorized channels of a server that has no categories at all', async () => {
    await setup();
    await openGuild(appStore.getState().guilds[8].id);
    expect(layout()).toHaveLength(1);
    expect(sidebar().querySelector('.sb-category')).toBeNull();
  });

  it('renders channel and server names as plain text', async () => {
    await setup();
    await openBig();
    const tree = bigTree();
    const hostile: ChannelNode = { ...tree.uncategorized[0], name: '<img src=x onerror=alert(1)>' };
    act(() => {
      appStore.setState({ trees: { [BIG]: { status: 'loaded', tree: { ...tree, uncategorized: [hostile, ...tree.uncategorized.slice(1)] } } } });
    });
    expect(sidebar().querySelector('img[src="x"]')).toBeNull();
    expect(within(sidebar()).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();

    const hostileGuild = appStore.getState().guilds.find((guild) => guild.name.includes('<script>'));
    await openGuild(hostileGuild?.id ?? '');
    expect(within(sidebar()).getByRole('heading', { level: 2 }).textContent).toBe(hostileGuild?.name);
    expect(sidebar().querySelector('script, b')).toBeNull();
  });
});

describe('open channel', () => {
  it('clicking a channel opens it: aria-current and the highlighted row move along', async () => {
    await setup();
    await openBig();
    expect(sidebar().querySelector('[aria-current]')).toBeNull();

    await act(async () => {
      fireEvent.click(button('general'));
    });
    await settle();
    expect(appStore.getState().activeChannelId).toBe(MOCK_IDS.generalChannel);
    expect(button('general').getAttribute('aria-current')).toBe('page');
    expect(rowOf('general').classList.contains('sb-row--active')).toBe(true);

    await act(async () => {
      fireEvent.click(button('🎧 잡담 음성'));
    });
    await settle();
    expect(button('general').getAttribute('aria-current')).toBeNull();
    expect(rowOf('general').classList.contains('sb-row--active')).toBe(false);
    expect(sidebar().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(button('🎧 잡담 음성').getAttribute('aria-current')).toBe('page');
  });

  it('calls openChannel(id, guildId); threads and voice channels open too', async () => {
    await setup();
    await openBig();
    const openChannel = vi.fn(async () => undefined);
    act(() => appStore.setState({ openChannel }));

    fireEvent.click(button('general'));
    expect(openChannel).toHaveBeenLastCalledWith(MOCK_IDS.generalChannel, BIG);
    fireEvent.click(button('v2.0 릴리즈 노트 토론'));
    expect(openChannel).toHaveBeenLastCalledWith(MOCK_IDS.generalThread2, BIG);
    fireEvent.click(button('라운지 Lounge'));
    expect(openChannel).toHaveBeenLastCalledWith(MOCK_IDS.voiceChannel, BIG);
    fireEvent.click(button('Town Hall 타운홀'));
    expect(openChannel).toHaveBeenLastCalledWith(MOCK_IDS.stageChannel, BIG);
    fireEvent.click(button('📣｜공지사항'));
    expect(openChannel).toHaveBeenCalledTimes(4 + 1);
  });

  it('the open channel of a server is not highlighted after switching to another server', async () => {
    await setup();
    await openBig();
    await act(async () => {
      fireEvent.click(button('general'));
    });
    await settle();
    await openGuild(appStore.getState().guilds[1].id);
    expect(sidebar().querySelector('[aria-current]')).toBeNull();
  });
});

describe('folding categories', () => {
  it('folds and unfolds a category; the state lives in the store', async () => {
    await setup();
    await openBig();
    const before = layout();
    expect(before).toContain('random');

    fireEvent.click(button(GENERAL));
    expect(button(GENERAL).getAttribute('aria-expanded')).toBe('false');
    expect(rowOf(GENERAL).classList.contains('sb-category--collapsed')).toBe(true);
    expect(appStore.getState().collapsedCategories[MOCK_IDS.generalCategory]).toBe(true);
    const folded = layout();
    expect(folded).not.toContain('random');
    expect(folded).not.toContain('general');
    expect(folded).toContain('[💬 일반 GENERAL]');
    expect(folded).toContain('[🔊 VOICE 음성]');
    expect(folded.slice(0, 5)).toEqual(['👋｜welcome', '📣｜공지사항', '❓｜오늘의-질문', '🔊 로비 Lobby', '[💬 일반 GENERAL]']);

    fireEvent.click(button(GENERAL));
    expect(layout()).toEqual(before);
    expect(appStore.getState().collapsedCategories).toEqual({});
  });

  it('keeps the open channel and the ticked channels visible inside a folded category', async () => {
    await setup();
    await openBig();
    await act(async () => {
      fireEvent.click(button('random'));
    });
    await settle();
    fireEvent.click(channelBox('memes'));
    fireEvent.click(channelBox('v2.0 릴리즈 노트 토론'));

    fireEvent.click(button(GENERAL));
    const folded = layout();
    const category = folded.indexOf('[💬 일반 GENERAL]');
    const next = folded.indexOf('[🔊 VOICE 음성]');
    // `random` (open) and `memes` (ticked) stay; the ticked thread brings its parent `general` back, with its threads.
    expect(folded.slice(category + 1, next)).toEqual(['general', '  v2.0 릴리즈 노트 토론', '  점심 메뉴 투표 🍜', 'random', 'memes']);

    // Un-ticking hides a row that is neither open nor ticked any more.
    fireEvent.click(channelBox('memes'));
    expect(layout()).not.toContain('memes');
    expect(layout()).toContain('random');
  });

  it('keeps the fold state when the server is left and opened again', async () => {
    await setup();
    await openBig();
    fireEvent.click(button('💻 DEVELOPMENT'));
    expect(layout()).not.toContain('frontend');

    await openGuild(appStore.getState().guilds[1].id);
    expect(sidebar().querySelector('.sb-category--collapsed')).toBeNull();
    await openBig();
    expect(layout()).not.toContain('frontend');
    expect(button('💻 DEVELOPMENT').getAttribute('aria-expanded')).toBe('false');
  });

  it('a new server starts with a fresh scroll area (so its tree begins at the top)', async () => {
    await setup();
    await openBig();
    const first = sidebar().querySelector('.sb-scroll');
    await openGuild(appStore.getState().guilds[1].id);
    const second = sidebar().querySelector('.sb-scroll');
    expect(second).not.toBe(first);
    expect(first?.isConnected).toBe(false);
  });
});

describe('export checkboxes', () => {
  it('channel checkbox: one channel, no navigation, category and server turn partial', async () => {
    await setup();
    await openBig();
    expect(checked(channelBox('general'))).toBe('false');

    fireEvent.click(channelBox('general'));
    expect(checked(channelBox('general'))).toBe('true');
    expect(Object.keys(appStore.getState().selection)).toEqual([MOCK_IDS.generalChannel]);
    expect(appStore.getState().activeChannelId).toBeNull();
    expect(checked(categoryBox(GENERAL))).toBe('mixed');
    expect(checked(box(SERVER_BOX))).toBe('mixed');
    expect(railBadge(appStore.getState().guilds[0].name)).toBe('1');

    fireEvent.click(channelBox('general'));
    expect(appStore.getState().selection).toEqual({});
    expect(checked(categoryBox(GENERAL))).toBe('false');
    expect(checked(box(SERVER_BOX))).toBe('false');
  });

  it('category checkbox: selects its channels and threads, none -> all -> none', async () => {
    await setup();
    await openBig();
    fireEvent.click(categoryBox(GENERAL));

    const category = bigTree().categories.find((candidate) => candidate.id === MOCK_IDS.generalCategory);
    const expected = (category?.channels ?? []).flatMap((channel) => [channel, ...(bigTree().threadsByParent[channel.id] ?? [])]).filter((node) => isExportable(node));
    expect(Object.keys(appStore.getState().selection).sort()).toEqual(expected.map((node) => node.id).sort());
    expect(Object.keys(appStore.getState().selection)).toContain(MOCK_IDS.generalThread);
    expect(checked(categoryBox(GENERAL))).toBe('true');
    expect(checked(channelBox('general'))).toBe('true');
    expect(checked(channelBox('점심 메뉴 투표 🍜'))).toBe('true');
    expect(checked(categoryBox('🔊 VOICE 음성'))).toBe('false');
    expect(checked(box(SERVER_BOX))).toBe('mixed');
    expect(selectCategoryCheck(appStore.getState(), BIG, MOCK_IDS.generalCategory)).toBe('all');

    // A partial category: the next press selects the rest.
    fireEvent.click(channelBox('random'));
    expect(checked(categoryBox(GENERAL))).toBe('mixed');
    fireEvent.click(categoryBox(GENERAL));
    expect(checked(categoryBox(GENERAL))).toBe('true');

    fireEvent.click(categoryBox(GENERAL));
    expect(appStore.getState().selection).toEqual({});
    expect(checked(categoryBox(GENERAL))).toBe('false');
  });

  it('server checkbox: every selectable channel, thread and forum post; none -> all -> none', async () => {
    await setup();
    await openBig();
    await act(async () => {
      fireEvent.click(box(SERVER_BOX));
    });
    await settle();

    const selected = Object.keys(appStore.getState().selection);
    expect(selected.sort()).toEqual(
      Object.values(bigTree().byId)
        .filter((node) => isExportable(node))
        .map((node) => node.id)
        .sort(),
    );
    expect(selected).toContain(MOCK_IDS.forumThreads[0]);
    expect(selected).not.toContain(MOCK_IDS.forumChannel);
    expect(selected).not.toContain(MOCK_IDS.hiddenChannel);
    expect(checked(box(SERVER_BOX))).toBe('true');
    expect(selectGuildCheck(appStore.getState(), BIG)).toBe('all');
    expect(railBadge(appStore.getState().guilds[0].name)).toBe(String(exportableCount(bigTree())));
    for (const name of [GENERAL, '🔊 VOICE 음성', '📌 INFORMATION', '💻 DEVELOPMENT', '🔐 PERMISSIONS', '🧪 TEST · EDGE CASES']) expect(checked(categoryBox(name)), name).toBe('true');

    await act(async () => {
      fireEvent.click(box(SERVER_BOX));
    });
    await settle();
    expect(appStore.getState().selection).toEqual({});
    expect(checked(box(SERVER_BOX))).toBe('false');
  });

  it('the targets come out in sidebar order whatever order they were ticked in', async () => {
    await setup();
    await openBig();
    fireEvent.click(channelBox('random'));
    fireEvent.click(channelBox('general'));
    fireEvent.click(channelBox('👋｜welcome'));
    expect(selectedNames()).toEqual(['👋｜welcome', 'general', 'random']);
  });

  it('a click on a checkbox or a press of Enter on it never opens the channel', async () => {
    await setup();
    await openBig();
    const openChannel = vi.fn(async () => undefined);
    act(() => appStore.setState({ openChannel }));
    fireEvent.click(channelBox('general'));
    fireEvent.keyDown(channelBox('general'), { key: 'Enter' });
    fireEvent.keyDown(channelBox('general'), { key: ' ' });
    expect(openChannel).not.toHaveBeenCalled();
  });

  it('categories with nothing exportable have no checkbox', async () => {
    await setup();
    await openBig();
    expect(within(sidebar()).queryByRole('checkbox', { name: 'Select every channel in 🛡️ STAFF ONLY' })).toBeNull();
    expect(within(sidebar()).queryByRole('checkbox', { name: 'Select every channel in 🗃️ ARCHIVE' })).toBeNull();
    expect(button('🛡️ STAFF ONLY')).toBeTruthy();
    fireEvent.click(button('🛡️ STAFF ONLY'));
    expect(button('🛡️ STAFF ONLY').getAttribute('aria-expanded')).toBe('false');
  });

  it('checkboxes of channels and categories are revealed on hover / focus or when ticked', async () => {
    await setup();
    await openBig();
    for (const element of [channelBox('general'), categoryBox(GENERAL)]) {
      expect(element.classList.contains('dce-checkbox--reveal')).toBe(true);
      expect(element.closest('.dce-reveal-host')).not.toBeNull();
    }
    // The server checkbox is always visible.
    expect(box(SERVER_BOX).classList.contains('dce-checkbox--reveal')).toBe(false);
    expect(selectSelectionCountForGuild(appStore.getState(), BIG)).toBe(0);
  });
});

function selectedNames(): string[] {
  return selectSelectedTargets(appStore.getState()).map((target) => target.channelName);
}

describe('locked channels', () => {
  it('a channel hidden by permissions is dimmed, locked, not selectable - but still opens so the main pane can say why', async () => {
    await setup();
    await openBig();
    const row = rowOf('mod-only');
    expect(row.classList.contains('sb-channel--locked')).toBe(true);
    expect(button('mod-only').getAttribute('title')).toBe('mod-only - No access');
    expect(within(row).queryByRole('checkbox')).toBeNull();
    expect(row.querySelector('.sb-channel__icon')?.innerHTML).not.toBe(rowOf('rules').querySelector('.sb-channel__icon')?.innerHTML);
    // Unlocked rows are not marked; their tooltip is just the full name.
    expect(rowOf('general').classList.contains('sb-channel--locked')).toBe(false);
    expect(button('general').getAttribute('title')).toBe('general');

    await act(async () => {
      fireEvent.click(button('mod-only'));
    });
    await settle();
    expect(appStore.getState().activeChannelId).toBe(MOCK_IDS.hiddenChannel);
    expect(button('mod-only').getAttribute('aria-current')).toBe('page');
  });

  it('locked variants exist for every kind (padlock after the name where the icon has none of its own)', async () => {
    await setup();
    await openBig();
    expect(rowOf('staff-voice').classList.contains('sb-channel--locked')).toBe(true);
    expect(rowOf('staff-voice').querySelector('.sb-channel__lock')).toBeNull(); // SpeakerLocked
    expect(rowOf('mod-log').querySelector('.sb-channel__lock')).toBeNull(); // HashLocked
    const tree = bigTree();
    const announcement: ChannelNode = { ...tree.uncategorized[1], canView: false };
    act(() => {
      appStore.setState({ trees: { [BIG]: { status: 'loaded', tree: { ...tree, uncategorized: [tree.uncategorized[0], announcement, ...tree.uncategorized.slice(2)] } } } });
    });
    expect(rowOf(announcement.name).querySelector('.sb-channel__lock')).not.toBeNull();
  });

  it('a channel that answers 403 when opened becomes locked and drops out of the selection', async () => {
    await setup();
    await openBig();
    const name = '비공개-라운지';
    expect(rowOf(name).classList.contains('sb-channel--locked')).toBe(false);
    fireEvent.click(channelBox(name));
    expect(checked(channelBox(name))).toBe('true');

    await act(async () => {
      fireEvent.click(button(name));
    });
    await settle();
    expect(rowOf(name).classList.contains('sb-channel--locked')).toBe(true);
    expect(button(name).getAttribute('title')).toBe(`${name} - No access`);
    expect(within(rowOf(name)).queryByRole('checkbox')).toBeNull();
    expect(appStore.getState().selection).toEqual({});
    expect(button(name).getAttribute('aria-current')).toBe('page');
  });
});

describe('forum channels', () => {
  it('fold their post list instead of opening; posts are indented and selectable one by one', async () => {
    await setup();
    await openBig();
    const forum = button('질문-게시판');
    expect(forum.getAttribute('aria-expanded')).toBe('true');
    expect(within(rowOf('질문-게시판')).queryByRole('checkbox')).toBeNull();

    const rows = layout();
    const index = rows.indexOf('질문-게시판');
    const posts = rows.slice(index + 1, index + 6);
    expect(posts).toHaveLength(5);
    expect(posts.every((post) => post.startsWith('  '))).toBe(true);
    expect(rowOf(posts[0].trim()).classList.contains('sb-channel--thread')).toBe(true);
    expect(rows[index + 6]).toBe('design');
    expect(checked(channelBox(posts[0].trim()))).toBe('false');

    const openChannel = vi.fn(async () => undefined);
    act(() => appStore.setState({ openChannel }));
    fireEvent.click(forum);
    expect(openChannel).not.toHaveBeenCalled();
    expect(appStore.getState().activeChannelId).toBeNull();
    expect(button('질문-게시판').getAttribute('aria-expanded')).toBe('false');
    expect(rowOf('질문-게시판').classList.contains('sb-channel--folded')).toBe(true);
    const folded = layout();
    expect(folded[folded.indexOf('질문-게시판') + 1]).toBe('design');

    fireEvent.click(button('질문-게시판'));
    expect(button('질문-게시판').getAttribute('aria-expanded')).toBe('true');
    expect(layout()).toEqual(rows);
  });

  it('a ticked or open post stays visible while its forum is folded', async () => {
    await setup();
    await openBig();
    const rows = layout();
    const posts = rows.slice(rows.indexOf('질문-게시판') + 1, rows.indexOf('질문-게시판') + 6).map((post) => post.trim());
    fireEvent.click(channelBox(posts[2]));
    await act(async () => {
      fireEvent.click(button(posts[0]));
    });
    await settle();

    fireEvent.click(button('질문-게시판'));
    const folded = layout();
    expect(folded.slice(folded.indexOf('질문-게시판') + 1, folded.indexOf('design'))).toEqual([`  ${posts[0]}`, `  ${posts[2]}`]);
  });

  it('a post opens like a channel', async () => {
    await setup();
    await openBig();
    const rows = layout();
    const post = rows[rows.indexOf('질문-게시판') + 1].trim();
    await act(async () => {
      fireEvent.click(button(post));
    });
    await settle();
    const postId = (bigTree().threadsByParent[MOCK_IDS.forumChannel] ?? [])[0].id;
    expect(appStore.getState().activeChannelId).toBe(postId);
    expect(appStore.getState().messages[postId]?.status).toBe('loaded');
    expect(button(post).getAttribute('aria-current')).toBe('page');
  });
});

describe('keyboard', () => {
  it('ArrowUp / ArrowDown / Home / End move the focus between rows and skip the rows of folded categories', async () => {
    await setup();
    await openBig();
    fireEvent.click(button(GENERAL));

    const header = button(GENERAL);
    header.focus();
    fireEvent.keyDown(header, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('🔊 VOICE 음성'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(header);
    fireEvent.keyDown(header, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(button('🔊 로비 Lobby'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(button('👋｜welcome'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    const buttons = Array.from(sidebar().querySelectorAll<HTMLElement>('[data-sb-nav]'));
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('works from the checkbox of a row too', async () => {
    await setup();
    await openBig();
    channelBox('👋｜welcome').focus();
    fireEvent.keyDown(channelBox('👋｜welcome'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(button('📣｜공지사항'));
  });

  it('the server checkbox in the header is not part of the row navigation', async () => {
    await setup();
    await openBig();
    const header = box(SERVER_BOX);
    header.focus();
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    header.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(header);
  });

  it('every row is a real button', async () => {
    await setup();
    await openBig();
    for (const element of sidebar().querySelectorAll('[data-sb-nav]')) {
      expect(element.tagName).toBe('BUTTON');
      expect(element.getAttribute('type')).toBe('button');
    }
  });
});
