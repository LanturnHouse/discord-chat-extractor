// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { endOfDayIso, startOfDayIso } from '@/app/components/topbar/dates';
import { tabbables } from '@/app/components/topbar/focus';
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
const resetName = (locale: 'en' | 'ko' = 'en'): string => (locale === 'en' ? 'Reset to common settings' : '공통 설정으로 되돌리기');
const resetLink = (name: string, locale: 'en' | 'ko' = 'en'): HTMLElement => within(panel(name, locale)).getByRole('button', { name: resetName(locale) });
const resetLinkOrNull = (name: string): HTMLElement | null => within(panel(name)).queryByRole('button', { name: resetName() });
const limitIn = (name: string, locale: 'en' | 'ko' = 'en'): HTMLInputElement =>
  within(panel(name, locale)).getByRole('spinbutton', { name: locale === 'en' ? 'Messages to export' : '내보낼 메시지 개수' });
const dateIn = (name: string, label: 'From' | 'To'): HTMLInputElement => within(panel(name)).getByLabelText(label);
const radio = (name: string, label: string, locale: 'en' | 'ko' = 'en'): HTMLElement => within(panel(name, locale)).getByRole('radio', { name: label });
const override = (channelId: string): ExportScope | undefined => appStore.getState().exportOverrides[channelId];
const dmName = (): string => appStore.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';

/** The common (default) settings, as the export options would set them. */
function setCommon(patch: Partial<ExportScope>): void {
  const { after, before, limit } = scope(patch);
  act(() => {
    appStore.getState().setExportAfter(after);
    appStore.getState().setExportBefore(before);
    appStore.getState().setExportLimit(limit);
  });
}

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
const typeLimit = (name: string, value: string): void => {
  fireEvent.change(limitIn(name), { target: { value } });
};
const chooseLimitMode = (name: string): void => {
  fireEvent.click(radio(name, 'Limit to N'));
};
/** The next Download request goes to a spy instead of the store's export. */
function spyOnStart(): ReturnType<typeof vi.fn<() => Promise<undefined>>> {
  const startExport = vi.fn(async () => undefined);
  act(() => appStore.setState({ startExport }));
  return startExport;
}

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

  it('opens the settings of THAT row only, moves the focus into them (onto the first field) and closes with a second click', async () => {
    await start();
    openPanel('edge-199');
    const opened = panel('edge-199');
    expect(row('edge-199').contains(opened)).toBe(true);
    expect(gear('edge-199').getAttribute('aria-expanded')).toBe('true');
    expect(gear('edge-199').getAttribute('aria-controls')).toBe(opened.id);
    expect(gear('general').getAttribute('aria-expanded')).toBe('false');
    expect(panelOrNull('general')).toBeNull();
    expect(opened.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(dateIn('edge-199', 'From'));

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

describe('what the panel shows the moment it opens', () => {
  it('is the editor itself: no checkbox, no "common settings" line, the date range first, no reset link', async () => {
    await start();
    setCommon({ limit: 200 });
    openPanel('general');
    const opened = panel('general');

    expect(within(opened).queryByRole('checkbox')).toBeNull();
    expect(opened.querySelector('input[type="checkbox"]')).toBeNull();
    expect(within(opened).queryByText(/common settings/i)).toBeNull();
    expect(resetLinkOrNull('general')).toBeNull();
    // Nothing above the date range, and nothing but the two sections.
    expect(Array.from(opened.children).map((child) => child.tagName)).toEqual(['SECTION', 'SECTION']);
    expect(within(opened).getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ['H4', 'Date range'],
      ['H4', 'Number of messages'],
    ]);
    expect(opened.firstElementChild?.querySelector('h4')?.textContent).toBe('Date range');

    expect(dateIn('general', 'From').value).toBe('');
    expect(dateIn('general', 'To').value).toBe('');
    expect(within(opened).getByText('Leave empty to export everything.')).toBeTruthy();
    expect(within(opened).getByRole('radiogroup', { name: 'Number of messages' })).toBeTruthy();
    expect(radio('general', 'All').getAttribute('aria-checked')).toBe('false');
    expect(radio('general', 'Limit to N').getAttribute('aria-checked')).toBe('true');
    expect(limitIn('general').value).toBe('200');
    expect(within(within(opened).getByRole('group', { name: 'Quick picks' })).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '100',
      '500',
      '1,000',
      '5,000',
      '10,000',
    ]);
    expect(within(opened).getByText('Starts from the latest message and goes back until 200 messages are collected.')).toBeTruthy();
    // No "applies to each channel" reminder: this editor is for one channel.
    expect(within(opened).queryByText('The number applies to each channel separately.')).toBeNull();
  });

  it('opening it changes nothing: no override, no summary, no lit gear, no dot on the chip', async () => {
    await start();
    setCommon({ limit: 200 });
    openPanel('general');
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(summaryOf('general')).toBeNull();
    expect(gear('general').hasAttribute('data-active')).toBe(false);
    expect(gear('general').hasAttribute('data-invalid')).toBe(false);
    expect(gear('general').getAttribute('aria-describedby')).toBeNull();
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('3 selected');
    // ... and neither does closing it again.
    fireEvent.click(gear('general'));
    expect(appStore.getState().exportOverrides).toEqual({});
  });

  it('shows "All" and the dates of the common settings as they are', async () => {
    await start();
    setCommon({ after: startOfDayIso('2026-09-01'), before: endOfDayIso('2026-09-30') });
    openPanel('general');
    expect(dateIn('general', 'From').value).toBe('2026-09-01');
    expect(dateIn('general', 'To').value).toBe('2026-09-30');
    expect(radio('general', 'All').getAttribute('aria-checked')).toBe('true');
    expect(within(panel('general')).queryByRole('spinbutton')).toBeNull();
    expect(resetLinkOrNull('general')).toBeNull();
  });

  it('is the same in Korean', async () => {
    await start('ko', [MOCK_IDS.generalChannel]);
    setCommon({ limit: 200 });
    fireEvent.click(gear('general', 'ko'));
    const opened = panel('general', 'ko');
    expect(within(opened).queryByRole('checkbox')).toBeNull();
    expect(within(opened).queryByText(/공통 설정/)).toBeNull();
    expect(within(opened).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['기간', '메시지 개수']);
    expect(within(opened).getByLabelText('시작일')).toBeTruthy();
    expect(within(opened).getByLabelText('종료일')).toBeTruthy();
    expect(within(opened).getByText('비워 두면 전체 기간을 내보내요.')).toBeTruthy();
    expect(radio('general', '전체', 'ko').getAttribute('aria-checked')).toBe('false');
    expect(radio('general', '개수 지정', 'ko').getAttribute('aria-checked')).toBe('true');
    expect(limitIn('general', 'ko').value).toBe('200');
    expect(within(opened).queryByRole('button', { name: '공통 설정으로 되돌리기' })).toBeNull();
    expect(Array.from(opened.children).map((child) => child.tagName)).toEqual(['SECTION', 'SECTION']);
  });
});

describe('until the first edit the channel follows the common settings, live', () => {
  it('the fields move with every later change of the common settings', async () => {
    await start();
    openPanel('general');
    expect(radio('general', 'All').getAttribute('aria-checked')).toBe('true');

    setCommon({ limit: 50 });
    expect(radio('general', 'Limit to N').getAttribute('aria-checked')).toBe('true');
    expect(limitIn('general').value).toBe('50');
    expect(within(panel('general')).getByText('Starts from the latest message and goes back until 50 messages are collected.')).toBeTruthy();

    setCommon({ after: startOfDayIso('2026-09-01'), before: endOfDayIso('2026-09-30'), limit: 7 });
    expect(dateIn('general', 'From').value).toBe('2026-09-01');
    expect(dateIn('general', 'To').value).toBe('2026-09-30');
    expect(limitIn('general').value).toBe('7');

    setCommon({});
    expect(dateIn('general', 'From').value).toBe('');
    expect(radio('general', 'All').getAttribute('aria-checked')).toBe('true');
    // Following is not an override: nothing was stored.
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(resetLinkOrNull('general')).toBeNull();
  });

  it('a row that was never edited does not say anything about itself, whatever the common settings are', async () => {
    await start();
    setCommon({ limit: 200 });
    expect(summaryOf('general')).toBeNull();
    setCommon({ limit: 5 });
    expect(summaryOf('general')).toBeNull();
    expect(gear('general').hasAttribute('data-active')).toBe(false);
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();
  });
});

describe('the first valid edit gives the channel its own scope', () => {
  const COMMON = scope({ after: startOfDayIso('2026-09-01'), before: endOfDayIso('2026-09-30'), limit: 300 });

  it('editing the count keeps the common dates: the override is the whole scope on show with the count changed', async () => {
    await start();
    setCommon(COMMON);
    openPanel('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: '1,000' }));

    expect(override(MOCK_IDS.edge199Channel)).toEqual({ ...COMMON, limit: 1000 });
    // Only that channel changed, and the common settings did not move.
    expect(Object.keys(appStore.getState().exportOverrides)).toEqual([MOCK_IDS.edge199Channel]);
    expect(appStore.getState().exportSettings).toEqual(COMMON);
    expect(dateIn('edge-199', 'From').value).toBe('2026-09-01');
    expect(dateIn('edge-199', 'To').value).toBe('2026-09-30');
    expect(limitIn('edge-199').value).toBe('1000');
  });

  it('editing the start date keeps the common end date and count', async () => {
    await start();
    setCommon(COMMON);
    openPanel('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-09-05' } });
    expect(override(MOCK_IDS.edge199Channel)).toEqual({ after: startOfDayIso('2026-09-05'), before: COMMON.before, limit: 300 });
  });

  it('editing the end date keeps the common start date and count', async () => {
    await start();
    setCommon(COMMON);
    openPanel('edge-199');
    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-09-20' } });
    expect(override(MOCK_IDS.edge199Channel)).toEqual({ after: COMMON.after, before: endOfDayIso('2026-09-20'), limit: 300 });
  });

  it('choosing "All" keeps the common dates and drops only the count', async () => {
    await start();
    setCommon(COMMON);
    openPanel('edge-199');
    fireEvent.click(radio('edge-199', 'All'));
    expect(override(MOCK_IDS.edge199Channel)).toEqual({ ...COMMON, limit: null });
  });

  it('choosing "Limit to N" from "All" starts at the usual 100', async () => {
    await start();
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 100 }));
  });

  it('a change that leaves everything as it was creates nothing', async () => {
    await start();
    setCommon({ limit: 100 });
    openPanel('edge-199');
    chooseLimitMode('edge-199'); // already chosen
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: '100' })); // the number it already has
    typeLimit('edge-199', '100');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '' } }); // still empty
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(resetLinkOrNull('edge-199')).toBeNull();
    expect(summaryOf('edge-199')).toBeNull();
    expect(gear('edge-199').hasAttribute('data-active')).toBe(false);
  });

  it('the row, the gear and the chip show it right away, and the link back appears', async () => {
    await start();
    setCommon({ limit: 200 });
    openPanel('edge-199');
    expect(resetLinkOrNull('edge-199')).toBeNull();
    typeLimit('edge-199', '25');

    expect(summaryOf('edge-199')).toBe('Newest 25 messages');
    expect(gear('edge-199').hasAttribute('data-active')).toBe(true);
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(gear('edge-199').getAttribute('aria-describedby')).toBe(row('edge-199').querySelector('.topbar-sel__scope')?.id);
    expect(gear('general').hasAttribute('data-active')).toBe(false);
    expect(summaryOf('general')).toBeNull();
    expect(resetLink('edge-199')).toBeTruthy();
    expect(Array.from(panel('edge-199').children).map((child) => child.tagName)).toEqual(['SECTION', 'SECTION', 'BUTTON']);

    expect(chip().querySelector('.topbar__chip-dot')).not.toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('3 selected, 1 with own settings');
    expect(chip().getAttribute('title')).toBe('3 selected, 1 with own settings');
    // The visible text of the chip is unchanged: the dot is decoration.
    expect(chip().textContent).toBe('3 selected');
  });

  it('says it in Korean', async () => {
    await start('ko', [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel]);
    setCommon({ limit: 200 });
    fireEvent.click(gear('edge-199', 'ko'));
    fireEvent.change(limitIn('edge-199', 'ko'), { target: { value: '30' } });
    expect(summaryOf('edge-199', 'ko')).toBe('최근 30개');
    expect(chip().getAttribute('aria-label')).toBe('2개 선택됨, 자체 설정 1개');
    expect(resetLink('edge-199', 'ko')).toBeTruthy();
  });

  it('once it exists the channel keeps its values when the common settings change', async () => {
    await start();
    setCommon({ limit: 300 });
    openPanel('edge-199');
    typeLimit('edge-199', '40');
    setCommon({ limit: 5 });
    expect(limitIn('edge-199').value).toBe('40');
    expect(override(MOCK_IDS.edge199Channel)?.limit).toBe(40);
    // ... while a channel that was never edited follows.
    openPanel('general');
    expect(limitIn('general').value).toBe('5');
  });

  it('it stays an override even when an edit brings it back to what the common settings say - only "Reset" removes it', async () => {
    await start();
    setCommon({ limit: 300 });
    openPanel('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: '1,000' }));
    typeLimit('edge-199', '300');

    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 300 }));
    expect(summaryOf('edge-199')).toBe('Newest 300 messages');
    expect(gear('edge-199').hasAttribute('data-active')).toBe(true);
    expect(chip().getAttribute('aria-label')).toBe('3 selected, 1 with own settings');
    expect(resetLink('edge-199')).toBeTruthy();
    // It no longer follows.
    setCommon({ limit: 5 });
    expect(limitIn('edge-199').value).toBe('300');
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 300 }));
  });

  it('an override that was written to equal the common settings is one too (it does not follow them either)', async () => {
    await start();
    setCommon({ limit: 300 });
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 300 })));
    openPanel('edge-199');
    expect(resetLink('edge-199')).toBeTruthy();
    setCommon({ limit: 9 });
    expect(limitIn('edge-199').value).toBe('300');
  });

  it('every kind of scope has a readable summary under the row', async () => {
    await start('en', [MOCK_IDS.edge199Channel]);
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    fireEvent.click(radio('edge-199', 'All'));
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
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 100 }));
    typeLimit('edge-199', '200');
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 200 }));
    expect(appStore.getState().exportSettings.limit).toBeNull();
    expect(summaryOf('edge-199')).toBe('Newest 200 messages');
    expect(override(MOCK_IDS.generalChannel)).toBeUndefined();
  });

  it('quick picks work inside the panel', async () => {
    await start();
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: '1,000' }));
    expect(override(MOCK_IDS.edge199Channel)?.limit).toBe(1000);
    expect(summaryOf('edge-199')).toBe('Newest 1,000 messages');
  });

  it('the dates are local days, converted like the common ones: From = start of the day, To = the very end of it', async () => {
    await start();
    openPanel('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-01' } });
    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-10-03' } });
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ after: new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(), before: new Date(2026, 9, 3, 23, 59, 59, 999).toISOString() }));
    expect(summaryOf('edge-199')).toBe('2026-10-01 – 2026-10-03');
    // The common settings did not move.
    expect(appStore.getState().exportSettings).toEqual(scope());
  });

  it('a start date and a count: the sentence and the summary say "first N"', async () => {
    await start();
    openPanel('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-01' } });
    chooseLimitMode('edge-199');
    typeLimit('edge-199', '500');
    expect(within(panel('edge-199')).getByText('Starts at the start date and takes the first 500 messages going forward.')).toBeTruthy();
    expect(summaryOf('edge-199')).toBe('From 2026-10-01: first 500');
    // No "applies to each channel" reminder: this editor is for one channel.
    expect(within(panel('edge-199')).queryByText('The number applies to each channel separately.')).toBeNull();
  });

  it('"All" inside the panel is a real choice: the channel keeps its own settings and exports everything', async () => {
    await start();
    setCommon({ limit: 200 });
    openPanel('edge-199');
    fireEvent.click(radio('edge-199', 'All'));
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope());
    expect(summaryOf('edge-199')).toBe('All messages');
    expect(gear('edge-199').hasAttribute('data-active')).toBe(true);
    expect(appStore.getState().exportSettings.limit).toBe(200);
  });

  it('the clear buttons of the date inputs work inside the panel', async () => {
    await start();
    openPanel('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-01' } });
    fireEvent.click(within(panel('edge-199')).getByRole('button', { name: 'Clear start date' }));
    // Its own settings, which now say "everything" - the channel does not go back to the common ones by itself.
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope());
    expect(document.activeElement).toBe(dateIn('edge-199', 'From'));
  });

  it('each channel keeps its own values', async () => {
    await start();
    openPanel('general');
    chooseLimitMode('general');
    typeLimit('general', '11');
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    typeLimit('edge-199', '22');
    expect(override(MOCK_IDS.generalChannel)?.limit).toBe(11);
    expect(override(MOCK_IDS.edge199Channel)?.limit).toBe(22);
    expect(chip().getAttribute('aria-label')).toBe('3 selected, 2 with own settings');
  });
});

describe('back to the common settings', () => {
  it('the link is there only while the channel has its own settings', async () => {
    await start();
    openPanel('edge-199');
    expect(resetLinkOrNull('edge-199')).toBeNull();
    chooseLimitMode('edge-199');
    expect(resetLinkOrNull('edge-199')).not.toBeNull();
    fireEvent.click(resetLink('edge-199'));
    expect(resetLinkOrNull('edge-199')).toBeNull();
    // It follows the settings of its own row, not those of another.
    openPanel('general');
    expect(resetLinkOrNull('general')).toBeNull();
  });

  it('"Reset to common settings" removes the override: the editor shows the common values again and the focus goes to the first field', async () => {
    await start();
    setCommon({ after: startOfDayIso('2026-09-01'), limit: 200 });
    openPanel('edge-199');
    fireEvent.click(radio('edge-199', 'All'));
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-10' } });
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ after: startOfDayIso('2026-10-10') }));

    fireEvent.click(resetLink('edge-199'));
    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(dateIn('edge-199', 'From').value).toBe('2026-09-01');
    expect(radio('edge-199', 'Limit to N').getAttribute('aria-checked')).toBe('true');
    expect(limitIn('edge-199').value).toBe('200');
    expect(resetLinkOrNull('edge-199')).toBeNull();
    expect(Array.from(panel('edge-199').children).map((child) => child.tagName)).toEqual(['SECTION', 'SECTION']);
    expect(document.activeElement).toBe(dateIn('edge-199', 'From'));

    expect(summaryOf('edge-199')).toBeNull();
    expect(gear('edge-199').hasAttribute('data-active')).toBe(false);
    expect(gear('edge-199').getAttribute('aria-describedby')).toBeNull();
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('3 selected');
    // The panel stays open, the common settings did not move.
    expect(panel('edge-199')).toBeTruthy();
    expect(appStore.getState().exportSettings).toEqual(scope({ after: startOfDayIso('2026-09-01'), limit: 200 }));
  });

  it('afterwards the channel follows the common settings again', async () => {
    await start();
    setCommon({ limit: 200 });
    openPanel('edge-199');
    typeLimit('edge-199', '9');
    fireEvent.click(resetLink('edge-199'));
    setCommon({ limit: 77 });
    expect(limitIn('edge-199').value).toBe('77');
  });

  it('the next edit starts from the common values of that moment, not from the old override', async () => {
    await start();
    setCommon({ after: startOfDayIso('2026-09-01'), limit: 200 });
    openPanel('edge-199');
    typeLimit('edge-199', '9');
    fireEvent.click(resetLink('edge-199'));
    setCommon({ after: startOfDayIso('2026-08-01'), limit: 77 });
    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-08-20' } });
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ after: startOfDayIso('2026-08-01'), before: endOfDayIso('2026-08-20'), limit: 77 }));
  });

  it('is in Korean in Korean', async () => {
    await start('ko', [MOCK_IDS.generalChannel, MOCK_IDS.edge199Channel]);
    setCommon({ limit: 200 });
    fireEvent.click(gear('edge-199', 'ko'));
    fireEvent.change(limitIn('edge-199', 'ko'), { target: { value: '5' } });
    fireEvent.click(resetLink('edge-199', 'ko'));
    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    expect(limitIn('edge-199', 'ko').value).toBe('200');
    expect(within(panel('edge-199', 'ko')).queryByRole('button', { name: '공통 설정으로 되돌리기' })).toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('2개 선택됨');
  });

  it('the settings of a channel that is deselected vanish with it, and a re-selected channel starts on the common ones', async () => {
    await start();
    setCommon({ limit: 40 });
    openPanel('edge-199');
    typeLimit('edge-199', '9');
    expect(override(MOCK_IDS.edge199Channel)).toBeDefined();
    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    expect(within(popover()).queryByRole('button', { name: gearName('edge-199') })).toBeNull();
    expect(panelOrNull('edge-199')).toBeNull();
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();

    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    openPanel('edge-199');
    expect(limitIn('edge-199').value).toBe('40');
    expect(resetLinkOrNull('edge-199')).toBeNull();
  });

  it('removing a row with the x while its settings are open removes the settings and keeps the keyboard going', async () => {
    await start();
    openPanel('edge-199');
    chooseLimitMode('edge-199'); // the row has settings of its own now
    typeLimit('edge-199', '5');
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
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    limitIn('edge-199').focus();
    fireEvent.keyDown(limitIn('edge-199'), { key: 'Escape' });
    expect(panelOrNull('edge-199')).toBeNull();
    expect(document.activeElement).toBe(gear('edge-199'));
    expect(popover()).toBeTruthy();
    // Closing the panel keeps what was edited.
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 100 }));
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

  it('Esc after "Reset" closes the panel and returns the focus to the gear all the same', async () => {
    await start();
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    typeLimit('edge-199', '5');
    fireEvent.click(resetLink('edge-199'));
    expect(document.activeElement).toBe(dateIn('edge-199', 'From'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(panelOrNull('edge-199')).toBeNull();
    expect(document.activeElement).toBe(gear('edge-199'));
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
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    for (const target of [dateIn('edge-199', 'From'), radio('edge-199', 'All'), panel('edge-199'), resetLink('edge-199')]) {
      fireEvent.pointerDown(target);
      expect(popover()).toBeTruthy();
    }
    fireEvent.pointerDown(document.body);
    expect(popoverOrNull()).toBeNull();
  });

  it('pressing "Reset" does not close the popover or the panel either', async () => {
    await start();
    openPanel('edge-199');
    chooseLimitMode('edge-199');
    typeLimit('edge-199', '5');
    fireEvent.pointerDown(resetLink('edge-199'));
    fireEvent.click(resetLink('edge-199'));
    expect(popover()).toBeTruthy();
    expect(panel('edge-199')).toBeTruthy();
    expect(chip().getAttribute('aria-expanded')).toBe('true');
  });

  it('Tab keeps wrapping inside the popover, settings open or not; ordinary Tabs inside them are left to the browser', async () => {
    await start();
    openPanel('edge-199');
    const clearAll = within(popover()).getByRole('button', { name: 'Clear all' });
    clearAll.focus();
    fireEvent.keyDown(clearAll, { key: 'Tab' });
    expect(document.activeElement).toBe(gear('general'));
    fireEvent.keyDown(gear('general'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(clearAll);

    const inside = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dateIn('edge-199', 'From').focus();
    dateIn('edge-199', 'From').dispatchEvent(inside);
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

  /** edge-199 gets its own scope ("Limit to N", 50) and then a count that cannot be exported. */
  async function startWithBadLimit(): Promise<ReturnType<typeof vi.fn<() => Promise<undefined>>>> {
    await start();
    const startExport = spyOnStart();
    openPanel('edge-199');
    chooseLimitMode('edge-199');
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
    const startExport = spyOnStart();
    openPanel('edge-199');
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

  it('"Reset to common settings" is a way out as well: the bad input goes away and nothing blocks Download any more', async () => {
    const startExport = await startWithBadLimit();
    fireEvent.click(resetLink('edge-199'));
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(summaryOf('edge-199')).toBeNull();
    expect(within(panel('edge-199')).queryByRole('alert')).toBeNull();
    expect(override(MOCK_IDS.edge199Channel)).toBeUndefined();
    // The field was put back on the common settings (no count), not on the rejected text.
    expect(radio('edge-199', 'All').getAttribute('aria-checked')).toBe('true');
    expect(within(panel('edge-199')).queryByRole('spinbutton')).toBeNull();
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
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
    const startExport = spyOnStart();
    for (const name of ['edge-199', 'general']) {
      openPanel(name);
      chooseLimitMode(name);
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
    fireEvent.click(radio('edge-199', '개수 지정', 'ko'));
    fireEvent.change(limitIn('edge-199', 'ko'), { target: { value: '0' } });
    expect(within(panel('edge-199', 'ko')).getByRole('alert').textContent).toBe('1에서 100,000 사이의 숫자를 입력하세요.');
    expect(summaryOf('edge-199', 'ko')).toBe('설정을 확인하세요');
  });
});

describe('input that cannot be exported while the channel still follows the common settings', () => {
  const alerts = (name: string): string[] => within(panel(name)).queryAllByRole('alert').map((alert) => alert.textContent ?? '');

  /** The common count is 200; edge-199 follows it, and its count field is emptied: a draft, no override. */
  async function startWithDraftOnly(): Promise<ReturnType<typeof vi.fn<() => Promise<undefined>>>> {
    await start();
    const startExport = spyOnStart();
    setCommon({ limit: 200 });
    openPanel('edge-199');
    typeLimit('edge-199', '0');
    return startExport;
  }

  it('is flagged as it is today, but not stored: no override, the error in the panel, the gear and the row marked', async () => {
    await startWithDraftOnly();
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(alerts('edge-199')).toEqual(['Enter a number from 1 to 100,000.']);
    expect(limitIn('edge-199').getAttribute('aria-invalid')).toBe('true');
    expect(limitIn('edge-199').value).toBe('0');
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);
    expect(gear('edge-199').hasAttribute('data-active')).toBe(false);
    expect(summaryOf('edge-199')).toBe('Check these settings');
    expect(chip().querySelector('.topbar__chip-dot')).toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('3 selected');
    expect(summaryOf('general')).toBeNull();
  });

  it('the mark stays when the panel is closed, and the typed text is still there when it is opened again', async () => {
    await startWithDraftOnly();
    fireEvent.click(gear('edge-199'));
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);
    expect(summaryOf('edge-199')).toBe('Check these settings');
    openPanel('edge-199');
    expect(limitIn('edge-199').value).toBe('0');
  });

  it('Download does not start: it opens the list at that row with the focus on the field', async () => {
    const startExport = await startWithDraftOnly();
    fireEvent.pointerDown(document.body);
    expect(popoverOrNull()).toBeNull();
    fireEvent.click(main());
    expect(startExport).not.toHaveBeenCalled();
    expect(panel('edge-199')).toBeTruthy();
    expect(document.activeElement).toBe(limitIn('edge-199'));
  });

  it('typing a valid number gives the channel its own scope (the common values with the new count) and clears the mark', async () => {
    const startExport = await startWithDraftOnly();
    typeLimit('edge-199', '30');
    expect(alerts('edge-199')).toEqual([]);
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ limit: 30 }));
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(gear('edge-199').hasAttribute('data-active')).toBe(true);
    expect(summaryOf('edge-199')).toBe('Newest 30 messages');
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('typing the common number again just clears the draft: the channel goes on following the common settings', async () => {
    const startExport = await startWithDraftOnly();
    typeLimit('edge-199', '200');
    expect(alerts('edge-199')).toEqual([]);
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(gear('edge-199').hasAttribute('data-active')).toBe(false);
    expect(summaryOf('edge-199')).toBeNull();
    expect(resetLinkOrNull('edge-199')).toBeNull();
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('"Reset to common settings" is offered for the pending input too, and throws it away without creating anything', async () => {
    const startExport = await startWithDraftOnly();
    fireEvent.click(resetLink('edge-199'));
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(alerts('edge-199')).toEqual([]);
    expect(limitIn('edge-199').value).toBe('200');
    expect(resetLinkOrNull('edge-199')).toBeNull();
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    expect(summaryOf('edge-199')).toBeNull();
    expect(document.activeElement).toBe(dateIn('edge-199', 'From'));
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('a start after the end is such an input as well, and giving the common date back clears it', async () => {
    await start();
    setCommon({ after: startOfDayIso('2026-10-01'), before: endOfDayIso('2026-10-10') });
    openPanel('edge-199');
    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-11-01' } });
    expect(alerts('edge-199')).toEqual(['The start date is later than the end date.']);
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);

    fireEvent.change(dateIn('edge-199', 'From'), { target: { value: '2026-10-01' } });
    expect(alerts('edge-199')).toEqual([]);
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);

    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-09-01' } });
    expect(alerts('edge-199')).toEqual(['The start date is later than the end date.']);
    fireEvent.change(dateIn('edge-199', 'To'), { target: { value: '2026-10-20' } });
    expect(override(MOCK_IDS.edge199Channel)).toEqual(scope({ after: startOfDayIso('2026-10-01'), before: endOfDayIso('2026-10-20') }));
  });

  it('an unfinished date is reset to a fresh field, not left half typed', async () => {
    await start();
    openPanel('edge-199');
    const field = dateIn('edge-199', 'To');
    // The user typed part of a date: the value is '' while the control still shows it. Leaving the field is when it is noticed.
    Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.blur(field);
    expect(alerts('edge-199')).toEqual(['Enter a valid date.']);
    expect(appStore.getState().exportOverrides).toEqual({});
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(true);

    fireEvent.click(resetLink('edge-199'));
    expect(alerts('edge-199')).toEqual([]);
    expect(dateIn('edge-199', 'To')).not.toBe(field);
    expect(dateIn('edge-199', 'To').value).toBe('');
    expect(dateIn('edge-199', 'To').getAttribute('aria-invalid')).toBeNull();
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
  });

  it('deselecting the channel drops the draft: nothing blocks Download, and the channel comes back clean', async () => {
    const startExport = await startWithDraftOnly();
    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    fireEvent.pointerDown(document.body);
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);

    act(() => appStore.getState().toggleChannel(MOCK_IDS.edge199Channel));
    fireEvent.click(chip());
    expect(gear('edge-199').hasAttribute('data-invalid')).toBe(false);
    openPanel('edge-199');
    expect(limitIn('edge-199').value).toBe('200');
    expect(alerts('edge-199')).toEqual([]);
  });

  it('removing it with the x does too', async () => {
    const startExport = await startWithDraftOnly();
    fireEvent.click(remove('edge-199'));
    fireEvent.pointerDown(document.body);
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('one channel\'s draft never shows up in another', async () => {
    await startWithDraftOnly();
    openPanel('general');
    expect(limitIn('general').value).toBe('200');
    expect(within(panel('general')).queryAllByRole('alert')).toHaveLength(0);
    expect(gear('general').hasAttribute('data-invalid')).toBe(false);
  });
});

describe('accessibility', () => {
  it('the settings are a labelled group; every field has a label; helper text and errors are attached to their field', async () => {
    await start();
    openPanel('edge-199');
    chooseLimitMode('edge-199');

    const group = panel('edge-199');
    expect(group.getAttribute('role')).toBe('group');
    expect(within(group).getByLabelText('From')).toBeTruthy();
    expect(within(group).getByLabelText('To')).toBeTruthy();
    expect(within(group).getByRole('radiogroup', { name: 'Number of messages' })).toBeTruthy();
    expect(within(group).getByRole('group', { name: 'Quick picks' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Reset to common settings' }).tagName).toBe('BUTTON');

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

  it('the tab order inside the panel is the date fields, the count and - once it exists - the link back last', async () => {
    await start();
    setCommon({ limit: 200 });
    openPanel('edge-199');
    const names = (): string[] =>
      tabbables(panel('edge-199')).map((element) => element.getAttribute('aria-label') ?? element.textContent ?? element.id);
    expect(tabbables(panel('edge-199'))[0]).toBe(dateIn('edge-199', 'From'));
    // The date inputs, the checked radio (a roving tab stop), the count and the quick picks; nothing about common settings.
    expect(names().some((name) => /common/i.test(name))).toBe(false);
    expect(tabbables(panel('edge-199')).slice(0, 4)).toEqual([dateIn('edge-199', 'From'), dateIn('edge-199', 'To'), radio('edge-199', 'Limit to N'), limitIn('edge-199')]);

    typeLimit('edge-199', '25');
    const after = tabbables(panel('edge-199'));
    expect(after[after.length - 1]).toBe(resetLink('edge-199'));
  });

  it('the whole flow works from the keyboard: Tab to the gear, Enter, edit, Tab to the link, Enter, Esc', async () => {
    await start();
    setCommon({ limit: 200 });
    expect(document.activeElement).toBe(gear('general'));
    // Tab order inside a row: gear, then remove.
    const order = Array.from(popover().querySelectorAll<HTMLElement>('button, input')).filter((element) => element.tabIndex >= 0);
    expect(order.slice(0, 2)).toEqual([gear('general'), remove('general')]);

    gear('general').focus();
    fireEvent.click(gear('general')); // Enter / Space on a button is a click
    expect(document.activeElement).toBe(dateIn('general', 'From')); // straight into the first field, no stop on a checkbox
    expect(resetLinkOrNull('general')).toBeNull();

    fireEvent.change(dateIn('general', 'From'), { target: { value: '2026-10-01' } }); // typing the date
    expect(override(MOCK_IDS.generalChannel)).toEqual(scope({ after: startOfDayIso('2026-10-01'), limit: 200 }));
    const stops = tabbables(panel('general'));
    expect(stops[stops.length - 1]).toBe(resetLink('general'));

    resetLink('general').focus();
    fireEvent.click(resetLink('general')); // Enter / Space on the link
    expect(override(MOCK_IDS.generalChannel)).toBeUndefined();
    expect(document.activeElement).toBe(dateIn('general', 'From'));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(document.activeElement).toBe(gear('general'));
    expect(gear('general').hasAttribute('data-active')).toBe(false);
  });

  it('editing from the keyboard and leaving with Esc keeps the settings and lights the gear', async () => {
    await start();
    openPanel('general');
    fireEvent.click(radio('general', 'Limit to N')); // arrow keys / Space on the radio
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(document.activeElement).toBe(gear('general'));
    expect(gear('general').hasAttribute('data-active')).toBe(true);
    expect(summaryOf('general')).toBe('Newest 100 messages');
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
