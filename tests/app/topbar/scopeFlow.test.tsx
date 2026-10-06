// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import { isoToDateInput } from '@/app/components/topbar/dates';
import { appStore } from '@/app/state/store';
import { MOCK_IDS } from '@/lib/discord/mock';
import type { Message } from '@/lib/discord/types';
import type { ExportFormat, ExportFormatId } from '@/lib/export/types';
import { fullHistory } from '../helpers';
import { bootTopBar, idLinesFormat, select, type BootedTopBar } from './helpers';

const mocks = vi.hoisted(() => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
  loadExportFormat: vi.fn<(id: ExportFormatId) => Promise<ExportFormat>>(),
}));

vi.mock('@/lib/export/download', () => ({ saveBlob: mocks.saveBlob }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: mocks.loadExportFormat }));

let consoleError: ReturnType<typeof vi.spyOn>;
let booted: BootedTopBar;

beforeEach(() => {
  mocks.saveBlob.mockReset();
  mocks.loadExportFormat.mockReset();
  // A fast format: a header line and one line per message id, so a file's lines ARE its messages.
  mocks.loadExportFormat.mockImplementation(async (id) => idLinesFormat(id));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  cleanup();
});

const chip = (): HTMLElement => screen.getByRole('button', { name: /selected/ });
const download = (): HTMLElement => screen.getByRole('button', { name: /^Download/ });
const optionsPanel = (): HTMLElement => screen.getByRole('dialog', { name: 'Export options' });
const listPanel = (): HTMLElement => screen.getByRole('dialog', { name: 'Selected chats' });
const rowPanel = (name: string): HTMLElement => within(listPanel()).getByRole('group', { name: `Export settings for ${name}` });

async function setup(channelIds: string[]): Promise<void> {
  booted = await bootTopBar('en');
  select(...channelIds);
  render(<TopBar />);
}

/** Options popover: "Limit to N" with the given number, then closed. */
function setCommonLimit(value: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Export options' }));
  fireEvent.click(within(optionsPanel()).getByRole('radio', { name: 'Limit to N' }));
  fireEvent.change(within(optionsPanel()).getByRole('spinbutton'), { target: { value } });
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

/** Selection list: the settings of one channel, with "Use common settings" switched off. Leaves the list open. */
function openOwnSettings(name: string): HTMLElement {
  if (screen.queryByRole('dialog', { name: 'Selected chats' }) === null) fireEvent.click(chip());
  fireEvent.click(within(listPanel()).getByRole('button', { name: `Export settings for ${name}` }));
  fireEvent.click(within(rowPanel(name)).getByRole('checkbox', { name: 'Use common settings' }));
  return rowPanel(name);
}

/** The ids inside the ZIP, per channel (the entry whose path contains the channel's name). */
async function zipLines(): Promise<Record<string, string[]>> {
  expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
  const [blob] = mocks.saveBlob.mock.calls[0];
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const lines: Record<string, string[]> = {};
  for (const [path, bytes] of Object.entries(entries)) {
    const name = ['edge-199', 'edge-200', 'edge-400', 'edge-401'].find((candidate) => path.includes(candidate));
    expect(name, path).toBeDefined();
    lines[name ?? path] = strFromU8(bytes)
      .split('\n')
      .filter((line) => /^\d+$/.test(line));
  }
  return lines;
}

const idsOf = (messages: readonly Message[]): string[] => messages.map((message) => message.id);

describe('select two channels, set a common count, give one channel its own count, press Download', () => {
  it('the ZIP holds the common number of messages for one channel and the channel\'s own number for the other', async () => {
    await setup([MOCK_IDS.edge400Channel, MOCK_IDS.edge200Channel]);
    setCommonLimit('150');
    expect(appStore.getState().exportSettings.limit).toBe(150);

    const panel = openOwnSettings('edge-200');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Limit to N' }));
    fireEvent.change(within(panel).getByRole('spinbutton'), { target: { value: '50' } });
    expect(appStore.getState().exportOverrides[MOCK_IDS.edge200Channel]).toEqual({ after: null, before: null, limit: 50 });
    // The row says so, the chip says so.
    expect(within(listPanel()).getByText('Newest 50 messages')).toBeTruthy();
    expect(chip().getAttribute('aria-label')).toBe('2 selected, 1 with own settings');

    fireEvent.pointerDown(document.body);
    fireEvent.click(download());
    const done = await screen.findByRole('dialog', { name: 'Export complete' });

    const lines = await zipLines();
    expect(Object.keys(lines).sort()).toEqual(['edge-200', 'edge-400']);
    expect(lines['edge-400']).toEqual(idsOf((await fullHistory(MOCK_IDS.edge400Channel)).slice(-150)));
    expect(lines['edge-200']).toEqual(idsOf((await fullHistory(MOCK_IDS.edge200Channel)).slice(-50)));
    expect(within(done).getByText(/^2 channels, 200 messages saved as /)).toBeTruthy();
  });

  it('the common count for everything but one channel that is exported completely', async () => {
    await setup([MOCK_IDS.edge400Channel, MOCK_IDS.edge401Channel]);
    setCommonLimit('200');
    const panel = openOwnSettings('edge-401');
    // Its settings start from the common ones (200 newest); "All" makes it export everything.
    expect(within(panel).getByRole('spinbutton')).toHaveProperty('value', '200');
    fireEvent.click(within(panel).getByRole('radio', { name: 'All' }));
    fireEvent.pointerDown(document.body);

    fireEvent.click(download());
    await screen.findByRole('dialog', { name: 'Export complete' });
    const lines = await zipLines();
    expect(lines['edge-400']).toHaveLength(200);
    expect(lines['edge-401']).toHaveLength(401);
    expect(lines['edge-400']).toEqual(idsOf((await fullHistory(MOCK_IDS.edge400Channel)).slice(-200)));
    expect(booted.spies.getMessages.mock.calls.filter(([id]) => id === MOCK_IDS.edge400Channel).length).toBeLessThanOrEqual(3);
  });

  it('a channel with a start date and a count takes the FIRST messages from that day on, while the others stay on the newest', async () => {
    await setup([MOCK_IDS.edge400Channel, MOCK_IDS.edge200Channel]);
    setCommonLimit('20');
    const history = await fullHistory(MOCK_IDS.edge200Channel);
    const day = isoToDateInput(history[40].timestamp);
    const panel = openOwnSettings('edge-200');
    fireEvent.change(within(panel).getByLabelText('From'), { target: { value: day } });
    expect(within(panel).getByText('Starts at the start date and takes the first 20 messages going forward.')).toBeTruthy();
    fireEvent.pointerDown(document.body);

    fireEvent.click(download());
    await screen.findByRole('dialog', { name: 'Export complete' });
    const lines = await zipLines();
    const startOfDay = new Date(`${day}T00:00:00`).getTime();
    expect(lines['edge-200']).toEqual(idsOf(history.filter((message) => Date.parse(message.timestamp) >= startOfDay).slice(0, 20)));
    expect(lines['edge-400']).toEqual(idsOf((await fullHistory(MOCK_IDS.edge400Channel)).slice(-20)));
  });

  it('the channel\'s own settings win over the common dates as well: it ignores them', async () => {
    await setup([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    const history = await fullHistory(MOCK_IDS.edge199Channel);
    const day = isoToDateInput(history[190].timestamp);
    fireEvent.click(screen.getByRole('button', { name: 'Export options' }));
    fireEvent.change(within(optionsPanel()).getByLabelText('From'), { target: { value: day } });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    const panel = openOwnSettings('edge-200');
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear start date' }));
    fireEvent.pointerDown(document.body);
    fireEvent.click(download());
    await screen.findByRole('dialog', { name: 'Export complete' });

    const lines = await zipLines();
    expect(lines['edge-200']).toHaveLength(200);
    expect(lines['edge-199'].length).toBeLessThan(15);
    expect(lines['edge-199'].length).toBeGreaterThan(0);
  });

  it('without any count nothing changes: every channel is exported completely', async () => {
    await setup([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    fireEvent.click(download());
    await screen.findByRole('dialog', { name: 'Export complete' });
    const lines = await zipLines();
    expect([lines['edge-199'].length, lines['edge-200'].length]).toEqual([199, 200]);
  });
});

describe('an invalid setting stops the real Download', () => {
  it('nothing is fetched while a channel\'s count is wrong; fixing it exports with the fixed value', async () => {
    await setup([MOCK_IDS.edge199Channel, MOCK_IDS.edge200Channel]);
    const panel = openOwnSettings('edge-200');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Limit to N' }));
    fireEvent.change(within(panel).getByRole('spinbutton'), { target: { value: '0' } });
    fireEvent.pointerDown(document.body);

    fireEvent.click(download());
    expect(booted.spies.getMessages).not.toHaveBeenCalled();
    expect(mocks.loadExportFormat).not.toHaveBeenCalled();
    expect(appStore.getState().exportJob.status).toBe('idle');
    expect(screen.queryByRole('dialog', { name: /Exporting|Export complete|Export failed/ })).toBeNull();
    // The list is open at the channel, with the field in focus.
    const field = within(rowPanel('edge-200')).getByRole('spinbutton');
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.pointerDown(document.body);
    fireEvent.click(download());
    await screen.findByRole('dialog', { name: 'Export complete' });
    const lines = await zipLines();
    expect(lines['edge-200']).toHaveLength(12);
    expect(lines['edge-199']).toHaveLength(199);
  });

  it('a wrong common count stops it the same way, and opens the export options', async () => {
    await setup([MOCK_IDS.edge199Channel]);
    fireEvent.click(screen.getByRole('button', { name: 'Export options' }));
    fireEvent.click(within(optionsPanel()).getByRole('radio', { name: 'Limit to N' }));
    fireEvent.change(within(optionsPanel()).getByRole('spinbutton'), { target: { value: '1.5' } });
    fireEvent.pointerDown(document.body);

    fireEvent.click(download());
    expect(mocks.loadExportFormat).not.toHaveBeenCalled();
    expect(optionsPanel()).toBeTruthy();
    expect(document.activeElement).toBe(within(optionsPanel()).getByRole('spinbutton'));
    expect(within(optionsPanel()).getByRole('alert').textContent).toBe('Use a whole number, without decimals.');
  });
});
