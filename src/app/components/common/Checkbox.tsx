import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement, type RefObject } from 'react';
import type { CheckState } from '../../state/types';
import { Check, Minus } from './Icons';
import './common.css';

export interface CheckboxProps {
  state: CheckState;
  /** Called on click / Enter / Space. The parent decides the next state (tri-state boxes: 'some' normally selects all). */
  onChange: () => void;
  /** Required: the box has no visible label of its own. */
  ariaLabel: string;
  /** Edge length in px (default 20). */
  size?: number;
  disabled?: boolean;
  /**
   * Work the box depends on is in progress: clicks are ignored (a second one would undo the first before it was applied), but
   * unlike `disabled` the box stays focusable. A focused element that turns disabled is blurred by the browser, which would
   * send a keyboard user back to the top of the page.
   */
  busy?: boolean;
  /** The action it stands for failed (the reason goes into `title` / `ariaLabel`): drawn as a warning, and never hidden. */
  invalid?: boolean;
  /** Native tooltip. */
  title?: string;
  /**
   * Hidden until the row is hovered or focused, unless it is checked. The row must carry the `dce-reveal-host` class.
   */
  revealOnHover?: boolean;
  /**
   * Where the keyboard focus goes if this box is taken away (a channel turns out to be forbidden and loses its box) while it holds
   * the focus: the browser would drop it to <body>, which sends a keyboard user back to the top of the page.
   */
  focusOnRemove?: RefObject<HTMLElement | null>;
  className?: string;
}

const DEFAULT_SIZE = 20;

function stop(event: MouseEvent | KeyboardEvent): void {
  event.stopPropagation();
}

/**
 * Discord-style rounded checkbox (brand blue when checked, a dash when partially checked). It can sit inside a clickable
 * row: clicks and Enter / Space on it never reach the row's own handlers.
 */
export function Checkbox({
  state,
  onChange,
  ariaLabel,
  size = DEFAULT_SIZE,
  disabled = false,
  busy = false,
  invalid = false,
  title,
  revealOnHover = false,
  focusOnRemove,
  className,
}: CheckboxProps): ReactElement {
  const box = useRef<HTMLButtonElement>(null);
  // React runs this before it removes the button from the page, while it is still the focused element.
  useLayoutEffect(() => {
    const element = box.current;
    return () => {
      if (element !== null && document.activeElement === element) focusOnRemove?.current?.focus();
    };
  }, [focusOnRemove]);

  const classes = ['dce-checkbox'];
  if (revealOnHover) classes.push('dce-checkbox--reveal');
  if (className !== undefined) classes.push(className);
  const style = size === DEFAULT_SIZE ? undefined : ({ '--dce-checkbox-size': `${size}px` } as CSSProperties);

  return (
    <button
      ref={box}
      type="button"
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state === 'all'}
      aria-label={ariaLabel}
      aria-busy={busy ? true : undefined}
      aria-disabled={busy ? true : undefined}
      aria-invalid={invalid ? true : undefined}
      title={title}
      className={classes.join(' ')}
      data-state={state}
      data-invalid={invalid ? '' : undefined}
      disabled={disabled}
      style={style}
      onClick={(event) => {
        stop(event);
        if (!busy) onChange();
      }}
      onDoubleClick={stop}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') stop(event);
      }}
    >
      {state === 'all' ? <Check /> : null}
      {state === 'some' ? <Minus /> : null}
    </button>
  );
}
