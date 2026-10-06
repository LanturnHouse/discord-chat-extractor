// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import { installFakeLayout, installFakeResizeObserver, type FakeLayout, type InstalledResizeObserver } from '../chat/fakeLayout';
import { bootApp } from '../rail/helpers';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

let layout: FakeLayout;
let resize: InstalledResizeObserver;

beforeEach(() => {
  layout = installFakeLayout({ viewportHeight: 600 });
  resize = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  layout.restore();
  resize.restore();
  vi.restoreAllMocks();
});

/** The ready app on the demo data; `init` is stubbed so that mounting does not boot a second time. */
async function renderReadyApp(locale: 'en' | 'ko' = 'en'): Promise<HTMLElement> {
  await bootApp({ locale });
  appStore.setState({ init: vi.fn(async () => undefined) });
  return render(<App />).container;
}

const skipLink = (name: string): HTMLElement => screen.getByRole('link', { name });

describe('skip links (UI-3)', () => {
  it('are the first three tab stops of the app, before the rail and its hundreds of controls', async () => {
    const container = await renderReadyApp();
    const stops = Array.from(container.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex="0"]'));
    expect(stops.slice(0, 3).map((element) => element.textContent)).toEqual(['Skip to channel list', 'Skip to messages', 'Skip to export controls']);
    expect(stops.slice(0, 3).every((element) => element.tagName === 'A' && element.classList.contains('skip-link'))).toBe(true);
    expect(stops[3].closest('.app-rail')).not.toBeNull();
    // Outside the grid of the shell, so they cannot take a cell of it.
    expect(container.querySelector('.app-shell')?.querySelector('.skip-links')).toBeNull();
    expect(container.firstElementChild?.classList.contains('skip-links')).toBe(true);
  });

  it('are in Korean in Korean', async () => {
    await renderReadyApp('ko');
    for (const name of ['채널 목록으로', '메시지로', '내보내기로']) expect(skipLink(name)).toBeTruthy();
  });

  it('exist only on the main screen', async () => {
    appStore.setState(appStore.getInitialState(), true);
    appStore.setState({ init: vi.fn(async () => undefined), status: 'booting', locale: 'en' });
    render(<App />);
    expect(screen.queryByRole('link', { name: /skip to/i })).toBeNull();
  });

  it('"channel list" focuses the list of conversations, and the list of a server once one is open', async () => {
    await renderReadyApp();
    fireEvent.click(skipLink('Skip to channel list'));
    const dmList = within(screen.getByRole('complementary')).getByRole('group', { name: 'Direct Messages' });
    expect(document.activeElement).toBe(dmList);

    await act(async () => {
      await appStore.getState().openGuild(MOCK_IDS.bigGuild);
    });
    fireEvent.click(skipLink('Skip to channel list'));
    expect(document.activeElement).toBe(within(screen.getByRole('complementary')).getByRole('group', { name: 'Channels' }));
  });

  it('"messages" focuses the pane while nothing is open, and the message log once a channel is', async () => {
    await renderReadyApp();
    fireEvent.click(skipLink('Skip to messages'));
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Messages' }));

    await act(async () => {
      await appStore.getState().openGuild(MOCK_IDS.bigGuild);
      await appStore.getState().openChannel(MOCK_IDS.generalChannel, MOCK_IDS.bigGuild);
    });
    fireEvent.click(skipLink('Skip to messages'));
    expect(document.activeElement).toBe(screen.getByRole('log'));
  });

  it('"export controls" focuses the Download button', async () => {
    await renderReadyApp();
    fireEvent.click(skipLink('Skip to export controls'));
    const download = document.activeElement as HTMLElement;
    expect(download.tagName).toBe('BUTTON');
    expect(download.classList.contains('topbar__split-main')).toBe(true);
    expect(download.textContent).toContain('Download');
  });

  it('use the keyboard path of a link: Enter activates them without navigating the page', async () => {
    await renderReadyApp();
    const before = window.location.href;
    const link = skipLink('Skip to messages');
    link.focus();
    // `click` is what Enter on a link dispatches; the default (a fragment navigation) must be cancelled.
    expect(fireEvent.click(link)).toBe(false);
    expect(window.location.href).toBe(before);
  });

  it('are drawn only while focused (visually hidden otherwise)', () => {
    const css = readFileSync(resolve(__dirname, '../../../src/app/styles/layout.css'), 'utf8');
    expect(css).toMatch(/\.skip-link:not\(:focus\)\s*\{[^}]*position:\s*absolute[^}]*clip-path:\s*inset\(50%\)/);
    expect(css).toMatch(/\.skip-link:focus\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*var\(--z-tooltip\)/);
  });
});

describe('landmarks of the shell (UI-3)', () => {
  it('has a navigation (servers), a complementary (channels), a main and a labelled messages region', async () => {
    await renderReadyApp();
    expect(screen.getByRole('navigation', { name: 'Servers' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Direct Messages' })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('region', { name: 'Messages' })).toBeTruthy();
    expect(main.classList.contains('app-main')).toBe(true);
  });
});
