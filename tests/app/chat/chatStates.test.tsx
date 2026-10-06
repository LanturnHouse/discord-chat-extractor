// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '@/app/components/chat/ChatPane';
import { appStore } from '@/app/state';
import { DiscordApiError } from '@/lib/discord/client';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import type { Message } from '@/lib/discord/types';
import { createSpiedClient, type SpiedClient } from '../helpers';
import { installFakeLayout, installFakeResizeObserver, type FakeLayout, type InstalledResizeObserver } from './fakeLayout';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

const GUILD = MOCK_IDS.bigGuild;
let layout: FakeLayout;
let resize: InstalledResizeObserver;
let spied: SpiedClient;

beforeEach(async () => {
  appStore.setState(appStore.getInitialState(), true);
  spied = createSpiedClient();
  await appStore.getState().initWithClient(spied.client, MOCK_ME);
  await appStore.getState().ensureGuildTree(GUILD);
  appStore.setState({ locale: 'en' });
  layout = installFakeLayout();
  resize = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  layout.restore();
  resize.restore();
});

const root = (container: HTMLElement): HTMLElement => container.querySelector('section.app-chat') as HTMLElement;

/** getMessages calls that stay open until resolved. */
function holdMessages(): Array<(messages: Message[]) => void> {
  const held: Array<(messages: Message[]) => void> = [];
  spied.spies.getMessages.mockImplementation(
    () =>
      new Promise<Message[]>((resolve) => {
        held.push(resolve);
      }),
  );
  return held;
}

describe('root element', () => {
  it('is a section with the app-chat class and takes no props', () => {
    const { container } = render(<ChatPane />);
    expect(root(container)).not.toBeNull();
    expect(root(container).tagName).toBe('SECTION');
    expect(ChatPane.length).toBe(0);
  });
});

describe('(a) nothing open', () => {
  it('invites to pick a channel in a server view', () => {
    appStore.setState({ view: { kind: 'guild', guildId: GUILD } });
    render(<ChatPane />);
    expect(screen.getByRole('heading', { name: 'Pick a channel' })).toBeTruthy();
    expect(screen.getByText('Pick a channel on the left; tick the boxes to choose what to download.')).toBeTruthy();
  });

  it('has its own line for the DM view', () => {
    render(<ChatPane />);
    expect(screen.getByRole('heading', { name: 'Pick a conversation' })).toBeTruthy();
    expect(screen.queryByText(/Pick a channel/)).toBeNull();
    expect(screen.getByText(/Pick a conversation on the left/)).toBeTruthy();
  });

  it('speaks Korean', () => {
    appStore.setState({ locale: 'ko', view: { kind: 'guild', guildId: GUILD } });
    render(<ChatPane />);
    expect(screen.getByRole('heading', { name: '채널을 선택하세요' })).toBeTruthy();
    expect(screen.getByText(/체크박스/)).toBeTruthy();
  });

  it('comes back when the open channel is closed', async () => {
    render(<ChatPane />);
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.edge199Channel, GUILD);
    });
    expect(screen.queryByRole('heading', { name: 'Pick a channel' })).toBeNull();
    act(() => appStore.getState().openDms());
    expect(screen.getByRole('heading', { name: 'Pick a conversation' })).toBeTruthy();
  });
});

describe('(b) loading', () => {
  it('shows 8 skeleton rows while the first page is on its way, then the messages', async () => {
    const held = holdMessages();
    const { container } = render(<ChatPane />);
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = appStore.getState().openChannel(MOCK_IDS.edge199Channel, GUILD);
    });

    const skeleton = screen.getByRole('status', { name: 'Loading messages…' });
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(skeleton.querySelectorAll('.chat-skeleton__row')).toHaveLength(8);
    for (const row of Array.from(skeleton.querySelectorAll('.chat-skeleton__row'))) {
      expect(row.querySelectorAll('.chat-skeleton__avatar')).toHaveLength(1);
      expect(row.querySelectorAll('.chat-skeleton__bar')).toHaveLength(2);
    }
    expect(container.querySelector('.chat-list')).toBeNull();

    await act(async () => {
      held[0]([]);
      await opening;
    });
    expect(container.querySelector('.chat-skeleton')).toBeNull();
    expect(container.querySelector('.chat-list')).not.toBeNull();
  });

  it('is the Korean label in Korean', () => {
    appStore.setState({ locale: 'ko' });
    holdMessages();
    render(<ChatPane />);
    act(() => {
      void appStore.getState().openChannel(MOCK_IDS.edge199Channel, GUILD);
    });
    expect(screen.getByRole('status', { name: '메시지를 불러오는 중…' })).toBeTruthy();
  });

  it('waits for the server tree when the channel is open before the tree arrived', () => {
    appStore.setState({
      view: { kind: 'guild', guildId: MOCK_IDS.englishGuild },
      activeChannelId: '123',
      messages: { '123': { status: 'loaded', items: [], hasMore: false, loadingOlder: false } },
    });
    render(<ChatPane />);
    expect(screen.getByRole('status', { name: 'Loading messages…' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Pick a channel' })).toBeNull();
  });

  it('says so when that tree failed to load, and retries it', () => {
    const ensureGuildTree = vi.fn(async () => undefined);
    appStore.setState({
      ensureGuildTree,
      view: { kind: 'guild', guildId: MOCK_IDS.englishGuild },
      activeChannelId: '123',
      messages: { '123': { status: 'loaded', items: [], hasMore: false, loadingOlder: false } },
      trees: { [MOCK_IDS.englishGuild]: { status: 'error', tree: null, error: 'The tree broke.' } },
    });
    render(<ChatPane />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The tree broke.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(ensureGuildTree).toHaveBeenCalledWith(MOCK_IDS.englishGuild);
  });
});

describe('(c) forbidden', () => {
  it('shows a lock, says the channel cannot be viewed and that it cannot be exported', async () => {
    const { container } = render(<ChatPane />);
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.forbiddenChannel, GUILD);
    });
    expect(screen.getByRole('heading', { name: "You can't view this channel" })).toBeTruthy();
    expect(screen.getByText(/can't be shown or exported/)).toBeTruthy();
    expect(container.querySelector('.chat-state__icon svg')).not.toBeNull();
    expect(container.querySelector('.chat-list')).toBeNull();
  });

  it('is Korean in Korean', async () => {
    appStore.setState({ locale: 'ko' });
    render(<ChatPane />);
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.forbiddenChannel, GUILD);
    });
    expect(screen.getByRole('heading', { name: '이 채널을 볼 수 없어요' })).toBeTruthy();
    expect(screen.getByText(/내보낼 수 없어요/)).toBeTruthy();
  });
});

describe('(d) error', () => {
  it('shows the message and a Retry button that loads the channel again', async () => {
    spied.spies.getMessages.mockRejectedValueOnce(new DiscordApiError('network', 'offline'));
    const { container } = render(<ChatPane />);
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.edge199Channel, GUILD);
    });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: "Couldn't load the messages" })).toBeTruthy();
    expect(alert.textContent).toContain('Could not reach Discord');

    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => expect(container.querySelectorAll('[data-message-id]')).toHaveLength(199));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a channel that does not exist is an error, not a lock', async () => {
    render(<ChatPane />);
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.unknownChannel, null);
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "You can't view this channel" })).toBeNull();
  });
});

describe('forum channels', () => {
  it('show a hint instead of an empty chat, and never request messages', () => {
    const calls = spied.spies.getMessages.mock.calls.length;
    appStore.setState({ view: { kind: 'guild', guildId: GUILD }, activeChannelId: MOCK_IDS.forumChannel });
    render(<ChatPane />);
    expect(screen.getByRole('heading', { name: 'This is a forum channel' })).toBeTruthy();
    expect(screen.getByText(/Pick one of its posts/)).toBeTruthy();
    expect(spied.spies.getMessages.mock.calls.length).toBe(calls);
  });
});

describe('voice and stage channels show their text chat like any other', () => {
  it.each([
    ['voice', MOCK_IDS.voiceChannel],
    ['stage', MOCK_IDS.stageChannel],
  ])('%s', async (_name, id) => {
    const { container } = render(<ChatPane />);
    await act(async () => {
      await appStore.getState().openChannel(id, GUILD);
    });
    expect(container.querySelector('.chat-list')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'This is a forum channel' })).toBeNull();
  });
});

describe('safety net', () => {
  it('loads an open channel that was never loaded, once', () => {
    const loadInitialMessages = vi.fn(async () => undefined);
    appStore.setState({
      loadInitialMessages,
      view: { kind: 'guild', guildId: GUILD },
      activeChannelId: MOCK_IDS.edge199Channel,
    });
    render(<ChatPane />);
    expect(loadInitialMessages).toHaveBeenCalledTimes(1);
    expect(loadInitialMessages).toHaveBeenCalledWith(MOCK_IDS.edge199Channel);
  });

  it.each(['loading', 'loaded', 'forbidden'] as const)('leaves a %s channel alone', (status) => {
    const loadInitialMessages = vi.fn(async () => undefined);
    appStore.setState({
      loadInitialMessages,
      view: { kind: 'guild', guildId: GUILD },
      activeChannelId: MOCK_IDS.edge199Channel,
      messages: { [MOCK_IDS.edge199Channel]: { status, items: [], hasMore: false, loadingOlder: false } },
    });
    render(<ChatPane />);
    expect(loadInitialMessages).not.toHaveBeenCalled();
  });
});
