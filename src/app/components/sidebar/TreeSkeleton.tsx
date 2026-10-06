import type { CSSProperties, ReactElement } from 'react';
import { common, useStrings } from '@/app/i18n';

/** Two category headers and eight channels, with bar widths that vary like real names do. */
const SHAPE: readonly { header: boolean; width: number }[] = [
  { header: false, width: 70 },
  { header: false, width: 55 },
  { header: false, width: 80 },
  { header: true, width: 40 },
  { header: false, width: 65 },
  { header: false, width: 50 },
  { header: false, width: 75 },
  { header: false, width: 60 },
  { header: true, width: 35 },
  { header: false, width: 68 },
];

/** Placeholder while a server's channel list is being fetched. */
export function TreeSkeleton(): ReactElement {
  const c = useStrings(common);
  return (
    <div className="sb-skeleton" role="status" aria-label={c.loading}>
      {SHAPE.map((item, index) => {
        const bar = { width: `${item.width}%` } satisfies CSSProperties;
        return item.header ? (
          <div key={index} className="sb-skeleton__header" aria-hidden="true">
            <span className="sb-skeleton__bar sb-skeleton__bar--header" style={bar} />
          </div>
        ) : (
          <div key={index} className="sb-skeleton__row" aria-hidden="true">
            <span className="sb-skeleton__bar sb-skeleton__bar--icon" />
            <span className="sb-skeleton__bar" style={bar} />
          </div>
        );
      })}
    </div>
  );
}
