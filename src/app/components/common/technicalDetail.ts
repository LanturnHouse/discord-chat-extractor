/** The longest technical message that is shown. */
const MAX_DETAIL_LENGTH = 300;

/** A URL up to its end: what follows `?` or `#` (queries and fragments carry tokens and ids) is dropped. */
const URL_QUERY = /(\bhttps?:\/\/[^\s?#'"<>]*)[?#][^\s'"<>]*/gi;
/** A Discord login token (three dot-separated base64url parts, or the older `mfa.` form) or any other long unbroken run of token characters. */
const TOKEN_LIKE = /\bmfa\.[\w-]{20,}|\b[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}|\b[\w-]{32,}/g;
/** Snowflake ids, as in the API errors: a message has to be safe to paste into a bug report. */
const ID_IN_TEXT = /\d{9,}/g;

/**
 * The technical message of an exception (the JavaScript engine's English wording) for a collapsed "technical details" block next
 * to a sentence in the user's language: on one line, clipped, and without anything that could be a secret - no query string or
 * fragment of a URL, no token-like string, no id. Undefined when there is nothing to show.
 */
export function technicalDetail(message: string): string | undefined {
  const text = message
    .replace(/\s+/g, ' ')
    .trim()
    .replace(URL_QUERY, '$1')
    .replace(TOKEN_LIKE, '[redacted]')
    .replace(ID_IN_TEXT, '<id>');
  if (text === '') return undefined;
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}
