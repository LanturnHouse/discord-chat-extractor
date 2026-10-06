import { beforeEach, describe, expect, it, vi } from 'vitest';
import { common } from '@/app/i18n/common';
import { stateStrings } from '@/app/state/strings';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { Message } from '@/lib/discord/types';
import { MAX_EXPORT_LIMIT, type ExportFormat, type ExportFormatId, type ExportOptions, type ExportScope, type ExportTarget } from '@/lib/export/types';
import { bootDemo, fullHistory } from '../helpers';

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  loadExportFormat: vi.fn<(id: ExportFormatId) => Promise<ExportFormat>>(),
}));

vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: mocks.loadExportFormat }));

interface WriterLog {
  options: Map<string, ExportOptions>;
  targets: Map<string, ExportTarget>;
  /** The ids each channel's writer was given, in the order it received them. */
  written: Map<string, string[]>;
}

/** A format that only records what its writers are given: the context and the message ids. */
function recordingFormat(log: WriterLog): ExportFormat {
  return {
    id: 'txt',
    label: 'TXT',
    extension: 'txt',
    mime: 'text/plain',
    createWriter(ctx) {
      const channelId = ctx.target.channelId;
      log.options.set(channelId, ctx.options);
      log.targets.set(channelId, ctx.target);
      const ids: string[] = [];
      log.written.set(channelId, ids);
      return {
        start: () => [],
        write: (batch) => {
          ids.push(...batch.map((message) => message.id));
          return [];
        },
        end: () => [],
      };
    },
  };
}

let log: WriterLog;

beforeEach(() => {
  mocks.saveBlob.mockReset();
  mocks.loadExportFormat.mockReset();
  log = { options: new Map(), targets: new Map(), written: new Map() };
  mocks.loadExportFormat.mockImplementation(async () => recordingFormat(log));
});

type Booted = Awaited<ReturnType<typeof bootDemo>>;

async function bootWithSelection(channelIds: string[], locale: 'en' | 'ko' = 'en'): Promise<Booted> {
  const booted = await bootDemo();
  booted.store.getState().setPrefs({ exportFormat: 'txt', locale });
  await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
  for (const id of channelIds) booted.store.getState().toggleChannel(id);
  return booted;
}

const scope = (patch: Partial<ExportScope> = {}): ExportScope => ({ after: null, before: null, limit: null, ...patch });
const idsOf = (messages: readonly Message[]): string[] => messages.map((message) => message.id);
const timeOf = (message: Message): number => Date.parse(message.timestamp);

/** The requests the store's client received for one channel. */
function requestsFor(booted: Booted, channelId: string): Array<{ before?: string; after?: string; limit?: number }> {
  return booted.spies.getMessages.mock.calls.filter(([id]) => id === channelId).map(([, options]) => options ?? {});
}

describe('startExport hands the scopes to the runner', () => {
  it('the default count travels in the options, the dates with it', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setExportAfter('2026-01-01T00:00:00.000Z');
    booted.store.getState().setExportBefore('2026-12-01T00:00:00.000Z');
    booted.store.getState().setExportLimit(30);
    await booted.store.getState().startExport();

    expect(log.options.get(MOCK_IDS.edge199Channel)).toMatchObject({ after: '2026-01-01T00:00:00.000Z', before: '2026-12-01T00:00:00.000Z', limit: 30 });
    expect(log.targets.get(MOCK_IDS.edge199Channel)?.scope).toBeUndefined();
  });

  it('an override travels on its own target as a copy; the writer sees the EFFECTIVE scope, the other targets the defaults', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    booted.store.getState().setExportLimit(50);
    booted.store.getState().setExportAfter('2026-01-01T00:00:00.000Z');
    const own = scope({ before: '2026-12-31T00:00:00.000Z', limit: 7 });
    booted.store.getState().setChannelScope(MOCK_IDS.edge200Channel, own);
    await booted.store.getState().startExport();

    const withOverride = log.targets.get(MOCK_IDS.edge200Channel);
    expect(withOverride?.scope).toEqual(own);
    expect(withOverride?.scope).not.toBe(booted.store.getState().exportOverrides[MOCK_IDS.edge200Channel]);
    expect(log.targets.get(MOCK_IDS.edge199Channel)?.scope).toBeUndefined();
    // All three fields of the override replace the defaults: its missing start is NOT filled in from them.
    expect(log.options.get(MOCK_IDS.edge200Channel)).toMatchObject({ after: null, before: '2026-12-31T00:00:00.000Z', limit: 7 });
    expect(log.options.get(MOCK_IDS.edge199Channel)).toMatchObject({ after: '2026-01-01T00:00:00.000Z', before: null, limit: 50 });
    // Format, theme and language stay global.
    expect(log.options.get(MOCK_IDS.edge200Channel)?.format).toBe(log.options.get(MOCK_IDS.edge199Channel)?.format);
  });

  it('the selection and the overrides survive the export (the next one starts from the same settings)', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 5 }));
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportOverrides).toEqual({ [MOCK_IDS.edge199Channel]: scope({ limit: 5 }) });
    expect(Object.keys(booted.store.getState().selection)).toEqual([MOCK_IDS.edge199Channel]);
  });

  it('the job remembers the scopes it started with, whatever the settings say later', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    booted.store.getState().setExportLimit(40);
    booted.store.getState().setChannelScope(MOCK_IDS.edge200Channel, scope({ limit: 9 }));
    mocks.loadExportFormat.mockReturnValue(new Promise(() => undefined)); // the job stays "running"
    void booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('running');

    booted.store.getState().setExportLimit(5);
    booted.store.getState().setChannelScope(MOCK_IDS.edge200Channel, null);
    expect(booted.store.getState().exportJob.scope).toEqual({
      defaults: scope({ limit: 40 }),
      overrides: { [MOCK_IDS.edge200Channel]: scope({ limit: 9 }) },
    });
  });

  it('a job without overrides has an empty override map, an idle one has no scope at all', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    expect(booted.store.getState().exportJob.scope).toBeNull();
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.scope).toEqual({ defaults: scope(), overrides: {} });
    booted.store.getState().dismissExportJob();
    expect(booted.store.getState().exportJob.scope).toBeNull();
  });
});

describe('what is exported', () => {
  it('only a count (no dates): the NEWEST messages of every channel, oldest first - and the walk stops early', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel, MOCK_IDS.edge199Channel]);
    booted.store.getState().setExportLimit(30);
    await booted.store.getState().startExport();

    for (const channelId of [MOCK_IDS.edge400Channel, MOCK_IDS.edge199Channel]) {
      const history = await fullHistory(channelId);
      expect(log.written.get(channelId), channelId).toEqual(idsOf(history.slice(-30)));
    }
    expect(booted.store.getState().exportJob.output).toMatchObject({ fileCount: 2, messageCount: 60 });
    // 30 newest messages are one request of 30, not a walk through 400 messages.
    expect(requestsFor(booted, MOCK_IDS.edge400Channel).length).toBeLessThanOrEqual(2);
  });

  it('the count is PER channel: a channel with fewer messages than the count is exported whole', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.emptyChannel]);
    booted.store.getState().setExportLimit(250);
    await booted.store.getState().startExport();
    expect(log.written.get(MOCK_IDS.edge199Channel)).toHaveLength(199);
    expect(log.written.get(MOCK_IDS.emptyChannel)).toEqual([]);
  });

  it('global count 200 + one channel on "all": that channel is fetched completely, the other stops at its 200 newest', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel, MOCK_IDS.edge401Channel]);
    booted.store.getState().setExportLimit(200);
    booted.store.getState().setChannelScope(MOCK_IDS.edge401Channel, scope());
    await booted.store.getState().startExport();

    const limitedHistory = await fullHistory(MOCK_IDS.edge400Channel);
    const wholeHistory = await fullHistory(MOCK_IDS.edge401Channel);
    expect(wholeHistory).toHaveLength(401);
    expect(log.written.get(MOCK_IDS.edge400Channel)).toEqual(idsOf(limitedHistory.slice(-200)));
    expect(log.written.get(MOCK_IDS.edge401Channel)).toEqual(idsOf(wholeHistory));

    // The request log tells the same story: the limited channel never walked through all of its 400 messages.
    const limited = requestsFor(booted, MOCK_IDS.edge400Channel);
    const whole = requestsFor(booted, MOCK_IDS.edge401Channel);
    expect(limited.length).toBeLessThanOrEqual(3);
    expect(whole.length).toBeGreaterThanOrEqual(5);
    expect(booted.store.getState().exportJob.output?.messageCount).toBe(200 + 401);
  });

  it('the other way round: no default count, one channel limited to its newest 50', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    booted.store.getState().setChannelScope(MOCK_IDS.edge200Channel, scope({ limit: 50 }));
    await booted.store.getState().startExport();
    expect(log.written.get(MOCK_IDS.edge199Channel)).toHaveLength(199);
    expect(log.written.get(MOCK_IDS.edge200Channel)).toEqual(idsOf((await fullHistory(MOCK_IDS.edge200Channel)).slice(-50)));
  });

  it('a start date + a count: the FIRST messages from the start date going forward', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel]);
    const history = await fullHistory(MOCK_IDS.edge400Channel);
    const start = history[100];
    booted.store.getState().setExportAfter(start.timestamp);
    booted.store.getState().setExportLimit(25);
    await booted.store.getState().startExport();

    const expected = history.filter((message) => timeOf(message) >= timeOf(start)).slice(0, 25);
    expect(expected).toHaveLength(25);
    expect(log.written.get(MOCK_IDS.edge400Channel)).toEqual(idsOf(expected));
    // Not the newest 25 of that window.
    expect(log.written.get(MOCK_IDS.edge400Channel)).not.toEqual(idsOf(history.slice(-25)));
  });

  it('a start date + an end date + a count never goes beyond the end date', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel]);
    const history = await fullHistory(MOCK_IDS.edge400Channel);
    booted.store.getState().setExportAfter(history[50].timestamp);
    booted.store.getState().setExportBefore(history[69].timestamp);
    booted.store.getState().setExportLimit(100);
    await booted.store.getState().startExport();

    const window = history.filter((message) => timeOf(message) >= timeOf(history[50]) && timeOf(message) <= timeOf(history[69]));
    expect(window.length).toBeGreaterThanOrEqual(20);
    expect(log.written.get(MOCK_IDS.edge400Channel)).toEqual(idsOf(window));

    // With a count smaller than the window the count wins, from the start.
    log.written.clear();
    booted.store.getState().dismissExportJob();
    booted.store.getState().setExportLimit(5);
    await booted.store.getState().startExport();
    expect(log.written.get(MOCK_IDS.edge400Channel)).toEqual(idsOf(window.slice(0, 5)));
  });

  it('only an end date + a count: the newest messages up to the end date', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel]);
    const history = await fullHistory(MOCK_IDS.edge400Channel);
    booted.store.getState().setExportBefore(history[300].timestamp);
    booted.store.getState().setExportLimit(40);
    await booted.store.getState().startExport();

    const upToEnd = history.filter((message) => timeOf(message) <= timeOf(history[300]));
    expect(log.written.get(MOCK_IDS.edge400Channel)).toEqual(idsOf(upToEnd.slice(-40)));
  });

  it('a channel with its own scope ignores the default dates and count entirely', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge400Channel, MOCK_IDS.edge401Channel]);
    const history = await fullHistory(MOCK_IDS.edge400Channel);
    booted.store.getState().setExportAfter(history[380].timestamp);
    booted.store.getState().setExportLimit(3);
    booted.store.getState().setChannelScope(MOCK_IDS.edge401Channel, scope());
    await booted.store.getState().startExport();

    expect(log.written.get(MOCK_IDS.edge400Channel)).toEqual(idsOf(history.slice(380, 383)));
    expect(log.written.get(MOCK_IDS.edge401Channel)).toHaveLength(401);
  });

  it('a limited export of several channels is still one ZIP with every channel in it', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.dmFriend]);
    booted.store.getState().setExportLimit(10);
    await booted.store.getState().startExport();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toMatch(/\.zip$/);
    expect(booted.store.getState().exportJob.output).toMatchObject({ fileCount: 3, messageCount: 30 });
  });
});

describe('a scope that cannot be exported', () => {
  /** Nothing is loaded, fetched or saved; the job says why. */
  function expectRefused(booted: Booted): string {
    expect(mocks.loadExportFormat).not.toHaveBeenCalled();
    expect(booted.spies.getMessages).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    const job = booted.store.getState().exportJob;
    expect(job.status).toBe('error');
    expect(job.output).toBeNull();
    expect(job.scope).toBeNull();
    expect(job.startedAt).toBeGreaterThan(0);
    return job.error ?? '';
  }

  it.each([
    ['0', 0],
    ['a decimal', 1.5],
    ['negative', -3],
    ['above the maximum', MAX_EXPORT_LIMIT + 1],
    ['NaN', Number.NaN],
  ])('a default count that is %s refuses to start', async (_name, limit) => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setExportLimit(limit);
    await booted.store.getState().startExport();
    expect(expectRefused(booted)).toBe(stateStrings.en.invalidLimit(MAX_EXPORT_LIMIT));
    expect(stateStrings.en.invalidLimit(MAX_EXPORT_LIMIT)).toContain('100,000');
  });

  it('the largest allowed count is not refused', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setExportLimit(MAX_EXPORT_LIMIT);
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('done');
  });

  it('a start after the end, and a date that is none, refuse with their own messages', async () => {
    const inverted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    inverted.store.getState().setExportAfter('2026-10-01T00:00:00.000Z');
    inverted.store.getState().setExportBefore('2026-09-01T00:00:00.000Z');
    await inverted.store.getState().startExport();
    expect(expectRefused(inverted)).toBe(common.en.invalidRange);

    mocks.loadExportFormat.mockClear();
    const garbage = await bootWithSelection([MOCK_IDS.edge199Channel]);
    garbage.store.getState().setExportBefore('whenever');
    await garbage.store.getState().startExport();
    expect(expectRefused(garbage)).toBe(stateStrings.en.invalidDate);
  });

  it('the messages are localised', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel], 'ko');
    booted.store.getState().setExportLimit(0);
    await booted.store.getState().startExport();
    expect(expectRefused(booted)).toBe(stateStrings.ko.invalidLimit(MAX_EXPORT_LIMIT));
    expect(stateStrings.ko.invalidLimit(MAX_EXPORT_LIMIT)).toContain('100,000');
    expect(stateStrings.ko.invalidLimit(MAX_EXPORT_LIMIT)).not.toBe(stateStrings.en.invalidLimit(MAX_EXPORT_LIMIT));
  });

  it('an invalid override of ONE channel refuses the whole run and names the channel', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    booted.store.getState().setChannelScope(MOCK_IDS.edge200Channel, scope({ limit: 0 }));
    await booted.store.getState().startExport();

    const message = expectRefused(booted);
    const guildName = booted.store.getState().guilds[0].name;
    expect(message).toBe(stateStrings.en.scopeOf(`${guildName} / edge-200`, stateStrings.en.invalidLimit(MAX_EXPORT_LIMIT)));
    expect(message).toContain('edge-200');
    // Nothing of the valid channel was started either.
    expect(log.written.size).toBe(0);
  });

  it('an invalid override with a bad date or an inverted range is refused too, and the channel stays in the selection', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel, MOCK_IDS.dmFriend]);
    booted.store.getState().setChannelScope(MOCK_IDS.dmFriend, scope({ after: '2026-02-01T00:00:00.000Z', before: '2026-01-01T00:00:00.000Z' }));
    await booted.store.getState().startExport();
    const dmName = booted.store.getState().dms.find((dm) => dm.id === MOCK_IDS.dmFriend)?.name ?? '';
    expect(expectRefused(booted)).toBe(stateStrings.en.scopeOf(dmName, common.en.invalidRange));
    expect(Object.keys(booted.store.getState().selection)).toHaveLength(2);

    booted.store.getState().dismissExportJob();
    booted.store.getState().setChannelScope(MOCK_IDS.dmFriend, scope({ after: 'x' }));
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.error).toBe(stateStrings.en.scopeOf(dmName, stateStrings.en.invalidDate));
  });

  it('the default settings are reported before any channel\'s own', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 0 }));
    booted.store.getState().setExportLimit(2.5);
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.error).toBe(stateStrings.en.invalidLimit(MAX_EXPORT_LIMIT));
  });

  it('a refused run can be dismissed, and once the scope is fixed the very same selection exports', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 0 }));
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('error');
    booted.store.getState().dismissExportJob();
    expect(booted.store.getState().exportJob.status).toBe('idle');

    booted.store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 4 }));
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'done', output: { messageCount: 4 } });
  });

  it('a channel that fell back to the default settings no longer blocks anything', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    booted.store.getState().setChannelScope(MOCK_IDS.edge199Channel, scope({ limit: 0 }));
    booted.store.getState().setChannelScope(MOCK_IDS.edge199Channel, null);
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('done');
  });
});
