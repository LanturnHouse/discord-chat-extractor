// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerRail } from '@/app/components/rail/ServerRail';
import { selectSelectionCountForGuild } from '@/app/state/selectors';
import { appStore } from '@/app/state/store';
import { DiscordApiError } from '@/lib/discord/client';
import { MOCK_IDS } from '@/lib/discord/mock';
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

const guilds = () => appStore.getState().guilds;
const rail = (): HTMLElement => screen.getByRole('navigation');
const iconOf = (name: string): HTMLElement => within(rail()).getByRole('button', { name });
const checkboxOf = (name: string): HTMLElement => within(rail()).getByRole('checkbox', { name: new RegExp(`^Select every channel of ${name}`) });

describe('a server whose channel list fails to load (UI-8 / REQ-6)', () => {
  /** The first load fails; later ones work, unless `always` is set. */
  async function failFirstLoad(always = false): Promise<{ name: string; load: ReturnType<typeof vi.spyOn> }> {
    const client = await bootApp();
    const original = client.getGuildChannels.bind(client);
    const failure = new DiscordApiError('rate-limited', 'slow down', { status: 429 });
    const load = vi.spyOn(client, 'getGuildChannels');
    if (always) load.mockRejectedValue(failure);
    else load.mockRejectedValueOnce(failure).mockImplementation(original);
    return { name: guilds()[0].name, load };
  }

  it('marks the checkbox as failed, names the reason in its label and tooltip, and announces it', async () => {
    const { name } = await failFirstLoad();
    render(<ServerRail />);
    expect(checkboxOf(name).hasAttribute('data-invalid')).toBe(false);

    await act(async () => {
      fireEvent.click(checkboxOf(name));
    });
    await settle();

    expect(appStore.getState().trees[BIG].status).toBe('error');
    const box = checkboxOf(name);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.hasAttribute('data-invalid')).toBe(true);
    const reason = 'Discord rate limit reached. Please try again in a moment.';
    expect(box.getAttribute('aria-label')).toBe(`Select every channel of ${name} (couldn't load its channels. ${reason} Select again to retry)`);
    expect(box.getAttribute('title')).toBe(box.getAttribute('aria-label'));
    // The warning is never hidden behind the "show on hover" rule, and nothing was selected.
    expect(box.classList.contains('dce-checkbox--reveal')).toBe(false);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(appStore.getState().selection).toEqual({});
    expect(within(rail()).getByRole('alert').textContent).toBe(`Couldn't load the channels of ${name}. ${reason}`);
  });

  it('retries when the checkbox is pressed again, and the warning goes away once the channels are there', async () => {
    const { name, load } = await failFirstLoad();
    render(<ServerRail />);
    await act(async () => {
      fireEvent.click(checkboxOf(name));
    });
    await settle();
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(checkboxOf(name));
    });
    await settle();

    expect(load).toHaveBeenCalledTimes(2);
    expect(appStore.getState().trees[BIG].status).toBe('loaded');
    expect(selectSelectionCountForGuild(appStore.getState(), BIG)).toBeGreaterThan(0);
    const box = checkboxOf(name);
    expect(box.hasAttribute('data-invalid')).toBe(false);
    expect(box.getAttribute('aria-invalid')).toBeNull();
    expect(box.getAttribute('title')).toBeNull();
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(within(rail()).queryByRole('alert')).toBeNull();
  });

  it('speaks Korean when the locale is ko', async () => {
    const { name } = await failFirstLoad();
    appStore.setState({ locale: 'ko' });
    render(<ServerRail />);
    await act(async () => {
      fireEvent.click(within(rail()).getByRole('checkbox', { name: `${name} 서버의 모든 채널 선택` }));
    });
    await settle();
    const box = within(rail()).getByRole('checkbox', { name: new RegExp(`^${name} 서버의 모든 채널 선택 \\(채널 목록을 불러오지 못했어요\\.`) });
    expect(box.getAttribute('aria-label')).toContain('Discord 요청 한도에 도달했습니다');
    expect(within(rail()).getByRole('alert').textContent).toContain(`${name} 서버의 채널 목록을 불러오지 못했어요.`);
  });

  it('does not announce it a second time for the open server: the sidebar shows the message with its own retry button', async () => {
    const { name } = await failFirstLoad(true);
    render(<ServerRail />);
    await act(async () => {
      fireEvent.click(checkboxOf(name));
    });
    await settle();
    expect(within(rail()).getAllByRole('alert')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(iconOf(name));
    });
    await settle();
    expect(appStore.getState().view).toEqual({ kind: 'guild', guildId: BIG });
    // Still marked, but silent: the screen reader hears the sidebar's alert instead.
    expect(checkboxOf(name).getAttribute('aria-invalid')).toBe('true');
    expect(within(rail()).queryByRole('alert')).toBeNull();
  });

  it('other servers are not marked', async () => {
    const { name } = await failFirstLoad();
    render(<ServerRail />);
    await act(async () => {
      fireEvent.click(checkboxOf(name));
    });
    await settle();
    expect(within(rail()).getAllByRole('checkbox').filter((box) => box.hasAttribute('data-invalid'))).toHaveLength(1);
  });
});

describe('a server checkbox that is busy loading (UI-7)', () => {
  it('stays focusable instead of becoming disabled, so the keyboard focus is not dropped to <body>', async () => {
    const client = await bootApp();
    const { release } = gateGuildChannels(client);
    render(<ServerRail />);
    const name = guilds()[0].name;

    checkboxOf(name).focus();
    fireEvent.click(checkboxOf(name));

    const box = checkboxOf(name) as HTMLButtonElement;
    expect(appStore.getState().trees[BIG].status).toBe('loading');
    expect(box.disabled).toBe(false);
    expect(box.getAttribute('aria-busy')).toBe('true');
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(box);

    await act(async () => {
      release();
    });
    await settle();
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('aria-busy')).toBeNull();
  });

  it('ignores presses while busy: two clicks must not toggle the selection back and forth', async () => {
    const client = await bootApp();
    const { release } = gateGuildChannels(client);
    render(<ServerRail />);
    const name = guilds()[0].name;

    fireEvent.click(checkboxOf(name));
    fireEvent.click(checkboxOf(name));
    fireEvent.keyDown(checkboxOf(name), { key: 'Enter' });
    await act(async () => {
      release();
    });
    await settle();

    expect(selectSelectionCountForGuild(appStore.getState(), BIG)).toBeGreaterThan(0);
    expect(checkboxOf(name).getAttribute('aria-checked')).toBe('true');
  });
});

describe('keyboard navigation of the rail (UI-3)', () => {
  const press = (element: HTMLElement, key: string, init: KeyboardEventInit = {}): boolean => fireEvent.keyDown(element, { key, ...init });

  it('ArrowDown / ArrowUp move between the icons, in order, from an icon or from a checkbox', async () => {
    await bootApp();
    render(<ServerRail />);
    const names = guilds().map((guild) => guild.name);

    iconOf('Direct Messages').focus();
    expect(press(iconOf('Direct Messages'), 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(iconOf(names[0]));

    press(iconOf(names[0]), 'ArrowDown');
    expect(document.activeElement).toBe(iconOf(names[1]));

    // From the corner checkbox of a server the next icon is the next server's, not the checkbox's own.
    checkboxOf(names[1]).focus();
    press(checkboxOf(names[1]), 'ArrowDown');
    expect(document.activeElement).toBe(iconOf(names[2]));
    press(checkboxOf(names[2]), 'ArrowUp');
    expect(document.activeElement).toBe(iconOf(names[1]));

    press(iconOf(names[0]), 'ArrowUp');
    expect(document.activeElement).toBe(iconOf('Direct Messages'));
  });

  it('Home and End jump to the first and last icon; the ends do not wrap', async () => {
    await bootApp();
    render(<ServerRail />);
    const names = guilds().map((guild) => guild.name);
    const last = iconOf(names[names.length - 1]);

    iconOf(names[3]).focus();
    press(iconOf(names[3]), 'End');
    expect(document.activeElement).toBe(last);
    press(last, 'ArrowDown');
    expect(document.activeElement).toBe(last);
    press(last, 'Home');
    expect(document.activeElement).toBe(iconOf('Direct Messages'));
    press(iconOf('Direct Messages'), 'ArrowUp');
    expect(document.activeElement).toBe(iconOf('Direct Messages'));
  });

  it('leaves keys with modifiers and every other key alone', async () => {
    await bootApp();
    render(<ServerRail />);
    const first = iconOf(guilds()[0].name);
    first.focus();
    for (const init of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(press(first, 'ArrowDown', init)).toBe(true);
    }
    expect(press(first, 'a')).toBe(true);
    expect(press(first, 'Tab')).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});
