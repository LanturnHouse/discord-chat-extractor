import { MSG_ICON_PATHS, type MsgIconName } from './iconPaths';

export interface MsgIconProps {
  name: MsgIconName;
  className?: string;
  size?: number;
}

/**
 * Decorative icon (the surrounding text carries the meaning). Kept local to the message view so the HTML export can
 * reproduce the same markup from `MSG_ICON_PATHS` without pulling in the app's icon set.
 */
export function MsgIcon({ name, className, size = 16 }: MsgIconProps) {
  return (
    <svg
      className={className === undefined ? 'msg-icon' : `msg-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" fillRule="evenodd" d={MSG_ICON_PATHS[name]} />
    </svg>
  );
}
