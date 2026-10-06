// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { appStore } from '@/app/state/store';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));
// The area components follow a contract (named export, no props); one of them blowing up must not blank the page.
vi.mock('@/app/components/chat/ChatPane', () => ({
  ChatPane: () => {
    throw new Error('message list exploded');
  },
}));

afterEach(cleanup);

describe('App crash handling', () => {
  it('shows a readable panel with a reload button instead of a blank page', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    appStore.setState(appStore.getInitialState(), true);
    appStore.setState({ init: vi.fn(async () => undefined), status: 'ready', locale: 'en' });
    render(<App />);

    const panel = screen.getByRole('alert');
    expect(panel.textContent).toContain('Something went wrong while showing this screen');
    expect(panel.textContent).toContain('message list exploded');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
    expect(document.querySelector('.app-shell')).toBeNull();
    consoleError.mockRestore();
  });
});
