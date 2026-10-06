import { createRowKeyHandler } from '../common/rowKeys';

/*
 * Arrow-key navigation for the sidebar lists. Rows carry `data-sb-row` (the <li>) and `data-sb-nav` (the button that opens /
 * folds it); one delegated handler on the scroll container serves hundreds of rows, and rows that are not rendered
 * (folded categories) are skipped automatically.
 */

const NAV_SELECTOR = '[data-sb-nav]';
const ROW_SELECTOR = '[data-sb-row]';

/** ArrowUp / ArrowDown / Home / End move the focus between rows, from the row's button or its checkbox; on the container itself they enter the list. */
export const handleRowKeys = createRowKeyHandler(ROW_SELECTOR, NAV_SELECTOR);

/** Moves the focus into the list (from the filter box); false when the list has no rows. */
export function focusFirstRow(container: HTMLElement | null): boolean {
  const first = container?.querySelector<HTMLElement>(NAV_SELECTOR);
  if (first === null || first === undefined) return false;
  first.focus();
  return true;
}
