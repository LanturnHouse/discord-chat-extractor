// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/app/components/topbar/TopBar';
import type { Platform } from '@/app/platform/types';
import { appStore } from '@/app/state/store';
import { bootTopBar } from './helpers';

const environment = vi.hoisted(() => ({ kind: 'extension' as Platform['kind'] }));

// The top bar asks `getPlatform()` whether there is a live mode to go back to; the tests choose the answer.
vi.mock('@/app/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/platform')>();
  return { ...actual, getPlatform: () => ({ kind: environment.kind }) as Platform };
});
vi.mock('@/lib/export/download', () => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));

let consoleError: ReturnType<typeof vi.spyOn>;
const assign = vi.fn<(url: string) => void>();

beforeEach(() => {
  environment.kind = 'extension';
  assign.mockReset();
  // The page of the demo: the extension's app page with ?mock=1 (and a hash, to see that nothing of it survives).
  vi.stubGlobal('location', { pathname: '/app.html', search: '?mock=1', hash: '#x', assign });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
  cleanup();
});

const header = (): HTMLElement => screen.getByRole('banner');

describe('leaving the demo', () => {
  it('inside the extension the DEMO pill is a button "Leave demo"', async () => {
    await bootTopBar('en');
    render(<TopBar />);
    expect(appStore.getState().mode).toBe('demo');

    const button = within(header()).getByRole('button', { name: 'Leave demo' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.classList.contains('topbar__demo')).toBe(true);
    expect(within(header()).queryByText('DEMO')).toBeNull();
  });

  it('is labelled in Korean', async () => {
    await bootTopBar('ko');
    render(<TopBar />);
    expect(within(header()).getByRole('button', { name: '데모 종료' })).toBeTruthy();
  });

  it('a click loads this same page again, without the mock query (and without a hash)', async () => {
    await bootTopBar('en');
    render(<TopBar />);
    fireEvent.click(within(header()).getByRole('button', { name: 'Leave demo' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/app.html');
  });

  it('it can be reached and used with the keyboard', async () => {
    await bootTopBar('en');
    render(<TopBar />);
    const button = within(header()).getByRole('button', { name: 'Leave demo' });
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    expect(button.tabIndex).toBe(0);
  });

  it('the plain dev server has no live mode: the pill stays a static label', async () => {
    environment.kind = 'dev';
    await bootTopBar('en');
    render(<TopBar />);
    expect(within(header()).getByText('DEMO')).toBeTruthy();
    expect(within(header()).queryByRole('button', { name: /Leave demo/ })).toBeNull();
    expect(header().querySelector('.topbar__account button')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('outside the demo there is neither a pill nor a button', async () => {
    await bootTopBar('en');
    act(() => appStore.setState({ mode: 'live' }));
    render(<TopBar />);
    expect(screen.queryByText('DEMO')).toBeNull();
    expect(screen.queryByRole('button', { name: /Leave demo/ })).toBeNull();
    expect(header().querySelector('.topbar__demo')).toBeNull();
  });

  it('the connected-as text is still there next to the button', async () => {
    await bootTopBar('en');
    render(<TopBar />);
    const label = header().querySelector('.topbar__account') as HTMLElement;
    expect(within(label).getByText(/^Connected as /)).toBeTruthy();
    expect(label.querySelectorAll('button')).toHaveLength(1);
  });
});
