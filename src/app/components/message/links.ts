/** Attributes for every link that leaves the app. The `href` itself must come from `safeUrl()`. */
export const EXTERNAL_LINK = { target: '_blank', rel: 'noopener noreferrer nofollow' } as const;

/** The site a link leads to ("example.com"): what names a link that has no text of its own. The text itself when it is no URL. */
export function linkHost(href: string): string {
  try {
    return new URL(href).host || href;
  } catch {
    return href;
  }
}
