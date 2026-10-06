import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS } from '@/app/platform/types';
import { common } from '@/app/i18n/common';
import { selectUnsavedFileCount } from '@/app/state/selectors';
import { createAppStore } from '@/app/state/store';
import { stateStrings } from '@/app/state/strings';
import type { ExportJobStatus } from '@/app/state/types';
import { DiscordApiError } from '@/lib/discord/client';
import { MOCK_IDS, createMockClient } from '@/lib/discord/mock';
import type { ExportFormat, ExportFormatId, ExportOptions, ExportTarget } from '@/lib/export/types';
import { TOKEN, bootDemo, createFakePlatform, createSpiedClient } from '../helpers';

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  loadExportFormat: vi.fn<(id: ExportFormatId) => Promise<ExportFormat>>(),
}));

vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: mocks.loadExportFormat }));

interface WriterLog {
  options: ExportOptions[];
  targets: ExportTarget[];
  /** What the writer could resolve while it wrote (the runner reuses one resolver and re-points it per target). */
  mentionNames: Array<{ channel: string | undefined; role: string | undefined }>;
  onCreate?: (index: number) => void;
}

/** A plain-text format: a header line, then one line per message id. */
function recordingFormat(log: WriterLog, id: ExportFormatId = 'txt'): ExportFormat {
  return {
    id,
    label: id.toUpperCase(),
    extension: id,
    mime: 'text/plain',
    createWriter(ctx) {
      log.options.push(ctx.options);
      log.targets.push(ctx.target);
      log.mentionNames.push({ channel: ctx.names.channel(MOCK_IDS.edge400Channel), role: ctx.names.role(MOCK_IDS.roles.admin) });
      log.onCreate?.(log.targets.length);
      return {
        start: () => [`# ${ctx.target.channelName}\n`],
        write: (batch) => batch.map((message) => `${message.id}\n`),
        end: () => [],
      };
    },
  };
}

function newLog(): WriterLog {
  return { options: [], targets: [], mentionNames: [] };
}

async function readBlob(blob: Blob): Promise<string> {
  return blob.text();
}

type Booted = Awaited<ReturnType<typeof bootDemo>>;

/** Boots the demo with the given channels of the main server ticked (format 'txt' unless told otherwise). */
async function bootWithSelection(channelIds: string[], format: ExportFormatId | null = 'txt'): Promise<Booted> {
  const booted = await bootDemo();
  if (format !== null) booted.store.getState().setPrefs({ exportFormat: format });
  await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
  for (const id of channelIds) booted.store.getState().toggleChannel(id);
  return booted;
}

/** Statuses the export job went through (consecutive duplicates collapsed). */
function recordStatuses(booted: Booted): ExportJobStatus[] {
  const seen: ExportJobStatus[] = [booted.store.getState().exportJob.status];
  booted.store.subscribe((state) => {
    if (seen[seen.length - 1] !== state.exportJob.status) seen.push(state.exportJob.status);
  });
  return seen;
}

let log: WriterLog;

beforeEach(() => {
  mocks.saveBlob.mockReset();
  mocks.loadExportFormat.mockReset();
  log = newLog();
  mocks.loadExportFormat.mockImplementation(async (id) => recordingFormat(log, id));
});

describe('startExport', () => {
  it('exports one channel as a single file and saves it', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const statuses = recordStatuses(booted);
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = mocks.saveBlob.mock.calls[0];
    expect(filename).toMatch(/ - edge-199\.txt$/);
    const text = await readBlob(blob);
    expect(text.startsWith('# edge-199\n')).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(1 + 199);

    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('done');
    expect(job.error).toBeNull();
    expect(job.startedAt).toBeGreaterThan(0);
    expect(job.output).toMatchObject({
      fileCount: 1,
      messageCount: 199,
      cancelled: false,
      saved: true,
      failures: [],
      filename: expect.stringMatching(/ - edge-199\.txt$/),
    });
    expect(job.progress?.phase).toBe('finished');
    expect(job.progress?.targets[0]).toMatchObject({ channelId: MOCK_IDS.edge199Channel, status: 'done', fetched: 199 });
    expect(statuses).toEqual(['idle', 'running', 'done']);
  });

  it('keeps the selection after exporting', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    await booted.store.getState().startExport();
    expect(Object.keys(booted.store.getState().selection)).toEqual([MOCK_IDS.edge199Channel]);
  });

  it('releases the archive from memory once it was handed to the browser', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    await booted.store.getState().startExport();
    expect(mocks.saveBlob.mock.calls[0][0].size).toBeGreaterThan(0);
    expect(booted.store.getState().exportJob.output?.blob.size).toBe(0);
  });

  it('several channels become one ZIP, and the job passes through "packaging"', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.emptyChannel, MOCK_IDS.dmFriendEnglish]);
    const statuses = recordStatuses(booted);
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = mocks.saveBlob.mock.calls[0];
    expect(filename).toMatch(/\.zip$/);
    expect(blob.size).toBeGreaterThan(0);
    expect(booted.store.getState().exportJob.output).toMatchObject({ fileCount: 3, cancelled: false });
    expect(statuses).toEqual(['idle', 'running', 'packaging', 'done']);
    // Targets are exported in display order: servers first, DMs last.
    expect(log.targets.map((t) => t.channelId)).toEqual([MOCK_IDS.edge199Channel, MOCK_IDS.emptyChannel, MOCK_IDS.dmFriendEnglish]);
  });

  it('tracks per-channel progress while running', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    const snapshots: Array<{ status: string; current: number | undefined }> = [];
    booted.store.subscribe((state) => {
      snapshots.push({ status: state.exportJob.status, current: state.exportJob.progress?.currentIndex });
    });
    await booted.store.getState().startExport();
    expect(snapshots.some((s) => s.status === 'running' && s.current === 0)).toBe(true);
    expect(snapshots.some((s) => s.status === 'running' && s.current === 1)).toBe(true);
    expect(booted.store.getState().exportJob.progress?.totalMessages).toBe(399);
  });

  it('does NOT save when nothing was completed: no access to the only channel', async () => {
    const booted = await bootWithSelection([MOCK_IDS.forbiddenChannel]);
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).not.toHaveBeenCalled();
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('done');
    expect(job.output).toMatchObject({ fileCount: 0, messageCount: 0, filename: '', saved: false });
    expect(job.output?.failures).toHaveLength(1);
    expect(job.output?.failures[0]).toMatchObject({ channelId: MOCK_IDS.forbiddenChannel, kind: 'skipped' });
  });

  it('saves what worked and lists the failures when some channels are skipped', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.forbiddenChannel]);
    await booted.store.getState().startExport();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toMatch(/ - edge-199\.txt$/);
    expect(booted.store.getState().exportJob.output).toMatchObject({ fileCount: 1 });
    expect(booted.store.getState().exportJob.output?.failures.map((f) => f.channelId)).toEqual([MOCK_IDS.forbiddenChannel]);
  });

  it('builds the options from prefs, locale and range', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setPrefs({ exportFormat: 'md', htmlTheme: 'light', locale: 'en' });
    booted.store.getState().setExportAfter('2026-09-01T00:00:00.000Z');
    booted.store.getState().setExportBefore('2026-09-30T23:59:59.000Z');
    await booted.store.getState().startExport();

    expect(mocks.loadExportFormat).toHaveBeenCalledWith('md');
    expect(log.options).toEqual([
      {
        format: 'md',
        after: '2026-09-01T00:00:00.000Z',
        before: '2026-09-30T23:59:59.000Z',
        limit: null,
        htmlTheme: 'light',
        locale: 'en',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ]);
    expect(mocks.saveBlob.mock.calls[0][1]).toMatch(/ - edge-199\.md$/);
  });

  it('the default options match the default prefs', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel], null);
    await booted.store.getState().startExport();
    expect(log.options[0]).toMatchObject({
      format: DEFAULT_PREFS.exportFormat,
      htmlTheme: DEFAULT_PREFS.htmlTheme,
      after: null,
      before: null,
      limit: null,
    });
    expect(['ko', 'en']).toContain(log.options[0].locale);
  });

  it('a date range limits what is exported', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel]);
    const all = await booted.client.getMessages(MOCK_IDS.edge400Channel, { limit: 100 });
    // Everything strictly after the 20th-newest message's time, i.e. a window that cuts the history.
    const cutoff = all[19].timestamp;
    booted.store.getState().setExportAfter(cutoff);
    await booted.store.getState().startExport();
    const output = booted.store.getState().exportJob.output;
    expect(output?.messageCount).toBeGreaterThanOrEqual(20);
    expect(output?.messageCount).toBeLessThan(400);
  });

  it('gives mention names of the exported server to the writers, and none for DMs', async () => {
    const booted = await bootWithSelection([MOCK_IDS.generalChannel, MOCK_IDS.dmFriend]);
    await booted.store.getState().startExport();
    expect(log.mentionNames[0]).toEqual({ channel: 'edge-400', role: 'Admin' });
    expect(log.mentionNames[1].role).toBeUndefined();
  });

  it('does nothing without a selection', async () => {
    const booted = await bootDemo();
    await booted.store.getState().startExport();
    expect(mocks.loadExportFormat).not.toHaveBeenCalled();
    expect(booted.store.getState().exportJob.status).toBe('idle');
  });

  it('runs one job at a time', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const first = booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('running');
    const second = booted.store.getState().startExport();
    await Promise.all([first, second]);
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(log.targets).toHaveLength(1);
  });

  it('rejects an inverted date range with a message and does not run', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setPrefs({ locale: 'en' });
    booted.store.getState().setExportAfter('2026-10-01T00:00:00.000Z');
    booted.store.getState().setExportBefore('2026-09-01T00:00:00.000Z');
    await booted.store.getState().startExport();

    expect(mocks.loadExportFormat).not.toHaveBeenCalled();
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'error', error: common.en.invalidRange });
  });

  it('an unparsable date ends in a readable error instead of a crash', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    // The message is localised; the assertion below is about the English one whatever the browser language is.
    booted.store.getState().setPrefs({ locale: 'en' });
    booted.store.getState().setExportAfter('not a date');
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('error');
    expect(booted.store.getState().exportJob.error).toContain('Invalid export range');
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('a format that cannot be loaded is an error', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    mocks.loadExportFormat.mockRejectedValueOnce(new Error('chunk failed to load'));
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('error');
    expect(booted.store.getState().exportJob.error).toContain('chunk failed to load');
  });

  it('a download that cannot be started is an error, with the summary kept', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setPrefs({ locale: 'en' });
    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('no document');
    });
    await booted.store.getState().startExport();
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('error');
    expect(job.error).toBe(`${common.en.saveFailed} (no document)`);
    expect(job.output).toMatchObject({ fileCount: 1, messageCount: 199, saved: false });
    // The finished export is not thrown away with the failed download (JOB-1).
    expect(job.output?.blob.size).toBeGreaterThan(0);
  });
});

describe('a download that fails keeps the finished export (JOB-1)', () => {
  const diskFull = (): void => {
    throw new Error('disk full');
  };

  async function failedSave(channelIds: string[] = [MOCK_IDS.edge199Channel]): Promise<Booted> {
    const booted = await bootWithSelection(channelIds);
    booted.store.getState().setPrefs({ locale: 'en' });
    mocks.saveBlob.mockImplementationOnce(diskFull);
    await booted.store.getState().startExport();
    return booted;
  }

  it('keeps the archive and the localised message; Save retries it and releases the archive once it went through', async () => {
    const booted = await failedSave();
    let job = booted.store.getState().exportJob;
    expect(job.status).toBe('error');
    expect(job.error).toBe(`${common.en.saveFailed} (disk full)`);
    expect(job.output).toMatchObject({ fileCount: 1, messageCount: 199, saved: false, cancelled: false });
    expect(job.output?.blob.size).toBeGreaterThan(0);
    expect(selectUnsavedFileCount(booted.store.getState())).toBe(1);

    booted.store.getState().saveExportOutput();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(2);
    // The retry hands over the very archive that failed the first time.
    expect(mocks.saveBlob.mock.calls[1][0]).toBe(mocks.saveBlob.mock.calls[0][0]);
    expect((await readBlob(mocks.saveBlob.mock.calls[1][0])).startsWith('# edge-199\n')).toBe(true);
    job = booted.store.getState().exportJob;
    expect(job).toMatchObject({ status: 'done', error: null, output: { fileCount: 1, saved: true } });
    expect(job.output?.blob.size).toBe(0);
    expect(selectUnsavedFileCount(booted.store.getState())).toBe(0);
  });

  it('the message is localised', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setPrefs({ locale: 'ko' });
    mocks.saveBlob.mockImplementationOnce(diskFull);
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.error).toBe(`${common.ko.saveFailed} (disk full)`);
  });

  it('a retry that fails again keeps the archive for the next one', async () => {
    const booted = await failedSave();
    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('still full');
    });
    booted.store.getState().saveExportOutput();

    let job = booted.store.getState().exportJob;
    expect(job).toMatchObject({ status: 'error', error: `${common.en.saveFailed} (still full)`, output: { saved: false } });
    expect(job.output?.blob.size).toBeGreaterThan(0);

    booted.store.getState().saveExportOutput();
    job = booted.store.getState().exportJob;
    expect(mocks.saveBlob).toHaveBeenCalledTimes(3);
    expect(job).toMatchObject({ status: 'done', error: null, output: { saved: true } });
    expect(job.output?.blob.size).toBe(0);
  });

  it('a double click on Save hands the file over once', async () => {
    const booted = await failedSave([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    booted.store.getState().saveExportOutput();
    booted.store.getState().saveExportOutput();
    // 1 failed automatic attempt + exactly 1 successful retry.
    expect(mocks.saveBlob).toHaveBeenCalledTimes(2);
    expect(mocks.saveBlob.mock.calls[1][1]).toMatch(/\.zip$/);
  });

  it('saving a cancelled run twice in a row hands the file over once as well', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.edge201Channel]);
    log.onCreate = (count) => {
      if (count === 2) booted.store.getState().cancelExport();
    };
    await booted.store.getState().startExport();
    booted.store.getState().saveExportOutput();
    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('a failed export that was dismissed is gone: nothing is saved afterwards', async () => {
    const failed = await failedSave();
    failed.store.getState().dismissExportJob();
    expect(failed.store.getState().exportJob).toMatchObject({ status: 'idle', output: null });
    failed.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('a finished export that was saved cannot be saved a second time', async () => {
    const saved = await bootWithSelection([MOCK_IDS.edge199Channel]);
    await saved.store.getState().startExport();
    saved.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('only an error that holds an archive can be saved: failures without a result are left alone', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setExportAfter('not a date');
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('error');
    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    expect(booted.store.getState().exportJob.status).toBe('error');
  });

  it('a run that completed nothing has no archive to retry', async () => {
    const booted = await bootWithSelection([MOCK_IDS.forbiddenChannel]);
    await booted.store.getState().startExport();
    expect(selectUnsavedFileCount(booted.store.getState())).toBe(0);
    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });
});

describe('a long rate limit during an export (RATE-1)', () => {
  it('ends as a normal run: what was completed is saved, the limit is listed as the one failure', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.edge201Channel]);
    booted.store.getState().setPrefs({ locale: 'en' });
    const healthy = createMockClient({ latencyMs: 0 });
    booted.spies.getMessages.mockImplementation(async (channelId, options, signal) => {
      if (channelId === MOCK_IDS.edge200Channel) throw new DiscordApiError('rate-limited', 'banned', { status: 429, retryAfterMs: 20 * 60_000 });
      return healthy.getMessages(channelId, options, signal);
    });
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toMatch(/ - edge-199\.txt$/);
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('done');
    expect(job.output).toMatchObject({ fileCount: 1, saved: true, cancelled: false });
    expect(job.output?.failures).toHaveLength(1);
    expect(job.output?.failures[0]).toMatchObject({
      channelId: MOCK_IDS.edge200Channel,
      kind: 'error',
      reason: 'Discord asked us to wait 20 min - try again later.',
    });
    expect(job.progress?.targets.map((t) => t.status)).toEqual(['done', 'error', 'cancelled']);
    // The session is fine: this is not a login problem.
    expect(booted.store.getState().status).toBe('ready');
  });
});

describe('an abort while the ZIP is being built (PKG-1)', () => {
  it('still delivers the finished archive: the job is "cancelled" with every channel completed and Save works', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.edge201Channel]);
    booted.store.subscribe((state) => {
      if (state.exportJob.status === 'packaging') booted.store.getState().cancelExport();
    });
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).not.toHaveBeenCalled();
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('cancelled');
    expect(job.output).toMatchObject({ fileCount: 3, cancelled: true, saved: false, filename: expect.stringMatching(/\.zip$/) });
    expect(job.output?.blob.size).toBeGreaterThan(0);
    expect(job.progress?.targets.map((t) => t.status)).toEqual(['done', 'done', 'done']);
    expect(selectUnsavedFileCount(booted.store.getState())).toBe(3);

    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toMatch(/\.zip$/);
    expect(booted.store.getState().exportJob.output).toMatchObject({ saved: true, fileCount: 3 });
  });
});

describe('cancelExport', () => {
  it('cancelling before anything finished saves nothing', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel, MOCK_IDS.edge200Channel]);
    const running = booted.store.getState().startExport();
    booted.store.getState().cancelExport();
    await running;

    expect(mocks.saveBlob).not.toHaveBeenCalled();
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('cancelled');
    expect(job.output).toMatchObject({ fileCount: 0, cancelled: true });
    expect(job.progress?.targets.every((t) => t.status === 'cancelled')).toBe(true);
  });

  /** Cancels while the second of three channels starts: one channel is done, two are cancelled. */
  async function cancelAfterFirstChannel(): Promise<Booted> {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.edge201Channel]);
    log.onCreate = (count) => {
      if (count === 2) booted.store.getState().cancelExport();
    };
    await booted.store.getState().startExport();
    return booted;
  }

  it('cancelling later does NOT download anything by itself: the completed channels wait to be saved', async () => {
    const booted = await cancelAfterFirstChannel();

    expect(mocks.saveBlob).not.toHaveBeenCalled();
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('cancelled');
    expect(job.error).toBeNull();
    expect(job.output).toMatchObject({ fileCount: 1, cancelled: true, saved: false, filename: expect.stringMatching(/ - edge-199\.txt$/) });
    expect(job.output?.blob.size).toBeGreaterThan(0);
    expect(job.progress?.targets.map((t) => t.status)).toEqual(['done', 'cancelled', 'cancelled']);
  });

  it('saveExportOutput hands the completed channels of a cancelled run to the browser, once, and releases the archive', async () => {
    const booted = await cancelAfterFirstChannel();
    booted.store.getState().saveExportOutput();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = mocks.saveBlob.mock.calls[0];
    expect(filename).toMatch(/ - edge-199\.txt$/);
    expect((await readBlob(blob)).startsWith('# edge-199\n')).toBe(true);
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('cancelled');
    expect(job.output).toMatchObject({ fileCount: 1, cancelled: true, saved: true });
    expect(job.output?.blob.size).toBe(0);

    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('a failed save of the completed channels keeps them and reports the error; retrying works', async () => {
    const booted = await cancelAfterFirstChannel();
    booted.store.getState().setPrefs({ locale: 'en' });
    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    booted.store.getState().saveExportOutput();

    let job = booted.store.getState().exportJob;
    expect(job.status).toBe('cancelled');
    expect(job.error).toBe(`${common.en.saveFailed} (disk full)`);
    expect(job.output).toMatchObject({ saved: false });
    expect(job.output?.blob.size).toBeGreaterThan(0);

    booted.store.getState().saveExportOutput();
    job = booted.store.getState().exportJob;
    expect(mocks.saveBlob).toHaveBeenCalledTimes(2);
    expect(job.error).toBeNull();
    expect(job.output).toMatchObject({ saved: true });
  });

  it('saveExportOutput does nothing when there is nothing to save', async () => {
    const idle = await bootDemo();
    idle.store.getState().saveExportOutput();
    expect(mocks.saveBlob).not.toHaveBeenCalled();

    // Cancelled before the first channel finished: no file.
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel, MOCK_IDS.edge200Channel]);
    const running = booted.store.getState().startExport();
    booted.store.getState().saveExportOutput();
    booted.store.getState().cancelExport();
    await running;
    booted.store.getState().saveExportOutput();
    expect(booted.store.getState().exportJob.output).toMatchObject({ fileCount: 0, saved: false });

    // A finished run was saved automatically and must not be saved a second time.
    const done = await bootWithSelection([MOCK_IDS.edge199Channel]);
    await done.store.getState().startExport();
    done.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('dismissing a cancelled run drops the unsaved channels', async () => {
    const booted = await cancelAfterFirstChannel();
    booted.store.getState().dismissExportJob();
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'idle', output: null });
    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('is harmless when nothing is running', async () => {
    const booted = await bootDemo();
    booted.store.getState().cancelExport();
    expect(booted.store.getState().exportJob.status).toBe('idle');
  });

  it('a new export can start after a cancelled one', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const first = booted.store.getState().startExport();
    booted.store.getState().cancelExport();
    await first;
    expect(booted.store.getState().exportJob.status).toBe('cancelled');
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('done');
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });
});

describe('authentication during an export', () => {
  const unauthorized = (): DiscordApiError => new DiscordApiError('auth', 'Unauthorized', { status: 401 });

  /** getMessages answers 401 for `failing` and the normal fixture data for every other channel. */
  function failChannel(booted: Booted, failing: string, beforeFailing: () => void = () => undefined): void {
    const healthy = createMockClient({ latencyMs: 0 });
    booted.spies.getMessages.mockImplementation(async (channelId, options, signal) => {
      if (channelId !== failing) return healthy.getMessages(channelId, options, signal);
      beforeFailing();
      throw unauthorized();
    });
  }

  /** The live path: the client reports a rejected login (onAuthError) BEFORE the request fails, like LiveDiscordClient does. */
  async function bootLiveWithSelection(channelIds: string[]): Promise<Booted & { rejectLogin: () => void }> {
    const spied = createSpiedClient();
    const platform = createFakePlatform({ token: TOKEN, prefs: { ...DEFAULT_PREFS, exportFormat: 'txt', locale: 'en' } });
    let reject: (token: string) => void = () => undefined;
    const store = createAppStore({
      getPlatform: () => platform,
      isMockRequested: () => false,
      createLiveClient: (options) => {
        reject = (token) => options.onAuthError?.(token);
        return spied.client;
      },
    });
    await store.getState().init();
    await store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    for (const id of channelIds) store.getState().toggleChannel(id);
    return { ...spied, store, platform, rejectLogin: () => reject(TOKEN) };
  }

  it('a 401 sends the user to the onboarding screen and forgets the login', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.spies.getMessages.mockRejectedValue(unauthorized());
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).not.toHaveBeenCalled();
    const state = booted.store.getState();
    expect(state.status).toBe('needs-token');
    expect(state.needsTokenReason).toBe('expired');
    expect(booted.platform.spies.clearToken).toHaveBeenCalled();
    expect(state.selection).toEqual({});
  });

  it('the job does not stay "running": it ends as an error that says the session expired (nothing to save)', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setPrefs({ locale: 'en' });
    booted.spies.getMessages.mockRejectedValue(unauthorized());
    await booted.store.getState().startExport();

    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('error');
    expect(job.error).toBe(stateStrings.en.sessionExpired);
    expect(job.output).toMatchObject({ fileCount: 0, saved: false, authExpired: true });
    expect(job.startedAt).toBeGreaterThan(0);
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('what was completed before the 401 is saved automatically - nobody can click anything once the session is gone', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.edge201Channel]);
    booted.store.getState().setPrefs({ locale: 'en' });
    failChannel(booted, MOCK_IDS.edge200Channel);
    const statuses = recordStatuses(booted);
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = mocks.saveBlob.mock.calls[0];
    expect(filename).toMatch(/ - edge-199\.txt$/);
    expect((await readBlob(blob)).startsWith('# edge-199\n')).toBe(true);

    const state = booted.store.getState();
    expect(state.status).toBe('needs-token');
    expect(state.needsTokenReason).toBe('expired');
    expect(state.selection).toEqual({});
    expect(state.exportJob.status).toBe('error');
    expect(state.exportJob.error).toBe(stateStrings.en.sessionExpiredSaved(1));
    expect(state.exportJob.output).toMatchObject({ fileCount: 1, messageCount: 199, saved: true, authExpired: true, cancelled: false });
    expect(state.exportJob.output?.blob.size).toBe(0);
    expect(state.exportJob.progress?.targets.map((t) => t.status)).toEqual(['done', 'error', 'cancelled']);
    // The session reset drops the job back to idle for a moment before the final state is reported; it never ends 'running'.
    expect(statuses.slice(0, 2)).toEqual(['idle', 'running']);
    expect(statuses[statuses.length - 1]).toBe('error');
  });

  it('the message is localised and counts the saved channels', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.edge201Channel]);
    booted.store.getState().setPrefs({ locale: 'ko' });
    failChannel(booted, MOCK_IDS.edge201Channel);
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(booted.store.getState().exportJob.error).toBe(stateStrings.ko.sessionExpiredSaved(2));
    expect(stateStrings.ko.sessionExpiredSaved(2)).toContain('2개');
  });

  it('the live client rejects the login first (onAuthError wipes the session) - the partial archive is still saved and reported', async () => {
    const booted = await bootLiveWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    failChannel(booted, MOCK_IDS.edge200Channel, booted.rejectLogin);
    await booted.store.getState().startExport();

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toMatch(/ - edge-199\.txt$/);
    expect(booted.platform.spies.clearToken).toHaveBeenCalledWith(TOKEN);
    const state = booted.store.getState();
    expect(state.status).toBe('needs-token');
    expect(state.client).toBeNull();
    expect(state.selection).toEqual({});
    expect(state.exportJob).toMatchObject({
      status: 'error',
      error: stateStrings.en.sessionExpiredSaved(1),
      output: { fileCount: 1, saved: true, authExpired: true },
    });
  });

  it('a download that cannot be started still ends the job and says so next to the expiry', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    booted.store.getState().setPrefs({ locale: 'en' });
    failChannel(booted, MOCK_IDS.edge200Channel);
    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await booted.store.getState().startExport();

    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('error');
    expect(job.error).toBe(`${stateStrings.en.sessionExpired} ${common.en.saveFailed} (disk full)`);
    expect(job.output).toMatchObject({ fileCount: 1, saved: false });
    expect(booted.store.getState().status).toBe('needs-token');
  });

  it('a download that failed keeps the archive of an expired run retryable, and the retry keeps saying why the run stopped', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    booted.store.getState().setPrefs({ locale: 'en' });
    failChannel(booted, MOCK_IDS.edge200Channel);
    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await booted.store.getState().startExport();

    let job = booted.store.getState().exportJob;
    expect(job).toMatchObject({ status: 'error', output: { fileCount: 1, saved: false, authExpired: true } });
    expect(job.output?.blob.size).toBeGreaterThan(0);
    expect(selectUnsavedFileCount(booted.store.getState())).toBe(1);

    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('still full');
    });
    booted.store.getState().saveExportOutput();
    job = booted.store.getState().exportJob;
    expect(job.error).toBe(`${stateStrings.en.sessionExpired} ${common.en.saveFailed} (still full)`);
    expect(job.output?.blob.size).toBeGreaterThan(0);

    booted.store.getState().saveExportOutput();
    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(3);
    job = booted.store.getState().exportJob;
    expect(job).toMatchObject({ status: 'error', error: stateStrings.en.sessionExpiredSaved(1), output: { saved: true, authExpired: true } });
    expect(job.output?.blob.size).toBe(0);
    expect(booted.store.getState().status).toBe('needs-token');
  });

  it('an expired run that was saved right away holds nothing to retry', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    failChannel(booted, MOCK_IDS.edge200Channel);
    await booted.store.getState().startExport();
    expect(selectUnsavedFileCount(booted.store.getState())).toBe(0);
    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('the expired job does not leak into the next session: after a new login the job is idle again', async () => {
    const booted = await bootLiveWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    failChannel(booted, MOCK_IDS.edge200Channel, booted.rejectLogin);
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('error');

    booted.platform.emitToken(TOKEN);
    await vi.waitFor(() => expect(booted.store.getState().status).toBe('ready'));
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'idle', output: null, error: null });
  });
});

describe('dismissExportJob', () => {
  it('clears a finished job', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('done');
    booted.store.getState().dismissExportJob();
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'idle', output: null, progress: null, error: null, startedAt: null });
  });

  it('clears an error', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setExportAfter('x');
    await booted.store.getState().startExport();
    booted.store.getState().dismissExportJob();
    expect(booted.store.getState().exportJob.status).toBe('idle');
  });

  it('is ignored while the job is running', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const running = booted.store.getState().startExport();
    booted.store.getState().dismissExportJob();
    expect(booted.store.getState().exportJob.status).toBe('running');
    await running;
    expect(booted.store.getState().exportJob.status).toBe('done');
  });
});

describe('export settings', () => {
  it('are plain state with setters, not persisted', async () => {
    const booted = await bootDemo();
    expect(booted.store.getState().exportSettings).toEqual({ after: null, before: null, limit: null });
    booted.store.getState().setExportAfter('2026-01-01T00:00:00.000Z');
    booted.store.getState().setExportBefore('2026-02-01T00:00:00.000Z');
    booted.store.getState().setExportLimit(200);
    expect(booted.store.getState().exportSettings).toEqual({ after: '2026-01-01T00:00:00.000Z', before: '2026-02-01T00:00:00.000Z', limit: 200 });
    booted.store.getState().setExportLimit(null);
    expect(booted.store.getState().exportSettings.limit).toBeNull();
    booted.store.getState().setExportAfter(null);
    expect(booted.store.getState().exportSettings.after).toBeNull();
    expect(booted.platform.spies.savePrefs).not.toHaveBeenCalled();
  });
});
