// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { appStore } from '@/app/state/store';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import { bootTopBar } from './helpers';

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

async function open(channelId: string, guildId: string | null): Promise<void> {
  await act(async () => {
    await appStore.getState().openChannel(channelId, guildId);
  });
}

const header = (): HTMLElement => screen.getByRole('banner');

describe('top bar root', () => {
  it('is the app-topbar header with the title area on the left and the actions on the right', async () => {
    await bootTopBar();
    const { container } = render(<TopBar />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('HEADER');
    expect(root.classList.contains('app-topbar')).toBe(true);
    expect(root.children[0].classList.contains('topbar__title')).toBe(true);
    expect(root.children[1].classList.contains('topbar__actions')).toBe(true);
  });
});

describe('channel title', () => {
  it('without an open channel shows only the (muted) app title', async () => {
    await bootTopBar();
    render(<TopBar />);
    expect(screen.getByText('Discord Chat Extractor')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(header().querySelector('.topbar__divider')).toBeNull();
  });

  it('a text channel shows its kind icon, name and topic', async () => {
    await bootTopBar();
    render(<TopBar />);
    await open(MOCK_IDS.generalChannel, MOCK_IDS.bigGuild);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('general');
    const topic = header().querySelector('.topbar__topic') as HTMLElement;
    expect(topic.textContent).toContain('Welcome!');
    // Native tooltip carries the complete, untrimmed topic (it is a multi-line one).
    expect(topic.getAttribute('title')).toContain('\nRules: https://example.com/rules');
    expect(header().querySelector('.topbar__divider')).not.toBeNull();
    expect(header().querySelector('.topbar__title svg')).not.toBeNull();
    expect(screen.queryByText('Discord Chat Extractor')).toBeNull();
  });

  it('a channel without a topic has no divider and no topic', async () => {
    await bootTopBar();
    render(<TopBar />);
    await open(MOCK_IDS.edge199Channel, MOCK_IDS.bigGuild);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('edge-199');
    expect(header().querySelector('.topbar__divider')).toBeNull();
    expect(header().querySelector('.topbar__topic')).toBeNull();
  });

  it('a voice channel shows its own icon (not the # of text channels)', async () => {
    await bootTopBar();
    const text = render(<TopBar />);
    await open(MOCK_IDS.generalChannel, MOCK_IDS.bigGuild);
    const textIcon = text.container.querySelector('.topbar__title .topbar__icon')?.innerHTML;
    await open(MOCK_IDS.voiceChannel, MOCK_IDS.bigGuild);
    const voiceIcon = text.container.querySelector('.topbar__title .topbar__icon')?.innerHTML;
    expect(voiceIcon).toBeTruthy();
    expect(voiceIcon).not.toBe(textIcon);
  });

  it('a thread shows "parent > thread"', async () => {
    await bootTopBar();
    render(<TopBar />);
    await open(MOCK_IDS.generalThread, MOCK_IDS.bigGuild);

    const title = header().querySelector('.topbar__title') as HTMLElement;
    const parent = title.querySelector('.topbar__name--parent');
    expect(parent?.textContent).toBe('general');
    expect(title.querySelector('.topbar__crumb-separator')).not.toBeNull();
    const thread = screen.getByRole('heading', { level: 1 });
    expect(thread.textContent).toBe(appStore.getState().trees[MOCK_IDS.bigGuild].tree?.byId[MOCK_IDS.generalThread].name);
    // parent, then separator, then the thread
    expect(parent?.compareDocumentPosition(thread)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('a DM shows the avatar and the name, and no topic', async () => {
    await bootTopBar();
    render(<TopBar />);
    await open(MOCK_IDS.dmFriend, null);

    const name = appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(name);
    const avatar = header().querySelector('img.topbar__avatar') as HTMLImageElement;
    expect(avatar).not.toBeNull();
    expect(avatar.getAttribute('src')).toBe(appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.iconUrl);
    expect(avatar.getAttribute('width')).toBe('24');
    expect(header().querySelector('.topbar__topic')).toBeNull();
  });

  it('a DM picture that fails to load becomes the initial of the name, never a broken image', async () => {
    await bootTopBar();
    render(<TopBar />);
    await open(MOCK_IDS.dmFriend, null);
    const name = appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';

    fireEvent.error(header().querySelector('img.topbar__avatar') as HTMLImageElement);
    expect(header().querySelector('img')).toBeNull();
    const fallback = header().querySelector('.topbar__avatar--fallback') as HTMLElement;
    expect(fallback.textContent).toBe(Array.from(name)[0].toUpperCase());
    expect(fallback.getAttribute('aria-hidden')).toBe('true');
  });

  describe('the names are cut off with an ellipsis when long, so each carries the full name as its native tooltip (QA-LAYOUT-08)', () => {
    it('a channel', async () => {
      await bootTopBar();
      render(<TopBar />);
      await open(MOCK_IDS.generalChannel, MOCK_IDS.bigGuild);
      expect(screen.getByRole('heading', { level: 1 }).getAttribute('title')).toBe('general');
    });

    it('a DM', async () => {
      await bootTopBar();
      render(<TopBar />);
      await open(MOCK_IDS.dmFriend, null);
      const name = appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';
      expect(name).not.toBe('');
      expect(screen.getByRole('heading', { level: 1 }).getAttribute('title')).toBe(name);
    });

    it('a thread: the thread and its parent', async () => {
      await bootTopBar();
      render(<TopBar />);
      await open(MOCK_IDS.generalThread, MOCK_IDS.bigGuild);
      const threadName = appStore.getState().trees[MOCK_IDS.bigGuild].tree?.byId[MOCK_IDS.generalThread].name;
      expect(threadName).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1 }).getAttribute('title')).toBe(threadName);
      expect(header().querySelector('.topbar__name--parent')?.getAttribute('title')).toBe('general');
    });

    it('a hostile name is the tooltip text as it is (an attribute, never markup)', async () => {
      await bootTopBar();
      await act(async () => {
        await appStore.getState().ensureGuildTree(MOCK_IDS.hostileNameGuild);
      });
      const hostile = Object.values(appStore.getState().trees[MOCK_IDS.hostileNameGuild].tree?.byId ?? {}).find((node) => node.name.includes('<img'));
      render(<TopBar />);
      await open(hostile?.id ?? '', MOCK_IDS.hostileNameGuild);
      expect(screen.getByRole('heading', { level: 1 }).getAttribute('title')).toBe(hostile?.name);
    });
  });

  it('follows the open channel', async () => {
    await bootTopBar();
    render(<TopBar />);
    await open(MOCK_IDS.generalChannel, MOCK_IDS.bigGuild);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('general');
    await open(MOCK_IDS.edge400Channel, MOCK_IDS.bigGuild);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('edge-400');
    await open(MOCK_IDS.dmFriendEnglish, null);
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe('edge-400');
  });

  it('renders hostile channel names and topics as plain text', async () => {
    await bootTopBar();
    await act(async () => {
      await appStore.getState().ensureGuildTree(MOCK_IDS.hostileNameGuild);
    });
    const tree = appStore.getState().trees[MOCK_IDS.hostileNameGuild].tree;
    const hostile = Object.values(tree?.byId ?? {}).find((node) => node.name.includes('<img'));
    expect(hostile).toBeDefined();
    render(<TopBar />);
    await open(hostile?.id ?? '', MOCK_IDS.hostileNameGuild);

    const name = screen.getByRole('heading', { level: 1 });
    expect(name.textContent).toBe(hostile?.name);
    expect(name.children).toHaveLength(0);
    const topic = header().querySelector('.topbar__topic') as HTMLElement;
    expect(topic.textContent).toContain('<script>');
    expect(topic.children).toHaveLength(0);
    expect(header().querySelector('script, img[src="x"]')).toBeNull();
  });
});

describe('connected account label', () => {
  it('says "Connected as <name>" in English', async () => {
    await bootTopBar('en');
    render(<TopBar />);
    expect(screen.getByText(`Connected as ${MOCK_ME.global_name}`)).toBeTruthy();
  });

  it('says it in Korean', async () => {
    await bootTopBar('ko');
    render(<TopBar />);
    expect(screen.getByText(`${MOCK_ME.global_name} 계정으로 연결됨`)).toBeTruthy();
  });

  it('is static text: nothing to click or focus', async () => {
    await bootTopBar();
    render(<TopBar />);
    const label = header().querySelector('.topbar__account') as HTMLElement;
    expect(label.querySelectorAll('button, a, [tabindex], [role="button"]')).toHaveLength(0);
  });

  it('carries a DEMO pill in demo mode only', async () => {
    await bootTopBar();
    const { unmount } = render(<TopBar />);
    expect(appStore.getState().mode).toBe('demo');
    expect(within(header()).getByText('DEMO')).toBeTruthy();
    unmount();

    act(() => appStore.setState({ mode: 'live' }));
    render(<TopBar />);
    expect(screen.queryByText('DEMO')).toBeNull();
    expect(screen.getByText(`Connected as ${MOCK_ME.global_name}`)).toBeTruthy();
  });

  it('shows nothing before the account is known (live mode)', async () => {
    await bootTopBar();
    act(() => appStore.setState({ me: null, mode: 'live' }));
    render(<TopBar />);
    expect(header().querySelector('.topbar__account')).toBeNull();
  });
});
