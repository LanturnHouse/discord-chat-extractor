// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '@/app/components/chat/MessageList';
import { appStore, type ActiveChannel, type ChannelMessages } from '@/app/state';
import type { Message } from '@/lib/discord/types';
import { defaultHeightOf, installFakeLayout, installFakeResizeObserver, type FakeLayout, type InstalledResizeObserver } from './fakeLayout';
import { dmChannel, messageRange, textChannel } from './fixtures';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

const loadOlder = vi.fn();
let layout: FakeLayout;
let resize: InstalledResizeObserver;

beforeEach(() => {
  appStore.setState(appStore.getInitialState(), true);
  appStore.setState({ locale: 'en', loadOlderMessages: loadOlder });
  layout = installFakeLayout({ viewportHeight: 600 });
  resize = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  layout.restore();
  resize.restore();
  loadOlder.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

const loaded = (items: Message[], extra: Partial<ChannelMessages> = {}): ChannelMessages => ({
  status: 'loaded',
  items,
  hasMore: true,
  loadingOlder: false,
  ...extra,
});

/** The newest 200 messages of a long channel: ids 200..399 (rows are 50px, so the list is 10,048px tall). */
const newest = (): Message[] => messageRange(200, 400);
const older = (): Message[] => messageRange(0, 200);

function tree(channel: ActiveChannel, messages: ChannelMessages): ReactElement {
  return <MessageList key={channel.kind === 'guild' ? channel.node.id : channel.dm.id} channel={channel} messages={messages} />;
}

function mount(messages: ChannelMessages, channel: ActiveChannel = textChannel()) {
  const view = render(tree(channel, messages));
  const scroller = view.container.querySelector<HTMLElement>('.chat-list');
  if (scroller === null) throw new Error('no scroll container');
  return {
    ...view,
    scroller,
    update: (next: ChannelMessages, nextChannel: ActiveChannel = channel) => view.rerender(tree(nextChannel, next)),
  };
}

const rows = (scroller: HTMLElement): HTMLElement[] => Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'));

/** First message that starts inside the viewport, and its distance from the top edge of the viewport. */
function firstVisible(scroller: HTMLElement): { element: HTMLElement; id: string; offset: number } {
  const top = scroller.getBoundingClientRect().top;
  const element = rows(scroller).find((row) => row.getBoundingClientRect().top - top >= 0);
  if (element === undefined) throw new Error('no visible row');
  return { element, id: element.dataset.messageId ?? '', offset: element.getBoundingClientRect().top - top };
}

/** 200 rows of 50px, the 32px day divider above the first one, 16px of padding below the last one, in a 600px viewport. */
const BOTTOM_OF_200 = 200 * 50 + 32 + 16 - 600; // 9448

describe('first paint', () => {
  it('shows the newest message: scrolled to the bottom before anything else happens', () => {
    const { scroller } = mount(loaded(newest()));
    expect(rows(scroller)).toHaveLength(200);
    expect(layout.scrollHeight(scroller)).toBe(10_048);
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200);
    const last = rows(scroller)[199];
    expect(last.getBoundingClientRect().bottom).toBe(600 - 16);
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('has no jump button at the bottom', () => {
    mount(loaded(newest()));
    expect(screen.queryByRole('button', { name: /jump to latest/i })).toBeNull();
  });

  it('a channel shorter than the viewport sits at the bottom of it and does not scroll', () => {
    const { scroller } = mount(loaded(messageRange(0, 5), { hasMore: false }));
    expect(scroller.scrollTop).toBe(0);
    const lastRow = rows(scroller)[4];
    expect(lastRow.getBoundingClientRect().bottom).toBe(600 - 16);
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('exposes the list as a labelled, focusable log region', () => {
    mount(loaded(newest()));
    const log = screen.getByRole('log', { name: 'Messages in #general' });
    expect(log.getAttribute('aria-live')).toBe('off');
    expect(log.getAttribute('tabindex')).toBe('0');
  });

  it('names threads and DMs in the label', () => {
    mount(loaded(newest()), textChannel('release notes', 'thread'));
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('Messages in the thread release notes');
    cleanup();
    mount(loaded(newest()), dmChannel('Minjun'));
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('Messages with Minjun');
  });

  it('uses Korean strings when the locale is Korean', () => {
    appStore.setState({ locale: 'ko' });
    mount(loaded(newest(), { loadingOlder: true }));
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('#general 채널의 메시지');
    expect(screen.getByText('이전 메시지를 불러오는 중…')).toBeTruthy();
  });

  it('every message is a direct child of the content, with no wrapper per row (content-visibility keeps working)', () => {
    const { scroller } = mount(loaded(messageRange(0, 20), { hasMore: false }));
    const content = scroller.querySelector('.chat-list__content');
    expect(content).not.toBeNull();
    for (const row of rows(scroller)) expect(row.parentElement).toBe(content);
  });
});

describe('staying at the bottom while the content settles', () => {
  /** Heights of the last message can change: images and fonts arriving late. */
  function growable() {
    const state = { lastHeight: 50 };
    layout.restore();
    layout = installFakeLayout({
      viewportHeight: 600,
      heightOf: (element) => (element.dataset.messageId === '5000399' ? state.lastHeight : defaultHeightOf(element)),
    });
    return state;
  }

  it('re-pins to the bottom when the content grows, until the user scrolls', () => {
    const state = growable();
    const { scroller } = mount(loaded(newest()));
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200);

    state.lastHeight = 350;
    resize.fire();
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200 + 300);

    fireEvent.wheel(scroller, { deltaY: -100 });
    state.lastHeight = 650;
    resize.fire();
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200 + 300); // never again for this channel instance
  });

  it('its own pin does not count as the user scrolling (scroll events after programmatic pins are ignored)', () => {
    const state = growable();
    const { scroller } = mount(loaded(newest()));
    // the scroll event of the first pin arrives after the content already grew
    state.lastHeight = 350;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    state.lastHeight = 450;
    resize.fire();
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200 + 400);
  });

  it('stops pinning once the user moved away from the bottom (scrollbar drag, keyboard, find...)', () => {
    const state = growable();
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 5000);
    state.lastHeight = 350;
    resize.fire();
    expect(scroller.scrollTop).toBe(5000);
  });

  it('a few pixels away from the bottom is still the bottom', () => {
    const state = growable();
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, BOTTOM_OF_200 - 3);
    state.lastHeight = 350;
    resize.fire();
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200 + 300);
  });

  it.each([
    ['wheel', (element: HTMLElement) => fireEvent.wheel(element, { deltaY: 40 })],
    ['touch drag', (element: HTMLElement) => fireEvent.touchMove(element)],
    ['PageUp', (element: HTMLElement) => fireEvent.keyDown(element, { key: 'PageUp' })],
    ['Home', (element: HTMLElement) => fireEvent.keyDown(element, { key: 'Home' })],
    ['ArrowUp', (element: HTMLElement) => fireEvent.keyDown(element, { key: 'ArrowUp' })],
    ['a press on the scrollbar', (element: HTMLElement) => fireEvent.pointerDown(element)],
  ])('%s takes over from the pin', (_name, interact) => {
    const state = growable();
    const { scroller } = mount(loaded(newest()));
    interact(scroller);
    state.lastHeight = 350;
    resize.fire();
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200);
  });

  it('keys and presses that do not scroll leave the pin alone', () => {
    const state = growable();
    const { scroller } = mount(loaded(newest()));
    fireEvent.keyDown(scroller, { key: 'a' });
    fireEvent.keyDown(scroller, { key: 'Tab' });
    fireEvent.pointerDown(rows(scroller)[10]); // a press on a message is not the scrollbar
    state.lastHeight = 350;
    resize.fire();
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200 + 300);
  });

  it('observes the content and the viewport, and stops with the list', () => {
    const { unmount } = mount(loaded(newest()));
    expect(resize.active()).toBe(1);
    unmount();
    expect(resize.active()).toBe(0);
  });

  it('works without ResizeObserver', () => {
    resize.restore();
    const { scroller } = mount(loaded(newest()));
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200);
  });
});

describe('loading older messages', () => {
  it('asks for the next page once when the viewport reaches the top, not for every scroll event', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 4000);
    expect(loadOlder).not.toHaveBeenCalled();

    layout.userScrollTo(scroller, 580);
    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(loadOlder).toHaveBeenCalledWith('7');

    layout.userScrollTo(scroller, 300);
    layout.userScrollTo(scroller, 0);
    layout.userScrollTo(scroller, 12);
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('waits until the viewport is within 600px of the top', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 601);
    expect(loadOlder).not.toHaveBeenCalled();
    layout.userScrollTo(scroller, 600);
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('does not ask while a request is in flight, however often the user scrolls', () => {
    const { scroller } = mount(loaded(newest(), { loadingOlder: true }));
    layout.userScrollTo(scroller, 100);
    layout.userScrollTo(scroller, 0);
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('does not ask at the start of the channel', () => {
    const { scroller } = mount(loaded(newest(), { hasMore: false }));
    layout.userScrollTo(scroller, 0);
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('does not ask when the channel is not loaded', () => {
    const { scroller } = mount(loaded(newest(), { status: 'loading' }));
    layout.userScrollTo(scroller, 0);
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('asks again for the next page after the previous one arrived', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 100);
    expect(loadOlder).toHaveBeenCalledTimes(1);

    update(loaded(newest(), { loadingOlder: true }));
    update(loaded([...older(), ...newest()]));
    // the page is in, the viewport has been corrected away from the top: nothing more to do yet
    expect(loadOlder).toHaveBeenCalledTimes(1);

    layout.userScrollTo(scroller, 200);
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it('a page that brought nothing new (same messages, nothing in flight) is not requested again in a loop', () => {
    const items = newest();
    const { scroller, update } = mount(loaded(items));
    layout.userScrollTo(scroller, 100);
    expect(loadOlder).toHaveBeenCalledTimes(1);
    update(loaded(items, { loadingOlder: true }));
    update(loaded(items, { loadingOlder: false }));
    resize.fire();
    layout.userScrollTo(scroller, 0);
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('does not look at the top before layout exists', () => {
    layout.restore();
    mount(loaded(messageRange(0, 5)));
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('checks again when the content or the viewport changes size, after the user took over', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 4000);
    expect(loadOlder).not.toHaveBeenCalled();
    // e.g. rows above the viewport rendered shorter than estimated and the browser corrected the position
    layout.setScrollTop(scroller, 100);
    resize.fire();
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
});

describe('a channel that does not fill the viewport', () => {
  it('keeps loading pages until it overflows', () => {
    const { update } = mount(loaded(messageRange(90, 95))); // 5 rows: 266px of a 600px viewport
    expect(loadOlder).toHaveBeenCalledTimes(1);

    update(loaded(messageRange(85, 95), { loadingOlder: true }));
    update(loaded(messageRange(85, 95))); // 10 rows: 516px, still short
    expect(loadOlder).toHaveBeenCalledTimes(2);

    update(loaded(messageRange(70, 95))); // 25 rows: 1,266px, overflows
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it('after filling it shows the newest messages, not the oldest', () => {
    const { scroller, update } = mount(loaded(messageRange(90, 95)));
    update(loaded(messageRange(50, 95)));
    expect(scroller.scrollTop).toBe(layout.scrollHeight(scroller) - 600);
  });

  it('stops at the start of the channel', () => {
    const { update } = mount(loaded(messageRange(90, 95)));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    update(loaded(messageRange(88, 95), { hasMore: false }));
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('asks only once under StrictMode (effects run twice)', () => {
    render(
      <StrictMode>
        <MessageList channel={textChannel()} messages={loaded(messageRange(90, 95))} />
      </StrictMode>,
    );
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
});

describe('the viewport does not jump when older messages are prepended', () => {
  it('keeps the first visible message at the same pixel offset', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 333); // mid-row on purpose
    const before = firstVisible(scroller);
    expect(loadOlder).toHaveBeenCalledTimes(1);

    update(loaded(newest(), { loadingOlder: true }));
    const afterLoader = firstVisible(scroller);
    expect(afterLoader.id).toBe(before.id);

    update(loaded([...older(), ...newest()]));
    expect(rows(scroller)).toHaveLength(400);
    const after = firstVisible(scroller);
    // 200 rows of 50px were inserted above, the same node is still where it was
    expect(scroller.scrollTop).toBe(333 + 200 * 50);
    const sameNode = rows(scroller).find((row) => row.dataset.messageId === before.id);
    expect(sameNode).toBe(before.element);
    const offsetNow = before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    expect(offsetNow).toBe(before.offset);
    expect(after.id).toBe(before.id);
  });

  it('also holds at scrollTop 0, where the browser would do no anchoring of its own', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 0);
    const before = firstVisible(scroller);
    update(loaded([...older(), ...newest()]));
    expect(scroller.scrollTop).toBe(200 * 50);
    expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
  });

  it('also holds when the beginning banner appears in the same update (the last page)', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 250);
    const before = firstVisible(scroller);
    update(loaded([...older(), ...newest()], { hasMore: false }));
    expect(scroller.querySelector('.chat-start')).not.toBeNull();
    expect(scroller.scrollTop).toBe(250 + 200 * 50 + 200); // + the 200px banner
    expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
  });

  it('holds for a page of any size, including a partial last page', () => {
    for (const count of [1, 7, 100, 200]) {
      cleanup();
      const { scroller, update } = mount(loaded(messageRange(400, 600)));
      layout.userScrollTo(scroller, 120);
      const before = firstVisible(scroller);
      update(loaded([...messageRange(400 - count, 400), ...messageRange(400, 600)], { hasMore: count === 200 }));
      expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
      expect(scroller.scrollTop).toBe(120 + count * 50 + (count === 200 ? 0 : 200));
    }
  });

  it('does nothing special when the messages change without a prepend', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 4000);
    update(loaded(newest(), { loadingOlder: true }));
    update(loaded([...newest()]));
    expect(scroller.scrollTop).toBe(4000);
  });

  it('while still pinned (the user never scrolled) a prepend leaves the newest messages in view', () => {
    const { scroller, update } = mount(loaded(messageRange(90, 95)));
    update(loaded(messageRange(40, 95)));
    expect(scroller.scrollTop).toBe(layout.scrollHeight(scroller) - 600);
  });

  it('keeps the DOM nodes of the rows that were already there', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 100);
    const kept = rows(scroller).slice(0, 5);
    update(loaded([...older(), ...newest()]));
    const now = rows(scroller).slice(200, 205);
    expect(now.every((element, index) => element === kept[index])).toBe(true);
  });
});

describe("prepending with the browser's own scroll anchoring switched on (overflow-anchor: auto)", () => {
  beforeEach(() => {
    layout.restore();
    layout = installFakeLayout({ viewportHeight: 600, nativeAnchoring: true });
  });

  it('the browser and the script agree: the row ends up where it was, the shift is not applied twice', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 333);
    const before = firstVisible(scroller);
    update(loaded(newest(), { loadingOlder: true }));
    update(loaded([...older(), ...newest()]));
    expect(scroller.scrollTop).toBe(333 + 200 * 50);
    expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
  });

  it('at scrollTop 0 the browser does nothing and the script still keeps the row in place', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 0);
    const before = firstVisible(scroller);
    update(loaded([...older(), ...newest()]));
    expect(scroller.scrollTop).toBe(200 * 50);
    expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
  });

  it('with the beginning banner appearing in the same update', () => {
    const { scroller, update } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 250);
    const before = firstVisible(scroller);
    update(loaded([...older(), ...newest()], { hasMore: false }));
    expect(scroller.scrollTop).toBe(250 + 200 * 50 + 200);
    expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
  });

  it('a second prepend right after the first is as steady as the first', () => {
    const { scroller, update } = mount(loaded(messageRange(400, 600)));
    layout.userScrollTo(scroller, 200);
    update(loaded(messageRange(200, 600)));
    layout.userScrollTo(scroller, 150);
    const before = firstVisible(scroller);
    update(loaded(messageRange(0, 600)));
    expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
    expect(scroller.scrollTop).toBe(150 + 200 * 50);
  });
});

describe('loader and errors above the list', () => {
  it('shows progress without taking any space in the list', () => {
    const { scroller } = mount(loaded(newest(), { loadingOlder: true }));
    const status = scroller.querySelector('.chat-list__status');
    expect(status).not.toBeNull();
    expect(within(status as HTMLElement).getByRole('status').textContent).toContain('Loading older messages…');
    expect(scroller.querySelector('.chat-list__content')?.textContent).not.toContain('Loading older messages…');
    // the content (and so the scroll height) is the same with and without the loader
    expect(layout.scrollHeight(scroller)).toBe(10_048);
  });

  it('shows a failed request with its reason and a Retry button, and never retries by itself', () => {
    const { scroller } = mount(loaded(newest(), { olderError: 'Discord rate limit reached.' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load older messages");
    expect(alert.textContent).toContain('Discord rate limit reached.');

    layout.userScrollTo(scroller, 0);
    layout.userScrollTo(scroller, 50);
    resize.fire();
    expect(loadOlder).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(loadOlder).toHaveBeenCalledWith('7');
  });

  it('the loader replaces the error while the retry is running', () => {
    const { update } = mount(loaded(newest(), { olderError: 'x' }));
    update(loaded(newest(), { loadingOlder: true }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('a retry that fails again can be retried again', () => {
    const items = newest();
    const { update } = mount(loaded(items, { olderError: 'first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    update(loaded(items, { loadingOlder: true }));
    update(loaded(items, { olderError: 'second' }));
    expect(screen.getByRole('alert').textContent).toContain('second');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it('renders error text as text, never as markup', () => {
    mount(loaded(newest(), { olderError: '<img src=x onerror=alert(1)>' }));
    expect(screen.getByRole('alert').querySelector('img')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('the beginning of the channel', () => {
  it('shows the welcome header once the start is reached (and not before)', () => {
    const { scroller, update } = mount(loaded(newest()));
    expect(scroller.querySelector('.chat-start')).toBeNull();
    update(loaded([...older(), ...newest()], { hasMore: false }));
    const banner = scroller.querySelector('.chat-start') as HTMLElement;
    expect(within(banner).getByRole('heading', { name: 'Welcome to #general!' })).toBeTruthy();
    expect(banner.textContent).toContain('This is the start of the #general channel.');
  });

  it('sits above the first message', () => {
    const { scroller } = mount(loaded(messageRange(0, 3), { hasMore: false }));
    const content = scroller.querySelector('.chat-list__content') as HTMLElement;
    expect(content.firstElementChild?.classList.contains('chat-start')).toBe(true);
  });

  it('is shown for an empty channel as well', () => {
    const { scroller } = mount(loaded([], { hasMore: false }));
    expect(scroller.querySelector('.chat-start')).not.toBeNull();
    expect(rows(scroller)).toHaveLength(0);
  });

  it('has the Korean wording in Korean', () => {
    appStore.setState({ locale: 'ko' });
    const { scroller } = mount(loaded(messageRange(0, 3), { hasMore: false }));
    expect(scroller.querySelector('.chat-start__title')?.textContent).toBe('#general 채널에 오신 것을 환영합니다!');
    expect(scroller.querySelector('.chat-start__text')?.textContent).toBe('여기는 #general 채널의 시작이에요.');
  });

  it('a DM shows the friend avatar, the name and the history sentence', () => {
    const { scroller } = mount(loaded(messageRange(0, 3), { hasMore: false }), dmChannel('Minjun'));
    const banner = scroller.querySelector('.chat-start') as HTMLElement;
    expect(within(banner).getByRole('heading', { name: 'Minjun' })).toBeTruthy();
    expect(banner.textContent).toContain('This is the beginning of your direct message history with Minjun.');
    const avatar = banner.querySelector('img.chat-start__avatar') as HTMLImageElement;
    expect(avatar.src).toBe('https://cdn.discordapp.com/embed/avatars/1.png?size=160');
    expect(avatar.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('a broken avatar falls back to an initial instead of the browser icon', () => {
    const { scroller } = mount(loaded(messageRange(0, 3), { hasMore: false }), dmChannel('minjun'));
    const avatar = scroller.querySelector('img.chat-start__avatar') as HTMLImageElement;
    fireEvent.error(avatar);
    expect(scroller.querySelector('img.chat-start__avatar')).toBeNull();
    expect(scroller.querySelector('.chat-start__avatar--fallback')?.textContent).toBe('M');
  });

  it('the fallback initial keeps a flag at the start of the name whole', () => {
    const { scroller } = mount(loaded(messageRange(0, 3), { hasMore: false }), dmChannel('🇰🇷 Korea friends'));
    fireEvent.error(scroller.querySelector('img.chat-start__avatar') as HTMLImageElement);
    expect(scroller.querySelector('.chat-start__avatar--fallback')?.textContent).toBe('🇰🇷');
  });

  it('a group DM and a thread have their own wording', () => {
    const group = mount(loaded([], { hasMore: false }), dmChannel('Board games', 'group-dm'));
    expect(group.scroller.querySelector('.chat-start__text')?.textContent).toBe('This is the beginning of the Board games group conversation.');
    cleanup();
    const thread = mount(loaded([], { hasMore: false }), textChannel('release notes', 'thread'));
    expect(thread.scroller.querySelector('.chat-start__title')?.textContent).toBe('release notes');
    expect(thread.scroller.querySelector('.chat-start__text')?.textContent).toBe('This is the start of the thread.');
  });

  it('shows names that look like markup as plain text', () => {
    const { scroller } = mount(loaded([], { hasMore: false }), textChannel('<b>bold</b>'));
    expect(scroller.querySelector('.chat-start__title b')).toBeNull();
    expect(scroller.querySelector('.chat-start__title')?.textContent).toBe('Welcome to #<b>bold</b>!');
  });
});

describe('jump to latest', () => {
  const button = (): HTMLElement | null => screen.queryByRole('button', { name: /jump to latest/i });

  it('appears when the bottom is more than 1.5 viewports away, and goes again near it', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, BOTTOM_OF_200 - 800);
    expect(button()).toBeNull();
    layout.userScrollTo(scroller, BOTTOM_OF_200 - 901);
    expect(button()).not.toBeNull();
    layout.userScrollTo(scroller, BOTTOM_OF_200 - 100);
    expect(button()).toBeNull();
  });

  it('is a real button, outside the scrolling list (it must not scroll away)', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    const jump = button() as HTMLElement;
    expect(jump.tagName).toBe('BUTTON');
    expect(scroller.contains(jump)).toBe(false);
  });

  it('scrolls smoothly to the bottom', () => {
    const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0;
    });
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    fireEvent.click(button() as HTMLElement);
    expect(scrollTo).toHaveBeenCalledWith({ top: BOTTOM_OF_200, behavior: 'smooth' });
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200);
    fireEvent.scroll(scroller);
    expect(button()).toBeNull();
  });

  it('hands the keyboard focus to the message list before it disappears (it would be dropped to <body> otherwise)', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    const jump = button() as HTMLElement;
    jump.focus();
    expect(document.activeElement).toBe(jump);

    fireEvent.click(jump);
    expect(document.activeElement).toBe(scroller);

    // The button is gone once the bottom is reached, and the focus is still in the list.
    fireEvent.scroll(scroller);
    expect(button()).toBeNull();
    expect(document.activeElement).toBe(scroller);
  });

  it('does not scroll by focusing the list (the smooth scroll alone moves it)', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    const focus = vi.spyOn(scroller, 'focus');
    fireEvent.click(button() as HTMLElement);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not animate for people who prefer reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query }));
    const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0;
    });
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    fireEvent.click(button() as HTMLElement);
    expect(scrollTo).toHaveBeenCalledWith({ top: BOTTOM_OF_200, behavior: 'auto' });
  });

  it('works where Element.scrollTo is missing', () => {
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    fireEvent.click(button() as HTMLElement);
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200);
  });

  it('finishes the job when rows rendered taller under the smooth scroll (the bottom moved)', () => {
    vi.useFakeTimers();
    // the smooth scroll "ends" 500px short of the real bottom
    const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = (options.top ?? 0) - 500;
    });
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    fireEvent.click(button() as HTMLElement);
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200 - 500);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('the user can interrupt the correction by scrolling', () => {
    vi.useFakeTimers();
    const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = (options.top ?? 0) - 500;
    });
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    fireEvent.click(button() as HTMLElement);
    fireEvent.wheel(scroller, { deltaY: -50 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(scroller.scrollTop).toBe(BOTTOM_OF_200 - 500);
  });

  it('is in Korean in Korean', () => {
    appStore.setState({ locale: 'ko' });
    const { scroller } = mount(loaded(newest()));
    layout.userScrollTo(scroller, 3000);
    expect(screen.getByRole('button', { name: '맨 아래로' })).toBeTruthy();
  });
});
