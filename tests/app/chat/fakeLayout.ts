import { act } from '@testing-library/react';

/*
 * jsdom has no layout. This installs a tiny stand-in for the part of it the chat pane reads: the scroll container
 * (`.chat-list`) reports scrollHeight / clientHeight / scrollTop (clamped like a browser does), and the children of
 * `.chat-list__content` (messages, day dividers, the beginning banner) get stacked positions from `getBoundingClientRect`.
 * Content shorter than the viewport is bottom-aligned, like the real CSS (`margin-top: auto`).
 */

export interface FakeLayoutOptions {
  /** Height of the scroll container (default 600). */
  viewportHeight?: number;
  /** Height of one child of the content; default 50 for a message, 32 for a day divider, 200 for the beginning banner. */
  heightOf?: (element: HTMLElement) => number;
  /** `padding-bottom` of the content (default 16, as in chat.css). */
  contentPadding?: number;
  /**
   * Behave like Chrome's scroll anchoring (`overflow-anchor: auto`): whenever the layout is read after rows moved, the row
   * that was first visible at the previous read is put back at its viewport offset - unless the scroll position is 0, and
   * never after the script itself has scrolled. Lets tests prove that the manual correction composes with it.
   */
  nativeAnchoring?: boolean;
}

export interface FakeLayout {
  viewportHeight: number;
  /** Total height the scroll container reports. */
  scrollHeight(scroller: HTMLElement): number;
  /** Sets `scrollTop` (clamped) and dispatches the `scroll` event inside `act`, like a user scrolling. */
  userScrollTo(scroller: HTMLElement, top: number): void;
  /** Sets `scrollTop` (clamped) without any event. */
  setScrollTop(scroller: HTMLElement, top: number): void;
  restore(): void;
}

const MESSAGE_HEIGHT = 50;
const DIVIDER_HEIGHT = 32;
const BANNER_HEIGHT = 200;

export function defaultHeightOf(element: HTMLElement): number {
  if (element.hasAttribute('data-message-id')) return MESSAGE_HEIGHT;
  if (element.classList.contains('msg-day-divider')) return DIVIDER_HEIGHT;
  if (element.classList.contains('chat-start')) return BANNER_HEIGHT;
  return 0;
}

const isScroller = (element: Element): boolean => element.classList.contains('chat-list');

export function installFakeLayout(options: FakeLayoutOptions = {}): FakeLayout {
  const viewportHeight = options.viewportHeight ?? 600;
  const heightOf = options.heightOf ?? defaultHeightOf;
  const contentPadding = options.contentPadding ?? 16;
  const scrollTops = new WeakMap<Element, number>();
  let anchor: { element: HTMLElement; offset: number } | null = null;

  const contentOf = (scroller: HTMLElement): HTMLElement | null => scroller.querySelector<HTMLElement>('.chat-list__content');
  const contentHeight = (content: HTMLElement): number =>
    Array.from(content.children).reduce((sum, child) => sum + heightOf(child as HTMLElement), 0) + contentPadding;
  const scrollHeightOf = (scroller: HTMLElement): number => {
    const content = contentOf(scroller);
    return content === null ? viewportHeight : Math.max(viewportHeight, contentHeight(content));
  };
  const clamp = (scroller: HTMLElement, top: number): number => Math.min(Math.max(0, top), Math.max(0, scrollHeightOf(scroller) - viewportHeight));
  /** Top of the content inside the scroller (content coordinates): free space goes above short content. */
  const contentTop = (content: HTMLElement): number => Math.max(0, viewportHeight - contentHeight(content));
  /** Top edge of a child of the content, in the viewport's coordinates. */
  const viewportOffsetOf = (child: HTMLElement, content: HTMLElement, scroller: HTMLElement): number => {
    let offset = contentTop(content);
    for (const sibling of Array.from(content.children)) {
      if (sibling === child) break;
      offset += heightOf(sibling as HTMLElement);
    }
    return offset - (scrollTops.get(scroller) ?? 0);
  };

  /** One pass over the content: where `target` is (viewport coordinates), and the first message that starts inside the viewport. */
  const scan = (content: HTMLElement, scroller: HTMLElement, target: HTMLElement | null): { targetOffset: number | null; first: { element: HTMLElement; offset: number } | null } => {
    const scrollTop = scrollTops.get(scroller) ?? 0;
    let offset = contentTop(content) - scrollTop;
    let targetOffset: number | null = null;
    let first: { element: HTMLElement; offset: number } | null = null;
    for (const child of Array.from(content.children) as HTMLElement[]) {
      if (child === target) targetOffset = offset;
      if (first === null && offset >= 0 && child.hasAttribute('data-message-id')) first = { element: child, offset };
      offset += heightOf(child);
    }
    return { targetOffset, first };
  };

  /** Chrome's scroll anchoring, run before every read of the layout (see `nativeAnchoring`). */
  const anchorScroller = (scroller: HTMLElement): void => {
    if (options.nativeAnchoring !== true) return;
    const content = contentOf(scroller);
    if (content === null) return;
    const previous = anchor !== null && anchor.element.isConnected ? anchor : null;
    anchor = null;
    const { targetOffset } = scan(content, scroller, previous?.element ?? null);
    if (previous !== null && targetOffset !== null && targetOffset !== previous.offset) {
      scrollTops.set(scroller, clamp(scroller, (scrollTops.get(scroller) ?? 0) + targetOffset - previous.offset));
    }
    if ((scrollTops.get(scroller) ?? 0) === 0) return; // no anchoring at the very top
    anchor = scan(content, scroller, null).first;
  };

  const proto = HTMLElement.prototype;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const define = (name: string, descriptor: PropertyDescriptor): void => {
    originals.set(name, Object.getOwnPropertyDescriptor(proto, name));
    Object.defineProperty(proto, name, { configurable: true, ...descriptor });
  };

  define('clientHeight', {
    get(this: HTMLElement) {
      return isScroller(this) ? viewportHeight : 0;
    },
  });
  define('scrollHeight', {
    get(this: HTMLElement) {
      if (!isScroller(this)) return 0;
      anchorScroller(this);
      return scrollHeightOf(this);
    },
  });
  define('scrollTop', {
    get(this: HTMLElement) {
      if (isScroller(this)) anchorScroller(this);
      return scrollTops.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      if (!isScroller(this)) {
        scrollTops.set(this, value);
        return;
      }
      anchorScroller(this);
      scrollTops.set(this, clamp(this, value));
      anchor = null; // a scroll by script drops the browser's anchor
    },
  });
  define('getBoundingClientRect', {
    value(this: HTMLElement) {
      let top = 0;
      let height = 0;
      const parent = this.parentElement;
      const scroller = parent?.parentElement ?? null;
      if (isScroller(this)) {
        height = viewportHeight;
      } else if (parent !== null && scroller !== null && parent.classList.contains('chat-list__content') && isScroller(scroller)) {
        anchorScroller(scroller);
        top = viewportOffsetOf(this, parent, scroller);
        height = heightOf(this);
      }
      return { x: 0, y: top, top, left: 0, right: 0, bottom: top + height, width: 0, height, toJSON: () => ({}) } as DOMRect;
    },
  });

  return {
    viewportHeight,
    scrollHeight: (scroller) => scroller.scrollHeight,
    setScrollTop(scroller, top) {
      scroller.scrollTop = top;
    },
    userScrollTo(scroller, top) {
      scroller.scrollTop = top;
      act(() => {
        scroller.dispatchEvent(new Event('scroll'));
      });
    },
    restore() {
      anchor = null;
      for (const [name, descriptor] of originals) {
        if (descriptor === undefined) Reflect.deleteProperty(proto, name);
        else Object.defineProperty(proto, name, descriptor);
      }
    },
  };
}

/** `ResizeObserver` for jsdom: nothing happens until a test calls `fire()`. */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }

  trigger(): void {
    if (this.observed.size > 0) this.callback([], this as unknown as ResizeObserver);
  }
}

export interface InstalledResizeObserver {
  /** Delivers a notification to every observer that is still observing something. */
  fire(): void;
  /** Number of observers currently observing at least one element. */
  active(): number;
  restore(): void;
}

export function installFakeResizeObserver(): InstalledResizeObserver {
  const previous = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  FakeResizeObserver.instances = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  return {
    fire() {
      act(() => {
        for (const observer of [...FakeResizeObserver.instances]) observer.trigger();
      });
    },
    active: () => FakeResizeObserver.instances.filter((observer) => observer.observed.size > 0).length,
    restore() {
      if (previous === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver');
      else (globalThis as { ResizeObserver?: unknown }).ResizeObserver = previous;
      FakeResizeObserver.instances = [];
    },
  };
}
