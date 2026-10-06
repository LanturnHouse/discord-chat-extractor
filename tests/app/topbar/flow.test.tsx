// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { ExportFormat, ExportFormatId } from '@/lib/export/types';
import { bootTopBar, select, type BootedTopBar } from './helpers';

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  /** Called with the number of writers created so far; lets a test act in the middle of a run. */
  onWriter: vi.fn<(count: number) => void>(),
  writers: { count: 0 },
}));

vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));
// The real TXT format keeps the flow honest and fast; the other formats are not needed here.
vi.mock('@/lib/export/formats', () => ({
  loadExportFormat: async (id: ExportFormatId): Promise<ExportFormat> => {
    if (id !== 'txt') throw new Error(`format ${id} is not loaded in this test`);
    const { txtFormat } = await import('@/lib/export/formats/txt');
    return {
      ...txtFormat,
      createWriter(ctx) {
        mocks.writers.count += 1;
        mocks.onWriter(mocks.writers.count);
        return txtFormat.createWriter(ctx);
      },
    };
  },
}));

let consoleError: ReturnType<typeof vi.spyOn>;
let booted: BootedTopBar;

beforeEach(() => {
  mocks.saveBlob.mockReset();
  mocks.onWriter.mockReset();
  mocks.writers.count = 0;
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  cleanup();
});

async function setup(channelIds: string[]): Promise<void> {
  booted = await bootTopBar('en');
  select(...channelIds);
  render(<TopBar />);
}

/** Picks TXT in the options popover the way a user does, then closes it. */
function chooseTxt(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Export options' }));
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Format' })).getByRole('radio', { name: /^TXT/ }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

describe('select, pick TXT, press Download', () => {
  it('saves a single ZIP with one file per selected channel and shows the summary', async () => {
    await setup([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    expect(screen.getByRole('button', { name: /selected/ }).textContent).toBe('2 selected');
    chooseTxt();
    expect(booted.platform.spies.savePrefs).toHaveBeenCalledWith(expect.objectContaining({ exportFormat: 'txt' }));
    expect(screen.getByRole('button', { name: /^Download/ }).textContent).toBe('DownloadTXT');

    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    expect(screen.getByRole('dialog', { name: 'Exporting chats…' })).toBeTruthy();

    const done = await screen.findByRole('dialog', { name: 'Export complete' });
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = mocks.saveBlob.mock.calls[0];
    expect(filename).toMatch(/\.zip$/);

    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const names = Object.keys(entries);
    expect(names).toHaveLength(2);
    expect(names.every((name) => name.endsWith('.txt'))).toBe(true);
    expect(names.some((name) => name.includes('edge-199'))).toBe(true);
    expect(names.some((name) => name.includes('edge-200'))).toBe(true);
    for (const name of names) expect(strFromU8(entries[name]).length).toBeGreaterThan(0);

    expect(within(done).getByText(`2 channels, 399 messages saved as ${filename}`)).toBeTruthy();
    expect(within(done).queryByText(/Skipped|Failed/)).toBeNull();

    // The dialog stays until the user closes it; the selection survives for the next export.
    fireEvent.click(within(done).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Download/ }));
    expect(Object.keys(appStore.getState().selection)).toHaveLength(2);
  });

  it('one channel is saved as the plain file, not zipped', async () => {
    await setup([MOCK_IDS.edge199Channel]);
    chooseTxt();
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const done = await screen.findByRole('dialog', { name: 'Export complete' });

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = mocks.saveBlob.mock.calls[0];
    expect(filename).toMatch(/ - edge-199\.txt$/);
    expect(await blob.text()).toContain('edge-199');
    expect(within(done).getByText(`1 channel, 199 messages saved as ${filename}`)).toBeTruthy();
  });

  it('lists a channel that could not be read next to what was saved', async () => {
    await setup([MOCK_IDS.edge199Channel, MOCK_IDS.forbiddenChannel]);
    chooseTxt();
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const done = await screen.findByRole('dialog', { name: 'Export complete' });

    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(within(done).getByText('Skipped, no access: 1')).toBeTruthy();
    const section = done.querySelector('.topbar-failures') as HTMLElement;
    expect(section.textContent).toContain('비공개-라운지');
    expect(section.textContent).toContain('403');
  });

  it('nothing is saved when no channel could be exported, and the dialog says so', async () => {
    await setup([MOCK_IDS.forbiddenChannel]);
    chooseTxt();
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const done = await screen.findByRole('dialog', { name: 'Export complete' });
    expect(mocks.saveBlob).not.toHaveBeenCalled();
    expect(within(done).getByText('None of the selected channels could be exported.')).toBeTruthy();
    expect(within(done).getByText('Skipped, no access: 1')).toBeTruthy();
  });

  it('the date range limits what is exported', async () => {
    await setup([MOCK_IDS.edge400Channel]);
    chooseTxt();
    const all = await booted.client.getMessages(MOCK_IDS.edge400Channel, { limit: 100 });
    const cutoff = new Date(all[19].timestamp);
    const day = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

    fireEvent.click(screen.getByRole('button', { name: 'Export options' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: day } });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const done = await screen.findByRole('dialog', { name: 'Export complete' });

    const messageCount = appStore.getState().exportJob.output?.messageCount ?? 0;
    expect(messageCount).toBeGreaterThanOrEqual(20);
    expect(messageCount).toBeLessThan(400);
    expect(within(done).getByText(new RegExp(`1 channel, ${messageCount} messages saved as`))).toBeTruthy();
  });
});

describe('cancelling in the middle', () => {
  it('downloads nothing by itself; "Save the completed channels" saves what was finished', async () => {
    await setup([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel, MOCK_IDS.edge201Channel]);
    chooseTxt();
    // Press Cancel in the dialog while the second channel starts.
    mocks.onWriter.mockImplementation((count) => {
      if (count === 2) fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const cancelled = await screen.findByRole('dialog', { name: 'Export cancelled' });

    expect(mocks.saveBlob).not.toHaveBeenCalled();
    expect(within(cancelled).getByText('1 channel was finished before you cancelled.')).toBeTruthy();
    const save = within(cancelled).getByRole('button', { name: 'Save the 1 completed channel' });

    fireEvent.click(save);
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob.mock.calls[0][1]).toMatch(/ - edge-199\.txt$/);
    expect(mocks.saveBlob.mock.calls[0][0].size).toBeGreaterThan(0);
    expect(within(cancelled).getByText(/1 channel saved as .* - edge-199\.txt\./)).toBeTruthy();

    fireEvent.click(within(cancelled).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelling before the first channel finished leaves nothing to save', async () => {
    await setup([MOCK_IDS.edge400Channel, MOCK_IDS.edge200Channel]);
    chooseTxt();
    mocks.onWriter.mockImplementation((count) => {
      if (count === 1) fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const cancelled = await screen.findByRole('dialog', { name: 'Export cancelled' });

    expect(within(cancelled).getByText('No channel was finished, so there is nothing to save.')).toBeTruthy();
    expect(within(cancelled).queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });

  it('a new export can follow a cancelled one', async () => {
    await setup([MOCK_IDS.edge199Channel]);
    chooseTxt();
    mocks.onWriter.mockImplementationOnce(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    mocks.onWriter.mockReset();
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    await screen.findByRole('dialog', { name: 'Export complete' });
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  });
});

describe('where the dialog lives', () => {
  it('in the page body, not inside the top bar (so no stacking context of the bar can hide it)', async () => {
    await setup([MOCK_IDS.edge199Channel]);
    chooseTxt();
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('header')).toBeNull();
    await screen.findByRole('dialog', { name: 'Export complete' });
  });
});
