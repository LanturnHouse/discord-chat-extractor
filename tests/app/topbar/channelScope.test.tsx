// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { endOfDayIso, startOfDayIso } from '@/app/components/topbar/dates';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { ExportFormat, ExportFormatId, ExportScope } from '@/lib/export/types';
import { bootTopBar, idLinesFormat, select, type BootedTopBar } from './helpers';

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  loadExportFormat: vi.fn<(id: ExportFormatId) => Promise<ExportFormat>>(),
}));

vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: mocks.loadExportFormat }));

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.saveBlob.mockReset();
  mocks.loadExportFormat.mockReset();
  mocks.loadExportFormat.mockImplementation(async (id) => idLinesFormat(id));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  cleanup();
});

const scope = (patch: Partial<ExportScope> = {}): ExportScope => ({ after: null, before: null, limit: null, ...patch });

const chip = (): HTMLElement => screen.getByRole('button', { name: /selected|선택됨/ });
const popover = (): HTMLElement => screen.getByRole('dialog', { name: /Selected chats|선택한 항목/ });
const popoverOrNull = (): HTMLElement | null => screen.queryByRole('dialog', { name: /Selected chats|선택한 항목/ });
const main = (): HTMLElement => screen.getByRole('button', { name: /^Download|^다운로드/ });
const gearName = (name: string, locale: 'en' | 'ko' = 'en'): string => (locale === 'en' ? `Export settings for ${name}` : `${name} 내보내기 설정`);
const gear = (name: string, locale: 'en' | 'ko' = 'en'): HTMLElement => within(popover()).getByRole('button', { name: gearName(name, locale) });
const panel = (name: string, locale: 'en' | 'ko' = 'en'): HTMLElement => within(popover()).getByRole('group', { name: gearName(name, locale) });
const panelOrNull = (name: string): HTMLElement | null => within(popover()).queryByRole('group', { name: gearName(name) });
const row = (name: string, locale: 'en' | 'ko' = 'en'): HTMLElement => gear(name, locale).closest('li') as HTMLElement;
const summaryOf = (name: string, locale: 'en' | 'ko' = 'en'): string | null => row(name, locale).querySelector('.topbar-sel__scope')?.textContent ?? null;
const remove = (name: string): HTMLElement => within(popover()).getByRole('button', { name: `Remove ${name} from the selection` });
const useCommon = (name: string): HTMLInputElement => within(panel(name)).getByRole('checkbox', { name: /Use common settings|공통 설정 사용/ });
const limitIn = (name: string): HTMLInputElement => within(panel(name)).getByRole('spinbutton', { name: /Messages to export|내보낼 메시지 개수/ });
const dateIn = (name: string, label: 'From' | 'To'): HTMLInputElement => within(panel(name)).getByLabelText(label);
const override = (channelId: string): ExportScope | undefined => appStore.getState().exportOverrides[channelId];
const dmName = (): string => appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';

async function start(
  locale: 'en' | 'ko' = 'en',
  selected: string[] = [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel, MOCK_IDS.dmFriend],
  open = true,
): Promise<BootedTopBar> {
  const booted = await bootTopBar(locale);
  select(...selected);
  render(<TopBar />);
  if (open) fireEvent.click(chip());
  return booted;
}

const openPanel = (name: string): void => {
  fireEvent.click(gear(name));
};
const ownSettings = (name: string): void => {
  openPanel(name);
  fireEvent.click(useCommon(name));
};
const typeLimit = (name: string, value: string): void => {
  fireEvent.change(limitIn(name), { target: { value } });
};

describe('the gear', () => {
  it('every row has one, named after the channel, and it sits right before the remove button', async () => {
    await start('en', [MOCK_IDS.generalChannel, MOCK_IDS.generalThread, MOCK_IDS.dmFriend]);
    const threadName = appStore.getState().selection[MOCK_IDS.generalThread].channelName;
    for (const name of ['general', threadName, dmName()]) {
      const button = gear(name);
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(button.getAttribute('aria-controls')).toBeNull();
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(button.nextElementSibling).toBe(remove(name));
      expect(button.parentElement?.classList.contains('topbar-sel__line')).toBe(true);
    }
    expect(within(popover()).getAllByRole('button', { name: /^Export settings for / })).toHaveLength(3);
  });

  it('is named in Korean', async () => {
    await start('ko', [MOCK_IDS.generalChannel]);
    expect(gear('general', 'ko').getAttribute('aria-expanded')).toBe('false');
  });

  it('is the first stop when the list opens (the harmless button before the destructive one)', async () => {
    await start();
    expect(document.activeElement).toBe(gear('general'));
  });

  it('opens the settings of THAT row only, moves the focus into them and closes with a second click', async () => {
    await start();
    openPanel('edge-199');
    const opened = panel('edge-199');
    expect(row('edge-199').contains(opened)).toBe(true);
    expect(gear('edge-199').getAttribute('aria-expanded')).toBe('true');
    expect(gear('edge-199').getAttribute('aria-controls')).toBe(opened.id);
    expect(gear('general').getAttribute('aria-expanded')).toBe('false');
    expect(panelOrNull('general')).toBeNull();
    expect(opened.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(useCommon('edge-199'));

    fireEvent.click(gear('edge-199'));
    expect(panelOrNull('edge-199')).toBeNull();
    expect(gear('edge-199').getAttribute('aria-expanded')).toBe('false');
    expect(popover()).toBeTruthy();
  });

  it('only one row is unfolded at a time', async () => {
    await start();
    openPanel('general');
    openPanel('edge-199');
    expect(panelOrNull('general')).toBeNull();
    expect(panel('edge-199')).toBeTruthy();
    expect(within(popover()).getAllByRole('group')).toHaveLength(1);
    expect(gear('general').getAttribute('aria-expanded')).toBe('false');
    expect(panel('edge-199').contains(document.activeElement)).toBe(true);
  });
});

describe('common settings by default', () => {
  it('"Use common settings" is on and says what the common settings are; nothing is overridden', async () => {
    await start();
    appStore.getState().setExportLimit(200);
    openPanel('general');
    expect(useCommon('general').checked).toBe(true);
    expect(within(panel('general')).getByText('Common settings: Newest 200 messages')).toBeTruthy();
    expect(within(panel('general')).queryByRole('spinbutton')).toBeNull();
    expect(within(panel('general')).queryByLabelText('From')).toBeNull();
    expect(within(panel('general')).queryByRole('button', { name: 'Reset to common settings' })).toBeNull();
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(summaryOf('general')).toBeNull();
    expect(gear('general').hasAttribute('data-active')).toBe(false);
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();
  });

  it('follows the common settings while the toggle is on', async () => {
    await start();
    openPanel('general');
    expect(within(panel('general')).getByText('Common settings: All messages')).toBeTruthy();
    act(() => appStore.getState().setExportLimit(50));
    expect(within(panel('general')).getByText('Common settings: Newest 50 messages')).toBeTruthy();
  });

  it('the texts are Korean in Korean', async () => {
    await start('ko', [MOCK_IDS.generalChannel]);
    appStore.getState().setExportLimit(200);
    fireEvent.click(gear('general', 'ko'));
    expect(within(panel('general', 'ko')).getByText('공통 설정 사용')).toBeTruthy();
    expect(within(panel('general', 'ko')).getByText('공통 설정: 최근 200개')).toBeTruthy();
  });
});

describe('turning "Use common settings" off', () => {
  it('starts the channel from the current common values - dates and count - and stores them as its own', async () => {
    await start();
    const common = scope({ after: startOfDayIso('2026-09-01'), before: endOfDayIso('2026-09-30'), limit: 300 });
    act(() => {
      appStore.getState().setExportAfter(common.after);
      appStore.getState().setExportBefore(common.before);
      appStore.getState().setExportLimit(common.limit);
    });
    ownSettings('edge-199');

    expect(useCommon('edge-199').checked).toBe(false);
    expect(override(MOCK_IDS.edge199Channel)).toEqual(common);
    expect(dateIn('edge-199', 'From').value).toBe('2026-09-01');
    expect(dateIn('edge-199', 'To').value).toBe('2026-09-30');
    expect(limitIn('edge-199').value).toBe('300');
    expect(within(panel('edge-199')).getByRole('button', { name: 'Reset to common settings' })).toBeTruthy();
    // Only that channel changed.
    expect(Object.keys(appStore.getState().exportOverrides)).toEqual([MOCK_IDS.edge199Channel]);
  });

  it('an override keeps its values when the common settings change afterwards', async () => {
    await start();
    act(() => appStore.getState().setExportLimit(300));
    ownSettings('edge-199');
    act(() => appStore.getState().setExportLimit(5));
    expect(limitIn('edge-199').value).toBe('300');
    expect(override(MOCK_IDS.edge199Channel)?.limit).toBe(300);
  });

  it('shows what it holds under the name, lights the gear and marks the chip', async () => {
    await start();
    act(() => appStore.getState().setExportLimit(200));
    ownSettings('edge-199');

    expect(summaryOf('edge-199')).toBe('Newest 200 messages');
    expect(gear('edge-199').hasAttribute('data-active')).toBe(true);
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(gear('edge-199').getAttribute('aria-describedby')).toBe(row('edge-199').querySelector('.topbar-sel__scope')?.id);
    expect(gear('general').hasAttribute('data-active')).toBe(false);
    expect(summaryOf('general')).toBeNull();

    expect(chip().querySelector('.topbar__chip-dot')).not.toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('3 selected, 1 with own settings');
    expect(chip().getAttribute('title')).toBe('3 selected, 1 with own settings');
    // The visible text of the chip is unchanged: the dot is decoration.
    expect(chip().textContent).toBe('3 selected');
  });

  it('says it in Korean', async () => {
    await start('ko', [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel]);
    act(() => appStore.getState().setExportLimit(200));
    fireEvent.click(gear('edge-199', 'ko'));
    fireEvent.click(within(panel('edge-199', 'ko')).getByRole('checkbox', { name: '공통 설정 사용' }));
    expect(summaryOf('edge-199', 'ko')).toBe('최근 200개');
    expect(chip().getAttribute('aria-label')).toBe('2개 선택됨, 자체 설정 1개');
    expect(within(panel('edge-199', 'ko')).getByRole('button', { name: '공통 설정으로 되돌리기' })).toBeTruthy();
  });

  it('every kind of scope has a readable summary under the row', async () => {
    await start('en', [MOCK_IDS.edge199Channel]);
    ownSettings('edge-199');
    expect(summaryOf('edge-199')).toBe('All messages');
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ after: startOfDayIso('2026-01-01'), limit: 500 })));
    expect(summaryOf('edge-199')).toBe('From 2026-01-01: first 500');
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ before: endOfDayIso('2026-03-31') })));
    expect(summaryOf('edge-199')).toBe('Until 2026-03-31');
  });
});

describe('editing one channel\'s settings', () => {
  it('the count: "Limit to N" + a number changes that channel only', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 100 }));
    typeLimit('edge-199', '200');
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 200 }));
    expect(appStore.getState().exportSettings.limit).toBeNull();
    expect(summaryOf('edge-199')).toBe('Newest 200 messages');
    expect(override(MOCK_IDS.generalChannel)).toBeUndefined();
  });

  it('quick picks work inside the panel', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: '1,000' }));
    expect(override(MOCK_IDS.edge199Channel)?.limit).toBe(1000);
    expect(summaryOf('edge-199')).toBe('Newest 1,000 messages');
  });

  it('the dates are local days, converted like the common ones: From = start of the day, To = the very end of it', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-01' } });
    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-10-03' } });
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ after: new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(), before: new Date(2026, 9, 3, 23, 59, 59, 999).toISOString() }));
    expect(summaryOf('edge-199')).toBe('2026-10-01 – 2026-10-03');
    // The common settings did not move.
    expect(appStore.getState().exportSettings).toEqual(scope());
  });

  it('a start date and a count: the sentence and the summary say "first N"', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-01' } });
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));
    typeLimit('edge-199', '500');
    expect(within(panel('edge-199')).getByText('Starts at the start date and takes the first 500 messages going forward.')).toBeTruthy();
    expect(summaryOf('edge-199')).toBe('From 2026-10-01: first 500');
    // No "applies to each channel" reminder: this editor is for one channel.
    expect(within(panel('edge-199')).queryByText('The number applies to each channel separately.')).toBeNull();
  });

  it('"All" inside the panel is a real choice: the channel keeps its own settings and exports everything', async () => {
    await start();
    act(() => appStore.getState().setExportLimit(200));
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'All' }));
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope());
    expect(summaryOf('edge-199')).toBe('All messages');
    expect(gear('edge-199').hasAttribute('data-active')).toBe(true);
    expect(appStore.getState().exportSettings.limit).toBe(200);
  });

  it('the clear buttons of the date inputs work inside the panel', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-01' } });
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: 'Clear start date' }));
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope());
    expect(document.activeElement).toBe(dateIn('edge-199', 'From'));
  });

  it('each channel keeps its own values', async () => {
    await start();
    ownSettings('general');
    fireEvent.click(within(panel('general')).getByRole('radio', { name: 'Limit to N' }));
    typeLimit('general', '11');
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));
    typeLimit('edge-199', '22');
    expect(override(MOCK_IDS.generalChannel)?.limit).toBe(11);
    expect(override(MOCK_IDS.edge199Channel)?.limit).toBe(22);
    expect(chip().getAttribute('aria-label')).toBe('3 selected, 2 with own settings');
  });
});

describe('back to the common settings', () => {
  it('"Reset to common settings" removes the override and puts the focus on the toggle', async () => {
    await start();
    act(() => appStore.getState().setExportLimit(200));
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: 'Reset to common settings' }));

    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    expect(useCommon('edge-199').checked).toBe(true);
    expect(document.activeElement).toBe(useCommon('edge-199'));
    expect(summaryOf('edge-199')).toBeNull();
    expect(gear('edge-199').hasAttribute('data-active')).toBe(false);
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('3 selected');
    expect(within(panel('edge-199')).getByText('Common settings: Newest 200 messages')).toBeTruthy();
  });

  it('turning the toggle back on does the same', async () => {
    await start();
    ownSettings('edge-199');
    expect(override(MOCK_IDS.edge199Channel)).toBeDefined();
    fireEvent.click(useCommon('edge-199'));
    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    expect(useCommon('edge-199').checked).toBe(true);
  });

  it('turning it off again starts from the common values of that moment, not from the old override', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));
    typeLimit('edge-199', '9');
    fireEvent.click(useCommon('edge-199'));
    act(() => appStore.getState().setExportLimit(77));
    fireEvent.click(useCommon('edge-199'));
    expect(limitIn('edge-199').value).toBe('77');
  });

  it('the settings of a channel that is deselected vanish with it, and a re-selected channel starts on the common ones', async () => {
    await start();
    ownSettings('edge-199');
    expect(override(MOCK_IDS.edge199Channel)).toBeDefined();
    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    expect(within(popover()).queryByRole('button', { name: gearName('edge-199') })).toBeNull();
    expect(panelOrNull('edge-199')).toBeNull();
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();

    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    openPanel('edge-199');
    expect(useCommon('edge-199').checked).toBe(true);
  });

  it('removing a row with the x while its settings are open removes the settings and keeps the keyboard going', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.click(remove('edge-199'));
    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    expect(within(popover()).queryByRole('group')).toBeNull();
    expect(popover().contains(document.activeElement)).toBe(true);
    expect(popover()).toBeTruthy();
  });
});

describe('inside the selection popover', () => {
  it('Esc closes the settings first and puts the focus back on the gear; the popover stays', async () => {
    await start();
    openPanel('edge-199');
    expect(panel('edge-199').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(panelOrNull('edge-199')).toBeNull();
    expect(popover()).toBeTruthy();
    expect(document.activeElement).toBe(gear('edge-199'));
    expect(gear('edge-199').getAttribute('aria-expanded')).toBe('false');
    expect(chip().getAttribute('aria-expanded')).toBe('true');
  });

  it('a second Esc closes the popover and returns the focus to the chip', async () => {
    await start();
    openPanel('edge-199');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(popoverOrNull()).toBeNull();
    expect(document.activeElement).toBe(chip());
  });

  it('Esc from a field deep inside the settings (a date input, the count) peels the same layer', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));
    limitIn('edge-199').focus();
    fireEvent.keyDown(limitIn('edge-199'), { key: 'Escape' });
    expect(panelOrNull('edge-199')).toBeNull();
    expect(document.activeElement).toBe(gear('edge-199'));
    expect(popover()).toBeTruthy();
  });

  it('Esc with the focus on the gear of the open row, or on another row\'s button, closes the settings first too', async () => {
    await start();
    openPanel('edge-199');
    gear('edge-199').focus();
    fireEvent.keyDown(gear('edge-199'), { key: 'Escape' });
    expect(panelOrNull('edge-199')).toBeNull();
    expect(popover()).toBeTruthy();

    openPanel('edge-199');
    remove('general').focus();
    fireEvent.keyDown(remove('general'), { key: 'Escape' });
    expect(panelOrNull('edge-199')).toBeNull();
    expect(document.activeElement).toBe(gear('edge-199'));

    openPanel('edge-199');
    const clearAll = within(popover()).getByRole('button', { name: 'Clear all' });
    clearAll.focus();
    fireEvent.keyDown(clearAll, { key: 'Escape' });
    expect(panelOrNull('edge-199')).toBeNull();
    expect(popover()).toBeTruthy();
  });

  it('Esc does nothing while a composition is in progress (IME)', async () => {
    await start('ko', [MOCK_IDS.generalChannel]);
    fireEvent.click(gear('general', 'ko'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', isComposing: true });
    expect(panel('general', 'ko')).toBeTruthy();
  });

  it('a press inside the settings is not an "outside" press: the popover stays open', async () => {
    await start();
    ownSettings('edge-199');
    for (const target of [useCommon('edge-199'), dateIn('edge-199', 'From'), within(panel('edge-199')).getByRole('radio', { name: 'All' }), panel('edge-199')]) {
      fireEvent.pointerDown(target);
      expect(popover()).toBeTruthy();
    }
    fireEvent.pointerDown(document.body);
    expect(popoverOrNull()).toBeNull();
  });

  it('Tab keeps wrapping inside the popover, settings open or not; ordinary Tabs inside them are left to the browser', async () => {
    await start();
    ownSettings('edge-199');
    const clearAll = within(popover()).getByRole('button', { name: 'Clear all' });
    clearAll.focus();
    fireEvent.keyDown(clearAll, { key: 'Tab' });
    expect(document.activeElement).toBe(gear('general'));
    fireEvent.keyDown(gear('general'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(clearAll);

    const inside = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    useCommon('edge-199').focus();
    useCommon('edge-199').dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
  });

  it('the settings fit the popover: it scrolls instead of growing past the window', async () => {
    await start();
    openPanel('edge-199');
    expect(popover().style.maxHeight).toBe('60vh');
    expect(popover().style.width).toBe('360px');
    expect(popover().querySelector('.topbar-sel__groups')?.contains(panel('edge-199'))).toBe(true);
  });
});

describe('settings that cannot be exported', () => {
  const alerts = (name: string): string[] => within(panel(name)).queryAllByRole('alert').map((alert) => alert.textContent ?? '');

  async function startWithBadLimit(): Promise<ReturnType<typeof vi.fn<() => Promise<undefined>>>> {
    await start();
    const startExport = vi.fn(async () => undefined);
    act(() => appStore.setState({ startExport }));
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));
    typeLimit('edge-199', '50');
    typeLimit('edge-199', '0');
    return startExport;
  }

  it('shows the error in the panel, flags the field, and marks the gear and the row', async () => {
    await startWithBadLimit();
    expect(alerts('edge-199')).toEqual(['Enter a number from 1 to 100,000.']);
    expect(limitIn('edge-199').getAttribute('aria-invalid')).toBe('true');
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);
    expect(gear('edge-199').hasAttribute('data-active')).toBe(false);
    expect(summaryOf('edge-199')).toBe('Check these settings');
    expect(row('edge-199').querySelector('.topbar-sel__scope')?.getAttribute('data-invalid')).toBe('');
    // The store still holds the last valid settings; the other rows are not marked.
    expect(override(MOCK_IDS.edge199Channel)?.limit).toBe(50);
    expect(gear('general').hasAttribute('data-invalid')).toBe(false);
    expect(summaryOf('general')).toBeNull();
  });

  it('the mark stays when the panel is closed, and the typed text is still there when it is opened again', async () => {
    await startWithBadLimit();
    fireEvent.click(gear('edge-199'));
    expect(panelOrNull('edge-199')).toBeNull();
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);
    expect(summaryOf('edge-199')).toBe('Check these settings');

    fireEvent.pointerDown(document.body);
    fireEvent.click(chip());
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);
    openPanel('edge-199');
    expect(limitIn('edge-199').value).toBe('0');
    expect(alerts('edge-199')).toEqual(['Enter a number from 1 to 100,000.']);
  });

  it('Download does not start: it opens the list at that row with the settings unfolded and the focus on the field', async () => {
    const startExport = await startWithBadLimit();
    fireEvent.pointerDown(document.body);
    expect(popoverOrNull()).toBeNull();

    fireEvent.click(main());
    expect(startExport).not.toHaveBeenCalled();
    expect(appStore.getState().exportJob.status).toBe('idle');
    expect(popover()).toBeTruthy();
    expect(panel('edge-199')).toBeTruthy();
    expect(document.activeElement).toBe(limitIn('edge-199'));
    expect(alerts('edge-199')).toEqual(['Enter a number from 1 to 100,000.']);
    expect(chip().getAttribute('aria-expanded')).toBe('true');
  });

  it('also while the list is still open, and asking again brings the focus back to the problem', async () => {
    const startExport = await startWithBadLimit();
    fireEvent.click(gear('edge-199')); // fold the settings
    fireEvent.click(main());
    expect(startExport).not.toHaveBeenCalled();
    expect(panel('edge-199')).toBeTruthy();
    expect(document.activeElement).toBe(limitIn('edge-199'));

    gear('general').focus();
    fireEvent.click(main());
    expect(document.activeElement).toBe(limitIn('edge-199'));
    expect(startExport).not.toHaveBeenCalled();
  });

  it('a bad date range of a channel is refused the same way, with the focus on the offending date', async () => {
    await start();
    const startExport = vi.fn(async () => undefined);
    act(() => appStore.setState({ startExport }));
    ownSettings('edge-199');
    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-10-03' } });
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-05' } });
    expect(alerts('edge-199')).toEqual(['The start date is later than the end date.']);
    expect(dateIn('edge-199', 'From').getAttribute('aria-invalid')).toBe('true');
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);

    fireEvent.pointerDown(document.body);
    fireEvent.click(main());
    expect(startExport).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dateIn('edge-199', 'From'));

    // A five-digit year is not a date either.
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '20261-10-06' } });
    expect(alerts('edge-199')).toEqual(['Enter a valid date.']);
  });

  it('fixing it lets Download start', async () => {
    const startExport = await startWithBadLimit();
    typeLimit('edge-199', '30');
    expect(alerts('edge-199')).toEqual([]);
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(gear('edge-199').hasAttribute('data-active')).toBe(true);
    expect(summaryOf('edge-199')).toBe('Newest 30 messages');

    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('"Use common settings" is a way out as well: the bad input goes away and nothing blocks Download any more', async () => {
    const startExport = await startWithBadLimit();
    fireEvent.click(useCommon('edge-199'));
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(summaryOf('edge-199')).toBeNull();
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);

    // And turning it off again starts clean, not from the rejected text.
    fireEvent.click(useCommon('edge-199'));
    expect(limitIn).toThrow();
    expect(within(panel('edge-199')).queryByRole('alert')).toBeNull();
  });

  it('deselecting the channel drops its bad input: nothing blocks Download, and the channel comes back clean', async () => {
    const startExport = await startWithBadLimit();
    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    fireEvent.pointerDown(document.body);
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);

    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    fireEvent.click(chip());
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(summaryOf('edge-199')).toBeNull();
  });

  it('removing it with the x does too', async () => {
    const startExport = await startWithBadLimit();
    fireEvent.click(remove('edge-199'));
    fireEvent.pointerDown(document.body);
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('with several bad channels it goes to the first one in the list, then to the next', async () => {
    await start();
    const startExport = vi.fn(async () => undefined);
    act(() => appStore.setState({ startExport }));
    for (const name of ['edge-199', 'general']) {
      ownSettings(name);
      fireEvent.click(within(panel(name)).getByRole('radio', { name: 'Limit to N' }));
      typeLimit(name, '0');
    }
    fireEvent.pointerDown(document.body);

    // "general" comes before "edge-199" in the sidebar: that is the one the list opens at.
    fireEvent.click(main());
    expect(panel('general')).toBeTruthy();
    expect(document.activeElement).toBe(limitIn('general'));

    typeLimit('general', '5');
    fireEvent.pointerDown(document.body);
    fireEvent.click(main());
    expect(startExport).not.toHaveBeenCalled();
    expect(panel('edge-199')).toBeTruthy();
    expect(document.activeElement).toBe(limitIn('edge-199'));

    typeLimit('edge-199', '5');
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('the common settings are looked at before a channel\'s own', async () => {
    const startExport = await startWithBadLimit();
    fireEvent.pointerDown(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Export options' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Export options' })).getByRole('radio', { name: 'Limit to N' }));
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Export options' })).getByRole('spinbutton'), { target: { value: '' } });
    fireEvent.pointerDown(document.body);

    fireEvent.click(main());
    expect(startExport).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Export options' })).toBeTruthy();
    expect(popoverOrNull()).toBeNull();
  });

  it('is refused in Korean, with Korean messages in the panel', async () => {
    await start('ko', [MOCK_IDS.edge199Channel]);
    fireEvent.click(gear('edge-199', 'ko'));
    fireEvent.click(within(panel('edge-199', 'ko')).getByRole('checkbox'));
    fireEvent.click(within(panel('edge-199', 'ko')).getByRole('radio', { name: '개수 지정' }));
    fireEvent.change(within(panel('edge-199', 'ko')).getByRole('spinbutton'), { target: { value: '0' } });
    expect(within(panel('edge-199', 'ko')).getByRole('alert').textContent).toBe('1에서 100,000 사이의 숫자를 입력하세요.');
    expect(summaryOf('edge-199', 'ko')).toBe('설정을 확인하세요');
  });
});

describe('accessibility', () => {
  it('the settings are a labelled group; every field has a label; helper text and errors are attached to their field', async () => {
    await start();
    ownSettings('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('radio', { name: 'Limit to N' }));

    const group = panel('edge-199');
    expect(group.getAttribute('role')).toBe('group');
    expect(within(group).getByLabelText('From')).toBeTruthy();
    expect(within(group).getByLabelText('To')).toBeTruthy();
    expect(within(group).getByRole('radiogroup', { name: 'Number of messages' })).toBeTruthy();
    expect(within(group).getByRole('group', { name: 'Quick picks' })).toBeTruthy();
    expect(useCommon('edge-199').closest('label')?.textContent).toBe('Use common settings');

    const describedBy = limitIn('edge-199').getAttribute('aria-describedby') ?? '';
    expect(describedBy).not.toBe('');
    expect(document.getElementById(describedBy)?.textContent).toBe('Starts from the latest message and goes back until 100 messages are collected.');

    typeLimit('edge-199', '');
    const error = within(group).getByRole('alert');
    expect(limitIn('edge-199').getAttribute('aria-describedby')).toBe(error.id);
    expect(error.textContent).toBe('Enter the number of messages.');

    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-10-03' } });
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-05' } });
    const dateAlert = within(group).getAllByRole('alert').find((alert) => alert.textContent?.includes('start date'));
    expect(dateIn('edge-199', 'From').getAttribute('aria-describedby')).toBe(dateAlert?.id);
  });

  it('the whole flow works from the keyboard: Tab to the gear, Enter, toggle, Esc', async () => {
    await start();
    expect(document.activeElement).toBe(gear('general'));
    // Tab order inside a row: gear, then remove.
    const order = Array.from(popover().querySelectorAll<HTMLElement>('button, input')).filter((element) => element.tabIndex >= 0);
    expect(order.slice(0, 2)).toEqual([gear('general'), remove('general')]);

    gear('general').focus();
    fireEvent.click(gear('general')); // Enter / Space on a button is a click
    expect(document.activeElement).toBe(useCommon('general'));
    fireEvent.click(useCommon('general')); // Space on the checkbox
    expect(override(MOCK_IDS.generalChannel)).toBeDefined();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(document.activeElement).toBe(gear('general'));
    expect(gear('general').hasAttribute('data-active')).toBe(true);
  });
});

describe('the export dialog mentions the channels that differ', () => {
  /** The first request of the run never answers, so the job stays "running" with its target list on screen. */
  async function runningDialog(booted: BootedTopBar): Promise<HTMLElement> {
    booted.spies.getMessages.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(main());
    const dialog = await screen.findByRole('dialog', { name: /Exporting chats…|채팅을 내보내는 중…/ });
    await vi.waitFor(() => expect(dialog.querySelectorAll('.topbar-targets__row').length).toBeGreaterThan(0));
    return dialog;
  }
  const scopes = (dialog: HTMLElement): Array<string | null> =>
    Array.from(dialog.querySelectorAll('.topbar-targets__row')).map((item) => item.querySelector('.topbar-targets__scope')?.textContent ?? null);

  it('shows the summary of a channel with its own settings under its name, and nothing for the others', async () => {
    const booted = await start('en', [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel], false);
    act(() => appStore.getState().setExportLimit(200));
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, scope()));
    expect(scopes(await runningDialog(booted))).toEqual([null, 'All messages']);
  });

  it('a channel whose own settings equal the common ones is not singled out', async () => {
    const booted = await start('en', [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel], false);
    act(() => appStore.getState().setExportLimit(200));
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 200 })));
    expect(scopes(await runningDialog(booted))).toEqual([null, null]);
  });

  it('keeps saying what the run started with when the settings are edited meanwhile', async () => {
    const booted = await start('en', [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel], false);
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 5 })));
    const dialog = await runningDialog(booted);
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, null));
    act(() => appStore.getState().setExportLimit(9));
    expect(scopes(dialog)).toEqual([null, 'Newest 5 messages']);
  });

  it('is in Korean in Korean', async () => {
    const booted = await start('ko', [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel], false);
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 5 })));
    expect(scopes(await runningDialog(booted))).toEqual([null, '최근 5개']);
  });
});
