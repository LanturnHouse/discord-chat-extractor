// @vitest-environment jsdom
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '@/app/state';
import type { ExportJob } from '@/app/state/types';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const job = (patch: Partial<ExportJob>): ExportJob => ({ status: 'idle', progress: null, output: null, error: null, startedAt: null, scope: null, ...patch });

/** What closing / reloading the tab does: a cancelable beforeunload event on the window. */
function leavePage(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('main.tsx wires the unload guard to the real store and window', () => {
  it('closing the tab asks for confirmation while an export runs, and not otherwise', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('@/app/main');
    await waitFor(() => expect(document.querySelector('.app-shell')).not.toBeNull(), { timeout: 4000 });

    expect(leavePage().defaultPrevented).toBe(false);

    appStore.setState({ exportJob: job({ status: 'running', startedAt: 1 }) });
    expect(leavePage().defaultPrevented).toBe(true);

    appStore.setState({ exportJob: job({}) });
    expect(leavePage().defaultPrevented).toBe(false);
  });
});
