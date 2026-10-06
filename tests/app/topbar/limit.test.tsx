// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { isoToDateInput, startOfDayIso } from '@/app/components/topbar/dates';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { ExportFormat, ExportFormatId, ExportOptions } from '@/lib/export/types';
import { fullHistory } from '../helpers';
import { bootTopBar, idLinesFormat, select } from './helpers';

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

const main = (): HTMLElement => screen.getByRole('button', { name: /^Download|^다운로드/ });
const caret = (): HTMLElement => screen.getByRole('button', { name: /Export options|내보내기 옵션/ });
const optionsPanel = (): HTMLElement => screen.getByRole('dialog', { name: /Export options|내보내기 옵션/ });
const countGroup = (): HTMLElement => within(optionsPanel()).getByRole('radiogroup', { name: /Number of messages|메시지 개수/ });
const modeRadio = (name: RegExp): HTMLElement => within(countGroup()).getByRole('radio', { name });
const limitInput = (): HTMLInputElement => within(optionsPanel()).getByRole('spinbutton', { name: /Messages to export|내보낼 메시지 개수/ });
const dateInput = (label: 'From' | 'To' | '시작일' | '종료일'): HTMLInputElement => within(optionsPanel()).getByLabelText(label);
const chips = (): HTMLElement[] => within(within(optionsPanel()).getByRole('group', { name: /Quick picks|빠른 선택/ })).getAllByRole('button');
const settings = (): ReturnType<typeof appStore.getState>['exportSettings'] => appStore.getState().exportSettings;

async function start(locale: 'en' | 'ko' = 'en', selected: string[] = [MOCK_IDS.edge199Channel]): Promise<void> {
  await bootTopBar(locale);
  select(...selected);
  render(<TopBar />);
  fireEvent.click(caret());
}

const typeLimit = (value: string): void => {
  fireEvent.change(limitInput(), { target: { value } });
};
const chooseLimitMode = (): void => {
  fireEvent.click(modeRadio(/^Limit to N|^개수 지정/));
};

describe('the number-of-messages section', () => {
  it('sits under the date range, as a heading plus an All / Limit to N choice that starts on All', async () => {
    await start();
    const headings = within(optionsPanel())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings.indexOf('Number of messages')).toBe(headings.indexOf('Date range') + 1);

    const radios = within(countGroup()).getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual(['All', 'Limit to N']);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(radios.map((radio) => radio.getAttribute('tabindex'))).toEqual(['0', '-1']);
    expect(within(optionsPanel()).queryByRole('spinbutton')).toBeNull();
    expect(settings().limit).toBeNull();
  });

  it('is in Korean too', async () => {
    await start('ko');
    expect(within(optionsPanel()).getByRole('heading', { name: '메시지 개수' })).toBeTruthy();
    expect(within(countGroup()).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['전체', '개수 지정']);
    chooseLimitMode();
    expect(limitInput().getAttribute('aria-label')).toBe('내보낼 메시지 개수');
    expect(within(optionsPanel()).getByRole('group', { name: '빠른 선택' })).toBeTruthy();
    expect(within(optionsPanel()).getByText('개')).toBeTruthy();
  });

  it('"Limit to N" starts at 100 and stores it; the number input is a real integer input', async () => {
    await start();
    chooseLimitMode();
    expect(settings().limit).toBe(100);
    const input = limitInput();
    expect(input.value).toBe('100');
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.max).toBe('100000');
    expect(input.step).toBe('1');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(modeRadio(/^Limit to N/).getAttribute('aria-checked')).toBe('true');
    expect(modeRadio(/^All/).getAttribute('aria-checked')).toBe('false');
  });

  it('typing a number stores it; the input never shows thousands separators', async () => {
    await start();
    chooseLimitMode();
    typeLimit('200');
    expect(settings().limit).toBe(200);
    typeLimit('5000');
    expect(settings().limit).toBe(5000);
    expect(limitInput().value).toBe('5000');
    typeLimit('100000');
    expect(settings().limit).toBe(100000);
    expect(limitInput().value).toBe('100000');
    // ... while the sentences around it do group the digits.
    expect(within(optionsPanel()).getByText(/100,000 messages are collected/)).toBeTruthy();
  });

  it('quick picks: 100 / 500 / 1,000 / 5,000 / 10,000 fill the number and mark the one that matches', async () => {
    await start();
    chooseLimitMode();
    expect(chips().map((chip) => chip.textContent)).toEqual(['100', '500', '1,000', '5,000', '10,000']);
    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);

    fireEvent.click(chips()[2]);
    expect(settings().limit).toBe(1000);
    expect(limitInput().value).toBe('1000');
    expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false']);

    fireEvent.click(chips()[4]);
    expect(settings().limit).toBe(10000);
    typeLimit('777');
    expect(chips().every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('"All" removes the count again, and "Limit to N" remembers the last number', async () => {
    await start();
    chooseLimitMode();
    typeLimit('321');
    fireEvent.click(modeRadio(/^All/));
    expect(settings().limit).toBeNull();
    expect(within(optionsPanel()).queryByRole('spinbutton')).toBeNull();

    chooseLimitMode();
    expect(settings().limit).toBe(321);
    expect(limitInput().value).toBe('321');
  });

  it('choosing what is already chosen leaves the number alone, also a half-typed one', async () => {
    await start();
    chooseLimitMode();
    typeLimit('777');
    chooseLimitMode();
    expect(limitInput().value).toBe('777');
    expect(settings().limit).toBe(777);

    typeLimit('');
    chooseLimitMode();
    expect(limitInput().value).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('Enter the number of messages.');
    fireEvent.click(modeRadio(/^All/));
    fireEvent.click(modeRadio(/^All/));
    expect(settings().limit).toBeNull();
  });

  it('the choice works with the arrow keys like the other radio groups', async () => {
    await start();
    fireEvent.keyDown(modeRadio(/^All/), { key: 'ArrowRight' });
    expect(modeRadio(/^Limit to N/).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(modeRadio(/^Limit to N/));
    expect(settings().limit).toBe(100);
    fireEvent.keyDown(modeRadio(/^Limit to N/), { key: 'ArrowLeft' });
    expect(settings().limit).toBeNull();
  });

  it('shows the stored count when the popover is opened again', async () => {
    await start();
    chooseLimitMode();
    typeLimit('42');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(caret());
    expect(modeRadio(/^Limit to N/).getAttribute('aria-checked')).toBe('true');
    expect(limitInput().value).toBe('42');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the sentence under the number says what will happen, for every date situation', () => {
  const type = (label: 'From' | 'To' | '시작일' | '종료일', value: string): void => {
    fireEvent.change(dateInput(label), { target: { value } });
  };
  const helper = (): string => {
    const id = limitInput().getAttribute('aria-describedby')?.split(' ')[0] ?? '';
    return document.getElementById(id)?.textContent ?? '';
  };

  it('English: no dates, only a start, start + end, only an end - and it follows the dates live', async () => {
    await start();
    chooseLimitMode();
    typeLimit('200');
    expect(helper()).toBe('Starts from the latest message and goes back until 200 messages are collected.');

    type('From', '2026-10-01');
    expect(helper()).toBe('Starts at the start date and takes the first 200 messages going forward.');

    type('To', '2026-10-03');
    expect(helper()).toBe('Starts at the start date and takes the first 200 messages going forward, never beyond the end date.');

    fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear start date' }));
    expect(helper()).toBe('The 200 newest messages up to the end date.');

    fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear end date' }));
    expect(helper()).toBe('Starts from the latest message and goes back until 200 messages are collected.');
  });

  it('Korean', async () => {
    await start('ko');
    chooseLimitMode();
    typeLimit('200');
    expect(helper()).toBe('가장 최근 메시지부터 거슬러 올라가 200개를 내보내요.');
    type('시작일', '2026-10-01');
    expect(helper()).toBe('시작일부터 200개를 내보내요.');
    type('종료일', '2026-10-03');
    expect(helper()).toBe('시작일부터 200개를 내보내요. 종료일을 넘지는 않아요.');
    fireEvent.click(within(optionsPanel()).getByRole('button', { name: '시작일 지우기' }));
    expect(helper()).toBe('종료일까지의 최근 200개를 내보내요.');
  });

  it('follows the number as well, and a rejected date pair still picks the sentence of the dates that are shown', async () => {
    await start();
    chooseLimitMode();
    typeLimit('1500');
    expect(helper()).toContain('1,500 messages');
    type('To', '2026-10-03');
    type('From', '2026-10-05');
    expect(screen.getByRole('alert').textContent).toBe('The start date is later than the end date.');
    expect(helper()).toContain('never beyond the end date');
  });

  it('says that the number applies to each channel separately - only while a number is chosen', async () => {
    await start();
    expect(within(optionsPanel()).queryByText('The number applies to each channel separately.')).toBeNull();
    chooseLimitMode();
    expect(within(optionsPanel()).getByText('The number applies to each channel separately.')).toBeTruthy();
    expect(limitInput().getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
  });

  it('says it in Korean', async () => {
    await start('ko');
    chooseLimitMode();
    expect(within(optionsPanel()).getByText('개수는 채널마다 따로 적용돼요.')).toBeTruthy();
  });

  it('points at the gear in the selection list for per-channel settings', async () => {
    await start();
    expect(within(optionsPanel()).getByText('To change this for one channel, open the "N selected" list and press the gear next to it.')).toBeTruthy();
    cleanup();
    await start('ko');
    expect(within(optionsPanel()).getByText('채널마다 다르게 하려면 "N개 선택됨" 목록에서 채널 옆의 톱니 버튼을 누르세요.')).toBeTruthy();
  });

  it('says how many channels ignore these settings because they have their own', async () => {
    await start('en', [MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    expect(within(optionsPanel()).queryByText(/own settings/)).toBeNull();
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge199Channel, { after: null, before: null, limit: 5 }));
    expect(within(optionsPanel()).getByText('1 channel uses its own settings, so the date range and number above do not apply to it.')).toBeTruthy();
    act(() => appStore.getState().setChannelScope(MOCK_IDS.edge200Channel, { after: null, before: null, limit: 6 }));
    expect(within(optionsPanel()).getByText('2 channels use their own settings, so the date range and number above do not apply to them.')).toBeTruthy();
  });
});

describe('a number that cannot be exported', () => {
  const alertText = (): string => screen.getByRole('alert').textContent ?? '';

  it('an empty input is an error: it names what to do, flags the input and does not touch the stored count', async () => {
    await start();
    chooseLimitMode();
    typeLimit('200');
    typeLimit('');
    expect(alertText()).toBe('Enter the number of messages.');
    expect(limitInput().getAttribute('aria-invalid')).toBe('true');
    // The input is described by the error (instead of the sentence it shows while the number is fine) and by the per-channel note.
    expect(limitInput().getAttribute('aria-describedby')?.split(' ')[0]).toBe(screen.getByRole('alert').id);
    // The last valid count stays stored; the inputs and Download are what stop the export.
    expect(settings().limit).toBe(200);
    expect(limitInput().value).toBe('');
  });

  it.each([
    ['0', 'Enter a number from 1 to 100,000.'],
    ['-5', 'Enter a number from 1 to 100,000.'],
    ['100001', 'Enter a number from 1 to 100,000.'],
    ['1.5', 'Use a whole number, without decimals.'],
    ['1e3', 'Use a whole number, without decimals.'],
  ])('"%s" is an error: %s', async (value, message) => {
    await start();
    chooseLimitMode();
    typeLimit('200');
    typeLimit(value);
    expect(alertText()).toBe(message);
    expect(limitInput().value).toBe(value);
    expect(settings().limit).toBe(200);
  });

  it('text the control cannot read (it reports bad input) is an error as well', async () => {
    await start();
    chooseLimitMode();
    Object.defineProperty(limitInput(), 'validity', { configurable: true, value: { badInput: true } });
    typeLimit('');
    expect(alertText()).toBe('Use a whole number, without decimals.');
    expect(limitInput().getAttribute('aria-invalid')).toBe('true');
  });

  describe('unreadable text that is deleted again (QA-EXP-05)', () => {
    /** What the control reports: while it holds text it cannot read ("1e") its value is '' and `validity.badInput` is true. */
    function holding(input: HTMLInputElement): { text(readable: boolean): void } {
      let bad = false;
      Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: bad }) });
      return {
        text(readable) {
          bad = !readable;
        },
      };
    }

    it('an emptied field asks for the number, not for a whole number', async () => {
      await start();
      chooseLimitMode();
      typeLimit('200');
      const control = holding(limitInput());

      // "1e" was typed over the 200: the value became '' (a change), the control says it holds text it cannot read.
      control.text(false);
      typeLimit('');
      expect(alertText()).toBe('Use a whole number, without decimals.');

      // Select all + Backspace: the value is still '' (so there is no change event), only the input event comes.
      control.text(true);
      fireEvent.input(limitInput());
      expect(alertText()).toBe('Enter the number of messages.');
      expect(limitInput().getAttribute('aria-invalid')).toBe('true');
      expect(settings().limit).toBe(200);
    });

    it('a lone "e" typed into an empty field is unreadable, and deleting it makes the field empty again', async () => {
      await start('ko');
      chooseLimitMode();
      typeLimit('');
      expect(alertText()).toBe('메시지 개수를 입력하세요.');
      const control = holding(limitInput());

      control.text(false);
      fireEvent.input(limitInput());
      expect(alertText()).toBe('소수점 없이 정수로 입력하세요.');

      control.text(true);
      fireEvent.input(limitInput());
      expect(alertText()).toBe('메시지 개수를 입력하세요.');
    });

    it('an input event that changes nothing is ignored', async () => {
      await start();
      chooseLimitMode();
      typeLimit('0');
      holding(limitInput());
      fireEvent.input(limitInput());
      expect(alertText()).toBe('Enter a number from 1 to 100,000.');
      expect(limitInput().value).toBe('0');
    });
  });

  it('the mouse wheel over the focused field leaves the number alone: the field is left, so Chrome does not step it (QA-EXP-04)', async () => {
    await start();
    chooseLimitMode();
    typeLimit('100');
    limitInput().focus();
    expect(document.activeElement).toBe(limitInput());

    fireEvent.wheel(limitInput(), { deltaY: -100 });
    expect(document.activeElement).not.toBe(limitInput());
    expect(limitInput().value).toBe('100');
    expect(settings().limit).toBe(100);
  });

  describe('the message under an invalid number (QA-LAYOUT-09)', () => {
    const scrollIntoView = vi.fn();
    beforeEach(() => {
      scrollIntoView.mockReset();
      // jsdom has no layout and no such method.
      Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView });
    });
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('scrolls itself into view when it appears: the popover scrolls and the message can be below its fold', async () => {
      await start();
      chooseLimitMode();
      scrollIntoView.mockClear();
      typeLimit('200000');
      const alert = screen.getByRole('alert');
      expect(scrollIntoView.mock.contexts).toEqual([alert]);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('does it again when a refused Download reopens the options on it', async () => {
      await start();
      chooseLimitMode();
      typeLimit('200000');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      scrollIntoView.mockClear();

      fireEvent.click(main());
      expect(scrollIntoView.mock.contexts).toEqual([screen.getByRole('alert')]);
    });

    it('is not asked to scroll while there is nothing to say, and says it again for a new message', async () => {
      await start();
      chooseLimitMode();
      scrollIntoView.mockClear();
      typeLimit('300');
      expect(scrollIntoView).not.toHaveBeenCalled();

      typeLimit('0');
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      typeLimit('2.5');
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      typeLimit('3');
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it('the date range message does it too', async () => {
      await start();
      scrollIntoView.mockClear();
      fireEvent.change(dateInput('To'), { target: { value: '2026-10-03' } });
      fireEvent.change(dateInput('From'), { target: { value: '2026-10-05' } });
      expect(scrollIntoView.mock.contexts).toEqual([screen.getByRole('alert')]);
    });
  });

  it('the messages are in Korean too', async () => {
    await start('ko');
    chooseLimitMode();
    typeLimit('');
    expect(alertText()).toBe('메시지 개수를 입력하세요.');
    typeLimit('0');
    expect(alertText()).toBe('1에서 100,000 사이의 숫자를 입력하세요.');
    typeLimit('2.5');
    expect(alertText()).toBe('소수점 없이 정수로 입력하세요.');
  });

  it('typing a good number removes the error and stores it', async () => {
    await start();
    chooseLimitMode();
    typeLimit('0');
    expect(screen.getByRole('alert')).toBeTruthy();
    typeLimit('12');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(limitInput().getAttribute('aria-invalid')).toBeNull();
    expect(settings().limit).toBe(12);
  });

  it('a quick pick fixes it, and so does "All"', async () => {
    await start();
    chooseLimitMode();
    typeLimit('');
    fireEvent.click(chips()[1]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(settings().limit).toBe(500);

    typeLimit('0');
    fireEvent.click(modeRadio(/^All/));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(settings().limit).toBeNull();
  });

  it('while it is wrong nothing else of the settings is stored either: everything is written together once it is fine', async () => {
    await start();
    chooseLimitMode();
    typeLimit('');
    fireEvent.change(dateInput('From'), { target: { value: '2026-10-01' } });
    expect(settings()).toEqual({ after: null, before: null, limit: 100 });
    expect(dateInput('From').value).toBe('2026-10-01');

    typeLimit('30');
    expect(settings()).toEqual({ after: startOfDayIso('2026-10-01'), before: null, limit: 30 });
  });

  it('the date error and the count error are both shown when both are wrong', async () => {
    await start();
    chooseLimitMode();
    fireEvent.change(dateInput('To'), { target: { value: '2026-10-03' } });
    fireEvent.change(dateInput('From'), { target: { value: '2026-10-05' } });
    typeLimit('0');
    const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent);
    expect(alerts).toEqual(['The start date is later than the end date.', 'Enter a number from 1 to 100,000.']);
  });

  describe('what Download does', () => {
    const armed = async (locale: 'en' | 'ko' = 'en'): Promise<ReturnType<typeof vi.fn<() => Promise<undefined>>>> => {
      await start(locale);
      const startExport = vi.fn(async () => undefined);
      act(() => appStore.setState({ startExport }));
      return startExport;
    };

    it('does not start: it opens the options with the problem and puts the focus on the number', async () => {
      const startExport = await armed();
      chooseLimitMode();
      typeLimit('0');
      fireEvent.click(main());

      expect(startExport).not.toHaveBeenCalled();
      expect(appStore.getState().exportJob.status).toBe('idle');
      expect(optionsPanel()).toBeTruthy();
      expect(alertText()).toBe('Enter a number from 1 to 100,000.');
      expect(document.activeElement).toBe(limitInput());
    });

    it('also after the popover was closed: the typed number is not silently replaced by the stored one', async () => {
      const startExport = await armed();
      chooseLimitMode();
      typeLimit('200');
      typeLimit('0');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(main());
      expect(startExport).not.toHaveBeenCalled();
      expect(limitInput().value).toBe('0');
      expect(alertText()).toBe('Enter a number from 1 to 100,000.');
      expect(document.activeElement).toBe(limitInput());
    });

    it('a problem with the dates is looked at before the one with the number', async () => {
      const startExport = await armed();
      chooseLimitMode();
      typeLimit('0');
      fireEvent.change(dateInput('From'), { target: { value: '20261-10-06' } });
      fireEvent.click(main());
      expect(startExport).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(dateInput('From'));
    });

    it('once the number is fixed it starts, with exactly the number the input shows', async () => {
      const seen: ExportOptions[] = [];
      await start();
      mocks.loadExportFormat.mockImplementation(async (id) => {
        const format = idLinesFormat(id);
        return {
          ...format,
          createWriter: (ctx) => {
            seen.push(ctx.options);
            return format.createWriter(ctx);
          },
        };
      });
      chooseLimitMode();
      typeLimit('abc-not-a-number');
      typeLimit('');
      fireEvent.click(main());
      expect(mocks.loadExportFormat).not.toHaveBeenCalled();

      typeLimit('25');
      await act(async () => {
        fireEvent.click(main());
      });
      await vi.waitFor(() => expect(appStore.getState().exportJob.status).toBe('done'));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ limit: 25, after: null, before: null });
      expect(appStore.getState().exportJob.output?.messageCount).toBe(25);
    });

    it('a valid count never blocks it, and nor does "All"', async () => {
      const startExport = await armed();
      chooseLimitMode();
      typeLimit('50');
      fireEvent.click(main());
      expect(startExport).toHaveBeenCalledTimes(1);
    });

    it('is refused in Korean the same way', async () => {
      const startExport = await armed('ko');
      chooseLimitMode();
      typeLimit('');
      fireEvent.click(main());
      expect(startExport).not.toHaveBeenCalled();
      expect(alertText()).toBe('메시지 개수를 입력하세요.');
    });
  });
});

describe('the count and the dates reach the export', () => {
  it('a start date and a count are exported as "the first N from the start date"', async () => {
    const history = await fullHistory(MOCK_IDS.edge199Channel);
    const startDay = isoToDateInput(history[120].timestamp);
    await start();
    fireEvent.change(dateInput('From'), { target: { value: startDay } });
    chooseLimitMode();
    typeLimit('7');
    fireEvent.pointerDown(document.body);

    const written: string[] = [];
    mocks.loadExportFormat.mockImplementation(async (id) => {
      const format = idLinesFormat(id);
      return {
        ...format,
        createWriter: (ctx) => {
          const writer = format.createWriter(ctx);
          return {
            ...writer,
            write: (batch) => {
              written.push(...batch.map((message) => message.id));
              return writer.write(batch);
            },
          };
        },
      };
    });
    await act(async () => {
      fireEvent.click(main());
    });
    await vi.waitFor(() => expect(appStore.getState().exportJob.status).toBe('done'));

    const from = Date.parse(startOfDayIso(startDay) ?? '');
    const expected = history.filter((message) => Date.parse(message.timestamp) >= from).slice(0, 7);
    expect(expected).toHaveLength(7);
    expect(written).toEqual(expected.map((message) => message.id));
  });
});
