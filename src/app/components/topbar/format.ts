/** Formats a count for the current language (built once per locale by `useNumberFormat`). */
export type NumberFormatter = (value: number) => string;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `mm:ss`, or `h:mm:ss` from one hour on. */
export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
}
