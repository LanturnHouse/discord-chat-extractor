// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { appStore } from '@/app/state/store';

vi.mock('@/lib/export/formats', () => ({ loadExportFormat: vi.fn() }));
const thrown = vi.hoisted(() => ({ error: undefined as unknown }));
// The area components follow a contract (named export, no props); one of them blowing up must not blank the page.
vi.mock('@/app/components/chat/ChatPane', () => ({
  ChatPane: () => {
    throw thrown.error;
  },
}));

beforeEach(() => {
  thrown.error = new Error('message list exploded');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function crash(locale: 'ko' | 'en'): HTMLElement {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  appStore.setState(appStore.getInitialState(), true);
  appStore.setState({ init: vi.fn(async () => undefined), status: 'ready', locale });
  render(<App />);
  return screen.getByRole('alert');
}

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

  it('keeps the exception text out of the sentence: a Korean sentence, the English message only in a collapsed, labelled block', () => {
    const panel = crash('ko');
    expect(panel.querySelector('.app-fatal__message')?.textContent).toBe('페이지를 새로고침하면 다시 시도할 수 있어요.');
    const details = panel.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('기술 세부 정보');
    const detail = details.querySelector('pre') as HTMLElement;
    expect(detail.textContent).toBe('Error: message list exploded');
    expect(detail.getAttribute('lang')).toBe('en');
    // nothing of it outside the block
    expect((panel.textContent ?? '').replace(details.textContent ?? '', '')).not.toContain('exploded');
    expect(screen.getByRole('button', { name: '페이지 새로고침' })).toBeTruthy();
  });

  it('labels the block in English too', () => {
    const panel = crash('en');
    expect(panel.querySelector('.app-fatal__message')?.textContent).toBe('Reloading the page lets you try again.');
    expect(panel.querySelector('details summary')?.textContent).toBe('Technical details');
  });

  it('never puts a token, an id or the query of a URL into the details', () => {
    thrown.error = new TypeError('Failed to load https://cdn.example.com/a.png?token=abcdef123 for 123456789012345678 with mfa.abcdefghijklmnopqrstuvwxyz0123456789');
    const detail = crash('en').querySelector('details pre')?.textContent ?? '';
    expect(detail).toBe('TypeError: Failed to load https://cdn.example.com/a.png for <id> with [redacted]');
  });

  it('shows no block at all for an exception without a message', () => {
    thrown.error = new Error('');
    const panel = crash('en');
    expect(panel.querySelector('details')).toBeNull();
    expect(panel.querySelector('.app-fatal__message')?.textContent).toBe('Reloading the page lets you try again.');
  });

  it('copes with something that is not an Error being thrown', () => {
    thrown.error = 'plain string';
    const panel = crash('en');
    expect(panel.querySelector('details pre')?.textContent).toBe('Error: plain string');
  });
});
