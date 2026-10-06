import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordClient } from '../../../src/lib/discord/client';
import { runExport, type RunExportArgs } from '../../../src/lib/export/runner';
import type { ExportFormat, ExportOptions, ExportProgress, ExportTarget } from '../../../src/lib/export/types';
import * as zipModule from '../../../src/lib/export/zip';

// The real limits are 3.75 GB and 65,535 entries, which a test cannot produce; the runner reads them from the zip module.
vi.mock('../../../src/lib/export/zip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/export/zip')>();
  return { ...actual, MAX_ZIP_INPUT_BYTES: 100, MAX_ZIP_ENTRIES: 3, buildZip: vi.fn(actual.buildZip) };
});

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const OPTIONS: ExportOptions = { format: 'txt', after: null, before: null, limit: null, htmlTheme: 'dark', locale: 'en', timeZone: 'UTC' };

/** Every channel is empty; the size of each file is decided by the format. */
const CLIENT = { kind: 'mock', getMessages: async () => [] } as unknown as DiscordClient;

function target(id: string): ExportTarget {
  return { channelId: id, kind: 'text', channelName: `chan-${id}`, guildId: 'g1', guildName: 'Guild', categoryName: 'Cat', parentChannelName: null, topic: null };
}

/** Writes `sizes[channelId]` bytes per channel. */
function sizedFormat(sizes: Record<string, number>): ExportFormat {
  return {
    id: 'txt',
    label: 'Sized',
    extension: 'txt',
    mime: 'text/plain',
    createWriter: (ctx) => ({
      start: () => [],
      write: () => [],
      end: () => [new Uint8Array(sizes[ctx.target.channelId] ?? 1)],
    }),
  };
}

async function run(
  ids: string[],
  sizes: Record<string, number>,
  overrides: Partial<RunExportArgs> = {},
): Promise<{ out: Awaited<ReturnType<typeof runExport>>; progress: ExportProgress[] }> {
  const progress: ExportProgress[] = [];
  const out = await runExport({
    client: CLIENT,
    targets: ids.map(target),
    format: sizedFormat(sizes),
    options: OPTIONS,
    now: () => NOW,
    onProgress: (p) => progress.push(p),
    ...overrides,
  });
  return { out, progress };
}

async function entryNames(blob: Blob): Promise<string[]> {
  return Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer())));
}

afterEach(() => {
  vi.mocked(zipModule.buildZip).mockClear();
});

describe('ZIP size and entry limits', () => {
  it('leaves out the channel that would push the ZIP over its byte limit, lists it, and delivers the rest', async () => {
    const { out, progress } = await run(['a', 'b', 'c'], { a: 40, b: 40, c: 40 });
    expect(out.fileCount).toBe(2);
    expect(out.cancelled).toBe(false);
    expect(await entryNames(out.blob)).toEqual(['Guild/Cat/chan-a.txt', 'Guild/Cat/chan-b.txt']);
    expect(out.failures).toEqual([
      { channelId: 'c', label: 'Guild / chan-c', kind: 'error', reason: 'Too large for one ZIP file (limit: about 3.75 GB). Export fewer channels at once.' },
    ]);
    const final = progress[progress.length - 1];
    expect(final.targets.map((t) => t.status)).toEqual(['done', 'done', 'error']);
    expect(final.targets[2].error).toBe(out.failures[0].reason);
  });

  it('still fits a smaller channel that comes after the one that did not fit', async () => {
    const { out } = await run(['a', 'b', 'c'], { a: 60, b: 60, c: 30 });
    expect(await entryNames(out.blob)).toEqual(['Guild/Cat/chan-a.txt', 'Guild/Cat/chan-c.txt']);
    expect(out.failures.map((f) => f.channelId)).toEqual(['b']);
  });

  it('counts the entry limit separately', async () => {
    const { out } = await run(['a', 'b', 'c', 'd'], { a: 1, b: 1, c: 1, d: 1 });
    expect(out.fileCount).toBe(3);
    expect(out.failures).toEqual([
      { channelId: 'd', label: 'Guild / chan-d', kind: 'error', reason: 'Too many files for one ZIP file (limit: 65,535). Export fewer channels at once.' },
    ]);
  });

  it('writes the reasons in Korean for a Korean export', async () => {
    const { out } = await run(['a', 'b'], { a: 90, b: 90 }, { options: { ...OPTIONS, locale: 'ko' } });
    expect(out.failures[0].reason).toBe('ZIP 파일 하나에 담기에는 너무 큽니다 (한도: 약 3.75GB). 한 번에 내보내는 채널 수를 줄이세요.');
  });

  it('never zips a lone file, however large: it is returned as is', async () => {
    const { out } = await run(['a'], { a: 500 });
    expect(out).toMatchObject({ filename: 'Guild - chan-a.txt', fileCount: 1, failures: [] });
    expect(out.blob.size).toBe(500);
    expect(zipModule.buildZip).not.toHaveBeenCalled();
  });

  it('returns an oversized first channel as a single file and lists the later ones that cannot join it', async () => {
    const { out } = await run(['a', 'b'], { a: 500, b: 10 });
    expect(out.fileCount).toBe(1);
    expect(out.filename).toBe('Guild - chan-a.txt');
    expect(out.failures.map((f) => f.channelId)).toEqual(['b']);
  });

  it('keeps the packaged ZIP inside the limit it checked', async () => {
    const { out } = await run(['a', 'b', 'c'], { a: 50, b: 50, c: 1 });
    expect(out.fileCount).toBe(2);
    const files = unzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    expect(Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0)).toBeLessThanOrEqual(100);
  });
});

describe('a ZIP failure that still happens', () => {
  it('is rethrown with a localised message and keeps the original as its cause', async () => {
    const original = new zipModule.ZipLimitError('bytes', 'The export is too large for a ZIP file (4 GB limit). Export fewer channels at once.');
    vi.mocked(zipModule.buildZip).mockRejectedValueOnce(original);
    const failure = await run(['a', 'b'], { a: 1, b: 1 }, { options: { ...OPTIONS, locale: 'ko' } }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('ZIP 파일 하나에 담기에는 너무 큽니다 (한도: 약 3.75GB). 한 번에 내보내는 채널 수를 줄이세요.');
    expect((failure as Error).cause).toBe(original);
  });

  it('keeps the message of an unexpected error', async () => {
    vi.mocked(zipModule.buildZip).mockRejectedValueOnce(new Error('disk full'));
    await expect(run(['a', 'b'], { a: 1, b: 1 })).rejects.toThrow('disk full');
  });

  it('localises the entry-count limit too', async () => {
    vi.mocked(zipModule.buildZip).mockRejectedValueOnce(new zipModule.ZipLimitError('entries', 'Too many ZIP entries (70000).'));
    await expect(run(['a', 'b'], { a: 1, b: 1 })).rejects.toThrow('Too many files for one ZIP file (limit: 65,535). Export fewer channels at once.');
  });
});
