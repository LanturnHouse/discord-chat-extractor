// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/app/components/sidebar/Sidebar';
import { appStore } from '@/app/state/store';
import type { GuildTree } from '@/lib/discord/model';
import { MOCK_IDS } from '@/lib/discord/mock';
import { bootApp, gateGuildChannels, settle, trackConsole } from '../rail/helpers';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

const BIG = MOCK_IDS.bigGuild;

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

const sidebar = (): HTMLElement => screen.getByRole('complementary');
const navButtons = (): HTMLElement[] => Array.from(sidebar().querySelectorAll<HTMLElement>('[data-sb-nav]'));
const list = (): HTMLElement => {
  const element = sidebar().querySelector<HTMLElement>('[data-skip-target="channels"]');
  if (element === null) throw new Error('no list container');
  return element;
};

async function openBig(): Promise<void> {
  await act(async () => {
    await appStore.getState().openGuild(BIG);
  });
}

describe('full names as tooltips on truncated rows (UI-9)', () => {
  it('every conversation row carries its full name', async () => {
    await bootApp();
    render(<Sidebar />);
    const rows = navButtons();
    expect(rows.length).toBeGreaterThan(20);
    const names = appStore.getState().dms.map((dm) => dm.name);
    expect(rows.map((row) => row.getAttribute('title'))).toEqual(names);
    expect(names.some((name) => name.length > 24)).toBe(true);
  });

  it('every category, channel and thread row carries its full name; a locked one also says why', async () => {
    await bootApp();
    render(<Sidebar />);
    await openBig();
    const tree = appStore.getState().trees[BIG].tree as GuildTree;

    const categories = Array.from(sidebar().querySelectorAll<HTMLElement>('.sb-category__main'));
    expect(categories.length).toBeGreaterThan(3);
    for (const category of categories) {
      expect(category.getAttribute('title')).toBe(category.querySelector('.sb-category__name')?.textContent);
    }

    const channels = Array.from(sidebar().querySelectorAll<HTMLElement>('.sb-channel__main'));
    expect(channels.length).toBeGreaterThan(20);
    for (const channel of channels) {
      const name = channel.querySelector('.sb-channel__name')?.textContent ?? '';
      const locked = channel.closest('li')?.classList.contains('sb-channel--locked') === true;
      expect(channel.getAttribute('title'), name).toBe(locked ? `${name} - No access` : name);
    }
    expect(channels.some((channel) => channel.closest('li')?.classList.contains('sb-channel--thread'))).toBe(true);
    expect(channels.some((channel) => channel.closest('li')?.classList.contains('sb-channel--locked'))).toBe(true);
    expect(Object.keys(tree.byId).length).toBeGreaterThan(0);
  });

  it('the server name in the header is a tooltip too', async () => {
    await bootApp();
    render(<Sidebar />);
    await openBig();
    const name = appStore.getState().guilds.find((guild) => guild.id === BIG)?.name;
    const heading = within(sidebar()).getByRole('heading', { level: 2 });
    expect(heading.getAttribute('title')).toBe(name);
    expect(heading.textContent).toBe(name);
  });

  it('keeps the rows readable for screen readers: the name still comes from the content', async () => {
    await bootApp();
    render(<Sidebar />);
    const friend = appStore.getState().dms.find((dm) => dm.kind === 'dm');
    expect(friend).toBeDefined();
    expect(within(sidebar()).getAllByRole('button', { name: friend?.name }).length).toBeGreaterThan(0);
  });
});

describe('the list is a skip-link target and can be entered with the arrow keys (UI-3)', () => {
  it('is a labelled group that can take focus from a script but is not a tab stop', async () => {
    await bootApp();
    render(<Sidebar />);
    expect(list().getAttribute('tabindex')).toBe('-1');
    expect(list().getAttribute('role')).toBe('group');
    expect(list().getAttribute('aria-label')).toBe('Direct Messages');
    list().focus();
    expect(document.activeElement).toBe(list());
  });

  it('is labelled "Channels" in a server', async () => {
    await bootApp();
    render(<Sidebar />);
    await openBig();
    expect(list().getAttribute('aria-label')).toBe('Channels');
    expect(list().getAttribute('tabindex')).toBe('-1');
  });

  it.each([
    ['ArrowDown', 0],
    ['Home', 0],
    ['ArrowUp', -1],
    ['End', -1],
  ])('%s on the container itself moves into the list', async (key, index) => {
    await bootApp();
    render(<Sidebar />);
    list().focus();
    expect(fireEvent.keyDown(list(), { key })).toBe(false);
    const rows = navButtons();
    expect(document.activeElement).toBe(rows.at(index));
  });

  it('works in a server as well, and leaves modified keys alone', async () => {
    await bootApp();
    render(<Sidebar />);
    await openBig();
    list().focus();
    expect(fireEvent.keyDown(list(), { key: 'ArrowDown', ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(list());
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(navButtons()[0]);
  });

  it('does nothing while the list has no rows (skeleton)', async () => {
    const client = await bootApp();
    gateGuildChannels(client);
    render(<Sidebar />);
    await act(async () => {
      void appStore.getState().openGuild(BIG);
    });
    expect(navButtons()).toHaveLength(0);
    list().focus();
    expect(fireEvent.keyDown(list(), { key: 'ArrowDown' })).toBe(true);
    expect(document.activeElement).toBe(list());
  });
});

describe('the server checkbox of the sidebar header while its channels load (UI-7)', () => {
  it('stays focusable (busy, not disabled), ignores presses, and applies the selection once', async () => {
    const client = await bootApp();
    const { release } = gateGuildChannels(client);
    render(<Sidebar />);
    await act(async () => {
      void appStore.getState().openGuild(BIG);
    });
    const header = within(sidebar()).getByRole('checkbox', { name: 'Select every channel of this server' }) as HTMLButtonElement;
    header.focus();
    expect(header.disabled).toBe(false);
    expect(header.getAttribute('aria-busy')).toBe('true');

    fireEvent.click(header);
    fireEvent.click(header);
    expect(document.activeElement).toBe(header);

    await act(async () => {
      release();
    });
    await settle();
    expect(header.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(header);
    // Both presses were ignored: nothing is selected.
    expect(appStore.getState().selection).toEqual({});

    fireEvent.click(header);
    await settle();
    expect(Object.keys(appStore.getState().selection).length).toBeGreaterThan(0);
  });
});
