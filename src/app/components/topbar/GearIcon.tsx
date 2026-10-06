import type { ReactElement, SVGProps } from 'react';

/**
 * The settings gear of the selection list: eight teeth around a hub, drawn with the same 2px round-capped outline style as
 * the shared icon set (which belongs to another module, so this one lives next to its only user). Decorative: the button
 * that holds it carries the accessible name.
 */
export function GearIcon(props: Omit<SVGProps<SVGSVGElement>, 'children' | 'ref'>): ReactElement {
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
      aria-hidden="true"
      {...props}
    >
      <path d="M10.3 4.9L10.72 2.49H13.28L13.7 4.9A7.3 7.3 0 0 1 15.81 5.78L17.82 4.37L19.63 6.18L18.22 8.19A7.3 7.3 0 0 1 19.1 10.3L21.51 10.72V13.28L19.1 13.7A7.3 7.3 0 0 1 18.22 15.81L19.63 17.82L17.82 19.63L15.81 18.22A7.3 7.3 0 0 1 13.7 19.1L13.28 21.51H10.72L10.3 19.1A7.3 7.3 0 0 1 8.19 18.22L6.18 19.63L4.37 17.82L5.78 15.81A7.3 7.3 0 0 1 4.9 13.7L2.49 13.28V10.72L4.9 10.3A7.3 7.3 0 0 1 5.78 8.19L4.37 6.18L6.18 4.37L8.19 5.78A7.3 7.3 0 0 1 10.3 4.9Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
