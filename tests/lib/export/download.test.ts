// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBlob } from '../../../src/lib/export/download';

interface ClickRecord {
  href: string;
  download: string;
  connected: boolean;
  parentIsBody: boolean;
}

describe('saveBlob', () => {
  let clicks: ClickRecord[];
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clicks = [];
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    // jsdom does not implement object URLs.
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true });
    // Real clicks on anchors make jsdom attempt a navigation.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({
        href: this.href,
        download: this.download,
        connected: this.isConnected,
        parentIsBody: this.parentElement === document.body,
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('clicks a temporary download link pointing at an object URL of the blob', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    saveBlob(blob, 'My Server - general.txt');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([{ href: 'blob:mock-url', download: 'My Server - general.txt', connected: true, parentIsBody: true }]);
  });

  it('removes the link right after the click', () => {
    saveBlob(new Blob(['x']), 'a.txt');
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('keeps the object URL alive for a while, then revokes it exactly once', () => {
    saveBlob(new Blob(['x']), 'a.txt');
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    vi.advanceTimersByTime(120_000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('handles several downloads independently', () => {
    createObjectURL.mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
    saveBlob(new Blob(['1']), 'one.txt');
    saveBlob(new Blob(['2']), 'two.txt');
    vi.advanceTimersByTime(60_000);
    expect(clicks.map((c) => c.download)).toEqual(['one.txt', 'two.txt']);
    expect(revokeObjectURL.mock.calls.map((c) => c[0])).toEqual(['blob:one', 'blob:two']);
  });

  it('cleans up and still schedules the revoke when the click throws', () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error('click blocked');
    });
    expect(() => saveBlob(new Blob(['x']), 'a.txt')).toThrow('click blocked');
    expect(document.querySelectorAll('a')).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('throws a clear error when there is no document', () => {
    vi.stubGlobal('document', undefined);
    expect(() => saveBlob(new Blob(['x']), 'a.txt')).toThrow(/browser page/);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('throws a clear error when object URLs are unavailable', () => {
    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true, writable: true });
    expect(() => saveBlob(new Blob(['x']), 'a.txt')).toThrow(/browser page/);
  });
});
