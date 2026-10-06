import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { focusInitial, useEscapeKey, useTabTrap, wrapFromGuard } from './focus';
import { useLatest } from './hooks';
import { PressGateContext, type AfterPress } from './pressGate';

export interface PopoverProps {
  /** Positions the popover: it opens under this element, right edges aligned (kept inside the window). Clicks on it never count as "outside". */
  anchorRef: RefObject<HTMLElement | null>;
  /** Gets the focus back when a dialog popover closes with Esc. Defaults to the anchor. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  width: number;
  /** Accessible name. */
  label: string;
  id?: string;
  /**
   * 'dialog' (default): focus moves in when it opens and Tab stays inside until it closes.
   * 'status': a message with nothing to operate - it never takes or traps the focus, which stays where it was.
   */
  role?: 'dialog' | 'status';
  /** CSS value; the content scrolls when it does not fit. */
  maxHeight?: string;
  className?: string;
  children: ReactNode;
}

const GAP = 8;
const MARGIN = 8;

interface Place {
  top: number;
  left: number;
}

function placeBelow(anchor: HTMLElement, width: number): Place {
  const rect = anchor.getBoundingClientRect();
  const furthestLeft = Math.max(MARGIN, document.documentElement.clientWidth - width - MARGIN);
  return { top: rect.bottom + GAP, left: Math.min(Math.max(MARGIN, rect.right - width), furthestLeft) };
}

/**
 * A small non-modal panel under its anchor, rendered in `document.body` so no stacking context of the top bar can hide it.
 * Esc and a press outside close it. A dialog popover takes the focus when it opens, keeps Tab inside and returns the focus
 * to the anchor on Esc; a status popover leaves the focus alone.
 */
export function Popover({
  anchorRef,
  returnFocusRef,
  onClose,
  width,
  label,
  id,
  role = 'dialog',
  maxHeight = 'min(80vh, calc(100vh - 72px))',
  className,
  children,
}: PopoverProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place>({ top: 0, left: 0 });
  const close = useLatest(onClose);
  const isDialog = role === 'dialog';

  // Work that fields inside the panel want done while a press that started in the panel is still down (see `AfterPress`).
  const pressed = useRef(false);
  const waiting = useRef<Array<() => void>>([]);
  const afterPress = useCallback<AfterPress>((action) => {
    if (pressed.current) waiting.current.push(action);
    else action();
  }, []);
  const onPressStart = (): void => {
    if (pressed.current) return;
    pressed.current = true;
    const release = (): void => {
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      pressed.current = false;
      const queued = waiting.current;
      waiting.current = [];
      for (const action of queued) action();
    };
    // On the document: the button is often let go outside the panel, and the panel may be gone by then.
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
  };

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return undefined;
    const update = (): void => {
      const next = placeBelow(anchor, width);
      setPlace((previous) => (previous.top === next.top && previous.left === next.left ? previous : next));
    };
    update();
    window.addEventListener('resize', update);
    // Capture: the page may scroll horizontally below its minimum width, and any scroll container moves the anchor.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, width]);

  useEffect(() => {
    if (isDialog && panelRef.current !== null) focusInitial(panelRef.current);
  }, [isDialog]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true || anchorRef.current?.contains(target) === true) return;
      // This runs before the browser moves the focus, and a field that is removed while it has the focus never gets its blur: a
      // half-typed date would be gone without a trace. Leaving the field first lets it report what it holds.
      const active = document.activeElement;
      if (active instanceof HTMLElement && panelRef.current?.contains(active) === true) active.blur();
      close.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchorRef, close]);

  useEscapeKey(() => {
    if (isDialog) (returnFocusRef ?? anchorRef).current?.focus();
    close.current();
  });
  useTabTrap(panelRef, isDialog);

  const classes = className === undefined ? 'topbar-popover' : `topbar-popover ${className}`;
  const guard = (edge: 'start' | 'end'): ReactElement => (
    <span
      tabIndex={0}
      data-focus-guard=""
      className="topbar-focus-guard"
      onFocus={(event) => {
        if (panelRef.current !== null) wrapFromGuard(panelRef.current, edge, event.relatedTarget);
      }}
    />
  );
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={label}
      aria-live={isDialog ? undefined : 'polite'}
      tabIndex={isDialog ? -1 : undefined}
      className={classes}
      style={{ top: place.top, left: place.left, width, maxHeight }}
      onPointerDownCapture={onPressStart}
    >
      <PressGateContext.Provider value={afterPress}>
        {isDialog ? guard('start') : null}
        {children}
        {isDialog ? guard('end') : null}
      </PressGateContext.Provider>
    </div>,
    document.body,
  );
}
