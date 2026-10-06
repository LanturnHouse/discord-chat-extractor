import { act } from '@testing-library/react';
import { appStore } from '@/app/state/store';
import type { ExportJob, Locale } from '@/app/state/types';
import { MOCK_IDS, MOCK_ME } from '@/lib/discord/mock';
import type { ExportFormat, ExportFormatId, ExportProgress, TargetProgress } from '@/lib/export/types';
import { createFakePlatform, createSpiedClient, type FakePlatform, type SpiedClient } from '../helpers';

export interface BootedTopBar extends SpiedClient {
  platform: FakePlatform;
}

/** Resets the app singleton and boots it on a zero-latency mock client (demo mode) with a fake platform. */
export async function bootTopBar(locale: Locale = 'en'): Promise<BootedTopBar> {
  const platform = createFakePlatform();
  const spied = createSpiedClient();
  appStore.setState(appStore.getInitialState(), true);
  appStore.setState({ platform, locale });
  await act(async () => {
    await appStore.getState().initWithClient(spied.client, MOCK_ME);
    await appStore.getState().ensureGuildTree(MOCK_IDS.bigGuild);
  });
  return { ...spied, platform };
}

/** Ticks channels of the main server (their tree must be loaded). */
export function select(...channelIds: string[]): void {
  act(() => {
    for (const id of channelIds) appStore.getState().toggleChannel(id);
  });
}

export function target(patch: Partial<TargetProgress> & Pick<TargetProgress, 'channelId' | 'label'>): TargetProgress {
  return { status: 'queued', fetched: 0, ratio: 0, ...patch };
}

export function progress(targets: TargetProgress[], patch: Partial<ExportProgress> = {}): ExportProgress {
  return {
    phase: 'fetching',
    targets,
    currentIndex: targets.findIndex((entry) => entry.status === 'fetching'),
    totalMessages: targets.reduce((sum, entry) => sum + entry.fetched, 0),
    ...patch,
  };
}

export function makeJob(patch: Partial<ExportJob> = {}): ExportJob {
  return { status: 'running', progress: null, output: null, error: null, startedAt: Date.now(), scope: null, ...patch };
}

/** Puts the export job into an arbitrary state (the dialog is a pure view of it). */
export function setJob(job: ExportJob): void {
  act(() => {
    appStore.setState({ exportJob: job });
  });
}

/** A fast stand-in for a format: a header line, then one line per message id (what the writer was given is what the file holds). */
export function idLinesFormat(id: ExportFormatId): ExportFormat {
  return {
    id,
    label: id,
    extension: id,
    mime: 'text/plain',
    createWriter: () => ({ start: () => ['header\n'], write: (batch) => batch.map((message) => `${message.id}\n`), end: () => [] }),
  };
}
