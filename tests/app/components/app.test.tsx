// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { appStore } from '@/app/state/store';
import type { AppState } from '@/app/state/types';
import { createFakePlatform } from '../helpers';

// The export formats are irrelevant here; keeping them out also keeps this suite independent of the format modules.
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

function setup(state: Partial<AppState>): { init: ReturnType<typeof vi.fn> } {
  const init = vi.fn(async () => undefined);
  appStore.setState(appStore.getInitialState(), true);
  appStore.setState({ init, locale: 'en', ...state });
  return { init };
}

beforeEach(() => {
  document.title = '';
  document.documentElement.lang = '';
});

afterEach(cleanup);

describe('App', () => {
  it('starts the boot on mount', () => {
    const { init } = setup({ status: 'booting' });
    render(<App />);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('under StrictMode init may be called twice: that is fine because init is idempotent', () => {
    const { init } = setup({ status: 'booting' });
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(init.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('booting: a centered spinner with a label', () => {
    setup({ status: 'booting' });
    render(<App />);
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeTruthy();
    expect(document.querySelector('.app-shell')).toBeNull();
  });

  it('booting: the label follows the locale', () => {
    setup({ status: 'booting', locale: 'ko' });
    render(<App />);
    expect(screen.getByRole('status', { name: '불러오는 중…' })).toBeTruthy();
  });

  it('needs-token: the onboarding screen', () => {
    setup({ status: 'needs-token', needsTokenReason: 'expired', platform: createFakePlatform() });
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Discord login needed');
    expect(screen.getByText('Your Discord login has expired. Please log in again.')).toBeTruthy();
    expect(document.querySelector('.app-shell')).toBeNull();
  });

  it('fatal: an error panel with the message and a retry button', () => {
    const retry = vi.fn(async () => undefined);
    setup({ status: 'fatal', fatalError: 'Could not reach Discord.', retry });
    render(<App />);

    const panel = screen.getByRole('alert');
    expect(panel.textContent).toContain('Could not load your Discord data');
    expect(panel.textContent).toContain('Could not reach Discord.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('fatal: still readable without a message', () => {
    setup({ status: 'fatal', fatalError: null });
    render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('An unknown error occurred.');
  });

  it('ready: the three-column shell with rail, sidebar and main (top bar + chat)', () => {
    setup({ status: 'ready' });
    const { container } = render(<App />);

    const shell = container.querySelector('.app-shell');
    expect(shell).not.toBeNull();
    const children = Array.from(shell?.children ?? []);
    expect(children).toHaveLength(3);
    expect(children[0].classList.contains('app-rail')).toBe(true);
    expect(children[1].classList.contains('app-sidebar')).toBe(true);
    expect(children[2].tagName).toBe('MAIN');
    expect(children[2].classList.contains('app-main')).toBe(true);
    const main = Array.from(children[2].children);
    expect(main).toHaveLength(2);
    expect(main[0].classList.contains('app-topbar')).toBe(true);
    expect(main[1].classList.contains('app-chat')).toBe(true);
  });

  it('keeps <html lang> and the document title in sync with the locale and mode', () => {
    setup({ status: 'booting', locale: 'ko', mode: 'live' });
    render(<App />);
    expect(document.documentElement.lang).toBe('ko');
    expect(document.title).toBe('Discord Chat Extractor');

    cleanup();
    setup({ status: 'booting', locale: 'en', mode: 'demo' });
    render(<App />);
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Discord Chat Extractor - Demo mode');
  });

  it('switches screens when the status changes', () => {
    setup({ status: 'booting', platform: createFakePlatform() });
    const { container } = render(<App />);
    expect(container.querySelector('.app-shell')).toBeNull();

    act(() => {
      appStore.setState({ status: 'ready' });
    });
    expect(container.querySelector('.app-shell')).not.toBeNull();

    act(() => {
      appStore.setState({ status: 'needs-token', needsTokenReason: 'no-token' });
    });
    expect(container.querySelector('.app-shell')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
});
