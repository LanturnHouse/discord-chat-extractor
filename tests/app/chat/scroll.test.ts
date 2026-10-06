import { describe, expect, it } from 'vitest';
import {
  JUMP_DISTANCE_VIEWPORTS,
  NEAR_TOP_PX,
  PIN_TOLERANCE_PX,
  anchorShift,
  bottomScrollTop,
  captureAnchor,
  contentOverflows,
  distanceFromBottom,
  firstVisibleIndex,
  isNearBottom,
  isNearTop,
  isOutsideView,
  keyScrollsUp,
  prependedCount,
  shouldLoadOlder,
  shouldShowJumpToLatest,
  userScrolledAway,
  type OlderLoadInput,
  type ScrollMetrics,
} from '@/app/components/chat/scroll';

const metrics = (scrollTop: number, scrollHeight: number, clientHeight: number): ScrollMetrics => ({ scrollTop, scrollHeight, clientHeight });

describe('bottom maths', () => {
  it('bottomScrollTop is the largest valid scrollTop and never negative', () => {
    expect(bottomScrollTop(metrics(0, 5000, 600))).toBe(4400);
    expect(bottomScrollTop(metrics(0, 500, 600))).toBe(0);
    expect(bottomScrollTop(metrics(0, 600, 600))).toBe(0);
    expect(bottomScrollTop(metrics(0, 0, 0))).toBe(0);
  });

  it('distanceFromBottom counts pixels below the viewport and never goes negative', () => {
    expect(distanceFromBottom(metrics(4400, 5000, 600))).toBe(0);
    expect(distanceFromBottom(metrics(4000, 5000, 600))).toBe(400);
    expect(distanceFromBottom(metrics(0, 5000, 600))).toBe(4400);
    // overscroll / rounding can put scrollTop past the maximum
    expect(distanceFromBottom(metrics(4402, 5000, 600))).toBe(0);
    expect(distanceFromBottom(metrics(0, 300, 600))).toBe(0);
  });

  it('isNearBottom honours the tolerance (inclusive) and a custom one', () => {
    expect(isNearBottom(metrics(4400, 5000, 600))).toBe(true);
    expect(isNearBottom(metrics(4400 - PIN_TOLERANCE_PX, 5000, 600))).toBe(true);
    expect(isNearBottom(metrics(4400 - PIN_TOLERANCE_PX - 1, 5000, 600))).toBe(false);
    expect(isNearBottom(metrics(4300, 5000, 600), 100)).toBe(true);
    expect(isNearBottom(metrics(4299, 5000, 600), 100)).toBe(false);
    // content that does not overflow is always at its bottom
    expect(isNearBottom(metrics(0, 300, 600))).toBe(true);
  });
});

describe('top maths', () => {
  it('isNearTop is inclusive at the threshold', () => {
    expect(isNearTop(metrics(0, 5000, 600))).toBe(true);
    expect(isNearTop(metrics(NEAR_TOP_PX, 5000, 600))).toBe(true);
    expect(isNearTop(metrics(NEAR_TOP_PX + 1, 5000, 600))).toBe(false);
    expect(isNearTop(metrics(150, 5000, 600), 100)).toBe(false);
  });

  it('contentOverflows is strict', () => {
    expect(contentOverflows(metrics(0, 601, 600))).toBe(true);
    expect(contentOverflows(metrics(0, 600, 600))).toBe(false);
    expect(contentOverflows(metrics(0, 100, 600))).toBe(false);
  });
});

describe('shouldShowJumpToLatest', () => {
  const viewport = 600;

  it('appears beyond 1.5 viewports from the bottom, not at it', () => {
    const limit = JUMP_DISTANCE_VIEWPORTS * viewport; // 900
    expect(shouldShowJumpToLatest(metrics(10_000 - viewport, 10_000, viewport))).toBe(false);
    expect(shouldShowJumpToLatest(metrics(10_000 - viewport - limit, 10_000, viewport))).toBe(false);
    expect(shouldShowJumpToLatest(metrics(10_000 - viewport - limit - 1, 10_000, viewport))).toBe(true);
    expect(shouldShowJumpToLatest(metrics(0, 10_000, viewport))).toBe(true);
  });

  it('accepts a different distance and never shows before layout exists', () => {
    expect(shouldShowJumpToLatest(metrics(7500, 10_000, viewport), 3)).toBe(true);
    expect(shouldShowJumpToLatest(metrics(7700, 10_000, viewport), 3)).toBe(false);
    expect(shouldShowJumpToLatest(metrics(0, 0, 0))).toBe(false);
    expect(shouldShowJumpToLatest(metrics(0, 5000, 0))).toBe(false);
  });
});

describe('userScrolledAway', () => {
  /** The list as our last pin left it: 5000px tall in a 600px viewport, at the bottom (4400). */
  const pinned = metrics(4400, 5000, 600);
  const m = (scrollTop: number): ScrollMetrics => metrics(scrollTop, 5000, 600);

  it('is false while at the bottom', () => {
    expect(userScrolledAway(m(4400), pinned)).toBe(false);
    expect(userScrolledAway(m(4397), pinned)).toBe(false);
  });

  it('is true when the list is away from the bottom, not where our pin left it, and was not re-laid-out', () => {
    expect(userScrolledAway(m(4300), pinned)).toBe(true);
    expect(userScrolledAway(m(0), pinned)).toBe(true);
  });

  it('ignores our own pin whose scroll event arrives after the content grew (the pin position is unchanged)', () => {
    // the content grew by 300px after the pin: the list is 300px from the new bottom, but scrollTop is still the pinned one
    expect(userScrolledAway(metrics(4400, 5300, 600), pinned)).toBe(false);
    expect(userScrolledAway(metrics(4402, 5300, 600), pinned)).toBe(false);
  });

  it('ignores a browser correction that keeps the bottom (content above shrank)', () => {
    expect(userScrolledAway(metrics(3900, 4500, 600), pinned)).toBe(false);
  });

  it('ignores the scroll anchoring of a reflow: the layout changed since the pin, whichever way scrollTop moved', () => {
    // a narrower window: the content got 750px taller and the browser moved scrollTop by 154px to keep its anchor row in place
    const before = metrics(15_816, 16_568, 752);
    expect(userScrolledAway(metrics(15_970, 17_318, 752), before)).toBe(false);
    expect(userScrolledAway(metrics(4390, 5300, 600), pinned)).toBe(false);
    // the viewport itself changed height (the window was resized)
    expect(userScrolledAway(metrics(3000, 5000, 400), pinned)).toBe(false);
    expect(userScrolledAway(metrics(3000, 5000, 800), pinned)).toBe(false);
  });
});

describe('keyScrollsUp', () => {
  it('is true for the keys that move towards older messages', () => {
    for (const key of ['PageUp', 'Home', 'ArrowUp']) expect(keyScrollsUp(key, false), key).toBe(true);
    expect(keyScrollsUp(' ', true)).toBe(true); // Shift+Space is a page up
  });

  it('is false for the keys that only move down, and for every other key', () => {
    for (const key of ['PageDown', 'End', 'ArrowDown', 'Tab', 'a', 'Enter', 'Escape']) expect(keyScrollsUp(key, false), key).toBe(false);
    expect(keyScrollsUp(' ', false)).toBe(false); // Space is a page down
  });
});

describe('isOutsideView', () => {
  const view = { top: 48, bottom: 900 };

  it('is false for a box that is entirely inside (the edges count as inside)', () => {
    expect(isOutsideView({ top: 300, bottom: 320 }, view)).toBe(false);
    expect(isOutsideView({ top: 48, bottom: 900 }, view)).toBe(false);
  });

  it('is true when any part of the box is above or below: focusing it scrolls', () => {
    expect(isOutsideView({ top: -13_626, bottom: -13_606 }, view)).toBe(true);
    expect(isOutsideView({ top: 1200, bottom: 1220 }, view)).toBe(true);
    expect(isOutsideView({ top: 40, bottom: 60 }, view)).toBe(true);
    expect(isOutsideView({ top: 890, bottom: 910 }, view)).toBe(true);
  });
});

describe('shouldLoadOlder', () => {
  const base: OlderLoadInput = {
    scrollTop: 100,
    scrollHeight: 10_000,
    clientHeight: 600,
    status: 'loaded',
    hasMore: true,
    loadingOlder: false,
    olderFailed: false,
  };
  const want = (overrides: Partial<OlderLoadInput>): boolean => shouldLoadOlder({ ...base, ...overrides });

  it('loads when the viewport is near the top of a loaded channel with more to give', () => {
    expect(want({})).toBe(true);
    expect(want({ scrollTop: 0 })).toBe(true);
    expect(want({ scrollTop: NEAR_TOP_PX })).toBe(true);
  });

  it('does not load further than the threshold from the top', () => {
    expect(want({ scrollTop: NEAR_TOP_PX + 1 })).toBe(false);
    expect(want({ scrollTop: 9400 })).toBe(false);
    expect(shouldLoadOlder({ ...base, scrollTop: 300 }, 200)).toBe(false);
  });

  it('never loads while a request is in flight, at the start of the channel, or when not loaded', () => {
    expect(want({ loadingOlder: true })).toBe(false);
    expect(want({ hasMore: false })).toBe(false);
    for (const status of ['idle', 'loading', 'error', 'forbidden'] as const) expect(want({ status })).toBe(false);
  });

  it('never retries on its own after a failed request', () => {
    expect(want({ olderFailed: true })).toBe(false);
    expect(want({ olderFailed: true, scrollTop: 0, scrollHeight: 100 })).toBe(false);
  });

  it('keeps loading while the messages do not fill the viewport, wherever scrollTop is', () => {
    expect(want({ scrollHeight: 400, scrollTop: 0 })).toBe(true);
    expect(want({ scrollHeight: 600, scrollTop: 0 })).toBe(true);
    // ... until they overflow far enough that the user is not near the top any more
    expect(want({ scrollHeight: 5000, scrollTop: 4400 })).toBe(false);
  });

  it('waits for layout: all-zero metrics are "not laid out yet", not an empty list to fill', () => {
    expect(want({ scrollHeight: 0, clientHeight: 0, scrollTop: 0 })).toBe(false);
    expect(want({ clientHeight: 0 })).toBe(false);
  });

  it('a short list with nothing more to load stops (no endless fill loop)', () => {
    expect(want({ scrollHeight: 100, hasMore: false })).toBe(false);
  });
});

describe('prependedCount', () => {
  const ids = (...values: number[]): { id: string }[] => values.map((value) => ({ id: String(value) }));

  it('counts the entries added in front', () => {
    expect(prependedCount(ids(3, 4, 5), ids(1, 2, 3, 4, 5))).toBe(2);
    expect(prependedCount(ids(5), ids(1, 2, 3, 4, 5))).toBe(4);
  });

  it('is 0 for everything that is not a pure prepend', () => {
    expect(prependedCount(ids(1, 2, 3), ids(1, 2, 3))).toBe(0); // same list
    expect(prependedCount(ids(), ids(1, 2))).toBe(0); // first load, nothing to keep in place
    expect(prependedCount(ids(1, 2), ids())).toBe(0); // shrank
    expect(prependedCount(ids(3, 4), ids(1, 2, 5, 6))).toBe(0); // replaced
    expect(prependedCount(ids(3, 4), ids(1, 2, 3, 5))).toBe(0); // the tail changed
    expect(prependedCount(ids(3, 4), ids(3, 4, 5))).toBe(0); // appended, not prepended
  });
});

/** Rows of known heights stacked from `origin`; the helpers below stand in for the DOM. */
function stack(heights: readonly number[], origin = 0): number[] {
  const tops: number[] = [];
  let top = origin;
  for (const height of heights) {
    tops.push(top);
    top += height;
  }
  return tops;
}

describe('firstVisibleIndex', () => {
  const find = (tops: readonly number[], scrollTop: number): number => firstVisibleIndex(tops.length, (index) => tops[index] - scrollTop);

  it('is -1 without rows', () => {
    expect(find([], 0)).toBe(-1);
  });

  it('finds the first row that starts at or below the top edge of the viewport', () => {
    const tops = [0, 50, 100, 150, 200];
    expect(find(tops, 0)).toBe(0);
    expect(find(tops, 1)).toBe(1); // row 0 is cut off by one pixel
    expect(find(tops, 50)).toBe(1); // starts exactly at the edge: visible
    expect(find(tops, 120)).toBe(3);
    expect(find(tops, 200)).toBe(4);
  });

  it('takes the last row when every row starts above the viewport', () => {
    expect(find([0, 50, 100], 500)).toBe(2);
  });

  it('works for a single row and for rows below a header', () => {
    expect(find([300], 0)).toBe(0);
    expect(find([300], 900)).toBe(0);
    expect(find(stack([50, 50, 50], 200), 100)).toBe(0); // everything starts below the edge: the first row
  });

  it('agrees with a linear scan on a large list of uneven rows, and probes only a handful of rows', () => {
    const heights = Array.from({ length: 2000 }, (_, index) => 22 + ((index * 37) % 140));
    const tops = stack(heights, 120);
    for (const scrollTop of [0, 17, 120, 121, 5000, 123_456, 10 ** 9]) {
      let probes = 0;
      const index = firstVisibleIndex(tops.length, (i) => {
        probes += 1;
        return tops[i] - scrollTop;
      });
      const linear = tops.findIndex((top) => top - scrollTop >= 0);
      expect(index).toBe(linear === -1 ? tops.length - 1 : linear);
      expect(probes).toBeLessThanOrEqual(12);
    }
  });
});

describe('captureAnchor / anchorShift: the anchor row stays at the same pixel offset after a prepend', () => {
  /** A list: `above` older rows of the given heights are placed in front of `rows`, all inside a content area that starts at `origin`. */
  function viewportOffsets(rowHeights: readonly number[], origin: number, scrollTop: number): number[] {
    return stack(rowHeights, origin).map((top) => top - scrollTop);
  }

  function simulate(options: { before: number[]; prepended: number[]; scrollTop: number; origin?: number; originAfter?: number }): { offsetBefore: number; offsetAfter: number; newScrollTop: number } {
    const { before, prepended, scrollTop } = options;
    const origin = options.origin ?? 0;
    const originAfter = options.originAfter ?? origin;
    const offsetsBefore = viewportOffsets(before, origin, scrollTop);
    const captured = captureAnchor(before.length, (i) => offsetsBefore[i], (i) => `row-${i}`);
    expect(captured).not.toBeNull();
    const { index, anchor } = captured!;
    // after the prepend the same row has moved down by the new rows (and by whatever else changed above it)
    const after = [...prepended, ...before];
    const offsetsAfter = viewportOffsets(after, originAfter, scrollTop);
    const currentOffset = offsetsAfter[prepended.length + index];
    const shift = anchorShift(anchor, currentOffset);
    const newScrollTop = scrollTop + shift;
    const offsetAfter = viewportOffsets(after, originAfter, newScrollTop)[prepended.length + index];
    return { offsetBefore: anchor.offset, offsetAfter, newScrollTop };
  }

  const rows = (count: number, height: number): number[] => Array.from({ length: count }, () => height);

  it('keeps a mid-list row where it was', () => {
    const result = simulate({ before: rows(200, 60), prepended: rows(200, 60), scrollTop: 340 });
    expect(result.offsetAfter).toBe(result.offsetBefore);
    expect(result.newScrollTop).toBe(340 + 200 * 60);
  });

  it('works at scrollTop 0 (where the browser does no anchoring of its own)', () => {
    const result = simulate({ before: rows(50, 40), prepended: rows(10, 33), scrollTop: 0 });
    expect(result.offsetAfter).toBe(result.offsetBefore);
    expect(result.newScrollTop).toBe(330);
  });

  it('works with uneven rows and fractional offsets', () => {
    const before = Array.from({ length: 80 }, (_, i) => 22.5 + (i % 7) * 11.25);
    const prepended = Array.from({ length: 200 }, (_, i) => 26 + (i % 5) * 17.5);
    const result = simulate({ before, prepended, scrollTop: 413.75 });
    expect(result.offsetAfter).toBeCloseTo(result.offsetBefore, 9);
  });

  it('also absorbs other things that changed above the rows at the same time (banner appears, loader goes)', () => {
    const result = simulate({ before: rows(100, 50), prepended: rows(30, 50), scrollTop: 800, origin: 0, originAfter: 220 });
    expect(result.offsetAfter).toBe(result.offsetBefore);
    expect(result.newScrollTop).toBe(800 + 30 * 50 + 220);
  });

  it('needs no correction when the browser already moved the viewport (idempotent)', () => {
    const anchor = { id: 'x', offset: 123 };
    expect(anchorShift(anchor, 123)).toBe(0);
    expect(anchorShift(anchor, 123.3)).toBe(0); // below half a pixel: invisible, would be rounded away
    expect(anchorShift(anchor, 123.5)).toBe(0.5);
    expect(anchorShift(anchor, 1123)).toBe(1000);
    expect(anchorShift(anchor, -877)).toBe(-1000);
  });

  it('reports the id of the row it anchored on and is null for no rows', () => {
    const tops = stack([50, 50, 50, 50]);
    const captured = captureAnchor(tops.length, (i) => tops[i] - 120, (i) => `msg-${i}`);
    expect(captured).toEqual({ index: 3, anchor: { id: 'msg-3', offset: 30 } });
    expect(captureAnchor(0, () => 0, () => 'x')).toBeNull();
  });
});
