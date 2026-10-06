import { createRowKeyHandler } from '../common/rowKeys';

/** ArrowUp / ArrowDown / Home / End move the focus between the rail's icons, from an icon or from a server's checkbox. */
export const handleRailKeys = createRowKeyHandler('.rail__item', '.rail__icon');
