import type { KeyboardEvent } from 'react';

const MOVES: Readonly<Record<string, (current: number, last: number) => number>> = {
  ArrowDown: (current, last) => Math.min(current + 1, last),
  ArrowUp: (current) => Math.max(current - 1, 0),
  Home: () => 0,
  End: (_current, last) => last,
};

/** Where the focus goes when the list container itself is focused (the target of a skip link): no row to move away from yet. */
const ENTER: Readonly<Record<string, 'first' | 'last'>> = { ArrowDown: 'first', Home: 'first', ArrowUp: 'last', End: 'last' };

/**
 * One delegated ArrowUp / ArrowDown / Home / End handler for a list of rows (hundreds of them cost one listener). A row is any
 * element matching `rowSelector`; `navSelector` is the control inside it that takes the focus. The keys work from the nav
 * control and from any other control of the row (its checkbox), and from the container itself, which enters the list.
 */
export function createRowKeyHandler(rowSelector: string, navSelector: string): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    const move = MOVES[event.key];
    if (move === undefined || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!(event.target instanceof Element)) return;
    const container = event.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>(navSelector));

    if (event.target === container) {
      const edge = ENTER[event.key];
      const entry = edge === 'last' ? items[items.length - 1] : items[0];
      if (entry === undefined) return;
      event.preventDefault();
      entry.focus();
      return;
    }

    const row = event.target.closest(rowSelector);
    if (row === null || !container.contains(row)) return;
    const current = items.findIndex((item) => row.contains(item));
    if (current < 0) return;
    event.preventDefault();
    items[move(current, items.length - 1)]?.focus();
  };
}
