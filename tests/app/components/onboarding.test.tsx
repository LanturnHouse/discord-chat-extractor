// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '@/app/components/Onboarding';
import { appStore } from '@/app/state/store';
import type { Locale, NeedsTokenReason } from '@/app/state/types';
import { createFakePlatform, type FakePlatform } from '../helpers';

// The export formats are irrelevant here; keeping them out also keeps this suite independent of the format modules.
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

const TAB = { id: 7, url: 'https://discord.com/channels/@me' };

function showOnboarding(platform: FakePlatform, options: { locale?: Locale; reason?: NeedsTokenReason; tokenDetected?: boolean; startDemoMode?: () => void } = {}): void {
  appStore.setState(appStore.getInitialState(), true);
  appStore.setState({
    platform,
    status: 'needs-token',
    locale: options.locale ?? 'en',
    needsTokenReason: options.reason ?? 'no-token',
    tokenDetected: options.tokenDetected ?? false,
    ...(options.startDemoMode ? { startDemoMode: options.startDemoMode } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Onboarding', () => {
  it('explains the three steps, the privacy promise and the terms-of-service note', async () => {
    showOnboarding(createFakePlatform());
    render(<Onboarding />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Discord login needed');
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toContain('Log in at discord.com first');
    expect(steps[1].textContent).toContain('already has');
    expect(steps[2].textContent).toContain('Nothing leaves your computer');
    expect(screen.getByText(/Terms of Service/)).toBeTruthy();
    expect(await screen.findByText('No Discord tab is open')).toBeTruthy();
  });

  it('is available in Korean', async () => {
    showOnboarding(createFakePlatform(), { locale: 'ko' });
    render(<Onboarding />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Discord 로그인 정보가 필요해요');
    expect(await screen.findByRole('button', { name: 'Discord 열기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '데모 모드로 둘러보기' })).toBeTruthy();
    expect(screen.getByText('열려 있는 Discord 탭이 없어요')).toBeTruthy();
  });

  it.each([
    ['no-token', 'No Discord login found yet.'],
    ['expired', 'Your Discord login has expired. Please log in again.'],
    ['invalid', 'Discord rejected the login. Please log in again in a Discord tab.'],
  ] as const)('shows why it is here: %s', (reason, text) => {
    showOnboarding(createFakePlatform(), { reason });
    render(<Onboarding />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(document.querySelector('.onboarding__reason')?.getAttribute('data-reason')).toBe(reason);
  });

  describe('without a Discord tab', () => {
    it('offers to open Discord and calls the platform', async () => {
      const platform = createFakePlatform();
      showOnboarding(platform);
      render(<Onboarding />);

      const open = await screen.findByRole('button', { name: 'Open Discord' });
      expect(screen.queryByRole('button', { name: 'Reload Discord tabs' })).toBeNull();
      await act(async () => {
        fireEvent.click(open);
      });
      expect(platform.spies.openDiscord).toHaveBeenCalledTimes(1);
      expect(platform.spies.reloadDiscordTabs).not.toHaveBeenCalled();
    });

    it('reports a failure to open Discord', async () => {
      const platform = createFakePlatform();
      platform.spies.openDiscord.mockRejectedValueOnce(new Error('blocked'));
      showOnboarding(platform);
      render(<Onboarding />);
      const button = await screen.findByRole('button', { name: 'Open Discord' });
      await act(async () => {
        fireEvent.click(button);
      });
      expect(screen.getByText(/Could not open Discord/)).toBeTruthy();
    });
  });

  describe('with Discord tabs', () => {
    it('shows the count and offers a reload instead of opening', async () => {
      const platform = createFakePlatform({ tabs: [TAB, { id: 8, url: 'https://discord.com/app' }] });
      showOnboarding(platform);
      render(<Onboarding />);

      expect(await screen.findByText('2 Discord tabs open')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reload Discord tabs' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Open Discord' })).toBeNull();
      expect(screen.getByText(/makes Discord send its requests again/)).toBeTruthy();
    });

    it('uses the singular for one tab', async () => {
      showOnboarding(createFakePlatform({ tabs: [TAB] }));
      render(<Onboarding />);
      expect(await screen.findByText('1 Discord tab open')).toBeTruthy();
    });

    it('reloads the tabs through the platform and says how many', async () => {
      const platform = createFakePlatform({ tabs: [TAB] });
      showOnboarding(platform);
      render(<Onboarding />);

      const button = await screen.findByRole('button', { name: 'Reload Discord tabs' });
      await act(async () => {
        fireEvent.click(button);
      });
      expect(platform.spies.reloadDiscordTabs).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Reloaded 1 tab\./)).toBeTruthy();
    });

    it('reports a failed reload', async () => {
      const platform = createFakePlatform({ tabs: [TAB] });
      platform.spies.reloadDiscordTabs.mockRejectedValueOnce(new Error('no permission'));
      showOnboarding(platform);
      render(<Onboarding />);
      const button = await screen.findByRole('button', { name: 'Reload Discord tabs' });
      await act(async () => {
        fireEvent.click(button);
      });
      expect(screen.getByText(/Could not reload the tabs/)).toBeTruthy();
    });
  });

  describe('live tab count', () => {
    it('follows the tabs every few seconds', async () => {
      const platform = createFakePlatform();
      showOnboarding(platform);
      render(<Onboarding />);
      expect(await screen.findByText('No Discord tab is open')).toBeTruthy();
      const calls = platform.spies.findDiscordTabs.mock.calls.length;

      platform.tabs = [TAB];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(platform.spies.findDiscordTabs.mock.calls.length).toBeGreaterThan(calls);
      expect(screen.getByText('1 Discord tab open')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reload Discord tabs' })).toBeTruthy();
    });

    it('refreshes when the window gets focus', async () => {
      const platform = createFakePlatform();
      showOnboarding(platform);
      render(<Onboarding />);
      expect(await screen.findByText('No Discord tab is open')).toBeTruthy();

      platform.tabs = [TAB];
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(screen.getByText('1 Discord tab open')).toBeTruthy();
    });

    it('refreshes when the page becomes visible again', async () => {
      const platform = createFakePlatform();
      showOnboarding(platform);
      render(<Onboarding />);
      expect(await screen.findByText('No Discord tab is open')).toBeTruthy();

      platform.tabs = [TAB];
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(screen.getByText('1 Discord tab open')).toBeTruthy();
    });

    it('does not poll while the page is hidden', async () => {
      const platform = createFakePlatform();
      showOnboarding(platform);
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      render(<Onboarding />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(platform.spies.findDiscordTabs).not.toHaveBeenCalled();
      expect(screen.getByText('Checking for Discord tabs…')).toBeTruthy();
    });

    it('stops polling and listening after it was removed', async () => {
      const platform = createFakePlatform();
      showOnboarding(platform);
      const view = render(<Onboarding />);
      await screen.findByText('No Discord tab is open');
      view.unmount();

      const calls = platform.spies.findDiscordTabs.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
        window.dispatchEvent(new Event('focus'));
      });
      expect(platform.spies.findDiscordTabs.mock.calls.length).toBe(calls);
    });

    it('a failing tab lookup is treated as "no tab"', async () => {
      const platform = createFakePlatform();
      platform.spies.findDiscordTabs.mockRejectedValue(new Error('no tabs permission'));
      showOnboarding(platform);
      render(<Onboarding />);
      expect(await screen.findByRole('button', { name: 'Open Discord' })).toBeTruthy();
    });
  });

  it('starts the demo mode', async () => {
    const startDemoMode = vi.fn();
    showOnboarding(createFakePlatform(), { startDemoMode });
    render(<Onboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore in demo mode' }));
    expect(startDemoMode).toHaveBeenCalledTimes(1);
    await screen.findByText('No Discord tab is open');
  });

  it('shows a "token detected" state while the captured token is being checked', async () => {
    const platform = createFakePlatform();
    showOnboarding(platform, { tokenDetected: true });
    render(<Onboarding />);

    expect(screen.getByRole('status').textContent).toContain('Login detected. Loading…');
    expect(screen.queryByRole('button', { name: 'Open Discord' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload Discord tabs' })).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    // The demo door stays open.
    expect(screen.getByRole('button', { name: 'Explore in demo mode' })).toBeTruthy();
  });

  it('switches to the detected state by itself when the store says so', async () => {
    showOnboarding(createFakePlatform());
    render(<Onboarding />);
    await screen.findByText('No Discord tab is open');
    act(() => {
      appStore.setState({ tokenDetected: true });
    });
    expect(screen.getByText('Login detected. Loading…')).toBeTruthy();
  });
});
