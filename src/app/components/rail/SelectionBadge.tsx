import type { ReactElement } from 'react';
import { useStrings } from '@/app/i18n';
import { railStrings } from './strings';

const MAX_SHOWN = 999;

/** Count of selected channels in the bottom-right corner of an icon. Screen readers get the full sentence instead of the digits. */
export function SelectionBadge({ count }: { count: number }): ReactElement | null {
  const t = useStrings(railStrings);
  if (count <= 0) return null;
  return (
    <>
      <span className="rail__badge" aria-hidden="true">
        {count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}
      </span>
      <span className="visually-hidden">{t.selectedCount(count)}</span>
    </>
  );
}
