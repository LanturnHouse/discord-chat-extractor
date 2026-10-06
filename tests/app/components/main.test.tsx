// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('main.tsx', () => {
  it('mounts the app into #root (StrictMode) and boots the demo in a plain browser', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('@/app/main');

    // A plain browser has no extension, so the app goes straight into demo mode with the fictional data.
    await waitFor(() => expect(document.querySelector('.app-shell')).not.toBeNull(), { timeout: 4000 });
    expect(document.querySelector('#root .app-shell')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.documentElement.lang).toMatch(/^(ko|en)$/);
    expect(document.title).toContain('Discord Chat Extractor');
  });
});
