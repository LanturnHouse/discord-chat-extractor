import type { CSSProperties, ReactElement } from 'react';
import './common.css';

export interface SpinnerProps {
  /** Diameter in px (default 24). */
  size?: number;
  /** Announced to screen readers. Without it the spinner is decorative (`aria-hidden`). */
  label?: string;
  className?: string;
}

/** Plain CSS ring spinner in `currentColor` (the colour of the surrounding text unless `.dce-spinner` is restyled). */
export function Spinner({ size = 24, label, className }: SpinnerProps): ReactElement {
  const style = { '--dce-spinner-size': `${size}px` } as CSSProperties;
  return (
    <span
      className={className === undefined ? 'dce-spinner' : `dce-spinner ${className}`}
      style={style}
      role={label === undefined ? undefined : 'status'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}
