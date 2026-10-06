// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/app/components/sidebar/Sidebar';
import { selectFilteredDms, selectSelectedTargets } from '@/app/state/selectors';
import { appStore } from '@/app/state/store';
import type { DmNode } from '@/lib/discord/model';
import { MOCK_IDS } from '@/lib/discord/mock';
import { bootApp, settle, trackConsole } from '../rail/helpers';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

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

function dms(): DmNode[] {
  return appStore.getState().dms;
}

function dmNamed(name: string): DmNode {
  const found = dms().find((dm) => dm.name === name);
  if (found === undefined) throw new Error(`no DM named ${name}`);
  return found;
}

function filterInput(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement;
}

function rowButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-sb-nav]'));
}

/** The row whose name is exactly `name` (matching by accessible name would also hit group chats that list the person). */
function rowOf(name: string): HTMLElement {
  const label = Array.from(document.querySelectorAll('.sb-dm__name')).find((element) => element.textContent === name);
  const row = label?.closest('li');
  if (row === null || row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

function sectionCheckbox(): HTMLElement {
  return screen.getByRole('checkbox', { name: /^Select all/ });
}

function type(value: string): void {
  fireEvent.change(filterInput(), { target: { value } });
}

describe('DM view layout', () => {
  it('is the aside of the shell with the app-sidebar class and the DM filter + list inside', async () => {
    await bootApp();
    const { container } = render(<Sidebar />);
    const root = container.firstElementChild;
    expect(root?.tagName).toBe('ASIDE');
    expect(root?.classList.contains('app-sidebar')).toBe(true);
    expect(screen.getByRole('complementary', { name: 'Direct Messages' })).toBe(root);
    expect(filterInput().placeholder).toBe('Find a conversation');
    expect(screen.getByRole('heading', { name: 'Direct Messages', level: 2 })).toBeTruthy();
  });

  it('lists every conversation, newest first, one row each', async () => {
    await bootApp();
    render(<Sidebar />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(dms().length);
    expect(dms().length).toBeGreaterThan(30);
    expect(rowButtons().map((button) => button.querySelector('.sb-dm__name')?.textContent)).toEqual(dms().map((dm) => dm.name));
  });

  it('speaks Korean when the locale is ko', async () => {
    await bootApp({ locale: 'ko' });
    render(<Sidebar />);
    expect(screen.getByRole('textbox', { name: '대화 찾기' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '다이렉트 메시지' })).toBeTruthy();
    expect(screen.getByText('멤버 5명')).toBeTruthy();
  });

  it('shows the member count under the name of group conversations only (yourself included)', async () => {
    await bootApp();
    render(<Sidebar />);
    const group = dmNamed('주말 보드게임 모임 🎲');
    expect(group.recipients).toHaveLength(4);
    expect(within(rowOf(group.name)).getByText('5 members')).toBeTruthy();
    expect(within(rowOf('김민준')).queryByText(/member/)).toBeNull();
    const subs = document.querySelectorAll('.sb-dm__sub');
    expect(subs).toHaveLength(dms().filter((dm) => dm.kind === 'group-dm').length);
  });

  it('shows the avatar image of the conversation and falls back to an initial when it cannot be loaded', async () => {
    await bootApp();
    render(<Sidebar />);
    const row = rowOf('Alex Rivera');
    const image = row.querySelector('img');
    expect(image?.getAttribute('src')).toBe(dmNamed('Alex Rivera').iconUrl);
    expect(image?.getAttribute('alt')).toBe('');
    fireEvent.error(image as HTMLImageElement);
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.sb-dm__fallback')?.textContent).toBe('A');
  });

  it('never loads an avatar from a host that is not Discord', async () => {
    await bootApp();
    const dm = dmNamed('Alex Rivera');
    appStore.setState({ dms: [{ ...dm, iconUrl: 'https://tracker.example/a.png' }] });
    render(<Sidebar />);
    expect(rowOf('Alex Rivera').querySelector('img')).toBeNull();
  });

  it('renders names as plain text', async () => {
    await bootApp();
    const dm = dmNamed('Alex Rivera');
    appStore.setState({ dms: [{ ...dm, name: '<img src=x onerror=alert(1)>' }] });
    const { container } = render(<Sidebar />);
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });
});

describe('opening a conversation', () => {
  it('click opens it in the DM view; the open row is aria-current and highlighted', async () => {
    await bootApp();
    render(<Sidebar />);
    const alex = dmNamed('Alex Rivera');
    expect(rowButtons().every((button) => button.getAttribute('aria-current') === null)).toBe(true);

    await act(async () => {
      fireEvent.click(within(rowOf(alex.name)).getAllByRole('button')[0]);
    });
    await settle();
    expect(appStore.getState().activeChannelId).toBe(alex.id);
    expect(appStore.getState().view).toEqual({ kind: 'dms' });

    const current = rowButtons().filter((button) => button.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(rowOf(alex.name).classList.contains('sb-row--active')).toBe(true);
    expect(document.querySelectorAll('.sb-row--active')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(rowButtons()[0]);
    });
    await settle();
    expect(rowOf(alex.name).classList.contains('sb-row--active')).toBe(false);
    expect(document.querySelectorAll('.sb-row--active')).toHaveLength(1);
  });

  it('calls openChannel(id, null)', async () => {
    await bootApp();
    const openChannel = vi.fn(async () => undefined);
    appStore.setState({ openChannel });
    render(<Sidebar />);
    fireEvent.click(rowButtons()[3]);
    expect(openChannel).toHaveBeenCalledExactlyOnceWith(dms()[3].id, null);
  });
});

describe('filter box', () => {
  it('filters the list as you type and shows how many conversations match', async () => {
    await bootApp();
    render(<Sidebar />);
    expect(document.querySelector('.sb-section__count')).toBeNull();

    type('alex');
    const matches = selectFilteredDms(appStore.getState());
    expect(matches.length).toBeGreaterThan(1);
    expect(matches.length).toBeLessThan(dms().length);
    expect(screen.getAllByRole('listitem')).toHaveLength(matches.length);
    expect(document.querySelector('.sb-section__count')?.textContent).toBe(String(matches.length));
    expect(appStore.getState().dmFilter).toBe('alex');
    expect(screen.getByText(`${matches.length} matches`)).toBeTruthy();
  });

  it('matches case-insensitively and by member username', async () => {
    await bootApp();
    render(<Sidebar />);
    type('  ALEX_R ');
    expect(rowButtons().map((button) => button.querySelector('.sb-dm__name')?.textContent)).toContain('Alex Rivera');
    type('김민준');
    expect(rowButtons().length).toBeGreaterThanOrEqual(2);
  });

  it('shows a clear button only when there is text; it empties the box and puts the focus back', async () => {
    await bootApp();
    render(<Sidebar />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    type('alex');
    const clear = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.click(clear);
    expect(filterInput().value).toBe('');
    expect(appStore.getState().dmFilter).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(document.activeElement).toBe(filterInput());
    expect(screen.getAllByRole('listitem')).toHaveLength(dms().length);
  });

  it('Escape clears the text', async () => {
    await bootApp();
    render(<Sidebar />);
    type('alex');
    fireEvent.keyDown(filterInput(), { key: 'Escape' });
    expect(filterInput().value).toBe('');
    // Nothing to clear: the key is left alone.
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    filterInput().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('shows an empty state for no match (with the typed text) and for no conversations at all', async () => {
    await bootApp();
    render(<Sidebar />);
    type('zzz-nobody');
    expect(screen.getByText('No conversations match "zzz-nobody"')).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(sectionCheckbox().getAttribute('aria-label')).toBe('Select all 0 matching conversations');
    expect((sectionCheckbox() as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    await bootApp();
    appStore.setState({ dms: [] });
    render(<Sidebar />);
    expect(screen.getByText('No conversations yet')).toBeTruthy();
    expect((sectionCheckbox() as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the empty-state texts in Korean too', async () => {
    await bootApp({ locale: 'ko' });
    render(<Sidebar />);
    type('없는사람');
    expect(screen.getByText('"없는사람"에 해당하는 대화가 없어요')).toBeTruthy();
  });
});

describe('export checkboxes', () => {
  it('every row has its own checkbox on the right, revealed on hover / focus or when ticked', async () => {
    await bootApp();
    render(<Sidebar />);
    const boxes = screen.getAllByRole('checkbox').filter((box) => box.closest('li') !== null);
    expect(boxes).toHaveLength(dms().length);
    for (const box of boxes) {
      expect(box.classList.contains('dce-checkbox--reveal')).toBe(true);
      expect(box.closest('li')?.classList.contains('dce-reveal-host')).toBe(true);
    }
  });

  it('ticks and unticks one conversation without opening it', async () => {
    await bootApp();
    render(<Sidebar />);
    const alex = dmNamed('Alex Rivera');
    const box = screen.getByRole('checkbox', { name: 'Select Alex Rivera for export' });

    fireEvent.click(box);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(appStore.getState().selection[alex.id]).toMatchObject({ kind: 'dm', guildId: null });
    expect(appStore.getState().activeChannelId).toBeNull();
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('mixed');

    fireEvent.click(box);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(appStore.getState().selection).toEqual({});
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('false');
  });

  it('the section checkbox selects every conversation and deselects them again', async () => {
    await bootApp();
    render(<Sidebar />);
    expect(sectionCheckbox().getAttribute('aria-label')).toBe('Select all conversations');

    fireEvent.click(sectionCheckbox());
    expect(Object.keys(appStore.getState().selection)).toHaveLength(dms().length);
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(dms().length + 1);

    fireEvent.click(sectionCheckbox());
    expect(appStore.getState().selection).toEqual({});
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('false');
  });

  it('applies to the filtered list only, and says how many that are', async () => {
    await bootApp();
    render(<Sidebar />);
    type('alex');
    const matches = selectFilteredDms(appStore.getState());
    expect(sectionCheckbox().getAttribute('aria-label')).toBe(`Select all ${matches.length} matching conversations`);

    fireEvent.click(sectionCheckbox());
    expect(
      selectSelectedTargets(appStore.getState())
        .map((target) => target.channelId)
        .sort(),
    ).toEqual(matches.map((dm) => dm.id).sort());
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('true');

    // Without the filter the same selection is only partial; the next press selects the rest.
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('mixed');
    expect(sectionCheckbox().getAttribute('aria-label')).toBe('Select all conversations');
    fireEvent.click(sectionCheckbox());
    expect(Object.keys(appStore.getState().selection)).toHaveLength(dms().length);
  });

  it('deselecting with a filter leaves the selection outside the filter alone', async () => {
    await bootApp();
    render(<Sidebar />);
    fireEvent.click(sectionCheckbox());
    type('legacy');
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sectionCheckbox());
    expect(Object.keys(appStore.getState().selection)).toHaveLength(dms().length - 1);
  });

  it('a conversation that answered 403 is locked: no checkbox, a lock and a tooltip', async () => {
    await bootApp();
    render(<Sidebar />);
    const alex = dmNamed('Alex Rivera');
    act(() => appStore.setState({ forbiddenChannels: { [alex.id]: true } }));
    const row = rowOf('Alex Rivera');
    expect(row.classList.contains('sb-row--locked')).toBe(true);
    expect(within(row).queryByRole('checkbox')).toBeNull();
    expect(row.querySelector('.sb-row__lock')).not.toBeNull();
    expect(within(row).getByRole('button').getAttribute('title')).toBe('Alex Rivera - No access');
  });

  it('the keyboard focus on the box of a conversation that answers 403 moves to its row instead of being dropped to <body>', async () => {
    await bootApp();
    render(<Sidebar />);
    const alex = dmNamed('Alex Rivera');
    const checkbox = screen.getByRole('checkbox', { name: 'Select Alex Rivera for export' });
    act(() => checkbox.focus());
    expect(document.activeElement).toBe(checkbox);

    act(() => appStore.setState({ forbiddenChannels: { [alex.id]: true } }));
    expect(within(rowOf('Alex Rivera')).queryByRole('checkbox')).toBeNull();
    expect(document.activeElement).toBe(within(rowOf('Alex Rivera')).getByRole('button'));
  });

  it('the checkboxes follow the store when the selection changes elsewhere', async () => {
    await bootApp();
    render(<Sidebar />);
    act(() => appStore.getState().toggleChannel(MOCK_IDS.dmFriend));
    expect(screen.getByRole('checkbox', { name: `Select ${dmNamed('김민준').name} for export` }).getAttribute('aria-checked')).toBe('true');
    act(() => appStore.getState().clearSelection());
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
  });
});

describe('keyboard', () => {
  it('every row is a real button and the checkboxes are separately focusable buttons', async () => {
    await bootApp();
    render(<Sidebar />);
    for (const button of rowButtons()) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
    expect(screen.getAllByRole('checkbox')[0].tagName).toBe('BUTTON');
  });

  it('ArrowDown in the filter box enters the list; arrows, Home and End move between rows', async () => {
    await bootApp();
    render(<Sidebar />);
    filterInput().focus();
    fireEvent.keyDown(filterInput(), { key: 'ArrowDown' });
    const rows = rowButtons();
    expect(document.activeElement).toBe(rows[0]);

    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: 'End' });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(rows[rows.length - 1], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(rows[rows.length - 1], { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('arrows work from a row\'s checkbox as well, and other keys are left alone', async () => {
    await bootApp();
    render(<Sidebar />);
    const rows = rowButtons();
    const box = within(rows[1].closest('li') as HTMLElement).getByRole('checkbox');
    box.focus();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    rows[2].dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    const modified = new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true });
    rows[2].dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(rows[2]);
  });

  it('ArrowDown with an empty list does not throw', async () => {
    await bootApp();
    render(<Sidebar />);
    type('zzz-nobody');
    filterInput().focus();
    expect(() => fireEvent.keyDown(filterInput(), { key: 'ArrowDown' })).not.toThrow();
    expect(document.activeElement).toBe(filterInput());
  });
});

describe('long lists', () => {
  function manyDms(count: number): DmNode[] {
    const template = dms()[1];
    return Array.from({ length: count }, (_, index) => ({ ...template, id: `9${String(index).padStart(5, '0')}`, name: `Person ${index}`, recipients: [{ ...template.recipients[0], id: `8${index}`, name: `Person ${index}`, username: `person_${index}` }] }));
  }

  it('renders 600 conversations, filters them and selects the filtered ones', async () => {
    await bootApp();
    appStore.setState({ dms: manyDms(600) });
    render(<Sidebar />);
    expect(screen.getAllByRole('listitem')).toHaveLength(600);

    type('person 59');
    // "Person 59", "Person 590" .. "Person 599"
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    fireEvent.click(sectionCheckbox());
    expect(Object.keys(appStore.getState().selection)).toHaveLength(11);

    type('');
    expect(screen.getAllByRole('listitem')).toHaveLength(600);
    expect(sectionCheckbox().getAttribute('aria-checked')).toBe('mixed');
  });
});
