// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { ExportFormat, ExportFormatId } from '@/lib/export/types';
import { bootTopBar, select, type BootedTopBar } from './helpers';

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  loadExportFormat: vi.fn<(id: ExportFormatId) => Promise<ExportFormat>>(),
}));

vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: mocks.loadExportFormat }));

function fakeFormat(id: ExportFormatId): ExportFormat {
  return {
    id,
    label: id,
    extension: id,
    mime: 'text/plain',
    createWriter: () => ({ start: () => ['header\n'], write: (batch) => batch.map((message) => `${message.id}\n`), end: () => [] }),
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;
let booted: BootedTopBar;

beforeEach(() => {
  mocks.saveBlob.mockReset();
  mocks.loadExportFormat.mockReset();
  mocks.loadExportFormat.mockImplementation(async (id) => fakeFormat(id));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  cleanup();
});

const main = (name: RegExp | string = /^Download|^다운로드/): HTMLElement => screen.getByRole('button', { name });
const caret = (): HTMLElement => screen.getByRole('button', { name: /Export options|내보내기 옵션/ });
const optionsPanel = (): HTMLElement => screen.getByRole('dialog', { name: /Export options|내보내기 옵션/ });
const radio = (name: string): HTMLElement => within(screen.getByRole('radiogroup', { name: /Format|형식/ })).getByRole('radio', { name: new RegExp(`^${name}`) });
const savedPrefs = (): unknown => booted.platform.spies.savePrefs.mock.calls.at(-1)?.[0];

async function start(locale: 'en' | 'ko' = 'en', selected: string[] = [MOCK_IDS.edge199Channel]): Promise<void> {
  booted = await bootTopBar(locale);
  select(...selected);
  render(<TopBar />);
}

describe('download split button', () => {
  it('shows the download icon, the label and the format chip', async () => {
    await start();
    expect(main().textContent).toBe('DownloadHTML');
    expect(main().querySelector('svg')).not.toBeNull();
    expect(main().querySelector('.topbar__format-chip')?.textContent).toBe('HTML');
    expect(caret().querySelector('svg')).not.toBeNull();
  });

  it('is labelled in Korean', async () => {
    await start('ko');
    expect(main().textContent).toBe('다운로드HTML');
    expect(caret().getAttribute('aria-label')).toBe('내보내기 옵션');
  });

  it('is the target of the "skip to export controls" link (SKIP-1): only the main part carries the hook, whatever the job state', async () => {
    await start();
    const hooked = (): Element[] => Array.from(document.querySelectorAll('[data-skip-target="export"]'));
    expect(hooked()).toEqual([main()]);
    expect(main().classList.contains('topbar__split-main')).toBe(true);
    expect(hooked()[0].closest('.app-topbar')).not.toBeNull();

    // While a job runs the button turns into the progress readout, and is still what the link must reach.
    mocks.loadExportFormat.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(main());
    expect(hooked()).toEqual([screen.getByRole('button', { name: /Exporting/ })]);
  });

  it('the chip follows the chosen format', async () => {
    await start();
    act(() => appStore.getState().setPrefs({ exportFormat: 'xlsx' }));
    expect(main().querySelector('.topbar__format-chip')?.textContent).toBe('XLSX');
    act(() => appStore.getState().setPrefs({ exportFormat: 'md' }));
    expect(main().querySelector('.topbar__format-chip')?.textContent).toBe('MD');
  });

  it('is two real buttons: the main part and the caret', async () => {
    await start();
    expect(main().tagName).toBe('BUTTON');
    expect(caret().tagName).toBe('BUTTON');
    expect(main().getAttribute('type')).toBe('button');
    expect(caret().getAttribute('aria-haspopup')).toBe('dialog');
    expect(caret().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('without a selection', () => {
  it('both segments are aria-disabled and say why', async () => {
    await start('en', []);
    expect(main().getAttribute('aria-disabled')).toBe('true');
    expect(caret().getAttribute('aria-disabled')).toBe('true');
    expect(main().getAttribute('title')).toBe('Select channels first');
    expect(caret().getAttribute('title')).toBe('Select channels first');
    expect(main().closest('.topbar__split')?.hasAttribute('data-unavailable')).toBe(true);
  });

  it('says it in Korean', async () => {
    await start('ko', []);
    expect(main().getAttribute('title')).toBe('먼저 채널을 선택하세요');
  });

  it('a click opens a small hint and does not start anything', async () => {
    await start('en', []);
    const startExport = vi.fn(async () => undefined);
    act(() => appStore.setState({ startExport }));
    fireEvent.click(main());

    const hint = screen.getByRole('status', { name: 'Select channels first' });
    expect(hint.textContent).toContain('Tick the checkboxes');
    expect(startExport).not.toHaveBeenCalled();
    expect(appStore.getState().exportJob.status).toBe('idle');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the caret shows the hint too instead of the options', async () => {
    await start('en', []);
    fireEvent.click(caret());
    expect(screen.getByRole('status', { name: 'Select channels first' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('the hint closes with Esc (focus stays on the button), with an outside press and with a second click', async () => {
    await start('en', []);
    main().focus();
    fireEvent.click(main());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.activeElement).toBe(main());

    fireEvent.click(main());
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(main());
    fireEvent.click(main());
    expect(screen.queryByRole('status')).toBeNull();
  });

  describe('the hint is a status message, not a dialog', () => {
    it('leaves the focus on the button, is not focusable and does not swallow Tab', async () => {
      await start('en', []);
      main().focus();
      fireEvent.click(main());
      const hint = screen.getByRole('status', { name: 'Select channels first' });

      expect(document.activeElement).toBe(main());
      expect(hint.getAttribute('aria-live')).toBe('polite');
      expect(hint.hasAttribute('tabindex')).toBe(false);
      expect(hint.querySelector('[tabindex], button, a, input')).toBeNull();
      expect(main().getAttribute('aria-describedby')).toBe(hint.id);
      for (const shiftKey of [false, true]) {
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        document.activeElement?.dispatchEvent(event);
        expect(event.defaultPrevented, `shiftKey ${shiftKey}`).toBe(false);
      }
      expect(document.activeElement).toBe(main());
    });

    it('opened from the caret it leaves the focus on the caret, also after Esc', async () => {
      await start('en', []);
      caret().focus();
      fireEvent.click(caret());
      expect(screen.getByRole('status')).toBeTruthy();
      expect(document.activeElement).toBe(caret());
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('status')).toBeNull();
      expect(document.activeElement).toBe(caret());
    });

    it('closes when the focus leaves the download button, but not when it moves between its two parts', async () => {
      await start('en', []);
      main().focus();
      fireEvent.click(main());
      act(() => caret().focus());
      expect(screen.getByRole('status')).toBeTruthy();

      act(() => screen.getByRole('button', { name: /selected/ }).focus());
      expect(screen.queryByRole('status')).toBeNull();
      expect(main().getAttribute('aria-describedby')).toBeNull();
    });

    it('closes when the button loses the focus to nothing (window switch, click on empty space)', async () => {
      await start('en', []);
      main().focus();
      fireEvent.click(main());
      act(() => main().blur());
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('the hint disappears once something is selected', async () => {
    await start('en', []);
    fireEvent.click(main());
    expect(screen.getByRole('status')).toBeTruthy();
    select(MOCK_IDS.edge199Channel);
    expect(screen.queryByRole('status')).toBeNull();
    expect(main().getAttribute('aria-disabled')).toBeNull();
  });
});

describe('pressing the main part', () => {
  it('starts the export immediately', async () => {
    await start();
    const startExport = vi.fn(async () => undefined);
    act(() => appStore.setState({ startExport }));
    fireEvent.click(main());
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('exports with the persisted format, options and range', async () => {
    await start();
    act(() => appStore.getState().setPrefs({ exportFormat: 'md', htmlTheme: 'light' }));
    act(() => appStore.getState().setExportAfter('2026-09-01T00:00:00.000Z'));
    mocks.loadExportFormat.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(main());

    expect(mocks.loadExportFormat).toHaveBeenCalledWith('md');
    expect(appStore.getState().exportJob.status).toBe('running');
  });

  it('opens the progress dialog and turns the button into a progress readout', async () => {
    await start('en', [MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    mocks.loadExportFormat.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(main());

    expect(screen.getByRole('dialog', { name: 'Exporting chats…' })).toBeTruthy();
    expect(main(/Exporting/).textContent).toBe('Exporting… 0/2');
    expect(main(/Exporting/).querySelector('.topbar__format-chip')).toBeNull();
    expect(main(/Exporting/).getAttribute('title')).toBe('Show export progress');
    // The options cannot change a running job: no caret.
    expect(screen.queryByRole('button', { name: 'Export options' })).toBeNull();
  });

  it('starts nothing while a job already runs, it only brings the dialog back', async () => {
    await start();
    mocks.loadExportFormat.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(main());
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(main(/Exporting/));
    expect(screen.getByRole('dialog', { name: 'Exporting chats…' })).toBeTruthy();
    expect(mocks.loadExportFormat).toHaveBeenCalledTimes(1);
  });

  it('closes an open options popover first', async () => {
    await start();
    fireEvent.click(caret());
    expect(optionsPanel()).toBeTruthy();
    mocks.loadExportFormat.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(main());
    expect(screen.queryByRole('dialog', { name: 'Export options' })).toBeNull();
  });
});

describe('options popover', () => {
  it('a format card is named by its label alone and described by its description: a screen reader does not read the description twice (QA-LAYOUT-13)', async () => {
    await start();
    fireEvent.click(caret());
    const group = within(optionsPanel()).getByRole('radiogroup', { name: 'Format' });
    const cards: Array<[string, string]> = [
      ['HTML', 'Looks like Discord - best for reading (recommended)'],
      ['TXT', 'Plain text'],
      ['Markdown', 'For Notion / Obsidian / GitHub'],
      ['Excel (.xlsx)', 'Excel - sort and filter'],
      ['CSV', 'Spreadsheet / data analysis'],
      ['JSON', 'Full raw data for programs'],
    ];
    expect(within(group).getAllByRole('radio')).toHaveLength(cards.length);
    for (const [label, description] of cards) {
      const card = within(group).getByRole('radio', { name: label });
      expect(card.getAttribute('aria-labelledby')).not.toBe(card.getAttribute('aria-describedby'));
      expect(document.getElementById(card.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(label);
      expect(document.getElementById(card.getAttribute('aria-describedby') ?? '')?.textContent).toBe(description);
    }
  });

  it('a segmented choice has no description to point at: it is named by its own text', async () => {
    await start();
    fireEvent.click(caret());
    const dark = within(optionsPanel()).getByRole('radio', { name: 'Dark' });
    expect(dark.getAttribute('aria-labelledby')).toBeNull();
    expect(dark.getAttribute('aria-describedby')).toBeNull();
  });

  it('opens under the caret and closes with a second click', async () => {
    await start();
    fireEvent.click(caret());
    expect(caret().getAttribute('aria-expanded')).toBe('true');
    const panel = optionsPanel();
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.width).toBe('340px');
    fireEvent.pointerDown(caret());
    fireEvent.click(caret());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(caret().getAttribute('aria-expanded')).toBe('false');
  });

  it('Esc closes it and returns the focus to the caret', async () => {
    await start();
    fireEvent.click(caret());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(caret());
  });

  it('a press outside closes it', async () => {
    await start();
    fireEvent.click(caret());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the six formats as radio cards with their descriptions', async () => {
    await start();
    fireEvent.click(caret());
    const group = screen.getByRole('radiogroup', { name: 'Format' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.querySelector('.topbar-radio__label')?.textContent)).toEqual(['HTML', 'TXT', 'Markdown', 'Excel (.xlsx)', 'CSV', 'JSON']);
    expect(radios.map((r) => r.querySelector('.topbar-radio__description')?.textContent)).toEqual([
      'Looks like Discord - best for reading (recommended)',
      'Plain text',
      'For Notion / Obsidian / GitHub',
      'Excel - sort and filter',
      'Spreadsheet / data analysis',
      'Full raw data for programs',
    ]);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);
  });

  it('describes the formats in Korean', async () => {
    await start('ko');
    fireEvent.click(caret());
    const group = screen.getByRole('radiogroup', { name: '형식' });
    expect(within(group).getAllByRole('radio').map((r) => r.querySelector('.topbar-radio__description')?.textContent)).toEqual([
      'Discord처럼 보이는 파일 - 읽기에 가장 좋아요 (권장)',
      '일반 텍스트',
      'Notion · Obsidian · GitHub용',
      'Excel - 정렬하고 필터링',
      '스프레드시트 · 데이터 분석용',
      '프로그램용 전체 원본 데이터',
    ]);
  });

  it('choosing a format persists it through the platform and updates the button', async () => {
    await start();
    fireEvent.click(caret());
    fireEvent.click(radio('TXT'));

    expect(appStore.getState().prefs.exportFormat).toBe('txt');
    expect(booted.platform.spies.savePrefs).toHaveBeenCalledTimes(1);
    expect(savedPrefs()).toMatchObject({ exportFormat: 'txt' });
    expect(radio('TXT').getAttribute('aria-checked')).toBe('true');
    expect(radio('HTML').getAttribute('aria-checked')).toBe('false');
    expect(main().querySelector('.topbar__format-chip')?.textContent).toBe('TXT');
  });

  it('the popover reflects the persisted format when it is opened again', async () => {
    await start();
    act(() => appStore.getState().setPrefs({ exportFormat: 'csv' }));
    fireEvent.click(caret());
    expect(radio('CSV').getAttribute('aria-checked')).toBe('true');
  });

  describe('keyboard', () => {
    it('Tab reaches the checked card only (roving tab stop)', async () => {
      await start();
      act(() => appStore.getState().setPrefs({ exportFormat: 'md' }));
      fireEvent.click(caret());
      expect(document.activeElement).toBe(radio('Markdown'));
    });

    it('ArrowDown / ArrowRight select and focus the next card, wrapping around', async () => {
      await start();
      fireEvent.click(caret());
      fireEvent.keyDown(radio('HTML'), { key: 'ArrowDown' });
      expect(appStore.getState().prefs.exportFormat).toBe('txt');
      expect(document.activeElement).toBe(radio('TXT'));
      fireEvent.keyDown(radio('TXT'), { key: 'ArrowRight' });
      expect(appStore.getState().prefs.exportFormat).toBe('md');

      act(() => appStore.getState().setPrefs({ exportFormat: 'json' }));
      fireEvent.keyDown(radio('JSON'), { key: 'ArrowDown' });
      expect(appStore.getState().prefs.exportFormat).toBe('html');
      expect(document.activeElement).toBe(radio('HTML'));
    });

    it('ArrowUp / ArrowLeft select the previous card, wrapping around', async () => {
      await start();
      fireEvent.click(caret());
      fireEvent.keyDown(radio('HTML'), { key: 'ArrowUp' });
      expect(appStore.getState().prefs.exportFormat).toBe('json');
      expect(document.activeElement).toBe(radio('JSON'));
      fireEvent.keyDown(radio('JSON'), { key: 'ArrowLeft' });
      expect(appStore.getState().prefs.exportFormat).toBe('csv');
    });

    it('Home and End jump to the ends', async () => {
      await start();
      fireEvent.click(caret());
      fireEvent.keyDown(radio('HTML'), { key: 'End' });
      expect(appStore.getState().prefs.exportFormat).toBe('json');
      fireEvent.keyDown(radio('JSON'), { key: 'Home' });
      expect(appStore.getState().prefs.exportFormat).toBe('html');
    });

    it('other keys do nothing', async () => {
      await start();
      fireEvent.click(caret());
      fireEvent.keyDown(radio('HTML'), { key: 'a' });
      expect(appStore.getState().prefs.exportFormat).toBe('html');
      expect(booted.platform.spies.savePrefs).not.toHaveBeenCalled();
    });

    it('Tab wraps inside the popover', async () => {
      await start();
      fireEvent.click(caret());
      const panel = optionsPanel();
      const buttons = Array.from(panel.querySelectorAll<HTMLElement>('button, input')).filter((element) => element.tabIndex >= 0);
      const last = buttons[buttons.length - 1];
      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(buttons[0]);
    });
  });

  describe('HTML theme', () => {
    it('is offered for HTML only', async () => {
      await start();
      fireEvent.click(caret());
      expect(screen.getByRole('radiogroup', { name: 'HTML theme' })).toBeTruthy();

      fireEvent.click(radio('TXT'));
      expect(screen.queryByRole('radiogroup', { name: 'HTML theme' })).toBeNull();
      fireEvent.click(radio('JSON'));
      expect(screen.queryByRole('radiogroup', { name: 'HTML theme' })).toBeNull();
      fireEvent.click(radio('HTML'));
      expect(screen.getByRole('radiogroup', { name: 'HTML theme' })).toBeTruthy();
    });

    it('is a Dark / Light segmented control bound to prefs.htmlTheme', async () => {
      await start();
      fireEvent.click(caret());
      const theme = screen.getByRole('radiogroup', { name: 'HTML theme' });
      const [dark, light] = within(theme).getAllByRole('radio');
      expect([dark.textContent, light.textContent]).toEqual(['Dark', 'Light']);
      expect(dark.getAttribute('aria-checked')).toBe('true');

      fireEvent.click(light);
      expect(appStore.getState().prefs.htmlTheme).toBe('light');
      expect(savedPrefs()).toMatchObject({ htmlTheme: 'light', exportFormat: 'html' });
      expect(light.getAttribute('aria-checked')).toBe('true');
      expect(dark.getAttribute('aria-checked')).toBe('false');
    });

    it('is labelled in Korean and works with the keyboard', async () => {
      await start('ko');
      fireEvent.click(caret());
      const theme = screen.getByRole('radiogroup', { name: 'HTML 테마' });
      const [dark, light] = within(theme).getAllByRole('radio');
      expect([dark.textContent, light.textContent]).toEqual(['다크', '라이트']);
      fireEvent.keyDown(dark, { key: 'ArrowRight' });
      expect(appStore.getState().prefs.htmlTheme).toBe('light');
      expect(document.activeElement).toBe(light);
    });
  });

  describe('language', () => {
    const group = (name: string): HTMLElement => screen.getByRole('radiogroup', { name });

    it('is an Auto / 한국어 / English segmented control bound to prefs.locale', async () => {
      await start();
      fireEvent.click(caret());
      const radios = within(group('Language')).getAllByRole('radio');
      expect(radios.map((r) => r.textContent)).toEqual(['Auto', '한국어', 'English']);
      expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
      expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
      expect(appStore.getState().prefs.locale).toBe('auto');
    });

    it('says that it changes the app and the exported files', async () => {
      await start();
      fireEvent.click(caret());
      const help = within(optionsPanel()).getByText(/fixed text inside exported files/);
      expect(help.textContent).toContain('language of the app');
      expect(help.textContent).toContain('Auto follows your browser language');
    });

    it('choosing a language switches the whole UI at once and persists the choice', async () => {
      await start();
      fireEvent.click(caret());
      fireEvent.click(within(group('Language')).getByRole('radio', { name: '한국어' }));

      expect(appStore.getState().prefs.locale).toBe('ko');
      expect(appStore.getState().locale).toBe('ko');
      expect(savedPrefs()).toMatchObject({ locale: 'ko' });
      expect(main().textContent).toBe('다운로드HTML');
      const korean = within(group('언어')).getAllByRole('radio');
      expect(korean.map((r) => r.textContent)).toEqual(['자동', '한국어', 'English']);
      expect(korean[1].getAttribute('aria-checked')).toBe('true');
      expect(within(optionsPanel()).getByText(/내보낸 파일 안의 고정 문구/)).toBeTruthy();

      fireEvent.click(within(group('언어')).getByRole('radio', { name: 'English' }));
      expect(appStore.getState().locale).toBe('en');
      expect(main().textContent).toBe('DownloadHTML');
    });

    it('Auto follows the browser language again', async () => {
      await start();
      fireEvent.click(caret());
      fireEvent.click(within(group('Language')).getByRole('radio', { name: '한국어' }));
      fireEvent.click(within(group('언어')).getByRole('radio', { name: '자동' }));
      expect(appStore.getState().prefs.locale).toBe('auto');
      expect(appStore.getState().locale).toBe(navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en');
    });

    it('works with the arrow keys and keeps the focus on the chosen option', async () => {
      await start();
      fireEvent.click(caret());
      const [auto] = within(group('Language')).getAllByRole('radio');
      fireEvent.keyDown(auto, { key: 'ArrowRight' });
      expect(appStore.getState().prefs.locale).toBe('ko');
      expect(document.activeElement).toBe(within(group('언어')).getAllByRole('radio')[1]);
    });

    it('also decides the language of the exported file', async () => {
      await start();
      fireEvent.click(caret());
      fireEvent.click(within(group('Language')).getByRole('radio', { name: '한국어' }));
      fireEvent.pointerDown(document.body);
      const seen: unknown[] = [];
      const original = fakeFormat('html');
      mocks.loadExportFormat.mockImplementation(async () => ({
        ...original,
        createWriter: (ctx) => {
          seen.push(ctx.options);
          return original.createWriter(ctx);
        },
      }));
      await act(async () => {
        fireEvent.click(main());
      });
      await vi.waitFor(() => expect(appStore.getState().exportJob.status).toBe('done'));
      expect(seen[0]).toMatchObject({ locale: 'ko' });
    });
  });

  describe('date range', () => {
    const input =(label: 'From' | 'To' | '시작일' | '종료일'): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
    const type = (label: 'From' | 'To', value: string): void => {
      fireEvent.change(input(label), { target: { value } });
    };
    const startOfDay = (y: number, m: number, d: number): string => new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
    const endOfDay = (y: number, m: number, d: number): string => new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();

    it('has two labelled date inputs and the helper texts', async () => {
      await start();
      fireEvent.click(caret());
      expect(input('From').type).toBe('date');
      expect(input('To').type).toBe('date');
      expect(input('From').value).toBe('');
      expect(within(optionsPanel()).getByText('Leave empty to export everything.')).toBeTruthy();
      expect(within(optionsPanel()).getByText('Files are zipped when more than one channel is selected.')).toBeTruthy();
    });

    it('is labelled in Korean', async () => {
      await start('ko');
      fireEvent.click(caret());
      expect(input('시작일').type).toBe('date');
      expect(input('종료일').type).toBe('date');
      expect(within(optionsPanel()).getByText('비워 두면 전체 기간을 내보내요.')).toBeTruthy();
      expect(within(optionsPanel()).getByText('채널을 2개 이상 선택하면 ZIP 파일 하나로 저장돼요.')).toBeTruthy();
    });

    it('From is stored as the local start of that day', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-01');
      expect(appStore.getState().exportSettings.after).toBe(startOfDay(2026, 10, 1));
      expect(appStore.getState().exportSettings.before).toBeNull();
    });

    it('To is stored as the very end (23:59:59.999) of that local day', async () => {
      await start();
      fireEvent.click(caret());
      type('To', '2026-10-03');
      expect(appStore.getState().exportSettings.before).toBe(endOfDay(2026, 10, 3));
      expect(new Date(appStore.getState().exportSettings.before ?? '').getHours()).toBe(23);
      expect(new Date(appStore.getState().exportSettings.before ?? '').getMilliseconds()).toBe(999);
      expect(appStore.getState().exportSettings.after).toBeNull();
    });

    it('the same day for both ends is a valid range', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-03');
      type('To', '2026-10-03');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(appStore.getState().exportSettings).toEqual({ after: startOfDay(2026, 10, 3), before: endOfDay(2026, 10, 3), limit: null });
    });

    it('years before 100 are not turned into 19xx', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '0050-01-02');
      expect(new Date(appStore.getState().exportSettings.after ?? '').getFullYear()).toBe(50);
    });

    it('rejects From after To with a message and does not store the pair', async () => {
      await start();
      fireEvent.click(caret());
      type('To', '2026-10-03');
      type('From', '2026-10-05');

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe('The start date is later than the end date.');
      expect(appStore.getState().exportSettings.after).toBeNull();
      expect(appStore.getState().exportSettings.before).toBe(endOfDay(2026, 10, 3));
      // What the user typed stays visible so it can be corrected.
      expect(input('From').value).toBe('2026-10-05');
      expect(input('From').getAttribute('aria-invalid')).toBe('true');
      expect(input('To').getAttribute('aria-invalid')).toBe('true');
      expect(input('From').getAttribute('aria-describedby')).toBe(alert.id);
    });

    it('rejects an end before the start the same way', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-05');
      type('To', '2026-10-03');
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(appStore.getState().exportSettings).toEqual({ after: startOfDay(2026, 10, 5), before: null, limit: null });
    });

    it('the message is shown in Korean too', async () => {
      await start('ko');
      fireEvent.click(caret());
      fireEvent.change(input('종료일'), { target: { value: '2026-10-03' } });
      fireEvent.change(input('시작일'), { target: { value: '2026-10-05' } });
      expect(screen.getByRole('alert').textContent).toBe('시작 날짜가 종료 날짜보다 늦습니다.');
    });

    it('correcting the pair stores both ends', async () => {
      await start();
      fireEvent.click(caret());
      type('To', '2026-10-03');
      type('From', '2026-10-05');
      type('From', '2026-10-02');

      expect(screen.queryByRole('alert')).toBeNull();
      expect(input('From').getAttribute('aria-invalid')).toBeNull();
      expect(appStore.getState().exportSettings).toEqual({ after: startOfDay(2026, 10, 2), before: endOfDay(2026, 10, 3), limit: null });
    });

    it('moving the end late enough also fixes a rejected start', async () => {
      await start();
      fireEvent.click(caret());
      type('To', '2026-10-03');
      type('From', '2026-10-05');
      type('To', '2026-10-09');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(appStore.getState().exportSettings).toEqual({ after: startOfDay(2026, 10, 5), before: endOfDay(2026, 10, 9), limit: null });
    });

    it('the clear buttons empty a field, reset the setting and keep the focus in the field', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-01');
      type('To', '2026-10-03');

      fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear start date' }));
      expect(input('From').value).toBe('');
      expect(appStore.getState().exportSettings).toEqual({ after: null, before: endOfDay(2026, 10, 3), limit: null });
      expect(document.activeElement).toBe(input('From'));
      expect(within(optionsPanel()).queryByRole('button', { name: 'Clear start date' })).toBeNull();

      fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear end date' }));
      expect(appStore.getState().exportSettings).toEqual({ after: null, before: null, limit: null });
    });

    it('clearing the offending start removes the error', async () => {
      await start();
      fireEvent.click(caret());
      type('To', '2026-10-03');
      type('From', '2026-10-05');
      fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear start date' }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(appStore.getState().exportSettings).toEqual({ after: null, before: endOfDay(2026, 10, 3), limit: null });
    });

    it('the native clear of a date input clears the setting', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-01');
      type('From', '');
      expect(appStore.getState().exportSettings.after).toBeNull();
    });

    it('shows the stored range when the popover is opened again', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-01');
      type('To', '2026-10-03');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(caret());
      expect(input('From').value).toBe('2026-10-01');
      expect(input('To').value).toBe('2026-10-03');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('keeps a rejected draft: it is shown again, with its error, when the popover is opened again', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-01');
      type('To', '2026-10-03');
      type('From', '2026-10-09');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(caret());
      expect(input('From').value).toBe('2026-10-09');
      expect(input('To').value).toBe('2026-10-03');
      expect(screen.getByRole('alert').textContent).toBe('The start date is later than the end date.');
      // The problem is where the focus goes, so it is read out and can be fixed right away.
      expect(document.activeElement).toBe(input('From'));
    });

    it('limits the inputs to 4-digit years', async () => {
      await start();
      fireEvent.click(caret());
      for (const label of ['From', 'To'] as const) {
        expect(input(label).getAttribute('min')).toBe('0001-01-01');
        expect(input(label).getAttribute('max')).toBe('9999-12-31');
      }
    });

    describe('what Download does with a range that cannot be exported', () => {
      const armed = async (): Promise<ReturnType<typeof vi.fn<() => Promise<undefined>>>> => {
        await start();
        const startExport = vi.fn(async () => undefined);
        act(() => appStore.setState({ startExport }));
        return startExport;
      };

      it('From after To: Download does not start, it opens the options at the problem', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '2026-10-10');
        type('To', '2026-10-01');
        expect(screen.getByRole('alert')).toBeTruthy();

        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();
        expect(appStore.getState().exportJob.status).toBe('idle');
        expect(optionsPanel()).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toBe('The start date is later than the end date.');
        expect(document.activeElement).toBe(input('From'));
        expect(input('From').getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
      });

      it('also after the popover was closed: the typed pair is not silently replaced by the stored range', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '2026-10-10');
        type('To', '2026-10-01');
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();
        expect(optionsPanel()).toBeTruthy();
        expect(input('From').value).toBe('2026-10-10');
        expect(input('To').value).toBe('2026-10-01');
      });

      it('and after a press outside closed it', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('To', '2026-10-03');
        type('From', '2026-10-05');
        fireEvent.pointerDown(document.body);

        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeTruthy();
      });

      describe('a date that is only half typed when the popover goes away (QA-EXP-01)', () => {
        /** The control holds "10/dd/yyyy": its value is '' and it reports bad input, and no event announced it. */
        function typePartially(label: 'From' | 'To'): HTMLInputElement {
          const field = input(label);
          Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
          field.focus();
          expect(document.activeElement).toBe(field);
          return field;
        }

        it.each([
          ['a press outside the popover (the chat area)', () => fireEvent.pointerDown(document.body)],
          ['a press on the selection chip', () => fireEvent.pointerDown(screen.getByRole('button', { name: /selected/ }))],
        ])('%s does not lose it: Download still refuses, and the options reopen with the error', async (_name, close) => {
          for (const label of ['From', 'To'] as const) {
            const startExport = await armed();
            fireEvent.click(caret());
            typePartially(label);

            close();
            expect(screen.queryByRole('dialog', { name: /Export options/ })).toBeNull();
            fireEvent.click(main());

            expect(startExport).not.toHaveBeenCalled();
            expect(optionsPanel()).toBeTruthy();
            expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
            expect(input(label).getAttribute('aria-invalid')).toBe('true');
            expect(appStore.getState().exportJob.status).toBe('idle');
            cleanup();
          }
        });

        it('the field is cleared with its own button, which lets Download start', async () => {
          const startExport = await armed();
          fireEvent.click(caret());
          typePartially('From');
          fireEvent.pointerDown(document.body);
          fireEvent.click(main());
          expect(startExport).not.toHaveBeenCalled();

          fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear start date' }));
          expect(screen.queryByRole('alert')).toBeNull();
          fireEvent.click(main());
          expect(startExport).toHaveBeenCalledTimes(1);
        });

        it('a press inside the popover does not leave the field', async () => {
          await armed();
          fireEvent.click(caret());
          const field = typePartially('To');
          fireEvent.pointerDown(optionsPanel());
          expect(document.activeElement).toBe(field);
          expect(screen.queryByRole('alert')).toBeNull();
        });
      });

      describe('a press on a control below a half-typed date (V-SEL-NEW-1, NEW-EXP-02)', () => {
        function typePartially(label: 'From' | 'To'): HTMLInputElement {
          const field = input(label);
          Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
          field.focus();
          expect(document.activeElement).toBe(field);
          return field;
        }
        /** The press of a mouse: the pointer goes down on the control, which takes the focus - the half-typed field is left. */
        function press(target: HTMLElement): void {
          fireEvent.pointerDown(target);
          act(() => target.focus());
        }
        const limitRadio = (): HTMLElement => within(optionsPanel()).getByRole('radio', { name: 'Limit to N' });

        it('the error line appears when the pointer is up, not while it is down: it would push the control away from under the press', async () => {
          await armed();
          fireEvent.click(caret());
          typePartially('From');
          const limit = limitRadio();

          press(limit);
          expect(screen.queryByRole('alert')).toBeNull();
          expect(input('From').getAttribute('aria-invalid')).toBeNull();

          fireEvent.pointerUp(limit);
          expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
          expect(input('From').getAttribute('aria-invalid')).toBe('true');

          // The click that follows reaches the control that was pressed, and what it chose is kept with the unfinished date.
          fireEvent.click(limit);
          expect(limit.getAttribute('aria-checked')).toBe('true');
          expect(within(optionsPanel()).getByRole('spinbutton')).toBeTruthy();
          expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
        });

        it.each([
          ['let go outside the popover', () => fireEvent.pointerUp(document.body)],
          ['cancelled by the browser (a touch that turned into a scroll)', () => fireEvent.pointerCancel(document.body)],
        ])('a press that is %s still reports the date, once', async (_name, end) => {
          await armed();
          fireEvent.click(caret());
          typePartially('To');
          press(limitRadio());
          expect(screen.queryByRole('alert')).toBeNull();

          end();
          expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual(['Enter a valid date.']);
          // Nothing is left waiting: the next press is a new one.
          fireEvent.pointerUp(document.body);
          expect(screen.getAllByRole('alert')).toHaveLength(1);
        });

        it('leaving the field with the keyboard (no press) reports it at once', async () => {
          await armed();
          fireEvent.click(caret());
          typePartially('From');
          act(() => limitRadio().focus());
          expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
        });

        it('a press on the Download button, which lies outside the popover, reports it at once: the click on it already finds the problem', async () => {
          const startExport = await armed();
          fireEvent.click(caret());
          typePartially('From');

          press(main());
          expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
          fireEvent.pointerUp(main());
          fireEvent.click(main());
          expect(startExport).not.toHaveBeenCalled();
          expect(appStore.getState().exportJob.status).toBe('idle');
        });
      });

      it('asking again while the options are open moves the focus back to the problem', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('To', '2026-10-03');
        type('From', '2026-10-05');
        input('To').focus();

        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(input('From'));
      });

      it('a year with 5 digits is an error, not "no limit"', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '20261-10-06');

        expect(input('From').value).toBe('20261-10-06');
        expect(input('From').getAttribute('aria-invalid')).toBe('true');
        expect(input('To').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
        expect(appStore.getState().exportSettings).toEqual({ after: null, before: null, limit: null });

        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(input('From'));
      });

      it('a 5 digit year in To is caught too, also next to a valid From', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '2026-10-01');
        type('To', '10000-01-01');
        expect(input('To').getAttribute('aria-invalid')).toBe('true');
        expect(input('From').getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
        expect(appStore.getState().exportSettings.after).toBe(startOfDay(2026, 10, 1));

        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(input('To'));
      });

      it('the error is shown in Korean too', async () => {
        await start('ko');
        fireEvent.click(caret());
        fireEvent.change(input('시작일'), { target: { value: '20261-10-06' } });
        expect(screen.getByRole('alert').textContent).toBe('올바른 날짜를 입력하세요.');
      });

      it('an unfinished date (the control reports bad input) is an error as well', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '2026-10-01');
        // The user clears the year segment: the value becomes '' while the control still shows "10/01/yyyy".
        Object.defineProperty(input('From'), 'validity', { configurable: true, value: { badInput: true } });
        type('From', '');

        expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
        expect(input('From').getAttribute('aria-invalid')).toBe('true');
        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();

        // It can be cleared although the value is empty.
        fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear start date' }));
        expect(screen.queryByRole('alert')).toBeNull();
        expect(appStore.getState().exportSettings).toEqual({ after: null, before: null, limit: null });
      });

      it('an unfinished date is noticed when the field is left, too', async () => {
        await armed();
        fireEvent.click(caret());
        Object.defineProperty(input('To'), 'validity', { configurable: true, value: { badInput: true } });
        fireEvent.blur(input('To'));
        expect(screen.getByRole('alert').textContent).toBe('Enter a valid date.');
        expect(input('To').getAttribute('aria-invalid')).toBe('true');
      });

      it('fixing the pair lets Download start, with exactly the range the inputs show', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '2026-10-10');
        type('To', '2026-10-01');
        fireEvent.click(main());
        expect(startExport).not.toHaveBeenCalled();

        type('To', '2026-10-20');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(appStore.getState().exportSettings).toEqual({ after: startOfDay(2026, 10, 10), before: endOfDay(2026, 10, 20), limit: null });
        fireEvent.click(main());
        expect(startExport).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog', { name: 'Export options' })).toBeNull();
      });

      it('clearing the offending field lets Download start', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '20261-10-06');
        fireEvent.click(within(optionsPanel()).getByRole('button', { name: 'Clear start date' }));
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.click(main());
        expect(startExport).toHaveBeenCalledTimes(1);
      });

      it('a valid range never blocks Download', async () => {
        const startExport = await armed();
        fireEvent.click(caret());
        type('From', '2026-10-01');
        type('To', '2026-10-03');
        fireEvent.click(main());
        expect(startExport).toHaveBeenCalledTimes(1);
      });

      it('no export is loaded or started for a refused request', async () => {
        await start();
        fireEvent.click(caret());
        type('From', '2026-10-10');
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        fireEvent.click(caret());
        type('To', '2026-10-01');
        fireEvent.click(main());
        expect(appStore.getState().exportJob.status).toBe('idle');
        expect(mocks.loadExportFormat).not.toHaveBeenCalled();
      });
    });

    it('the stored range reaches the export', async () => {
      await start();
      fireEvent.click(caret());
      type('From', '2026-10-01');
      type('To', '2026-10-03');
      fireEvent.pointerDown(document.body);
      const seen: unknown[] = [];
      const original = fakeFormat('html');
      mocks.loadExportFormat.mockImplementation(async () => ({
        ...original,
        createWriter: (ctx) => {
          seen.push(ctx.options);
          return original.createWriter(ctx);
        },
      }));
      await act(async () => {
        fireEvent.click(main());
      });
      await vi.waitFor(() => expect(appStore.getState().exportJob.status).toBe('done'));
      expect(seen[0]).toMatchObject({ after: startOfDay(2026, 10, 1), before: endOfDay(2026, 10, 3), format: 'html' });
    });
  });
});
