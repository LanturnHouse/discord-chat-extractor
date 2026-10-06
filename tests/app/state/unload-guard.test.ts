import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '@/app/state/store';
import { hasUnsavedExportWork, installUnloadGuard, type UnloadTarget } from '@/app/state/unloadGuard';
import type { ExportJob, ExportJobOutput } from '@/app/state/types';
import { MOCK_IDS, createMockClient } from '@/lib/discord/mock';
import { bootDemo } from '../helpers';

const mocks = vi.hoisted(() => ({ saveBlob: vi.fn<(blob: Blob, filename: string) => void>() }));
vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));

beforeEach(() => {
  mocks.saveBlob.mockReset();
});

type Listener = (event: BeforeUnloadEvent) => void;

/** A window that only knows about the one event the guard registers for. */
function fakeWindow() {
  const listeners = new Set<Listener>();
  const target: UnloadTarget = {
    addEventListener: vi.fn((_type: 'beforeunload', listener: Listener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: 'beforeunload', listener: Listener) => {
      listeners.delete(listener);
    }),
  };
  return {
    target,
    listeners,
    /** What the browser does when the tab is about to go: runs every handler, reports whether any asked for the prompt. */
    leave(): { prompted: boolean; returnValue: unknown } {
      const event = { defaultPrevented: false, returnValue: undefined as unknown, preventDefault: vi.fn() };
      event.preventDefault.mockImplementation(() => {
        event.defaultPrevented = true;
      });
      for (const listener of [...listeners]) listener(event as unknown as BeforeUnloadEvent);
      return { prompted: event.defaultPrevented, returnValue: event.returnValue };
    },
  };
}

const output = (patch: Partial<ExportJobOutput> = {}): ExportJobOutput => ({
  filename: 'general.txt',
  blob: new Blob(['x']),
  fileCount: 1,
  messageCount: 1,
  failures: [],
  cancelled: true,
  saved: false,
  ...patch,
});

const job = (patch: Partial<ExportJob>): ExportJob => ({ status: 'idle', progress: null, output: null, error: null, startedAt: null, scope: null, ...patch });

describe('hasUnsavedExportWork', () => {
  it('is true while a run is fetching or packaging', () => {
    expect(hasUnsavedExportWork({ exportJob: job({ status: 'running' }) })).toBe(true);
    expect(hasUnsavedExportWork({ exportJob: job({ status: 'packaging' }) })).toBe(true);
  });

  it('is true for a cancelled run whose completed channels were not handed to the browser yet', () => {
    expect(hasUnsavedExportWork({ exportJob: job({ status: 'cancelled', output: output() }) })).toBe(true);
  });

  it('is true for a run whose finished export could not be downloaded (an error that still holds the archive)', () => {
    expect(hasUnsavedExportWork({ exportJob: job({ status: 'error', error: 'x', output: output({ cancelled: false }) }) })).toBe(true);
  });

  it.each([
    ['nothing happens', job({})],
    ['a finished run (saved already)', job({ status: 'done', output: output({ cancelled: false, saved: true }) })],
    ['a cancelled run that was saved', job({ status: 'cancelled', output: output({ saved: true }) })],
    ['a cancelled run with nothing completed', job({ status: 'cancelled', output: output({ fileCount: 0, filename: '' }) })],
    ['a cancelled run without a summary', job({ status: 'cancelled' })],
    ['a failed run', job({ status: 'error', error: 'x' })],
    ['a failed run whose export was saved by a retry', job({ status: 'error', error: 'x', output: output({ cancelled: false, saved: true }) })],
    ['a failed run with nothing completed', job({ status: 'error', error: 'x', output: output({ cancelled: false, fileCount: 0, filename: '' }) })],
  ])('is false when %s', (_what, exportJob) => {
    expect(hasUnsavedExportWork({ exportJob })).toBe(false);
  });
});

describe('installUnloadGuard', () => {
  it('registers one beforeunload handler exactly while there is work to lose, and removes it afterwards', () => {
    const store = createAppStore();
    const win = fakeWindow();
    installUnloadGuard(store, win.target);
    expect(win.listeners.size).toBe(0);
    expect(win.leave().prompted).toBe(false);

    store.setState({ exportJob: job({ status: 'running' }) });
    expect(win.listeners.size).toBe(1);
    // Progress updates (many per second) must not stack handlers.
    for (let i = 0; i < 5; i += 1) store.setState({ exportJob: job({ status: 'running', startedAt: i }) });
    store.setState({ exportJob: job({ status: 'packaging' }) });
    expect(win.listeners.size).toBe(1);
    expect(win.target.addEventListener).toHaveBeenCalledTimes(1);

    store.setState({ exportJob: job({ status: 'done', output: output({ cancelled: false, saved: true }) }) });
    expect(win.listeners.size).toBe(0);
    expect(win.target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(win.leave().prompted).toBe(false);
  });

  it('asks the browser to confirm: preventDefault and a returnValue (what Chrome needs to show its prompt)', () => {
    const store = createAppStore();
    const win = fakeWindow();
    installUnloadGuard(store, win.target);
    store.setState({ exportJob: job({ status: 'running' }) });
    expect(win.leave()).toEqual({ prompted: true, returnValue: '' });
  });

  it('keeps asking for a cancelled run until its completed channels were saved or the summary was dismissed', () => {
    const store = createAppStore();
    const win = fakeWindow();
    installUnloadGuard(store, win.target);

    store.setState({ exportJob: job({ status: 'cancelled', output: output() }) });
    expect(win.leave().prompted).toBe(true);

    store.setState({ exportJob: job({ status: 'cancelled', output: output({ saved: true }) }) });
    expect(win.leave().prompted).toBe(false);

    store.setState({ exportJob: job({ status: 'cancelled', output: output() }) });
    expect(win.leave().prompted).toBe(true);
    store.getState().dismissExportJob();
    expect(win.leave().prompted).toBe(false);
  });

  it('keeps asking after a failed download until the export was saved or the summary was dismissed', () => {
    const store = createAppStore();
    const win = fakeWindow();
    installUnloadGuard(store, win.target);

    store.setState({ exportJob: job({ status: 'error', error: 'The file could not be saved.', output: output({ cancelled: false }) }) });
    expect(win.leave().prompted).toBe(true);
    store.getState().dismissExportJob();
    expect(win.leave().prompted).toBe(false);
  });

  it('arms immediately when the work already exists, and the returned function removes the guard for good', () => {
    const store = createAppStore();
    store.setState({ exportJob: job({ status: 'running' }) });
    const win = fakeWindow();
    const dispose = installUnloadGuard(store, win.target);
    expect(win.listeners.size).toBe(1);

    dispose();
    expect(win.listeners.size).toBe(0);
    store.setState({ exportJob: job({ status: 'packaging' }) });
    expect(win.listeners.size).toBe(0);
  });

  it('follows a real export: armed from the click until the file was handed over', async () => {
    const booted = await bootDemo();
    booted.store.getState().setPrefs({ exportFormat: 'txt' });
    await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    booted.store.getState().toggleChannel(MOCK_IDS.edge199Channel);
    const win = fakeWindow();
    installUnloadGuard(booted.store, win.target);
    expect(win.leave().prompted).toBe(false);

    const running = booted.store.getState().startExport();
    expect(win.leave().prompted).toBe(true);
    await running;

    expect(booted.store.getState().exportJob.status).toBe('done');
    expect(win.leave().prompted).toBe(false);
  });

  it('follows a real export whose download failed: armed until the retry went through', async () => {
    const booted = await bootDemo();
    booted.store.getState().setPrefs({ exportFormat: 'txt' });
    await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    booted.store.getState().toggleChannel(MOCK_IDS.edge199Channel);
    const win = fakeWindow();
    installUnloadGuard(booted.store, win.target);

    mocks.saveBlob.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await booted.store.getState().startExport();
    expect(booted.store.getState().exportJob.status).toBe('error');
    expect(win.leave().prompted).toBe(true);

    booted.store.getState().saveExportOutput();
    expect(booted.store.getState().exportJob.status).toBe('done');
    expect(win.leave().prompted).toBe(false);
  });

  it('follows a real cancelled export: armed until the completed channels are saved', async () => {
    const booted = await bootDemo();
    booted.store.getState().setPrefs({ exportFormat: 'txt' });
    await booted.store.getState().ensureGuildTree(MOCK_IDS.bigGuild);
    for (const id of [MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]) booted.store.getState().toggleChannel(id);
    const win = fakeWindow();
    installUnloadGuard(booted.store, win.target);

    // Cancel as soon as the second channel starts: the first one is complete.
    const healthy = createMockClient({ latencyMs: 0 });
    booted.spies.getMessages.mockImplementation(async (channelId, options, signal) => {
      if (channelId === MOCK_IDS.edge200Channel) booted.store.getState().cancelExport();
      return healthy.getMessages(channelId, options, signal);
    });
    await booted.store.getState().startExport();

    expect(booted.store.getState().exportJob).toMatchObject({ status: 'cancelled', output: { fileCount: 1, saved: false } });
    expect(win.leave().prompted).toBe(true);

    booted.store.getState().saveExportOutput();
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(win.leave().prompted).toBe(false);
  });
});
