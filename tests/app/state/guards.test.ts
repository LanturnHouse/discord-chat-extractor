import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_IDS, MOCK_ME, createMockClient } from '@/lib/discord/mock';
import type { Message } from '@/lib/discord/types';
import type { ExportFormat, ExportFormatId, ExportOutput } from '@/lib/export/types';
import { bootDemo, createSpiedClient, type SpiedClient } from '../helpers';

/*
 * The defensive branches of the store that no other test pins: each test below fails when its guard is removed
 * (they were found by mutation: the other suites stayed green without them).
 */

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  loadExportFormat: vi.fn<(id: ExportFormatId) => Promise<ExportFormat>>(),
  runExport: vi.fn<(args: unknown) => Promise<ExportOutput>>(),
}));

vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: mocks.loadExportFormat }));
vi.mock('@/lib/export/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/export/runner')>();
  mocks.runExport.mockImplementation((args) => actual.runExport(args as Parameters<typeof actual.runExport>[0]));
  return { ...actual, runExport: mocks.runExport };
});

/** A promise the test settles by hand. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const textFormat: ExportFormat = {
  id: 'txt',
  label: 'TXT',
  extension: 'txt',
  mime: 'text/plain',
  createWriter: (ctx) => ({
    start: () => [`# ${ctx.target.channelName}\n`],
    write: (batch) => batch.map((message) => `${message.id}\n`),
    end: () => [],
  }),
};

beforeEach(() => {
  mocks.saveBlob.mockReset();
  mocks.loadExportFormat.mockReset();
  mocks.loadExportFormat.mockImplementation(async () => textFormat);
  mocks.runExport.mockClear();
});

type Booted = Awaited<ReturnType<typeof bootDemo>>;

async function bootWithSelection(channelIds: string[]): Promise<Booted> {
  const booted = await bootDemo();
  booted.store.getState().setPrefs({ exportFormat: 'txt' });
  await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
  for (const id of channelIds) booted.store.getState().toggleChannel(id);
  return booted;
}

/** getMessages of this client waits for `gate` (and gets its signal reported), then answers like a healthy mock. */
function holdMessages(client: Pick<SpiedClient, 'spies'>, gate: Promise<unknown>, signals: AbortSignal[] = []): void {
  const healthy = createMockClient({ latencyMs: 0 });
  client.spies.getMessages.mockImplementation(async (channelId, options, signal) => {
    if (signal) signals.push(signal);
    await gate;
    return healthy.getMessages(channelId, options, signal);
  });
}

/** Replaces the whole session (what a token loss and re-boot do) with a fresh mock client, which it returns. */
async function replaceSession(booted: Booted): Promise<SpiedClient> {
  const replacement = createSpiedClient();
  await booted.store.getState().initWithClient(replacement.client, MOCK_ME);
  await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
  return replacement;
}

describe('startExport: one job at a time', () => {
  it('a second start while the first still loads its format starts nothing at all', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const formatGate = deferred();
    mocks.loadExportFormat.mockImplementationOnce(async () => {
      await formatGate.promise;
      return textFormat;
    });

    const first = booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('running');
    await booted.store.getState().startExport(); // refused: resolves at once, the format gate is still closed
    expect(mocks.loadExportFormat).toHaveBeenCalledTimes(1);

    formatGate.resolve();
    await first;
    expect(mocks.runExport).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'done', output: { fileCount: 1, messageCount: 199, saved: true } });
  });

  it('a second start while the runner is fetching leaves the first job (and its cancel) intact', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const gate = deferred();
    holdMessages(booted, gate.promise);

    const first = booted.store.getState().startExport();
    await vi.waitFor(() => expect(booted.spies.getMessages).toHaveBeenCalled());
    const startedAt = booted.store.getState().exportJob.startedAt;
    await booted.store.getState().startExport();
    expect(mocks.runExport).toHaveBeenCalledTimes(1);
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'running', startedAt });

    gate.resolve();
    await first;
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'done', output: { messageCount: 199, cancelled: false } });
  });

  it('cancel, then start again: refused while the cancelled run is still winding down, accepted once it ended', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const gate = deferred();
    holdMessages(booted, gate.promise);

    const first = booted.store.getState().startExport();
    await vi.waitFor(() => expect(booted.spies.getMessages).toHaveBeenCalled());
    booted.store.getState().cancelExport();
    await booted.store.getState().startExport();
    expect(mocks.runExport).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
    expect(booted.store.getState().exportJob.status).toBe('cancelled');
    expect(mocks.saveBlob).not.toHaveBeenCalled();

    holdMessages(booted, Promise.resolve());
    await booted.store.getState().startExport();
    expect(mocks.runExport).toHaveBeenCalledTimes(2);
    expect(booted.store.getState().exportJob.status).toBe('done');
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('dismissing while the job runs changes nothing: the job still finishes and reports', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const gate = deferred();
    holdMessages(booted, gate.promise);

    const running = booted.store.getState().startExport();
    await vi.waitFor(() => expect(booted.spies.getMessages).toHaveBeenCalled());
    booted.store.getState().dismissExportJob();
    expect(booted.store.getState().exportJob.status).toBe('running');

    gate.resolve();
    await running;
    expect(booted.store.getState().exportJob).toMatchObject({ status: 'done', output: { saved: true } });
  });
});

describe('startExport: a job that outlives its session', () => {
  /** An export blocked inside the first API request, whose session is then replaced by a new one. */
  async function startBlockedExportThenReplaceSession(channelId: string): Promise<{
    booted: Booted;
    replacement: SpiedClient;
    first: Promise<void>;
    gate: Deferred<void>;
    signals: AbortSignal[];
  }> {
    const booted = await bootWithSelection([channelId]);
    const gate = deferred();
    const signals: AbortSignal[] = [];
    holdMessages(booted, gate.promise, signals);
    const first = booted.store.getState().startExport();
    await vi.waitFor(() => expect(booted.spies.getMessages).toHaveBeenCalled());
    const replacement = await replaceSession(booted);
    return { booted, replacement, first, gate, signals };
  }

  it('ending the session aborts the running export: it must not keep fetching with the next account', async () => {
    const { signals, gate, first } = await startBlockedExportThenReplaceSession(MOCK_IDS.edge199Channel);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    gate.resolve();
    await first;
  });

  it("its late result does not overwrite the job of the new session", async () => {
    const { booted, first, gate } = await startBlockedExportThenReplaceSession(MOCK_IDS.edge199Channel);
    booted.store.getState().toggleChannel(MOCK_IDS.edge200Channel);
    await booted.store.getState().startExport();
    const finished = booted.store.getState().exportJob;
    expect(finished).toMatchObject({ status: 'done', output: { fileCount: 1, filename: expect.stringMatching(/ - edge-200\.txt$/) } });
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);

    gate.resolve();
    await first;
    // The aborted run of the old session reports "cancelled"; that must never reach the new session's state.
    expect(booted.store.getState().exportJob).toBe(finished);
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('its late failure does not overwrite the job of the new session either', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const formatGate = deferred<ExportFormat>();
    mocks.loadExportFormat.mockImplementationOnce(() => formatGate.promise);
    const first = booted.store.getState().startExport();

    await replaceSession(booted);
    booted.store.getState().toggleChannel(MOCK_IDS.edge200Channel);
    await booted.store.getState().startExport();
    const finished = booted.store.getState().exportJob;
    expect(finished.status).toBe('done');

    formatGate.reject(new Error('chunk failed to load'));
    await first;
    expect(booted.store.getState().exportJob).toBe(finished);
  });

  it('a format that finishes loading after the session was replaced never starts a run', async () => {
    const booted = await bootWithSelection([MOCK_IDS.edge199Channel]);
    const formatGate = deferred<ExportFormat>();
    mocks.loadExportFormat.mockImplementationOnce(() => formatGate.promise);
    const first = booted.store.getState().startExport();

    await replaceSession(booted);
    formatGate.resolve(textFormat);
    await first;
    expect(mocks.runExport).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    expect(booted.store.getState().exportJob.status).toBe('idle');
  });

  it("the old job's cleanup must not detach the cancel button of the new session's job", async () => {
    const { booted, replacement, first, gate } = await startBlockedExportThenReplaceSession(MOCK_IDS.edge199Channel);
    booted.store.getState().toggleChannel(MOCK_IDS.edge200Channel);
    const secondGate = deferred();
    holdMessages(replacement, secondGate.promise);
    const second = booted.store.getState().startExport();
    await vi.waitFor(() => expect(replacement.spies.getMessages).toHaveBeenCalled());

    gate.resolve(); // the old job ends now, after the new one started
    await first;
    booted.store.getState().cancelExport();
    secondGate.resolve();
    await second;
    expect(booted.store.getState().exportJob.status).toBe('cancelled');
  });
});

describe('older pages', () => {
  /** `count` messages that are all NEWER than `after`: what a server that repeats itself would answer for "older than after". */
  function newerThan(template: Message, after: string, from: number, count: number): Message[] {
    return Array.from({ length: count }, (_unused, i) => ({ ...template, id: String(BigInt(after) + BigInt(from + i + 1)) }));
  }

  it('a server that keeps answering with messages that are not older ends the top-scroll loading instead of repeating it forever', async () => {
    const booted = await bootDemo();
    await booted.store.getState().openChannel(MOCK_IDS.edge400Channel, MOCK_IDS.bigGuild);
    const loaded = booted.store.getState().messages[MOCK_IDS.edge400Channel];
    expect(loaded).toMatchObject({ status: 'loaded', hasMore: true });
    const before = loaded.items[0].id;

    let served = 0;
    booted.spies.getMessages.mockImplementation(async () => {
      const page = newerThan(loaded.items[0], before, served, 100).reverse(); // raw API order: newest first
      served += 100;
      return page;
    });
    await booted.store.getState().loadOlderMessages(MOCK_IDS.edge400Channel);

    const after = booted.store.getState().messages[MOCK_IDS.edge400Channel];
    expect(after.items).toBe(loaded.items);
    expect(after).toMatchObject({ status: 'loaded', hasMore: false, loadingOlder: false });
    const calls = booted.spies.getMessages.mock.calls.length;
    await booted.store.getState().loadOlderMessages(MOCK_IDS.edge400Channel);
    expect(booted.spies.getMessages.mock.calls.length).toBe(calls);
  });

  it('opening the channel whose first page is already loading joins that load instead of cancelling it', async () => {
    const booted = await bootDemo();
    const gate = deferred();
    const healthy = createMockClient({ latencyMs: 0 });
    booted.spies.getMessages.mockImplementation(async (channelId, options, signal) => {
      await gate.promise;
      return healthy.getMessages(channelId, options, signal);
    });

    const first = booted.store.getState().openChannel(MOCK_IDS.edge400Channel, MOCK_IDS.bigGuild);
    const again = booted.store.getState().openChannel(MOCK_IDS.edge400Channel, MOCK_IDS.bigGuild);
    gate.resolve();
    await Promise.all([first, again]);

    // 200 messages = two sequential API pages, requested once: the first load was neither aborted nor repeated.
    expect(booted.spies.getMessages).toHaveBeenCalledTimes(2);
    expect(booted.store.getState().messages[MOCK_IDS.edge400Channel]).toMatchObject({ status: 'loaded' });
  });
});

describe('selecting all direct messages', () => {
  it('leaves out the DMs known to be forbidden, and the toggle counts only the ones it can select', async () => {
    const { store } = await bootDemo();
    const dms = store.getState().dms;
    const forbidden = dms[0].id;
    store.setState({ forbiddenChannels: { [forbidden]: true } });

    store.getState().toggleAllDms();
    const selected = Object.keys(store.getState().selection);
    expect(selected).not.toContain(forbidden);
    expect(selected).toHaveLength(dms.length - 1);

    // Everything selectable is selected, so the next toggle clears the selection (a forbidden DM is not "missing").
    store.getState().toggleAllDms();
    expect(store.getState().selection).toEqual({});
  });
});
