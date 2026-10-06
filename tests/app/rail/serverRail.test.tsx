// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerRail } from '@/app/components/rail/ServerRail';
import { selectSelectedTargets, selectSelectionCountForGuild } from '@/app/state/selectors';
import { appStore } from '@/app/state/store';
import type { GuildTree } from '@/lib/discord/model';
import type { ExportTarget } from '@/lib/export/types';
import { MOCK_IDS } from '@/lib/discord/mock';
import { acronymOf } from '@/lib/message';
import { bootApp, gateGuildChannels, settle, trackConsole } from './helpers';

// The export formats are irrelevant here; keeping them out keeps this suite independent of the format modules.
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

function guilds() {
  return appStore.getState().guilds;
}

function rail(): HTMLElement {
  return screen.getByRole('navigation');
}

function guildButton(name: string): HTMLElement {
  return within(rail()).getByRole('button', { name });
}

/** The 48px slot (`.rail__item`) around a button of the rail. */
function itemOf(button: HTMLElement): HTMLElement {
  const item = button.closest('.rail__item');
  if (!(item instanceof HTMLElement)) throw new Error('not inside a rail item');
  return item;
}

function guildCheckbox(name: string): HTMLElement {
  return within(rail()).getByRole('checkbox', { name: `Select every channel of ${name}` });
}

function badgeOf(button: HTMLElement): string | null {
  return itemOf(button).querySelector('.rail__badge')?.textContent ?? null;
}

describe('ServerRail structure', () => {
  it('is the navigation landmark with the app-rail class (the shell positions it by that class)', async () => {
    await bootApp();
    const { container } = render(<ServerRail />);
    const nav = container.firstElementChild;
    expect(nav?.tagName).toBe('NAV');
    expect(nav?.classList.contains('app-rail')).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Servers' })).toBe(nav);
  });

  it('shows "Direct Messages" first, a separator, then every server in API order', async () => {
    await bootApp();
    render(<ServerRail />);

    const buttons = within(rail())
      .getAllByRole('button')
      .filter((button) => button.classList.contains('rail__icon'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Direct Messages', ...guilds().map((guild) => guild.name)]);
    expect(guilds()).toHaveLength(9);
    expect(within(rail()).getAllByRole('listitem')).toHaveLength(guilds().length);
    expect(within(rail()).getByRole('separator')).toBeTruthy();
  });

  it('renders no separator or list while there are no servers', async () => {
    await bootApp();
    appStore.setState({ guilds: [] });
    render(<ServerRail />);
    expect(within(rail()).queryByRole('separator')).toBeNull();
    expect(within(rail()).queryByRole('list')).toBeNull();
    expect(within(rail()).getByRole('button', { name: 'Direct Messages' })).toBeTruthy();
  });

  it('speaks Korean when the locale is ko', async () => {
    await bootApp({ locale: 'ko' });
    render(<ServerRail />);
    expect(screen.getByRole('navigation', { name: '서버 목록' })).toBeTruthy();
    expect(within(rail()).getByRole('button', { name: '다이렉트 메시지' })).toBeTruthy();
    expect(within(rail()).getByRole('checkbox', { name: `${guilds()[0].name} 서버의 모든 채널 선택` })).toBeTruthy();
  });

  it('has no inline colours or sizes of its own (everything comes from the stylesheet)', async () => {
    await bootApp();
    const { container } = render(<ServerRail />);
    const styled = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter((element) => !element.style.getPropertyValue('--dce-checkbox-size') && !element.style.getPropertyValue('--dce-spinner-size'));
    expect(styled).toEqual([]);
  });
});

describe('server icons', () => {
  it('shows the icon image when the server has one, with an empty alt (the button carries the name)', async () => {
    await bootApp();
    render(<ServerRail />);
    for (const guild of guilds().filter((candidate) => candidate.iconUrl !== null)) {
      const image = guildButton(guild.name).querySelector('img');
      expect(image, guild.name).not.toBeNull();
      expect(image?.getAttribute('src')).toBe(guild.iconUrl);
      expect(image?.getAttribute('alt')).toBe('');
      expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(guildButton(guild.name).querySelector('.rail__acronym')).toBeNull();
    }
  });

  it('shows the acronym when there is no icon: first letters of each word, emoji and CJK safe', async () => {
    await bootApp();
    render(<ServerRail />);
    const iconless = guilds().filter((guild) => guild.iconUrl === null);
    expect(iconless.map((guild) => guild.name)).toEqual(['🎮🔥 Game Night 🎲✨', 'A/B:C*?', 'Archive of 2024...']);
    expect(iconless.map((guild) => guildButton(guild.name).textContent)).toEqual(['🎮GN🎲', 'A', 'Ao2']);
    for (const guild of iconless) expect(guildButton(guild.name).querySelector('img')).toBeNull();
  });

  it('marks the acronym length so 3 and 4 glyphs get a smaller font', async () => {
    await bootApp();
    render(<ServerRail />);
    const glyphs = (name: string): string | null | undefined => guildButton(name).querySelector('.rail__acronym')?.getAttribute('data-glyphs');
    expect(glyphs('A/B:C*?')).toBe('1');
    expect(glyphs('Archive of 2024...')).toBe('3');
    expect(glyphs('🎮🔥 Game Night 🎲✨')).toBe('4');
  });

  it('falls back to the acronym when the image cannot be loaded, never to the browser broken-image icon', async () => {
    await bootApp();
    render(<ServerRail />);
    const name = guilds()[0].name;
    const button = guildButton(name);
    const image = button.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image as HTMLImageElement);
    expect(button.querySelector('img')).toBeNull();
    expect(button.textContent).toBe(acronymOf(name));
  });

  it('refuses an icon URL that is not an image on a Discord host', async () => {
    await bootApp();
    appStore.setState({
      guilds: [
        { id: '1', name: 'Tracker', iconUrl: 'https://evil.example/pixel.png', owner: false },
        { id: '2', name: 'Script', iconUrl: 'javascript:alert(1)', owner: false },
      ],
    });
    render(<ServerRail />);
    expect(guildButton('Tracker').querySelector('img')).toBeNull();
    expect(guildButton('Script').querySelector('img')).toBeNull();
    expect(guildButton('Tracker').textContent).toBe('T');
  });

  it('renders hostile names as plain text only', async () => {
    await bootApp();
    const { container } = render(<ServerRail />);
    const hostile = guilds().find((guild) => guild.name.includes('<script>'));
    expect(hostile).toBeDefined();
    expect(guildButton(hostile?.name ?? '')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('open server and the white pill', () => {
  it('starts in the DM view: only the DM button is active', async () => {
    await bootApp();
    render(<ServerRail />);
    expect(guildButton('Direct Messages').getAttribute('aria-current')).toBe('true');
    expect(itemOf(guildButton('Direct Messages')).classList.contains('rail__item--active')).toBe(true);
    for (const guild of guilds()) {
      expect(guildButton(guild.name).getAttribute('aria-current')).toBeNull();
      expect(itemOf(guildButton(guild.name)).classList.contains('rail__item--active')).toBe(false);
    }
  });

  it('every entry has a pill element (hidden / 20px / 40px is decided by the stylesheet)', async () => {
    await bootApp();
    const { container } = render(<ServerRail />);
    expect(container.querySelectorAll('.rail__pill')).toHaveLength(guilds().length + 1);
    for (const pill of container.querySelectorAll('.rail__pill')) expect(pill.getAttribute('aria-hidden')).toBe('true');
  });

  it('clicking a server opens it and moves the active state; the DM button takes it back', async () => {
    await bootApp();
    render(<ServerRail />);
    const first = guilds()[0];
    const second = guilds()[1];

    await act(async () => {
      fireEvent.click(guildButton(first.name));
    });
    await settle();
    expect(appStore.getState().view).toEqual({ kind: 'guild', guildId: first.id });
    expect(guildButton(first.name).getAttribute('aria-current')).toBe('true');
    expect(itemOf(guildButton(first.name)).classList.contains('rail__item--active')).toBe(true);
    expect(guildButton('Direct Messages').getAttribute('aria-current')).toBeNull();

    await act(async () => {
      fireEvent.click(guildButton(second.name));
    });
    await settle();
    expect(guildButton(first.name).getAttribute('aria-current')).toBeNull();
    expect(guildButton(second.name).getAttribute('aria-current')).toBe('true');

    fireEvent.click(guildButton('Direct Messages'));
    expect(appStore.getState().view).toEqual({ kind: 'dms' });
    expect(guildButton('Direct Messages').getAttribute('aria-current')).toBe('true');
    expect(guildButton(second.name).getAttribute('aria-current')).toBeNull();
  });

  it('clicking calls the store actions with the right ids', async () => {
    await bootApp();
    const openGuild = vi.fn(async () => undefined);
    const openDms = vi.fn();
    appStore.setState({ openGuild, openDms });
    render(<ServerRail />);

    fireEvent.click(guildButton(guilds()[2].name));
    expect(openGuild).toHaveBeenCalledExactlyOnceWith(guilds()[2].id);
    fireEvent.click(guildButton('Direct Messages'));
    expect(openDms).toHaveBeenCalledTimes(1);
  });

  it('uses real buttons, so Enter / Space activation and Tab focus come for free', async () => {
    await bootApp();
    render(<ServerRail />);
    for (const button of within(rail()).getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
  });
});

describe('export selection affordances', () => {
  it('shows no badge while nothing is selected, and every server has a (hidden until hover) checkbox', async () => {
    await bootApp();
    const { container } = render(<ServerRail />);
    expect(container.querySelector('.rail__badge')).toBeNull();
    const boxes = within(rail()).getAllByRole('checkbox');
    expect(boxes).toHaveLength(guilds().length);
    for (const box of boxes) {
      expect(box.getAttribute('aria-checked')).toBe('false');
      expect(box.classList.contains('dce-checkbox--reveal')).toBe(true);
      expect(box.closest('.dce-reveal-host')).not.toBeNull();
    }
  });

  it('the server checkbox loads the tree on demand and selects every exportable channel: all -> none', async () => {
    const client = await bootApp();
    const { release } = gateGuildChannels(client);
    render(<ServerRail />);
    const name = guilds()[0].name;
    const item = itemOf(guildButton(name));

    fireEvent.click(guildCheckbox(name));
    // Loading: a tiny spinner sits on the checkbox, which cannot be pressed a second time. It is busy, not disabled, so a keyboard
    // user who just pressed it keeps the focus.
    expect(appStore.getState().trees[BIG].status).toBe('loading');
    expect(item.querySelector('.rail__check-spinner')).not.toBeNull();
    expect((guildCheckbox(name) as HTMLButtonElement).disabled).toBe(false);
    expect(guildCheckbox(name).getAttribute('aria-busy')).toBe('true');
    expect(guildCheckbox(name).classList.contains('dce-checkbox--reveal')).toBe(false);

    await act(async () => {
      release();
    });
    await settle();
    expect(item.querySelector('.rail__check-spinner')).toBeNull();
    expect(guildCheckbox(name).getAttribute('aria-busy')).toBeNull();

    const tree = appStore.getState().trees[BIG].tree as GuildTree;
    const exportable = Object.values(tree.byId).filter((node) => node.canView !== false && ['text', 'announcement', 'voice', 'stage', 'thread'].includes(node.kind));
    expect(selectSelectionCountForGuild(appStore.getState(), BIG)).toBe(exportable.length);
    expect(guildCheckbox(name).getAttribute('aria-checked')).toBe('true');
    expect(guildCheckbox(name).getAttribute('data-state')).toBe('all');
    expect(badgeOf(guildButton(name))).toBe(String(exportable.length));

    await act(async () => {
      fireEvent.click(guildCheckbox(name));
    });
    await settle();
    expect(appStore.getState().selection).toEqual({});
    expect(guildCheckbox(name).getAttribute('aria-checked')).toBe('false');
    expect(badgeOf(guildButton(name))).toBeNull();
  });

  it('a partial selection is mixed, counts in the badge and is announced in words', async () => {
    await bootApp();
    await appStore.getState().ensureGuildTree(BIG);
    render(<ServerRail />);
    const name = guilds()[0].name;

    act(() => {
      appStore.getState().toggleChannel(MOCK_IDS.generalChannel);
      appStore.getState().toggleChannel(MOCK_IDS.edge400Channel);
    });
    expect(guildCheckbox(name).getAttribute('aria-checked')).toBe('mixed');
    expect(badgeOf(guildButton(name))).toBe('2');
    expect(within(itemOf(guildButton(name))).getByText('2 selected')).toBeTruthy();
    // Other servers are untouched.
    expect(badgeOf(guildButton(guilds()[1].name))).toBeNull();

    // Pressing the box of a partial server selects the rest.
    await act(async () => {
      fireEvent.click(guildCheckbox(name));
    });
    await settle();
    expect(guildCheckbox(name).getAttribute('aria-checked')).toBe('true');
  });

  it('the badge of a selection in another server and the DM badge are independent', async () => {
    await bootApp();
    render(<ServerRail />);
    expect(badgeOf(guildButton('Direct Messages'))).toBeNull();

    act(() => {
      appStore.getState().toggleChannel(MOCK_IDS.dmFriend);
      appStore.getState().toggleChannel(MOCK_IDS.dmFriendEnglish);
    });
    expect(badgeOf(guildButton('Direct Messages'))).toBe('2');
    expect(within(itemOf(guildButton('Direct Messages'))).getByText('2 selected')).toBeTruthy();
    for (const guild of guilds()) expect(badgeOf(guildButton(guild.name))).toBeNull();

    await act(async () => {
      await appStore.getState().ensureGuildTree(BIG);
      appStore.getState().toggleChannel(MOCK_IDS.generalChannel);
    });
    expect(badgeOf(guildButton('Direct Messages'))).toBe('2');
    expect(badgeOf(guildButton(guilds()[0].name))).toBe('1');
    expect(selectSelectedTargets(appStore.getState()).map((target) => target.guildId)).toEqual([BIG, null, null]);

    act(() => appStore.getState().toggleAllDms());
    expect(badgeOf(guildButton('Direct Messages'))).toBe(String(appStore.getState().dms.length));
    act(() => appStore.getState().clearSelection());
    expect(document.querySelector('.rail__badge')).toBeNull();
  });

  it('caps huge counts', async () => {
    await bootApp();
    render(<ServerRail />);
    const target = (channelId: string): ExportTarget => ({ channelId, kind: 'text', channelName: 'x', guildId: guilds()[1].id, guildName: 'g', categoryName: null, parentChannelName: null, topic: null, iconUrl: null });
    const selection = Object.fromEntries(Array.from({ length: 1200 }, (_, index) => [`d${index}`, target(`d${index}`)]));
    act(() => appStore.setState({ selection }));
    expect(badgeOf(guildButton(guilds()[1].name))).toBe('999+');
  });

  it('clicking the checkbox only toggles the selection: it does not open the server', async () => {
    await bootApp();
    const openGuild = vi.fn(async () => undefined);
    appStore.setState({ openGuild });
    render(<ServerRail />);
    await act(async () => {
      fireEvent.click(guildCheckbox(guilds()[1].name));
    });
    await settle();
    expect(openGuild).not.toHaveBeenCalled();
    expect(appStore.getState().view).toEqual({ kind: 'dms' });
    expect(selectSelectionCountForGuild(appStore.getState(), guilds()[1].id)).toBeGreaterThan(0);
  });
});

describe('tooltip', () => {
  function stubRect(rect: { top: number; right: number; height: number }): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: rect.top,
      top: rect.top,
      right: rect.right,
      bottom: rect.top + rect.height,
      left: rect.right - 48,
      width: 48,
      height: rect.height,
      toJSON: () => ({}),
    });
  }

  it('appears on hover next to the icon, through a portal on document.body', async () => {
    await bootApp();
    stubRect({ top: 100, right: 60, height: 48 });
    render(<ServerRail />);
    expect(screen.queryByRole('tooltip')).toBeNull();

    const name = guilds()[1].name;
    fireEvent.mouseEnter(itemOf(guildButton(name)));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe(name);
    expect(tooltip.parentElement).toBe(document.body);
    expect(rail().contains(tooltip)).toBe(false);
    // Vertically centred on the icon, 16px to its right.
    expect(tooltip.style.top).toBe('124px');
    expect(tooltip.style.left).toBe('76px');
    expect(tooltip.className).toBe('rail-tooltip');

    fireEvent.mouseLeave(itemOf(guildButton(name)));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('follows the pointer from one server to the next and also labels the DM button', async () => {
    await bootApp();
    render(<ServerRail />);
    fireEvent.mouseEnter(itemOf(guildButton('Direct Messages')));
    expect(screen.getByRole('tooltip').textContent).toBe('Direct Messages');
    fireEvent.mouseLeave(itemOf(guildButton('Direct Messages')));
    fireEvent.mouseEnter(itemOf(guildButton(guilds()[0].name)));
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip').textContent).toBe(guilds()[0].name);
  });

  it('shows the full (long, hostile) name as plain text', async () => {
    await bootApp();
    render(<ServerRail />);
    const hostile = guilds().find((guild) => guild.name.includes('<script>'));
    fireEvent.mouseEnter(itemOf(guildButton(hostile?.name ?? '')));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe(hostile?.name);
    expect(tooltip.querySelector('script, b')).toBeNull();
  });

  it('keyboard focus shows it and leaving the entry hides it', async () => {
    await bootApp();
    render(<ServerRail />);
    const button = guildButton(guilds()[0].name);
    act(() => button.focus());
    expect(screen.getByRole('tooltip').textContent).toBe(guilds()[0].name);

    // Moving focus inside the same entry (to its checkbox) keeps it.
    act(() => guildCheckbox(guilds()[0].name).focus());
    expect(screen.getByRole('tooltip')).toBeTruthy();

    act(() => guildButton(guilds()[1].name).focus());
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip').textContent).toBe(guilds()[1].name);

    act(() => guildButton(guilds()[1].name).blur());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('focus caused by a mouse press does not pop a tooltip of its own, but later keyboard focus does', async () => {
    await bootApp();
    vi.useFakeTimers();
    try {
      render(<ServerRail />);
      const button = guildButton(guilds()[0].name);
      fireEvent.mouseDown(itemOf(button));
      act(() => button.focus());
      expect(screen.queryByRole('tooltip')).toBeNull();

      act(() => button.blur());
      act(() => {
        vi.runAllTimers();
      });
      act(() => button.focus());
      expect(screen.getByRole('tooltip')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides on scroll, on Escape and when the window loses focus', async () => {
    await bootApp();
    render(<ServerRail />);
    const item = itemOf(guildButton(guilds()[0].name));

    fireEvent.mouseEnter(item);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.scroll(rail());
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(item);
    fireEvent.keyDown(guildButton(guilds()[0].name), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => guildButton(guilds()[0].name).focus());
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(guildButton(guilds()[0].name), { relatedTarget: null });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  /** Rects by element: the rail is a window onto the icons, which sit wherever the test says. */
  function stubLayout(layout: { rail: { top: number; height: number }; icon: () => { top: number; height: number } }): void {
    const box = ({ top, height }: { top: number; height: number }): DOMRect => ({
      x: 0,
      y: top,
      top,
      right: 60,
      bottom: top + height,
      left: 12,
      width: 48,
      height,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return box(this.classList.contains('app-rail') ? layout.rail : layout.icon());
    });
  }

  it('a keyboard-focused icon keeps its tooltip when the rail scrolls (focusing an icon out of view is what scrolls it) and the tooltip follows the icon', async () => {
    await bootApp();
    const state = { top: 600 }; // below the 500px high rail: focusing it makes the browser scroll
    stubLayout({ rail: { top: 0, height: 500 }, icon: () => ({ top: state.top, height: 48 }) });
    render(<ServerRail />);
    act(() => guildButton(guilds()[0].name).focus());
    expect(screen.getByRole('tooltip').style.top).toBe('624px');

    state.top = 300;
    fireEvent.scroll(rail());
    expect(screen.getByRole('tooltip').textContent).toBe(guilds()[0].name);
    expect(screen.getByRole('tooltip').style.top).toBe('324px');

    // Scrolled out of the rail again (the wheel, while the icon still has the focus): nothing left to point at.
    state.top = 700;
    fireEvent.scroll(rail());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('brings the focused icon into view first, so the tooltip is placed once, where it stays', async () => {
    await bootApp();
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView });
    try {
      render(<ServerRail />);
      act(() => guildButton(guilds()[2].name).focus());
      expect(scrollIntoView.mock.contexts).toEqual([itemOf(guildButton(guilds()[2].name))]);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

      // A hover does not scroll anything.
      scrollIntoView.mockClear();
      fireEvent.mouseEnter(itemOf(guildButton(guilds()[0].name)));
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('a tooltip that follows the pointer still goes when the rail scrolls (the icon left from under it)', async () => {
    await bootApp();
    stubLayout({ rail: { top: 0, height: 500 }, icon: () => ({ top: 100, height: 48 }) });
    render(<ServerRail />);
    fireEvent.mouseEnter(itemOf(guildButton(guilds()[0].name)));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.scroll(rail());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('an unreadable tooltip is shifted back into the window: tall names near the top or bottom edge', async () => {
    await bootApp();
    const state = { top: 0, windowHeight: 300 };
    stubLayout({ rail: { top: 0, height: 300 }, icon: () => ({ top: state.top, height: 48 }) });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 88 }); // four lines
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => state.windowHeight });
    try {
      render(<ServerRail />);
      const shiftOf = (): string => screen.getByRole('tooltip').style.getPropertyValue('--tooltip-shift');
      const name = guilds()[1].name;

      // The icon's centre at 270 of 300: the box would run to 314, so it moves up by 22px (to 204..292, 8px from the edge).
      state.top = 246;
      fireEvent.mouseEnter(itemOf(guildButton(name)));
      expect(shiftOf()).toBe('-22px');

      // The icon's centre at 24: the box would start at -20, so it moves down by 28px (8px from the edge).
      fireEvent.mouseLeave(itemOf(guildButton(name)));
      state.top = 0;
      fireEvent.mouseEnter(itemOf(guildButton(name)));
      expect(shiftOf()).toBe('28px');

      // In the middle of the window nothing moves.
      fireEvent.mouseLeave(itemOf(guildButton(name)));
      state.top = 100;
      fireEvent.mouseEnter(itemOf(guildButton(name)));
      expect(shiftOf()).toBe('0px');
    } finally {
      delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
      delete (document.documentElement as { clientHeight?: unknown }).clientHeight;
    }
  });

  it('a tooltip that stays while the window changes height is shifted again for the new edges', async () => {
    await bootApp();
    const state = { windowHeight: 420 };
    stubLayout({ rail: { top: 0, height: 420 }, icon: () => ({ top: 246, height: 48 }) });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 88 }); // four lines
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => state.windowHeight });
    try {
      render(<ServerRail />);
      const tooltip = (): HTMLElement => screen.getByRole('tooltip');
      fireEvent.mouseEnter(itemOf(guildButton(guilds()[1].name)));
      // Centred on 270 of 420: 226..314 fits.
      expect(tooltip().style.getPropertyValue('--tooltip-shift')).toBe('0px');

      // The window gets shorter (300): the box would run to 314, so it moves up by 22px (to 204..292, 8px from the edge).
      state.windowHeight = 300;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(tooltip().style.getPropertyValue('--tooltip-shift')).toBe('-22px');

      // Taller again: back where it was.
      state.windowHeight = 420;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(tooltip().style.getPropertyValue('--tooltip-shift')).toBe('0px');
    } finally {
      delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
      delete (document.documentElement as { clientHeight?: unknown }).clientHeight;
    }
  });

  it('stops listening for window resizes when the tooltip goes', async () => {
    await bootApp();
    const remove = vi.spyOn(window, 'removeEventListener');
    render(<ServerRail />);
    fireEvent.mouseEnter(itemOf(guildButton(guilds()[0].name)));
    fireEvent.mouseLeave(itemOf(guildButton(guilds()[0].name)));
    expect(remove.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    remove.mockRestore();
  });

  it('is removed from the document with the rail', async () => {
    await bootApp();
    const { unmount } = render(<ServerRail />);
    fireEvent.mouseEnter(itemOf(guildButton(guilds()[0].name)));
    expect(document.body.querySelector('.rail-tooltip')).not.toBeNull();
    unmount();
    expect(document.body.querySelector('.rail-tooltip')).toBeNull();
  });
});
