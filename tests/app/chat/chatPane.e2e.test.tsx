// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '@/app/components/chat/ChatPane';
import { appStore } from '@/app/state';
import { DiscordApiError } from '@/lib/discord/client';
import { createMockClient, MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import { compareSnowflakes } from '@/lib/discord/snowflake';
import type { Message, Snowflake } from '@/lib/discord/types';
import { createSpiedClient, type SpiedClient } from '../helpers';
import { installFakeLayout, installFakeResizeObserver, type FakeLayout, type InstalledResizeObserver } from './fakeLayout';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

/*
 * The chat pane end to end: the real store, the real mock client (zero latency, fake layout), real scroll events.
 */

const GUILD = MOCK_IDS.bigGuild;
const VIEWPORT = 600;
let layout: FakeLayout;
let resize: InstalledResizeObserver;
let spied: SpiedClient;

beforeEach(async () => {
  appStore.setState(appStore.getInitialState(), true);
  spied = createSpiedClient();
  await appStore.getState().initWithClient(spied.client, MOCK_ME);
  await appStore.getState().ensureGuildTree(GUILD);
  appStore.setState({ locale: 'en' });
  layout = installFakeLayout({ viewportHeight: VIEWPORT });
  resize = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  layout.restore();
  resize.restore();
});

async function open(channelId: Snowflake, guildId: Snowflake | null = GUILD): Promise<void> {
  await act(async () => {
    await appStore.getState().openChannel(channelId, guildId);
  });
}

const scrollerOf = (container: HTMLElement): HTMLElement => {
  const scroller = container.querySelector<HTMLElement>('.chat-list');
  if (scroller === null) throw new Error('the message list is not shown');
  return scroller;
};
const rowIds = (container: HTMLElement): string[] => Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]')).map((row) => row.dataset.messageId ?? '');
const bottomOf = (scroller: HTMLElement): number => layout.scrollHeight(scroller) - VIEWPORT;

function expectAscendingUnique(ids: readonly string[]): void {
  for (let index = 1; index < ids.length; index += 1) expect(compareSnowflakes(ids[index - 1], ids[index])).toBeLessThan(0);
  expect(new Set(ids).size).toBe(ids.length);
}

function firstVisible(scroller: HTMLElement): { element: HTMLElement; offset: number } {
  const top = scroller.getBoundingClientRect().top;
  const element = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).find((row) => row.getBoundingClientRect().top - top >= 0);
  if (element === undefined) throw new Error('no visible row');
  return { element, offset: element.getBoundingClientRect().top - top };
}

/** Scrolls to `top` like a user and waits until the page that this triggers has been rendered. */
async function scrollAndWaitForRows(container: HTMLElement, top: number, rows: number): Promise<void> {
  layout.userScrollTo(scrollerOf(container), top);
  await waitFor(() => expect(rowIds(container)).toHaveLength(rows));
}

describe('opening a channel', () => {
  it('shows exactly the newest 200 messages, at the bottom, with two API calls', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);

    const ids = rowIds(container);
    expect(ids).toHaveLength(200);
    expectAscendingUnique(ids);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(2);

    const newest = (await spied.client.getMessages(MOCK_IDS.generalChannel, { limit: 1 }))[0];
    expect(ids[199]).toBe(newest.id);

    const scroller = scrollerOf(container);
    expect(scroller.scrollTop).toBe(bottomOf(scroller));
    expect(container.querySelector('.chat-start')).toBeNull(); // 2,600 messages: this is not the start
    expect(screen.getByRole('log', { name: 'Messages in #general' })).toBe(scroller);
  });

  it('does not ask for more while the user stays at the bottom', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    resize.fire();
    layout.userScrollTo(scrollerOf(container), bottomOf(scrollerOf(container)) - 100);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(2);
  });
});

describe('scrolling to the top', () => {
  it('loads 200 more, ascending and without duplicates, and the viewport stays put', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    const firstPage = rowIds(container);
    const scroller = scrollerOf(container);

    layout.userScrollTo(scroller, 250);
    const before = firstVisible(scroller);
    await waitFor(() => expect(rowIds(container)).toHaveLength(400));

    const ids = rowIds(container);
    expectAscendingUnique(ids);
    expect(ids.slice(200)).toEqual(firstPage);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(4);

    // the message that was at the top of the viewport is still there, at the same pixel offset
    expect(before.element.isConnected).toBe(true);
    expect(before.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top).toBe(before.offset);
    // and the loader is gone again
    expect(screen.queryByText('Loading older messages…')).toBeNull();
  });

  it('asks once per trip to the top, however many scroll events the trip has', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    const scroller = scrollerOf(container);
    for (const top of [500, 400, 300, 200, 100, 0, 30, 0]) layout.userScrollTo(scroller, top);
    await waitFor(() => expect(rowIds(container)).toHaveLength(400));
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(4);

    // the correction put the viewport far away from the top: a few more events do not trigger anything
    layout.userScrollTo(scroller, scroller.scrollTop - 50);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(4);

    // the next trip loads the next page
    await scrollAndWaitForRows(container, 100, 600);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(6);
    expectAscendingUnique(rowIds(container));
  });

  it('shows the loader while the page is on its way, and does not stack requests', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    // an untouched client over the same deterministic world: the one in the store is held back by the mock below
    const real = createMockClient({ latencyMs: 0 });
    const held: Array<() => void> = [];
    spied.spies.getMessages.mockImplementation(
      (channelId, options, signal) =>
        new Promise<Message[]>((resolve, reject) => {
          held.push(() => real.getMessages(channelId, options, signal).then(resolve, reject));
        }),
    );

    const scroller = scrollerOf(container);
    layout.userScrollTo(scroller, 100);
    expect(screen.getByRole('status').textContent).toContain('Loading older messages…');
    layout.userScrollTo(scroller, 0);
    layout.userScrollTo(scroller, 10);
    expect(held).toHaveLength(1);

    await act(async () => {
      held.shift()?.();
    });
    await waitFor(() => expect(held).toHaveLength(1)); // the second API call of the same 200-page
    await act(async () => {
      held.shift()?.();
    });
    await waitFor(() => expect(rowIds(container)).toHaveLength(400));
    expect(screen.queryByText('Loading older messages…')).toBeNull();
  });

  it('a failed page shows the reason and Retry; nothing retries by itself', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    spied.spies.getMessages.mockRejectedValueOnce(new DiscordApiError('rate-limited', 'slow down'));

    const scroller = scrollerOf(container);
    layout.userScrollTo(scroller, 100);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load older messages");
    expect(alert.textContent).toContain('rate limit');
    expect(rowIds(container)).toHaveLength(200);

    const calls = spied.spies.getMessages.mock.calls.length;
    layout.userScrollTo(scroller, 0);
    layout.userScrollTo(scroller, 80);
    resize.fire();
    expect(spied.spies.getMessages.mock.calls.length).toBe(calls);

    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => expect(rowIds(container)).toHaveLength(400));
    expect(screen.queryByRole('alert')).toBeNull();
    expectAscendingUnique(rowIds(container));
  });
});

describe('the beginning of the channel', () => {
  it('199 messages: the banner is there from the start and nothing more is requested', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.edge199Channel);
    expect(rowIds(container)).toHaveLength(199);
    expect(screen.getByRole('heading', { name: 'Welcome to #edge-199!' })).toBeTruthy();
    expect(screen.getByText('This is the start of the #edge-199 channel.')).toBeTruthy();

    layout.userScrollTo(scrollerOf(container), 0);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(2);
  });

  it('200 messages: still "maybe more" until the next look finds nothing', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.edge200Channel);
    expect(rowIds(container)).toHaveLength(200);
    expect(container.querySelector('.chat-start')).toBeNull();

    layout.userScrollTo(scrollerOf(container), 0);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome to #edge-200!' })).toBeTruthy());
    expect(rowIds(container)).toHaveLength(200);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(3);

    // at the start for good
    layout.userScrollTo(scrollerOf(container), 0);
    layout.userScrollTo(scrollerOf(container), 20);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(3);
  });

  it('201 messages: one older message arrives and the banner goes above it', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.edge201Channel);
    expect(rowIds(container)).toHaveLength(200);
    expect(container.querySelector('.chat-start')).toBeNull();

    await scrollAndWaitForRows(container, 0, 201);
    expect(screen.getByRole('heading', { name: 'Welcome to #edge-201!' })).toBeTruthy();
    expectAscendingUnique(rowIds(container));
    const content = container.querySelector('.chat-list__content') as HTMLElement;
    expect(content.firstElementChild?.classList.contains('chat-start')).toBe(true);

    layout.userScrollTo(scrollerOf(container), 0);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(3);
  });

  it('400 messages: 200 + 200, the banner only after the following empty look', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.edge400Channel);
    expect(rowIds(container)).toHaveLength(200);

    await scrollAndWaitForRows(container, 0, 400);
    expect(container.querySelector('.chat-start')).toBeNull(); // a full page: it might continue
    expectAscendingUnique(rowIds(container));
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(4);

    layout.userScrollTo(scrollerOf(container), 0);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome to #edge-400!' })).toBeTruthy());
    expect(rowIds(container)).toHaveLength(400);
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(5);
  });

  it('an empty channel is just the banner', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.emptyChannel);
    const name = appStore.getState().trees[GUILD].tree?.byId[MOCK_IDS.emptyChannel].name ?? '';
    expect(name).not.toBe('');
    expect(rowIds(container)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: `Welcome to #${name}!` })).toBeTruthy();
    expect(spied.spies.getMessages).toHaveBeenCalledTimes(1);
  });
});

describe('direct messages', () => {
  it('open at the bottom and have their own banner and label', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.dmFriend, null);
    const scroller = scrollerOf(container);
    expect(rowIds(container)).toHaveLength(200);
    expect(scroller.scrollTop).toBe(bottomOf(scroller));
    const name = appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';
    expect(screen.getByRole('log', { name: `Messages with ${name}` })).toBe(scroller);

    await scrollAndWaitForRows(container, 0, 400);
    layout.userScrollTo(scroller, 0); // a full page: one more look finds the start
    await waitFor(() => expect(screen.getByRole('heading', { name })).toBeTruthy());
    expect(screen.getByText(`This is the beginning of your direct message history with ${name}.`)).toBeTruthy();
    expectAscendingUnique(rowIds(container));
  });

  it('a group DM', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.groupDmNamed, null);
    const name = appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.groupDmNamed)?.name ?? '';
    await waitFor(() => expect(container.querySelector('.chat-start')).not.toBeNull());
    expect(screen.getByText(`This is the beginning of the ${name} group conversation.`)).toBeTruthy();
  });
});

describe('switching channels', () => {
  it('remounts the list: each channel starts at its own bottom', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    const first = scrollerOf(container);
    layout.userScrollTo(first, 1234);
    expect(first.scrollTop).toBe(1234);

    await open(MOCK_IDS.edge400Channel);
    const second = scrollerOf(container);
    expect(second).not.toBe(first);
    expect(second.scrollTop).toBe(bottomOf(second));
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('Messages in #edge-400');

    // back to the first one (its messages are cached): at the bottom again, not at 1234
    await open(MOCK_IDS.generalChannel);
    const third = scrollerOf(container);
    expect(third).not.toBe(first);
    expect(rowIds(container)).toHaveLength(200);
    expect(third.scrollTop).toBe(bottomOf(third));
  });

  it('loads pages into the channel that is shown, not the one that was left', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.edge400Channel);
    await open(MOCK_IDS.generalChannel);
    await scrollAndWaitForRows(container, 100, 400);
    expect(appStore.getState().messages[MOCK_IDS.generalChannel].items).toHaveLength(400);
    expect(appStore.getState().messages[MOCK_IDS.edge400Channel].items).toHaveLength(200);
  });

  it('the pin of one channel does not leak into the next: the new list pins again on its first paint', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    fireEvent.wheel(scrollerOf(container), { deltaY: -100 }); // the user took over in the first channel
    await open(MOCK_IDS.edge400Channel);
    const scroller = scrollerOf(container);
    expect(scroller.scrollTop).toBe(bottomOf(scroller));
  });

  it('leaving a channel while an older page is loading does not break the next one', async () => {
    const { container } = render(<ChatPane />);
    await open(MOCK_IDS.generalChannel);
    layout.userScrollTo(scrollerOf(container), 0);
    await open(MOCK_IDS.edge199Channel);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome to #edge-199!' })).toBeTruthy());
    expect(rowIds(container)).toHaveLength(199);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
