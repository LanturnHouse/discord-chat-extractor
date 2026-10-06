import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useAppStore, type ChannelMessages } from '@/app/state';
import type { Message, Snowflake } from '@/lib/discord/types';
import {
  bottomScrollTop,
  isNearBottom,
  shouldLoadOlder,
  shouldShowJumpToLatest,
  userScrolledAway,
  type ScrollMetrics,
} from './scroll';

/** After a smooth "jump to latest" has gone quiet this long, check that the bottom was really reached. */
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

export interface MessageScroll {
  /** The floating "jump to latest" button is visible. */
  showJump: boolean;
  /** `scroll` event of the container. */
  onScroll(): void;
  /** Wheel, touch drag, scroll keys or a press on the scrollbar: the user took over, so the bottom pin ends for good. */
  onUserScroll(): void;
  jumpToLatest(): void;
  /** The "retry" button of a failed older-page request. */
  retryOlder(): void;
}

/**
 * The imperative half of the message list, for ONE channel instance (the list is remounted per channel):
 *
 * - pinned to the bottom on first paint and while the content settles (images, fonts, rows rendering their real height
 *   under `content-visibility`), until the user scrolls by themself; after that it never pins again;
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
  /** `scrollTop` right after our last pin: tells our own scroll events from the user's. */
  const lastPinnedTop = useRef(0);
  /** The message array an older page was already requested for: one automatic request per state, never a loop. */
  const requestedFor = useRef<readonly Message[] | null>(null);
  const latest = useRef(messages);
  const settling = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; passes: number } | null>(null);

  const pin = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    element.scrollTop = bottomScrollTop(readMetrics(element));
    lastPinnedTop.current = element.scrollTop;
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

  const onScroll = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    const metrics = readMetrics(element);
    if (pinned.current && userScrolledAway(metrics, lastPinnedTop.current)) pinned.current = false;
    setShowJump(shouldShowJumpToLatest(metrics));
    loadIfNeeded();
    scheduleSettle();
  }, [scrollerRef, loadIfNeeded, scheduleSettle]);

  const onUserScroll = useCallback(() => {
    pinned.current = false;
    cancelSettling();
  }, [cancelSettling]);

  const jumpToLatest = useCallback(() => {
    const element = scrollerRef.current;
    if (element === null) return;
    pinned.current = false;
    const top = bottomScrollTop(readMetrics(element));
    if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    else element.scrollTop = top;
    cancelSettling();
    settling.current = { timer: undefined, passes: 0 };
    scheduleSettle();
  }, [scrollerRef, cancelSettling, scheduleSettle]);

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

  return { showJump, onScroll, onUserScroll, jumpToLatest, retryOlder };
}
