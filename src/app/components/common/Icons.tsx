import type { ReactElement, ReactNode, SVGProps } from 'react';
import './common.css';

/*
 * Own simple icon set (nothing here is taken from Discord's assets). Every icon is a 24x24 SVG that scales with the
 * font size (1em), takes its colour from `currentColor` and is hidden from assistive technology unless a `title` is given.
 *
 *   <Hash />                       decorative, sized by the surrounding font-size
 *   <Lock title="No access" />     announced as an image named "No access"
 *   <Check style={{ fontSize: 14 }} className="..." />   any other SVG prop works too
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'ref'> {
  /** Accessible name. Without it the icon is `aria-hidden`. */
  title?: string;
}

interface SvgProps extends IconProps {
  children: ReactNode;
}

/** Outline icons: round-capped 2px strokes. Filled shapes opt out with `FILL`. */
function Svg({ title, children, ...rest }: SvgProps): ReactElement {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title === undefined ? true : undefined}
      role={title === undefined ? undefined : 'img'}
      {...rest}
    >
      {title === undefined ? null : <title>{title}</title>}
      {children}
    </svg>
  );
}

const FILL = { fill: 'currentColor', stroke: 'none' } as const;

/** Small padlock in the bottom-right corner, shared by the "locked channel" icons. */
function LockBadge(): ReactElement {
  return (
    <>
      <path d="M16.2 15.2v-1.6a2.3 2.3 0 0 1 4.6 0v1.6" />
      <rect {...FILL} x="14.5" y="15" width="8" height="6.5" rx="1.5" />
    </>
  );
}

/* --- channels -------------------------------------------------------------------------------------------------- */

export function Hash(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M9.5 4 7.5 20M16.5 4l-2 16M4 9h16.5M3.5 15H20" />
    </Svg>
  );
}

export function HashLocked(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M8 3.5 6.5 16M14 3.5 12.5 16M3 7.5h11.5M2.5 12.5H13" />
      <LockBadge />
    </Svg>
  );
}

export function Speaker(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...FILL} d="M3.5 9.5v5h3.2l4.8 4V5.5l-4.8 4z" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6M17.8 6.6a8 8 0 0 1 0 10.8" />
    </Svg>
  );
}

export function SpeakerLocked(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...FILL} d="M2.5 6.5v4h2.6l3.9 3.2V3.3L5.1 6.5z" />
      <path d="M11.8 6.2a3.5 3.5 0 0 1 0 4.8" />
      <LockBadge />
    </Svg>
  );
}

export function Megaphone(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...FILL} d="M3.5 10a2 2 0 0 1 2-2H8l8.5-4v16L8 16H5.5a2 2 0 0 1-2-2z" />
      <path d="M7.5 16.5 8.8 20.5M19.8 9.5a3.5 3.5 0 0 1 0 5" />
    </Svg>
  );
}

export function Forum(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M7.5 9h9M7.5 12.5h6" />
    </Svg>
  );
}

export function Thread(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M6 4v9a5 5 0 0 0 5 5h7" />
      <path d="m14.5 14.5 3.5 3.5-3.5 3.5" />
    </Svg>
  );
}

export function Stage(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <circle {...FILL} cx="12" cy="12" r="2.4" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.4 9.4 0 0 0 0 13.2M18.6 5.4a9.4 9.4 0 0 1 0 13.2" />
    </Svg>
  );
}

export function Lock(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <rect {...FILL} x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  );
}

/* --- controls -------------------------------------------------------------------------------------------------- */

export function ChevronDown(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

export function ChevronRight(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  );
}

export function Check(props: IconProps): ReactElement {
  return (
    <Svg strokeWidth={3} {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function Minus(props: IconProps): ReactElement {
  return (
    <Svg strokeWidth={3} {...props}>
      <path d="M6 12h12" />
    </Svg>
  );
}

export function Close(props: IconProps): ReactElement {
  return (
    <Svg strokeWidth={2.5} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function Download(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </Svg>
  );
}

/** Filled caret for the dropdown half of a split button. */
export function DownloadCaret(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...FILL} d="M6.5 9.5h11L12 15.5z" />
    </Svg>
  );
}

export function Search(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </Svg>
  );
}

/** A spinning arc (turns while the `dce-icon-spin` class from common.css is applied; always on here). */
export function SpinnerIcon({ className, ...props }: IconProps): ReactElement {
  return (
    <Svg className={className === undefined ? 'dce-icon-spin' : `dce-icon-spin ${className}`} {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Svg>
  );
}

/* --- status ---------------------------------------------------------------------------------------------------- */

export function Warning(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 3.8 21.2 20H2.8z" />
      <path d="M12 10v4.5" />
      <circle {...FILL} cx="12" cy="17.4" r="1.1" />
    </Svg>
  );
}

export function Info(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle {...FILL} cx="12" cy="7.6" r="1.2" />
    </Svg>
  );
}

/* --- neutral glyphs -------------------------------------------------------------------------------------------- */

/** The "direct messages" glyph of the home button: a plain speech bubble (deliberately not Discord's logo). */
export function ChatBubble(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path {...FILL} d="M6.5 3.5h11A3 3 0 0 1 20.5 6.5v8a3 3 0 0 1-3 3H12L7.5 21v-3.5h-1a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z" />
    </Svg>
  );
}
