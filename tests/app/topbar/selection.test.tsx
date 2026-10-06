// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { ExportTarget } from '@/lib/export/types';
import { bootTopBar, select } from './helpers';

vi.mock('@/lib/export/download', () => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  cleanup();
});

const chip = (name: RegExp | string = /selected|선택됨/): HTMLElement => screen.getByRole('button', { name });
const popover = (): HTMLElement => screen.getByRole('dialog', { name: /Selected chats|선택한 항목/ });
const selectionCount = (): number => Object.keys(appStore.getState().selection).length;

/** Two channels of the main server, one thread and one DM. */
async function bootWithSelection(locale: 'en' | 'ko' = 'en'): Promise<void> {
  await bootTopBar(locale);
  select(MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel, MOCK_IDS.generalThread, MOCK_IDS.dmFriend);
}

describe('selection chip', () => {
  it('shows the number of selected targets in English', async () => {
    await bootWithSelection();
    render(<TopBar />);
    expect(chip().textContent).toBe('4 selected');
  });

  it('and in Korean', async () => {
    await bootWithSelection('ko');
    render(<TopBar />);
    expect(chip().textContent).toBe('4개 선택됨');
  });

  it('keeps the number apart from its words, so a narrow bar can drop the words (icon + number stay)', async () => {
    await bootWithSelection();
    const { unmount } = render(<TopBar />);
    expect(chip().querySelector('.topbar__chip-count')?.textContent).toBe('4');
    expect(chip().querySelector('.topbar__chip-rest')?.textContent).toBe(' selected');
    expect(chip().querySelector('svg')).not.toBeNull();
    // The full text is the tooltip and the accessible name, whatever the layout shows.
    expect(chip().getAttribute('title')).toBe('4 selected');
    expect(screen.getByRole('button', { name: '4 selected' })).toBe(chip());
    unmount();

    act(() => appStore.setState({ locale: 'ko' }));
    render(<TopBar />);
    expect(chip().querySelector('.topbar__chip-count')?.textContent).toBe('4');
    expect(chip().querySelector('.topbar__chip-rest')?.textContent).toBe('개 선택됨');
    expect(chip().getAttribute('title')).toBe('4개 선택됨');
  });

  it('splits a formatted number the same way', async () => {
    await bootTopBar('en');
    const base = {
      kind: 'text',
      channelName: 'x',
      guildId: null,
      guildName: null,
      categoryName: null,
      parentChannelName: null,
      topic: null,
    } as const;
    const selection: Record<string, ExportTarget> = {};
    for (let index = 0; index < 1234; index += 1) selection[`id${index}`] = { ...base, channelId: `id${index}` };
    act(() => appStore.setState({ selection }));
    render(<TopBar />);
    expect(chip().querySelector('.topbar__chip-count')?.textContent).toBe('1,234');
    expect(chip().querySelector('.topbar__chip-rest')?.textContent).toBe(' selected');
  });

  it('counts with the number format of the language', async () => {
    await bootTopBar('en');
    const base = {
      kind: 'text',
      channelName: 'x',
      guildId: null,
      guildName: null,
      categoryName: null,
      parentChannelName: null,
      topic: null,
    } as const;
    const selection: Record<string, ExportTarget> = {};
    for (let index = 0; index < 1234; index += 1) selection[`id${index}`] = { ...base, channelId: `id${index}` };
    act(() => appStore.setState({ selection }));
    render(<TopBar />);
    expect(chip().textContent).toBe('1,234 selected');
  });

  it('follows the selection', async () => {
    await bootWithSelection();
    render(<TopBar />);
    select(MOCK_IDS.edge200Channel);
    expect(chip().textContent).toBe('5 selected');
    select(MOCK_IDS.edge200Channel);
    expect(chip().textContent).toBe('4 selected');
  });

  it('is muted and does nothing while nothing is selected', async () => {
    await bootTopBar();
    render(<TopBar />);
    const empty = chip();
    expect(empty.textContent).toBe('0 selected');
    expect(empty.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(empty);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(empty.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a real button that announces its popover', async () => {
    await bootWithSelection();
    render(<TopBar />);
    const button = chip();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(popover().id);
  });
});

describe('selection popover', () => {
  it('opens under the chip and lists the targets grouped by server and Direct Messages', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());

    const list = popover();
    const guildName = appStore.getState().guilds[0].name;
    const headings = within(list)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([guildName, 'Direct Messages']);

    const groups = list.querySelectorAll('.topbar-sel__group');
    const names = (group: Element): string[] => Array.from(group.querySelectorAll('.topbar-sel__name')).map((node) => node.textContent ?? '');
    expect(names(groups[0]).some((name) => name.endsWith('general'))).toBe(true);
    expect(names(groups[0]).some((name) => name.includes('edge-199'))).toBe(true);
    expect(names(groups[1])).toHaveLength(1);
  });

  it('shows a thread with its parent channel', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    const parents = Array.from(popover().querySelectorAll('.topbar-sel__parent')).map((node) => node.textContent);
    expect(parents).toEqual(['general']);
  });

  it('is anchored in the page body (a fixed 360px panel with an accessible name)', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    const panel = popover();
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.width).toBe('360px');
    expect(panel.style.maxHeight).toBe('60vh');
  });

  it('lists nothing but real text (names are never interpreted as markup)', async () => {
    await bootTopBar();
    act(() =>
      appStore.setState({
        selection: {
          evil: {
            channelId: 'evil',
            kind: 'text',
            channelName: '<img src=x onerror=alert(1)>',
            guildId: 'g',
            guildName: '<b>Server</b>',
            categoryName: null,
            parentChannelName: null,
            topic: null,
          },
        },
      }),
    );
    render(<TopBar />);
    fireEvent.click(chip());
    const panel = popover();
    expect(panel.querySelector('img, b')).toBeNull();
    expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel.textContent).toContain('<b>Server</b>');
  });

  it('removes one target with its x button', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    fireEvent.click(within(popover()).getByRole('button', { name: 'Remove general from the selection' }));

    expect(Object.keys(appStore.getState().selection)).not.toContain(MOCK_IDS.generalChannel);
    expect(selectionCount()).toBe(3);
    expect(chip().textContent).toBe('3 selected');
    expect(within(popover()).queryByRole('button', { name: 'Remove general from the selection' })).toBeNull();
  });

  it('removing the only member of a group removes the group', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    const dmName = appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';
    fireEvent.click(within(popover()).getByRole('button', { name: `Remove ${dmName} from the selection` }));
    expect(within(popover()).queryByText('Direct Messages')).toBeNull();
  });

  it('"Clear all" empties the selection, closes the popover and returns the focus to the chip', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    fireEvent.click(within(popover()).getByRole('button', { name: 'Clear all' }));

    expect(selectionCount()).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chip());
    expect(chip().textContent).toBe('0 selected');
  });

  it('removing the last row closes the popover and keeps the focus on the chip', async () => {
    await bootTopBar();
    select(MOCK_IDS.edge199Channel);
    render(<TopBar />);
    fireEvent.click(chip());
    // The list opens on the first row's gear: the harmless action comes first, the x is never the default focus.
    expect(document.activeElement).toBe(within(popover()).getByRole('button', { name: /^Export settings for edge-199/ }));
    const remove = within(popover()).getByRole('button', { name: /^Remove edge-199/ });
    fireEvent.click(remove);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chip());
  });

  it('removing a row hands the focus to the next remove button', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    const buttons = (): HTMLElement[] => within(popover()).getAllByRole('button', { name: /^Remove / });
    expect(document.activeElement).toBe(within(popover()).getAllByRole('button', { name: /^Export settings for / })[0]);
    fireEvent.click(buttons()[0]);
    expect(buttons()).toHaveLength(3);
    expect(document.activeElement).toBe(buttons()[0]);

    // The last row's button: focus moves to the one before it.
    const last = buttons()[2];
    last.focus();
    fireEvent.click(last);
    expect(buttons()).toHaveLength(2);
    expect(document.activeElement).toBe(buttons()[1]);
  });

  describe('a key held down (NEW-EXP-01)', () => {
    /** What the browser does with Enter on a focused button: `keydown`, then (unless that was cancelled) a click on it, for the repeats of a held key too. */
    function pressEnter(repeat = false): void {
      const key = document.activeElement ?? document.body;
      const proceed = fireEvent.keyDown(key, { key: 'Enter', repeat });
      if (proceed && key instanceof HTMLButtonElement && !key.disabled) fireEvent.click(key);
    }
    const removeButtons = (): HTMLElement[] => within(popover()).getAllByRole('button', { name: /^Remove / });

    it('Enter held on an x removes one chat: the repeats land on the next x, which they do not press', async () => {
      await bootWithSelection();
      render(<TopBar />);
      fireEvent.click(chip());
      removeButtons()[0].focus();

      pressEnter();
      expect(selectionCount()).toBe(3);
      expect(document.activeElement).toBe(removeButtons()[0]);
      for (let repeats = 0; repeats < 6; repeats += 1) pressEnter(true);
      expect(selectionCount()).toBe(3);

      // A new press is a new decision.
      pressEnter();
      expect(selectionCount()).toBe(2);
    });

    it('Enter held on the chip opens the list; the repeats do not press the gear it focuses', async () => {
      await bootWithSelection();
      render(<TopBar />);
      chip().focus();
      pressEnter();
      const gear = within(popover()).getAllByRole('button', { name: /^Export settings for / })[0];
      expect(document.activeElement).toBe(gear);

      for (let repeats = 0; repeats < 4; repeats += 1) pressEnter(true);
      expect(gear.getAttribute('aria-expanded')).toBe('false');
      expect(within(popover()).queryByRole('group', { name: /^Export settings for / })).toBeNull();

      pressEnter();
      expect(gear.getAttribute('aria-expanded')).toBe('true');
    });

    it('the x, the gear and "Clear all" ignore the repeats of Enter and Space, never of Tab', async () => {
      await bootWithSelection();
      render(<TopBar />);
      fireEvent.click(chip());
      const remove = removeButtons()[0];
      const buttons = [remove, within(popover()).getAllByRole('button', { name: /^Export settings for / })[0], within(popover()).getByRole('button', { name: 'Clear all' })];
      for (const button of buttons) {
        button.focus();
        const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
        expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true }), name).toBe(false);
        expect(fireEvent.keyDown(button, { key: ' ', repeat: true }), name).toBe(false);
        expect(fireEvent.keyDown(button, { key: 'Enter' }), name).toBe(true);
      }
      // Tab keeps repeating (and wraps at the end of the list, which is the popover's own business).
      remove.focus();
      expect(fireEvent.keyDown(remove, { key: 'Tab', repeat: true })).toBe(true);
      expect(selectionCount()).toBe(4);
    });
  });

  it('a server name that the heading cuts off with an ellipsis is its tooltip; Direct Messages needs none (V-LAYOUT-07)', async () => {
    await bootTopBar();
    const longName = 'The Extremely Long Server Name That Keeps Going On And On Until It Cannot Possibly Fit In The List';
    const base = { kind: 'text', categoryName: null, parentChannelName: null, topic: null } as const;
    act(() =>
      appStore.setState({
        selection: {
          a: { ...base, channelId: 'a', channelName: 'general', guildId: 'g', guildName: longName },
          b: { ...base, channelId: 'b', channelName: 'friend', guildId: null, guildName: null },
        },
      }),
    );
    render(<TopBar />);
    fireEvent.click(chip());
    const [server, direct] = within(popover()).getAllByRole('heading', { level: 3 });
    expect(server.textContent).toBe(longName);
    expect(server.getAttribute('title')).toBe(longName);
    expect(direct.textContent).toBe('Direct Messages');
    expect(direct.hasAttribute('title')).toBe(false);
  });

  it('moves the focus into the popover when it opens', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    expect(popover().contains(document.activeElement)).toBe(true);
  });

  it('Esc closes it and returns the focus to the chip', async () => {
    await bootWithSelection();
    render(<TopBar />);
    chip().focus();
    fireEvent.click(chip());
    expect(popover()).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chip());
    expect(chip().getAttribute('aria-expanded')).toBe('false');
    expect(selectionCount()).toBe(4);
  });

  it('a press outside closes it (and leaves the selection alone)', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(selectionCount()).toBe(4);
  });

  it('a press inside does not close it', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    fireEvent.pointerDown(within(popover()).getAllByRole('heading')[0]);
    expect(popover()).toBeTruthy();
  });

  it('clicking the chip again closes it', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.pointerDown(chip());
    fireEvent.click(chip());
    expect(popover()).toBeTruthy();
    fireEvent.pointerDown(chip());
    fireEvent.click(chip());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps Tab inside while it is open', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    const clear = within(popover()).getByRole('button', { name: 'Clear all' });
    clear.focus();
    fireEvent.keyDown(clear, { key: 'Tab' });
    const first = within(popover()).getAllByRole('button')[0];
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(clear);
  });

  it('is labelled in Korean', async () => {
    await bootWithSelection('ko');
    render(<TopBar />);
    fireEvent.click(chip());
    expect(within(popover()).getByRole('button', { name: '모두 해제' })).toBeTruthy();
    expect(within(popover()).getByText('다이렉트 메시지')).toBeTruthy();
    expect(within(popover()).getByRole('button', { name: 'general 선택 해제' })).toBeTruthy();
  });

  it('closes itself when the selection is emptied elsewhere', async () => {
    await bootWithSelection();
    render(<TopBar />);
    fireEvent.click(chip());
    act(() => appStore.getState().clearSelection());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
