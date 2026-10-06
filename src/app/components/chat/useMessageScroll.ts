import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DOMAttributes, type RefObject } from 'react';
import { useAppStore, type ChannelMessages } from '@/app/state';
import type { Message, Snowflake } from '@/lib/discord/types';
import {
  bottomScrollTop,
  isNearBottom,
  isOutsideView,
  keyScrollsUp,
  shouldLoadOlder,
  shouldShowJumpToLatest,
  userScrolledAway,
  type ScrollMetrics,
} from './scroll';

/** After a scroll to the bottom (the "jump to latest" button, the End key) has been quiet this long, check that it really got there. */
const SETTLE_DELAY_MS = 160;
const MAX_SETTLE_PASSES = 4;

function readMetrics(element: HTMLElement): ScrollMetrics {
  return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface MessageScrollOptions {
  scrollerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  channelId: Snowflake;
  messages: ChannelMessages;
}

/** The event handlers of the scroll container: between them they decide whether the bottom pin holds (see `useMessageScroll`). */
export type MessageScrollHandlers = Pick<
  DOMAttributes<HTMLElement>,
  'onScroll' | 'onWheel' | 'onTouchStart' | 'onTouchMove' | 'onKeyDown' | 'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'onFocus'
>;

export interface MessageScroll {
  /** The floating "jump to latest" button is visible. */
  showJump: boolean;
  handlers: MessageScrollHandlers;
  jumpToLatest(): void;
  /** The "retry" button of a failed older-page request. */
  retryOlder(): void;
}

/**
 * The imperative half of the message list, for ONE channel instance (the list is remounted per channel):
 *
 * - pinned to the bottom on first paint and while the content settles (images, fonts, rows rendering their real height
 *   under `content-visibility`) and when the window is resized. The pin ends when the user moves the list up (wheel, touch,
 *   keys, the scrollbar) or the focus goes to something out of view, and it comes back as soon as the list is at the bottom
 *   again (scrolled down to it, the "jump to latest" button, a window that grew). So a list that sits at the newest message
 *   stays there whether or not it was touched before, and a user who moved up is left alone;
 * - loads the next older page when the viewport comes within NEAR_TOP_PX of the top, or when the loaded messages do not
 *   fill the viewport. This is a scroll handler (plus a re-check after every commit and size change) instead of an
 *   IntersectionObserver sentinel on purpose: a sentinel only reports *changes* of visibility, so it would stay silent
 *   after a page was added while the list is still short or still close to the top, and the same predicate would be
 *   needed anyway to decide whether to continue. `scroll` events already come at most once per frame;
 * - the "jump to latest" button.
 */
export function useMessageScroll({ scrollerRef, contentRef, channelId, messages }: MessageScrollOptions): MessageScroll {
  const loadOlder = useAppStore((state) => state.loadOlderMessages);
  const [showJump, setShowJump] = useState(false);
  const pinned = useRef(true);
  /** The metrics right after our last pin: tells our own and the layout's scroll events from the user's (see `userScrolledAway`). */
  const pinnedAt = useRef<ScrollMetrics>({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  /** Where the finger was at the last touch event: the direction of a drag. */
  const touchY = useRef<number | null>(null);
  /** The message array an older page was already requested for: one automatic request per state, never a loop. */
  const requestedFor = useRef<readonly Message[] | null>(null);
  const latest = useRef(messages);
  const settling = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; passes: number } | null>(null);

  const pin = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    element.scrollTop = bottomScrollTop(readMetrics(element));
    pinnedAt.current = readMetrics(element);
  }, [scrollerRef]);

  const loadIfNeeded = useCallback(() => {
    const element = scrollerRef.current;
    const current = latest.current;
    if (element === null || requestedFor.current === current.items) return;
    const wanted = shouldLoadOlder({
      ...readMetrics(element),
      status: current.status,
      hasMore: current.hasMore,
      loadingOlder: current.loadingOlder,
      olderFailed: current.olderError !== undefined,
    });
    if (!wanted) return;
    requestedFor.current = current.items;
    void loadOlder(channelId);
  }, [scrollerRef, loadOlder, channelId]);

  const cancelSettling = useCallback(() => {
    if (settling.current !== null) clearTimeout(settling.current.timer);
    settling.current = null;
  }, []);

  /** Waits for the smooth scroll to go quiet, then corrects what moved under it (rows that rendered taller than estimated). */
  const scheduleSettle = useCallback(() => {
    const state = settling.current;
    if (state === null) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      const element = scrollerRef.current;
      if (element === null || isNearBottom(readMetrics(element)) || state.passes >= MAX_SETTLE_PASSES) {
        settling.current = null;
        return;
      }
      state.passes += 1;
      element.scrollTop = bottomScrollTop(readMetrics(element));
      scheduleSettle();
    }, SETTLE_DELAY_MS);
  }, [scrollerRef]);

  /** On its way to the bottom (the "jump to latest" button, the End key): once it goes quiet, finish what taller rows left short. */
  const settleAtBottom = useCallback(() => {
    cancelSettling();
    settling.current = { timer: undefined, passes: 0 };
    scheduleSettle();
  }, [cancelSettling, scheduleSettle]);

  /**
   * Looks at where the list is. A pinned list that was moved away from the bottom is let go; an unpinned one that is at the
   * bottom is pinned again, however it got there (and a nudge of a few pixels that ends within the tolerance is no move at all).
   */
  const track = useCallback((metrics: ScrollMetrics) => {
    if (pinned.current) {
      if (userScrolledAway(metrics, pinnedAt.current)) pinned.current = false;
    } else if (isNearBottom(metrics)) {
      pinned.current = true;
      pinnedAt.current = metrics;
    }
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    const metrics = readMetrics(element);
    track(metrics);
    setShowJump(shouldShowJumpToLatest(metrics));
    loadIfNeeded();
    scheduleSettle();
  }, [scrollerRef, track, loadIfNeeded, scheduleSettle]);

  /**
   * The pin ends right away, before any scroll event: the layout can be changing under the list, which hides the move from
   * `userScrolledAway`.
   */
  const unpin = useCallback(() => {
    pinned.current = false;
    cancelSettling();
  }, [cancelSettling]);

  /**
   * The user moves the list towards older messages. When there is nothing above to scroll to (a list that fits, or one at the
   * very top) the gesture moves nothing and ends nothing.
   */
  const leaveBottom = useCallback(() => {
    const element = scrollerRef.current;
    if (element !== null && element.scrollTop > 0) unpin();
  }, [scrollerRef, unpin]);

  /** A press that moved nothing (the thumb of the scrollbar grabbed at the bottom and let go) leaves the list where it was. */
  const onPointerEnd = useCallback(() => {
    const element = scrollerRef.current;
    if (element !== null) track(readMetrics(element));
  }, [scrollerRef, track]);

  const handlers = useMemo<MessageScrollHandlers>(
    () => ({
      onScroll,
      onWheel: (event) => {
        if (event.deltaY < 0 && !event.ctrlKey) leaveBottom();
      },
      onTouchStart: (event) => {
        touchY.current = event.touches[0]?.clientY ?? null;
      },
      onTouchMove: (event) => {
        const y = event.touches[0]?.clientY ?? null;
        const previous = touchY.current;
        touchY.current = y;
        // A finger moving down pulls older messages into view.
        if (y !== null && previous !== null && y > previous) leaveBottom();
      },
      onKeyDown: (event) => {
        if (keyScrollsUp(event.key, event.shiftKey)) leaveBottom();
        else if (event.key === 'End') settleAtBottom();
      },
      // A press on the container itself (not on a row) can only be the scrollbar being grabbed.
      onPointerDown: (event) => {
        if (event.target === event.currentTarget) leaveBottom();
      },
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      // The browser scrolls a focused element into view unless it is already in it (Tab to a link of an old message), and rows
      // near the target then render their real height, which passes for a reflow: the pin has to let go before the scroll
      // events arrive. Chrome scrolls first and dispatches this event after, so look at where the list is now as well as at
      // where the target is.
      onFocus: (event) => {
        const { target, currentTarget } = event;
        if (target === currentTarget) return;
        const moved = !isNearBottom(readMetrics(currentTarget));
        if (moved || isOutsideView(target.getBoundingClientRect(), currentTarget.getBoundingClientRect())) unpin();
      },
    }),
    [onScroll, leaveBottom, unpin, settleAtBottom, onPointerEnd],
  );

  const jumpToLatest = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    pinned.current = false;
    const top = bottomScrollTop(readMetrics(element));
    if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    else element.scrollTop = top;
    settleAtBottom();
  }, [scrollerRef, settleAtBottom]);

  const retryOlder = useCallback(() => {
    requestedFor.current = latest.current.items;
    void loadOlder(channelId);
  }, [loadOlder, channelId]);

  // After every commit (this also is the first paint): learn the new data, keep the bottom while still pinned, and see
  // whether another page is needed. Runs after the anchor restore of a prepend (see useScrollAnchor), so a corrected
  // position is never mistaken for "still close to the top".
  useLayoutEffect(() => {
    latest.current = messages;
    if (pinned.current) pin();
    loadIfNeeded();
  }, [messages, pin, loadIfNeeded]);

  // The content changes size without React being involved (images, fonts, rows leaving `content-visibility` skipping),
  // and so does the viewport (window resize).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (pinned.current) pin();
      const element = scrollerRef.current;
      if (element !== null) setShowJump(shouldShowJumpToLatest(readMetrics(element)));
      loadIfNeeded();
    });
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollerRef, contentRef, pin, loadIfNeeded]);

  useEffect(() => cancelSettling, [cancelSettling]);

  return { showJump, handlers, jumpToLatest, retryOlder };
}
