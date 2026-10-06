// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import type { ExportJob, ExportJobOutput } from '@/app/state/types';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { ExportFailure, ExportFormat, ExportFormatId } from '@/lib/export/types';
import { bootTopBar, makeJob, progress, select, setJob, target } from './helpers';

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
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  vi.useRealTimers();
  cleanup();
});

const dialog = (): HTMLElement => screen.getByRole('dialog');
const closeButton = (): HTMLElement => within(dialog()).getByRole('button', { name: /^Close$|^닫기$/ });

function output(patch: Partial<ExportJobOutput> = {}): ExportJobOutput {
  return {
    filename: 'Discord Export 2026-10-06.zip',
    blob: new Blob(['zip']),
    fileCount: 12,
    messageCount: 48213,
    failures: [],
    cancelled: false,
    saved: true,
    ...patch,
  };
}

const skipped = (id: string, label: string): ExportFailure => ({ channelId: id, label, kind: 'skipped', reason: 'No access to this channel (403).' });
const failed = (id: string, label: string): ExportFailure => ({ channelId: id, label, kind: 'error', reason: 'Network error while contacting Discord.' });

describe('running', () => {
  async function runningDialog(locale: 'en' | 'ko' = 'en'): Promise<void> {
    await bootTopBar(locale);
    setJob(
      makeJob({
        progress: progress(
          [
            target({ channelId: '1', label: 'Dev Lounge / general', status: 'done', fetched: 1234, ratio: 1 }),
            target({ channelId: '2', label: 'Dev Lounge / help', status: 'fetching', fetched: 500, ratio: 0.42 }),
            target({ channelId: '3', label: 'Dev Lounge / random', status: 'queued' }),
            target({ channelId: '4', label: 'Dev Lounge / staff', status: 'skipped', ratio: 0, error: 'No access to this channel (403).' }),
          ],
          { totalMessages: 1734 },
        ),
      }),
    );
    render(<TopBar />);
  }

  it('is a modal dialog named by its title, centered over a backdrop', async () => {
    await runningDialog();
    const panel = dialog();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(panel.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Exporting chats…');
    expect(screen.getByRole('dialog', { name: 'Exporting chats…' })).toBe(panel);
    expect(panel.getAttribute('aria-busy')).toBe('true');
    expect(panel.parentElement?.className).toBe('topbar-modal');
    expect(panel.parentElement?.parentElement).toBe(document.body);
  });

  it('shows the overall bar, the messages written so far and the "do not close" note', async () => {
    await runningDialog();
    const bar = within(dialog()).getByRole('progressbar', { name: 'Overall progress' });
    // (1 done + 0.42 of the second + 1 skipped) / 4 channels
    expect(bar.getAttribute('aria-valuenow')).toBe('61');
    expect(bar.querySelector<HTMLElement>('.topbar-progress__fill')?.style.width).toBe('61%');
    expect(within(dialog()).getByText('2/4 channels · 1,734 messages')).toBeTruthy();
    expect(within(dialog()).getByText("Don't close this tab.")).toBeTruthy();
  });

  it('lists every channel with its state: done, fetching with count and percent, waiting, no access', async () => {
    await runningDialog();
    const rows = within(dialog()).getByRole('list', { name: 'Progress per channel' }).querySelectorAll('li');
    expect(Array.from(rows).map((row) => [row.querySelector('.topbar-targets__label')?.textContent, row.querySelector('.topbar-targets__state')?.textContent, row.getAttribute('data-status')])).toEqual([
      ['Dev Lounge / general', '1,234 messages', 'done'],
      ['Dev Lounge / help', '500 messages · 42%', 'fetching'],
      ['Dev Lounge / random', 'Waiting', 'queued'],
      ['Dev Lounge / staff', 'No access', 'skipped'],
    ]);
    expect(rows[1].querySelector('.dce-spinner')).not.toBeNull();
    expect(rows[0].querySelector('svg')).not.toBeNull();
    expect(rows[2].querySelector('.topbar-targets__dot')).not.toBeNull();
    expect(rows[3].getAttribute('title')).toBe('No access to this channel (403).');
  });

  it('gives every channel label a title, so a long "Server / channel" name that is cut off can still be read (UI-9b)', async () => {
    await bootTopBar();
    const long = `${'A very long server name '.repeat(6)}/ ${'an-even-longer-channel-name-'.repeat(4)}end`;
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: long, status: 'fetching', ratio: 0.1 }), target({ channelId: '2', label: 'Dev Lounge / help', status: 'queued' })]) }));
    render(<TopBar />);
    const labels = Array.from(dialog().querySelectorAll<HTMLElement>('.topbar-targets__label'));
    expect(labels.map((label) => label.getAttribute('title'))).toEqual([long, 'Dev Lounge / help']);
    expect(labels.map((label) => label.textContent)).toEqual([long, 'Dev Lounge / help']);
  });

  it('says it in Korean, with Korean number formatting', async () => {
    await runningDialog('ko');
    expect(screen.getByRole('dialog', { name: '채팅을 내보내는 중…' })).toBeTruthy();
    expect(screen.getByText('채널 2/4 · 메시지 1,734개')).toBeTruthy();
    expect(screen.getByText('이 탭을 닫지 마세요.')).toBeTruthy();
    const states = Array.from(dialog().querySelectorAll('.topbar-targets__state')).map((node) => node.textContent);
    expect(states).toEqual(['메시지 1,234개', '메시지 500개 · 42%', '대기 중', '접근 불가']);
    expect(within(dialog()).getByRole('button', { name: '숨기기' })).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: '취소' })).toBeTruthy();
  });

  it('shows no percentage when the ratio is unknown and never claims 100% while still fetching', async () => {
    await bootTopBar();
    setJob(
      makeJob({
        progress: progress([
          target({ channelId: '1', label: 'a', status: 'fetching', fetched: 1, ratio: null }),
          target({ channelId: '2', label: 'b', status: 'fetching', fetched: 7, ratio: 1 }),
        ]),
      }),
    );
    render(<TopBar />);
    const states = Array.from(dialog().querySelectorAll('.topbar-targets__state')).map((node) => node.textContent);
    expect(states).toEqual(['1 message', '7 messages · 99%']);
  });

  it('an error row shows its reason', async () => {
    await bootTopBar();
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'Server / lost', status: 'error', ratio: 0, error: 'Discord server error; try again later.' })]) }));
    render(<TopBar />);
    const row = dialog().querySelector('li') as HTMLElement;
    expect(row.querySelector('.topbar-targets__state')?.textContent).toBe('Error');
    expect(row.querySelector('.topbar-targets__reason')?.textContent).toBe('Discord server error; try again later.');
  });

  it('cancelled rows say so', async () => {
    await bootTopBar();
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'x', status: 'cancelled' }), target({ channelId: '2', label: 'y', status: 'fetching', fetched: 3, ratio: 0.1 })]) }));
    render(<TopBar />);
    expect(Array.from(dialog().querySelectorAll('.topbar-targets__state')).map((node) => node.textContent)).toEqual(['Cancelled', '3 messages · 10%']);
  });

  it('before the first progress snapshot it shows an empty bar', async () => {
    await bootTopBar();
    setJob(makeJob({ progress: null }));
    render(<TopBar />);
    expect(within(dialog()).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(within(dialog()).queryByRole('list')).toBeNull();
    expect(within(dialog()).getByText('0/0 channels · 0 messages')).toBeTruthy();
  });

  it('numbers keep updating as the job progresses', async () => {
    await runningDialog();
    setJob(
      makeJob({
        progress: progress([
          target({ channelId: '1', label: 'Dev Lounge / general', status: 'done', fetched: 1234, ratio: 1 }),
          target({ channelId: '2', label: 'Dev Lounge / help', status: 'done', fetched: 800, ratio: 1 }),
          target({ channelId: '3', label: 'Dev Lounge / random', status: 'fetching', fetched: 10, ratio: 0.05 }),
          target({ channelId: '4', label: 'Dev Lounge / staff', status: 'skipped', ratio: 0 }),
        ]),
      }),
    );
    expect(within(dialog()).getByText('3/4 channels · 2,044 messages')).toBeTruthy();
  });
});

describe('packaging', () => {
  const packagingJob = (): ExportJob =>
    makeJob({
      status: 'packaging',
      progress: progress(
        [target({ channelId: '1', label: 'a', status: 'done', fetched: 5, ratio: 1 }), target({ channelId: '2', label: 'b', status: 'done', fetched: 6, ratio: 1 })],
        { phase: 'packaging', currentIndex: -1 },
      ),
    });

  it('says "Creating ZIP…" with an indeterminate bar', async () => {
    await bootTopBar();
    setJob(packagingJob());
    render(<TopBar />);
    expect(within(dialog()).getByText('Creating ZIP…')).toBeTruthy();
    const bar = within(dialog()).getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.hasAttribute('data-indeterminate')).toBe(true);
    expect(within(dialog()).getByRole('heading', { name: 'Exporting chats…' })).toBeTruthy();
  });

  it('Cancel is disabled and says why: the ZIP can no longer be aborted (PKG-1)', async () => {
    await bootTopBar();
    setJob(packagingJob());
    render(<TopBar />);
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' });
    expect(cancel.getAttribute('aria-disabled')).toBe('true');
    expect(cancel.getAttribute('title')).toBe('The ZIP is already being created and can no longer be cancelled.');
    expect(cancel.hasAttribute('data-blocked')).toBe(true);
    // Hide stays: the dialog can still be put away while the archive is built.
    expect(within(dialog()).getByRole('button', { name: 'Hide' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('a click on the disabled Cancel does nothing', async () => {
    await bootTopBar();
    const cancelExport = vi.fn();
    act(() => appStore.setState({ cancelExport }));
    setJob(packagingJob());
    render(<TopBar />);
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.click(cancel);
    expect(cancelExport).not.toHaveBeenCalled();
    expect(within(dialog()).queryByRole('button', { name: 'Cancelling…' })).toBeNull();
    // It stays focusable (aria-disabled, not disabled): the focus is not thrown to <body>.
    expect(document.activeElement).toBe(cancel);
  });

  it('turns disabled the moment the job reaches packaging, keeping the focus where it was', async () => {
    await bootTopBar();
    const cancelExport = vi.fn();
    act(() => appStore.setState({ cancelExport }));
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0.5 }), target({ channelId: '2', label: 'b', status: 'done', ratio: 1 })]) }));
    render(<TopBar />);
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' });
    expect(cancel.getAttribute('aria-disabled')).toBeNull();
    expect(cancel.hasAttribute('title')).toBe(false);
    cancel.focus();

    setJob(packagingJob());
    expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBe(cancel);
    expect(cancel.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(cancelExport).not.toHaveBeenCalled();
  });

  it('a Cancel that was already pressed keeps saying "Cancelling…" and explains why it can no longer take effect', async () => {
    await bootTopBar();
    act(() => appStore.setState({ cancelExport: vi.fn() }));
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0.5 })]) }));
    render(<TopBar />);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    setJob(packagingJob());
    const busy = within(dialog()).getByRole('button', { name: 'Cancelling…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.getAttribute('title')).toBe('The ZIP is already being created and can no longer be cancelled.');
  });

  it('says it in Korean', async () => {
    await bootTopBar('ko');
    setJob(packagingJob());
    render(<TopBar />);
    expect(within(dialog()).getByRole('button', { name: '취소' }).getAttribute('title')).toBe('ZIP 파일을 만드는 중이라 더 이상 취소할 수 없어요.');
  });

  it('the download button keeps showing progress', async () => {
    await bootTopBar();
    setJob(makeJob({ status: 'packaging', progress: progress([target({ channelId: '1', label: 'a', status: 'done', ratio: 1 }), target({ channelId: '2', label: 'b', status: 'done', ratio: 1 })], { phase: 'packaging' }) }));
    render(<TopBar />);
    expect(screen.getByRole('button', { name: /Exporting/ }).textContent).toBe('Exporting… 2/2');
  });
});

describe('elapsed time', () => {
  it('ticks every second while the job runs (mm:ss) and stops when it ends', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T12:00:00Z') });
    await bootTopBar();
    const intervals = new Set<unknown>();
    const originalSet = globalThis.setInterval;
    const originalClear = globalThis.clearInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = originalSet(handler as () => void, delay, ...args);
      if (delay === 1000) intervals.add(id);
      return id;
    }) as typeof setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: Parameters<typeof clearInterval>[0]) => {
      intervals.delete(id);
      originalClear(id);
    }) as typeof clearInterval);

    setJob(makeJob({ startedAt: Date.now(), progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0 })]) }));
    render(<TopBar />);
    expect(within(dialog()).getByText('00:00 elapsed')).toBeTruthy();
    expect(intervals.size).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(within(dialog()).getByText('00:01 elapsed')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(64_000);
    });
    expect(within(dialog()).getByText('01:05 elapsed')).toBeTruthy();

    setJob(makeJob({ status: 'done', startedAt: Date.now(), output: output(), progress: null }));
    expect(intervals.size).toBe(0);
    expect(dialog().textContent).not.toContain('elapsed');
  });

  it('starts from the real start time when the dialog is opened later', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T12:00:00Z') });
    await bootTopBar();
    setJob(makeJob({ startedAt: Date.now() - (3600 + 61) * 1000, progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0 })]) }));
    render(<TopBar />);
    expect(within(dialog()).getByText('1:01:01 elapsed')).toBeTruthy();
  });

  it('Korean wording', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T12:00:00Z') });
    await bootTopBar('ko');
    setJob(makeJob({ startedAt: Date.now() - 5000, progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0 })]) }));
    render(<TopBar />);
    expect(within(dialog()).getByText('경과 시간 00:05')).toBeTruthy();
  });
});

describe('finished: done', () => {
  const failures = [skipped('9', 'Dev Lounge / staff'), skipped('8', 'Dev Lounge / mod-only'), failed('7', 'Dev Lounge / flaky')];

  async function doneDialog(locale: 'en' | 'ko' = 'en', patch: Partial<ExportJobOutput> = {}): Promise<void> {
    await bootTopBar(locale);
    setJob(makeJob({ status: 'done', output: output({ failures, ...patch }) }));
    render(<TopBar />);
  }

  it('shows the success summary with counts and the saved file name', async () => {
    await doneDialog();
    expect(screen.getByRole('dialog', { name: 'Export complete' })).toBeTruthy();
    expect(within(dialog()).getByText('12 channels, 48,213 messages saved as Discord Export 2026-10-06.zip')).toBeTruthy();
    expect(dialog().getAttribute('aria-busy')).toBe('false');
  });

  it('in Korean', async () => {
    await doneDialog('ko');
    expect(screen.getByRole('dialog', { name: '내보내기 완료' })).toBeTruthy();
    expect(within(dialog()).getByText('채널 12개, 메시지 48,213개를 Discord Export 2026-10-06.zip 파일로 저장했어요')).toBeTruthy();
  });

  it('uses singular forms for one channel and one message', async () => {
    await doneDialog('en', { fileCount: 1, messageCount: 1, filename: 'general.txt', failures: [] });
    expect(within(dialog()).getByText('1 channel, 1 message saved as general.txt')).toBeTruthy();
  });

  it('lists the failures split by kind: skipped (no access) and errors, with reasons', async () => {
    await doneDialog();
    const sections = dialog().querySelectorAll('.topbar-failures');
    expect(sections).toHaveLength(2);
    expect(within(sections[0] as HTMLElement).getByRole('heading').textContent).toBe('Skipped, no access: 2');
    expect(Array.from(sections[0].querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'Dev Lounge / staffNo access to this channel (403).',
      'Dev Lounge / mod-onlyNo access to this channel (403).',
    ]);
    expect(within(sections[1] as HTMLElement).getByRole('heading').textContent).toBe('Failed: 1');
    expect(sections[1].querySelector('li')?.textContent).toBe('Dev Lounge / flakyNetwork error while contacting Discord.');
  });

  it('only shows the sections that have entries', async () => {
    await doneDialog('en', { failures: [skipped('9', 'x')] });
    expect(dialog().querySelectorAll('.topbar-failures')).toHaveLength(1);
    expect(within(dialog()).queryByText(/^Failed:/)).toBeNull();
  });

  it('with nothing exported it says so (and warns instead of celebrating)', async () => {
    await doneDialog('en', { fileCount: 0, messageCount: 0, filename: '', saved: false, failures: [skipped('9', 'x')] });
    expect(within(dialog()).getByText('None of the selected channels could be exported.')).toBeTruthy();
    expect(dialog().querySelector('.topbar-summary')?.getAttribute('data-tone')).toBe('warning');
  });

  it('with nothing exported the title does not say "complete" either (QA-EXP-07), in both languages', async () => {
    const nothing = { fileCount: 0, messageCount: 0, filename: '', saved: false, failures: [skipped('9', 'x')] };
    await doneDialog('en', nothing);
    expect(screen.getByRole('dialog', { name: 'Nothing was exported' })).toBeTruthy();
    expect(screen.queryByText('Export complete')).toBeNull();
    cleanup();

    await doneDialog('ko', nothing);
    expect(screen.getByRole('dialog', { name: '내보낸 채널이 없어요' })).toBeTruthy();
    expect(screen.queryByText('내보내기 완료')).toBeNull();
  });

  it('a run in which some channel failed but one was exported is still "complete"', async () => {
    await doneDialog('en', { fileCount: 1, failures: [failed('7', 'Dev Lounge / flaky')] });
    expect(screen.getByRole('dialog', { name: 'Export complete' })).toBeTruthy();
  });

  it('says how many channels were never reached when the run stopped early (a long rate limit), next to the one failure that explains it', async () => {
    const stopped = 'Discord asked us to wait 12 min - try again later.';
    await bootTopBar();
    setJob(
      makeJob({
        status: 'done',
        output: output({ fileCount: 1, messageCount: 5, filename: 'general.txt', failures: [failed('2', 'Dev Lounge / help')].map((f) => ({ ...f, reason: stopped })) }),
        progress: progress(
          [
            target({ channelId: '1', label: 'Dev Lounge / general', status: 'done', fetched: 5, ratio: 1 }),
            target({ channelId: '2', label: 'Dev Lounge / help', status: 'error', error: stopped }),
            target({ channelId: '3', label: 'Dev Lounge / random', status: 'cancelled', error: stopped }),
            target({ channelId: '4', label: 'Dev Lounge / staff', status: 'cancelled', error: stopped }),
          ],
          { phase: 'finished', currentIndex: -1 },
        ),
      }),
    );
    render(<TopBar />);
    expect(within(dialog()).getByText('1 channel, 5 messages saved as general.txt')).toBeTruthy();
    expect(within(dialog()).getByText('The export stopped early, so 2 more channels were not exported.')).toBeTruthy();
    expect(within(dialog()).getByText(stopped)).toBeTruthy();
  });

  it('the stopped-early note is localised, singular for one channel, and absent for a run that reached every channel', async () => {
    await bootTopBar('ko');
    const job = (statuses: Array<'done' | 'cancelled'>): ExportJob =>
      makeJob({
        status: 'done',
        output: output(),
        progress: progress(statuses.map((status, i) => target({ channelId: String(i), label: `c${i}`, status })), { phase: 'finished', currentIndex: -1 }),
      });
    setJob(job(['done', 'cancelled']));
    render(<TopBar />);
    expect(within(dialog()).getByText('내보내기가 중간에 멈춰서 나머지 채널 1개는 내보내지 못했어요.')).toBeTruthy();

    setJob(job(['done', 'done']));
    expect(within(dialog()).queryByText(/중간에 멈춰서/)).toBeNull();
  });

  it('renders channel names and reasons as plain text', async () => {
    await doneDialog('en', { failures: [failed('1', '<img src=x onerror=alert(1)>')], filename: '<b>x</b>.zip' });
    expect(dialog().querySelector('img, b')).toBeNull();
    expect(dialog().textContent).toContain('<img src=x onerror=alert(1)>');
    expect(dialog().textContent).toContain('<b>x</b>.zip');
  });

  it('has just a Close button, which dismisses the job and gives the focus back to the download button', async () => {
    await doneDialog();
    const buttons = within(dialog()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Close']);
    expect(document.activeElement).toBe(closeButton());

    fireEvent.click(closeButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appStore.getState().exportJob.status).toBe('idle');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Download/ }));
  });

  it('never closes by itself', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T12:00:00Z') });
    await doneDialog();
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(dialog()).toBeTruthy();
    expect(appStore.getState().exportJob.status).toBe('done');
  });

  it('Esc closes a finished dialog', async () => {
    await doneDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appStore.getState().exportJob.status).toBe('idle');
  });

  it('a press on the backdrop does not close it', async () => {
    await doneDialog();
    fireEvent.pointerDown(dialog().parentElement as HTMLElement);
    fireEvent.click(dialog().parentElement as HTMLElement);
    expect(dialog()).toBeTruthy();
  });

  it('the selection stays after a finished export', async () => {
    await bootTopBar();
    select(MOCK_IDS.edge199Channel);
    setJob(makeJob({ status: 'done', output: output() }));
    render(<TopBar />);
    fireEvent.click(closeButton());
    expect(Object.keys(appStore.getState().selection)).toEqual([MOCK_IDS.edge199Channel]);
  });
});

describe('finished: cancelled', () => {
  const pending = (patch: Partial<ExportJobOutput> = {}): ExportJobOutput => output({ cancelled: true, saved: false, fileCount: 2, messageCount: 300, ...patch });

  async function cancelledDialog(patch: Partial<ExportJob> = {}, locale: 'en' | 'ko' = 'en'): Promise<void> {
    await bootTopBar(locale);
    setJob(makeJob({ status: 'cancelled', output: pending(), ...patch }));
    render(<TopBar />);
  }

  it('says "Export cancelled" and offers to save the channels that were completed', async () => {
    await cancelledDialog();
    expect(screen.getByRole('dialog', { name: 'Export cancelled' })).toBeTruthy();
    expect(within(dialog()).getByText('2 channels were finished before you cancelled.')).toBeTruthy();
    expect(within(dialog()).getByText('They have not been saved yet. Closing without saving discards them.')).toBeTruthy();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close', 'Save the 2 completed channels']);
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('in Korean', async () => {
    await cancelledDialog({}, 'ko');
    expect(screen.getByRole('dialog', { name: '내보내기를 취소했어요' })).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: '완료한 채널 2개 저장' })).toBeTruthy();
    expect(within(dialog()).getByText('취소하기 전에 채널 2개를 마쳤어요.')).toBeTruthy();
  });

  it('singular wording for one completed channel', async () => {
    await cancelledDialog({ output: pending({ fileCount: 1, filename: 'general.txt' }) });
    expect(within(dialog()).getByRole('button', { name: 'Save the 1 completed channel' })).toBeTruthy();
    expect(within(dialog()).getByText('1 channel was finished before you cancelled.')).toBeTruthy();
    // "It", not "They" (QA-EXP-06).
    expect(within(dialog()).getByText('It has not been saved yet. Closing without saving discards it.')).toBeTruthy();
    expect(within(dialog()).queryByText(/^They have not/)).toBeNull();
  });

  it('the save button hands the file to the browser once, then the dialog confirms and offers only Close', async () => {
    await cancelledDialog();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toBe('Discord Export 2026-10-06.zip');
    expect(appStore.getState().exportJob.output).toMatchObject({ saved: true });
    expect(within(dialog()).getByText('2 channels saved as Discord Export 2026-10-06.zip.')).toBeTruthy();
    expect(within(dialog()).queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
    // The focus stays in the dialog instead of falling to <body>, on the dialog itself and not on Close: a key that is still down
    // after the press on Save must not press the next button.
    expect(document.activeElement).toBe(dialog());
  });

  it('a failed save stays visible and can be retried', async () => {
    await cancelledDialog();
    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));
    expect(within(dialog()).getByRole('alert').textContent).toBe('The file could not be saved. (disk full)');
    expect(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' })).toBeTruthy();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));
    expect(mocks.saveBlob).toHaveBeenCalledTimes(2);
    expect(within(dialog()).queryByRole('alert')).toBeNull();
  });

  it('Close discards the unsaved channels', async () => {
    await cancelledDialog();
    fireEvent.click(closeButton());
    expect(appStore.getState().exportJob).toMatchObject({ status: 'idle', output: null });
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('Close is the primary choice when there is nothing to save', async () => {
    await cancelledDialog({ output: pending({ fileCount: 0, messageCount: 0, filename: '' }) });
    expect(within(dialog()).getByText('No channel was finished, so there is nothing to save.')).toBeTruthy();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
    expect(closeButton().className).toContain('dce-button--primary');
  });

  it('a cancel without any result (aborted before the first channel) just says nothing was finished', async () => {
    await cancelledDialog({ output: null });
    expect(within(dialog()).getByText('No channel was finished, so there is nothing to save.')).toBeTruthy();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
  });

  it('also lists failures of the channels that were tried', async () => {
    await cancelledDialog({ output: pending({ failures: [skipped('9', 'Dev Lounge / staff')] }) });
    expect(within(dialog()).getByText('Skipped, no access: 1')).toBeTruthy();
  });

  it('Esc closes it like any finished dialog', async () => {
    await cancelledDialog();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an abort that landed while the ZIP was built (every channel completed) is a finished export to save, never "nothing to save" (PKG-1)', async () => {
    await cancelledDialog({
      output: pending({ fileCount: 3, messageCount: 12 }),
      progress: progress(
        [
          target({ channelId: '1', label: 'a', status: 'done', fetched: 3, ratio: 1 }),
          target({ channelId: '2', label: 'b', status: 'done', fetched: 4, ratio: 1 }),
          target({ channelId: '3', label: 'c', status: 'done', fetched: 5, ratio: 1 }),
        ],
        { phase: 'finished', currentIndex: -1 },
      ),
    });
    expect(within(dialog()).queryByText('No channel was finished, so there is nothing to save.')).toBeNull();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close', 'Save the 3 completed channels']);

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 3 completed channels' }));
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(within(dialog()).getByText('3 channels saved as Discord Export 2026-10-06.zip.')).toBeTruthy();
  });

  it('a double click on Save hands the file over once', async () => {
    await cancelledDialog();
    const save = within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });
});

describe('finished: error', () => {
  it('shows the error text and a Close button', async () => {
    await bootTopBar();
    setJob(makeJob({ status: 'error', error: 'Your Discord login has expired or is not valid.' }));
    render(<TopBar />);
    expect(screen.getByRole('dialog', { name: 'Export failed' })).toBeTruthy();
    expect(within(dialog()).getByRole('alert').textContent).toBe('Your Discord login has expired or is not valid.');
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
    fireEvent.click(closeButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appStore.getState().exportJob.status).toBe('idle');
  });

  it('a save error keeps the summary of what was exported', async () => {
    await bootTopBar();
    setJob(makeJob({ status: 'error', error: 'The file could not be saved. (no document)', output: output({ saved: false, failures: [failed('1', 'a / b')] }) }));
    render(<TopBar />);
    expect(within(dialog()).getByRole('alert').textContent).toContain('could not be saved');
    expect(within(dialog()).getByText('Failed: 1')).toBeTruthy();
  });

  it('an error that has no archive (nothing completed) offers no Save', async () => {
    await bootTopBar();
    setJob(makeJob({ status: 'error', error: 'x', output: output({ saved: false, fileCount: 0, messageCount: 0, filename: '' }) }));
    render(<TopBar />);
    expect(screen.getByRole('dialog', { name: 'Export failed' })).toBeTruthy();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
  });

  it('in Korean', async () => {
    await bootTopBar('ko');
    setJob(makeJob({ status: 'error', error: '시작 날짜가 종료 날짜보다 늦습니다.' }));
    render(<TopBar />);
    expect(screen.getByRole('dialog', { name: '내보내지 못했어요' })).toBeTruthy();
  });

  it('an inverted range from the store ends here with the message and nothing was exported', async () => {
    const booted = await bootTopBar();
    select(MOCK_IDS.edge199Channel);
    act(() => {
      appStore.getState().setExportAfter('2026-10-01T00:00:00.000Z');
      appStore.getState().setExportBefore('2026-09-01T00:00:00.000Z');
    });
    render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    expect(within(dialog()).getByRole('alert').textContent).toBe('The start date is later than the end date.');
    expect(mocks.loadExportFormat).not.toHaveBeenCalled();
    expect(booted.spies.getMessages).not.toHaveBeenCalled();
  });
});

describe('finished: the automatic download failed (JOB-1)', () => {
  const unsaved = (patch: Partial<ExportJobOutput> = {}): ExportJobOutput => output({ saved: false, fileCount: 2, messageCount: 300, ...patch });

  async function failedDialog(patch: Partial<ExportJob> = {}, locale: 'en' | 'ko' = 'en'): Promise<void> {
    await bootTopBar(locale);
    setJob(makeJob({ status: 'error', error: locale === 'en' ? 'The file could not be saved. (disk full)' : '파일을 저장하지 못했습니다. (disk full)', output: unsaved(), ...patch }));
    render(<TopBar />);
  }

  it('says that only the download failed, keeps the summary and offers to save the completed channels', async () => {
    await failedDialog({ output: unsaved({ failures: [skipped('9', 'Dev Lounge / staff')] }) });
    expect(screen.getByRole('dialog', { name: 'Could not save the file' })).toBeTruthy();
    expect(within(dialog()).getByRole('alert').textContent).toBe('The file could not be saved. (disk full)');
    expect(within(dialog()).getByText('2 channels were exported.')).toBeTruthy();
    expect(within(dialog()).getByText('They have not been saved yet. Closing without saving discards them.')).toBeTruthy();
    expect(within(dialog()).getByText('Skipped, no access: 1')).toBeTruthy();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close', 'Save the 2 completed channels']);
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('in Korean', async () => {
    await failedDialog({}, 'ko');
    expect(screen.getByRole('dialog', { name: '파일을 저장하지 못했어요' })).toBeTruthy();
    expect(within(dialog()).getByText('채널 2개를 내보냈어요.')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: '완료한 채널 2개 저장' })).toBeTruthy();
  });

  it('singular wording for one completed channel', async () => {
    await failedDialog({ output: unsaved({ fileCount: 1, filename: 'general.txt' }) });
    expect(within(dialog()).getByText('1 channel was exported.')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Save the 1 completed channel' })).toBeTruthy();
    expect(within(dialog()).getByText('It has not been saved yet. Closing without saving discards it.')).toBeTruthy();
  });

  it('Save hands the archive over, and the dialog turns into the normal success summary', async () => {
    await failedDialog();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toBe('Discord Export 2026-10-06.zip');
    expect(appStore.getState().exportJob).toMatchObject({ status: 'done', error: null, output: { saved: true } });
    expect(screen.getByRole('dialog', { name: 'Export complete' })).toBeTruthy();
    expect(within(dialog()).getByText('2 channels, 300 messages saved as Discord Export 2026-10-06.zip')).toBeTruthy();
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
    expect(document.activeElement).toBe(dialog());
  });

  it('a failing retry shows the new message, keeps the button and the archive, and the next try works', async () => {
    await failedDialog();
    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('still full');
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));
    expect(within(dialog()).getByRole('alert').textContent).toBe('The file could not be saved. (still full)');
    expect(screen.getByRole('dialog', { name: 'Could not save the file' })).toBeTruthy();
    expect(appStore.getState().exportJob.output?.blob.size).toBeGreaterThan(0);

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' }));
    expect(mocks.saveBlob).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog', { name: 'Export complete' })).toBeTruthy();
  });

  it('a double click on Save hands the file over once', async () => {
    await failedDialog();
    const save = within(dialog()).getByRole('button', { name: 'Save the 2 completed channels' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('Close discards the archive', async () => {
    await failedDialog();
    fireEvent.click(closeButton());
    expect(appStore.getState().exportJob).toMatchObject({ status: 'idle', output: null });
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('an expired run whose download failed shows the expiry next to the save failure and keeps saying so after the retry', async () => {
    await failedDialog({
      error: 'Your Discord session expired, so the export was stopped. The file could not be saved. (disk full)',
      output: unsaved({ authExpired: true, fileCount: 1, filename: 'general.txt' }),
    });
    expect(within(dialog()).getByRole('alert').textContent).toContain('session expired');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save the 1 completed channel' }));
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(appStore.getState().exportJob.status).toBe('error');
    expect(within(dialog()).getByRole('alert').textContent).toBe('Your Discord session expired, so the export was stopped. The 1 completed channel was saved.');
    expect(within(dialog()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);
  });
});

describe('Cancel', () => {
  async function running(): Promise<ReturnType<typeof vi.fn>> {
    await bootTopBar();
    const cancelExport = vi.fn();
    act(() => appStore.setState({ cancelExport }));
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0 })]) }));
    render(<TopBar />);
    return cancelExport;
  }

  it('asks the store to cancel, once, and shows that it is cancelling', async () => {
    const cancelExport = await running();
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' });
    expect(cancel.className).toContain('dce-button--danger');
    cancel.focus();
    fireEvent.click(cancel);
    expect(cancelExport).toHaveBeenCalledTimes(1);

    const busy = within(dialog()).getByRole('button', { name: 'Cancelling…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(busy);
    expect(cancelExport).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(busy);
  });

  it('is only there while the job runs', async () => {
    await bootTopBar();
    setJob(makeJob({ status: 'done', output: output() }));
    render(<TopBar />);
    expect(within(dialog()).queryByRole('button', { name: /Cancel/ })).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: 'Hide' })).toBeNull();
  });
});

describe('Enter on Cancel, held down or pressed again (QA-EXP-02)', () => {
  /** What the browser does with Enter on a focused button: `keydown`, then (unless that was cancelled) a click on it, for the repeats of a held key too. */
  function pressEnter(repeat = false): void {
    const key = document.activeElement ?? document.body;
    const proceed = fireEvent.keyDown(key, { key: 'Enter', repeat });
    if (proceed && key instanceof HTMLButtonElement && !key.disabled) fireEvent.click(key);
  }

  const download = (): HTMLElement => screen.getByRole('button', { name: /^Download|^Exporting/ });

  async function spies(): Promise<{ startExport: ReturnType<typeof vi.fn>; saveExportOutput: ReturnType<typeof vi.fn>; cancelExport: ReturnType<typeof vi.fn> }> {
    await bootTopBar();
    select(MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel);
    const startExport = vi.fn(async () => undefined);
    const saveExportOutput = vi.fn();
    // Cancelling ends the run at once, with six completed channels waiting for "Save".
    const cancelExport = vi.fn(() => setJob(makeJob({ status: 'cancelled', output: output({ cancelled: true, saved: false, fileCount: 6, messageCount: 900 }) })));
    act(() => appStore.setState({ startExport, saveExportOutput, cancelExport }));
    return { startExport, saveExportOutput, cancelExport };
  }

  it('cancels once; the Enter that follows (a held key, or a second press) presses nothing: not Save, not Close, not Download', async () => {
    const { startExport, saveExportOutput, cancelExport } = await spies();
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'a', status: 'done', fetched: 1, ratio: 1 }), target({ channelId: '2', label: 'b', status: 'fetching', ratio: 0.5 })]) }));
    render(<TopBar />);
    within(dialog()).getByRole('button', { name: 'Cancel' }).focus();

    pressEnter();
    expect(cancelExport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Export cancelled' })).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Save the 6 completed channels' })).toBeTruthy();
    expect(document.activeElement).toBe(dialog());

    pressEnter(true);
    pressEnter(true);
    pressEnter();
    expect(saveExportOutput).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Export cancelled' })).toBeTruthy();
    expect(startExport).not.toHaveBeenCalled();
    expect(cancelExport).toHaveBeenCalledTimes(1);
  });

  it('a dialog that opens already finished still starts on its main action (only a button that disappears under the focus hands it to the dialog)', async () => {
    await spies();
    setJob(makeJob({ status: 'cancelled', output: output({ cancelled: true, saved: false, fileCount: 6 }) }));
    render(<TopBar />);
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Save the 6 completed channels' }));
  });

  it('the buttons of the finished dialog are new buttons, not the running ones relabelled (the focus would stay on the relabelled Cancel)', async () => {
    await bootTopBar();
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0.5 })]) }));
    render(<TopBar />);
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' });
    cancel.focus();

    setJob(makeJob({ status: 'cancelled', output: output({ cancelled: true, saved: false, fileCount: 2 }) }));
    const buttons = within(dialog()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Close', 'Save the 2 completed channels']);
    expect(buttons).not.toContain(cancel);
    expect(cancel.isConnected).toBe(false);
  });

  it('a key held down on Close does not start a new export through the Download button that gets the focus back', async () => {
    const { startExport } = await spies();
    setJob(makeJob({ status: 'done', output: output({ fileCount: 6 }) }));
    render(<TopBar />);
    expect(document.activeElement).toBe(closeButton());

    pressEnter();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(download());
    pressEnter(true);
    pressEnter(true);
    expect(startExport).not.toHaveBeenCalled();

    // A new press is a new decision.
    pressEnter();
    expect(startExport).toHaveBeenCalledTimes(1);
  });

  it('the buttons of the dialog press once per key press as well: a repeat on Close does not close, one on Cancel does not cancel', async () => {
    const { cancelExport } = await spies();
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0.5 })]) }));
    render(<TopBar />);
    for (const name of ['Hide', 'Cancel']) {
      const button = within(dialog()).getByRole('button', { name });
      button.focus();
      expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true }), name).toBe(false);
    }
    expect(cancelExport).not.toHaveBeenCalled();

    setJob(makeJob({ status: 'done', output: output({ fileCount: 6 }) }));
    expect(fireEvent.keyDown(closeButton(), { key: 'Enter', repeat: true })).toBe(false);
    expect(fireEvent.keyDown(closeButton(), { key: 'Tab', repeat: true })).toBe(true);
  });

  it('the Download button ignores only the repeats of Enter and Space, never Tab', async () => {
    await spies();
    render(<TopBar />);
    const caret = screen.getByRole('button', { name: 'Export options' });
    for (const button of [download(), caret]) {
      button.focus();
      expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false);
      expect(fireEvent.keyDown(button, { key: ' ', repeat: true })).toBe(false);
      expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
      expect(fireEvent.keyDown(button, { key: 'Tab', repeat: true })).toBe(true);
    }
  });
});

describe('Hide and reopen', () => {
  async function running(): Promise<void> {
    await bootTopBar();
    select(MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel);
    setJob(
      makeJob({
        progress: progress([target({ channelId: '1', label: 'a', status: 'done', fetched: 1, ratio: 1 }), target({ channelId: '2', label: 'b', status: 'fetching', fetched: 1, ratio: 0.5 })]),
      }),
    );
    render(<TopBar />);
  }

  it('Hide closes the dialog but not the job; the download button shows the progress and brings the dialog back', async () => {
    await running();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appStore.getState().exportJob.status).toBe('running');

    const button = screen.getByRole('button', { name: /Exporting/ });
    expect(button.textContent).toBe('Exporting… 1/2');
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Exporting chats…' })).toBeTruthy();
    expect(appStore.getState().exportJob.status).toBe('running');
  });

  it('the button readout follows the progress while the dialog is hidden', async () => {
    await running();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Hide' }));
    setJob(
      makeJob({
        progress: progress([target({ channelId: '1', label: 'a', status: 'done', fetched: 1, ratio: 1 }), target({ channelId: '2', label: 'b', status: 'done', fetched: 9, ratio: 1 })]),
      }),
    );
    expect(screen.getByRole('button', { name: /Exporting/ }).textContent).toBe('Exporting… 2/2');
  });

  it('a job that finishes while hidden brings the result back (it must be seen)', async () => {
    await running();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    setJob(makeJob({ status: 'done', output: output({ failures: [skipped('9', 'x')] }) }));
    expect(screen.getByRole('dialog', { name: 'Export complete' })).toBeTruthy();
    expect(within(dialog()).getByText('Skipped, no access: 1')).toBeTruthy();
  });

  it('the next job starts with its dialog open even after one was hidden before', async () => {
    await running();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Hide' }));
    setJob(makeJob({ status: 'done', output: output() }));
    fireEvent.click(closeButton());
    expect(screen.queryByRole('dialog')).toBeNull();

    mocks.loadExportFormat.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    expect(screen.getByRole('dialog', { name: 'Exporting chats…' })).toBeTruthy();
  });

  it('Esc does nothing to a running dialog', async () => {
    await running();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(dialog()).toBeTruthy();
    expect(appStore.getState().exportJob.status).toBe('running');
  });

  it('while hidden, progress updates do not re-render the top bar beyond the button readout', async () => {
    await bootTopBar();
    select(MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel);
    const targets = (fetched: number) => [target({ channelId: '1', label: 'a', status: 'done', fetched: 1, ratio: 1 }), target({ channelId: '2', label: 'b', status: 'fetching', fetched, ratio: 0.5 })];
    setJob(makeJob({ progress: progress(targets(1)) }));
    const onRender = vi.fn();
    render(
      <Profiler id="topbar" onRender={onRender}>
        <TopBar />
      </Profiler>,
    );
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Hide' }));
    onRender.mockClear();

    for (let fetched = 2; fetched < 30; fetched += 1) setJob(makeJob({ startedAt: appStore.getState().exportJob.startedAt, progress: progress(targets(fetched)) }));
    expect(onRender).not.toHaveBeenCalled();
  });
});

describe('focus handling', () => {
  async function running(): Promise<void> {
    await bootTopBar();
    setJob(makeJob({ progress: progress([target({ channelId: '1', label: 'a', status: 'fetching', ratio: 0 })]) }));
    render(<TopBar />);
  }

  it('moves the focus into the dialog (to Hide) when it opens', async () => {
    await running();
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Hide' }));
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    await running();
    const hide = within(dialog()).getByRole('button', { name: 'Hide' });
    const cancel = within(dialog()).getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(hide);
    fireEvent.keyDown(hide, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('pulls focus that wandered outside (a click on the backdrop) back in on the next Tab', async () => {
    await running();
    const outside = screen.getByRole('button', { name: /Exporting/ });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it('moves the focus to the dialog itself, not to a button, when the focused button disappears because the job finished', async () => {
    await running();
    within(dialog()).getByRole('button', { name: 'Cancel' }).focus();
    setJob(makeJob({ status: 'done', output: output() }));
    expect(document.activeElement).toBe(dialog());
    expect(within(dialog()).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('gives the focus back to the download button when the dialog is hidden or closed', async () => {
    await running();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Hide' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Exporting/ }));
  });

  it('exposes the dialog title as its accessible name and keeps the page behind it out of the dialog', async () => {
    await running();
    const panel = dialog();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(panel.tabIndex).toBe(-1);
    expect(panel.closest('header.app-topbar')).toBeNull();
  });
});
