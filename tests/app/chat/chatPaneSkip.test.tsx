// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '@/app/components/chat/ChatPane';
import { appStore } from '@/app/state';
import { createMockClient, MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import { installFakeLayout, installFakeResizeObserver, type FakeLayout, type InstalledResizeObserver } from './fakeLayout';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

let layout: FakeLayout;
let resize: InstalledResizeObserver;

beforeEach(async () => {
  appStore.setState(appStore.getInitialState(), true);
  await appStore.getState().initWithClient(createMockClient({ latencyMs: 0 }), MOCK_ME);
  await appStore.getState().ensureGuildTree(MOCK_IDS.bigGuild);
  appStore.setState({ locale: 'en' });
  layout = installFakeLayout({ viewportHeight: 600 });
  resize = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  layout.restore();
  resize.restore();
});

describe('the chat pane as a skip-link target (UI-3)', () => {
  it('is a labelled region that script can focus, also while no channel is open', () => {
    const { container } = render(<ChatPane />);
    const pane = container.firstElementChild as HTMLElement;
    expect(pane.tagName).toBe('SECTION');
    expect(pane.classList.contains('app-chat')).toBe(true);
    expect(screen.getByRole('region', { name: 'Messages' })).toBe(pane);
    expect(pane.getAttribute('tabindex')).toBe('-1');
    expect(pane.getAttribute('data-skip-target')).toBe('chat');
    pane.focus();
    expect(document.activeElement).toBe(pane);
  });

  it('is labelled in Korean', () => {
    appStore.setState({ locale: 'ko' });
    render(<ChatPane />);
    expect(screen.getByRole('region', { name: '메시지' })).toBeTruthy();
  });

  it('the open message list is the better target: the log is focusable and tagged', async () => {
    const { container } = render(<ChatPane />);
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.generalChannel, MOCK_IDS.bigGuild);
    });
    const log = container.querySelector<HTMLElement>('[data-skip-target="messages"]');
    expect(log).not.toBeNull();
    expect(log?.getAttribute('role')).toBe('log');
    expect(log?.getAttribute('tabindex')).toBe('0');
    log?.focus();
    expect(document.activeElement).toBe(log);
  });
});
