// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { common } from '@/app/i18n/common';
import { appStore } from '@/app/state/store';
import { DiscordApiError } from '@/lib/discord/client';
import { MOCK_IDS } from '@/lib/discord/mock';
import { bootTopBar, select, type BootedTopBar } from './topbar/helpers';

// The export formats are irrelevant here; keeping them out also keeps this suite independent of the format modules.
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

afterEach(cleanup);

/** What Discord answers when it blocks the client (Cloudflare / anti-abuse): an HTTP 403 that is not a permission error. */
const blocked = (): DiscordApiError => new DiscordApiError('unknown', 'Discord API error 403 for GET /x (raw English text)', { status: 403, code: 40333 });

/** The whole app on a booted demo store, with one channel ticked so that the export options can be opened. */
async function mountApp(): Promise<BootedTopBar> {
  const booted = await bootTopBar('en');
  select(MOCK_IDS.generalChannel);
  // `App` boots on mount: the store is booted already.
  appStore.setState({ init: vi.fn(async () => undefined) });
  return booted;
}

/** What the user does: caret of the Download button, then the language row of the options. */
function chooseLanguage(name: '한국어' | 'English', caret: string): void {
  fireEvent.click(screen.getByRole('button', { name: caret }));
  fireEvent.click(within(screen.getByRole('dialog', { name: caret })).getByRole('radio', { name }));
}

describe('switching the language while an error is on screen (NEW-5)', () => {
  it('the error panel of a channel follows: title, sentence and button are all in the new language, both ways', async () => {
    const booted = await mountApp();
    booted.spies.getMessages.mockRejectedValueOnce(blocked());
    await act(async () => {
      await appStore.getState().openChannel(MOCK_IDS.edge200Channel, MOCK_IDS.bigGuild);
    });
    render(<App />);
    expect(screen.getByText("Couldn't load the messages")).toBeTruthy();
    expect(screen.getByText(common.en.errorBlocked(403))).toBeTruthy();

    chooseLanguage('한국어', 'Export options');
    expect(screen.getByText('메시지를 불러오지 못했어요')).toBeTruthy();
    expect(screen.getByText(common.ko.errorBlocked(403))).toBeTruthy();
    expect(screen.queryByText(common.en.errorBlocked(403))).toBeNull();
    expect(screen.queryByText("Couldn't load the messages")).toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    chooseLanguage('English', '내보내기 옵션');
    expect(screen.getByText(common.en.errorBlocked(403))).toBeTruthy();
    expect(screen.queryByText(common.ko.errorBlocked(403))).toBeNull();
  });

  it('so does the message of a server whose channels failed to load, in the sidebar', async () => {
    const booted = await mountApp();
    booted.spies.getGuildChannels.mockRejectedValueOnce(blocked());
    await act(async () => {
      await appStore.getState().openGuild(MOCK_IDS.englishGuild);
    });
    render(<App />);
    const sidebar = (): HTMLElement => document.querySelector('.app-sidebar') as HTMLElement;
    expect(within(sidebar()).getByText(common.en.errorBlocked(403))).toBeTruthy();

    chooseLanguage('한국어', 'Export options');
    expect(within(sidebar()).getByText(common.ko.errorBlocked(403))).toBeTruthy();
    expect(within(sidebar()).queryByText(common.en.errorBlocked(403))).toBeNull();
    expect(within(sidebar()).getByRole('button', { name: common.ko.retry })).toBeTruthy();
  });

  it('and the note the rail keeps for a server that is not open (screen readers hear it)', async () => {
    const booted = await mountApp();
    booted.spies.getGuildChannels.mockRejectedValueOnce(blocked());
    await act(async () => {
      await appStore.getState().ensureGuildTree(MOCK_IDS.englishGuild);
    });
    render(<App />);
    const rail = (): HTMLElement => document.querySelector('.app-rail') as HTMLElement;
    const note = (): string => within(rail()).getAllByRole('alert').map((alert) => alert.textContent ?? '').join('|');
    expect(note()).toContain("Couldn't load the channels of");
    expect(note()).toContain(common.en.errorBlocked(403));

    chooseLanguage('한국어', 'Export options');
    expect(note()).toContain('채널 목록을 불러오지 못했어요');
    expect(note()).toContain(common.ko.errorBlocked(403));
    expect(note()).not.toContain(common.en.errorBlocked(403));
  });
});
