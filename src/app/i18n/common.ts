import { DiscordApiError, type DiscordErrorKind } from '@/lib/discord/client';
import { MAX_RATE_LIMIT_WAIT_MS } from '@/lib/discord/rateLimit';
import { defineStrings, type Locale } from './core';

/** Strings used by more than one UI area. Area-specific strings live in the area's own file next to its components. */
export const common = defineStrings({
  ko: {
    appName: 'Discord Chat Extractor',
    demoMode: '데모 모드',
    loading: '불러오는 중…',
    retry: '다시 시도',
    cancel: '취소',
    close: '닫기',
    ok: '확인',
    reload: '페이지 새로고침',
    connectedAs: (name: string) => `${name} 계정으로 연결됨`,

    errorAuth: 'Discord 로그인 정보가 만료되었거나 유효하지 않습니다.',
    errorForbidden: '접근 권한이 없습니다.',
    errorNotFound: '찾을 수 없거나 삭제되었습니다.',
    errorRateLimited: 'Discord 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
    errorRateLimitedWait: (minutes: number) => `Discord에서 약 ${minutes}분 동안 기다려 달라고 요청했습니다. 그 뒤에 다시 시도하세요.`,
    errorNetwork:
      'Discord에 연결할 수 없습니다. 네트워크 연결을 확인하세요. 브라우저가 일시적으로 요청을 제한하고 있을 수도 있으니, 1분쯤 기다렸다가 다시 시도해 보세요.',
    errorServer: 'Discord 서버 오류입니다. 잠시 후 다시 시도하세요.',
    errorAborted: '요청이 취소되었습니다.',
    errorBlocked: (status: number) => `Discord가 요청을 거부했습니다 (HTTP ${status}). 일시적인 차단일 수 있으니 잠시 후 다시 시도하세요.`,
    errorRejected: (status: number) => `Discord가 요청을 거부했습니다 (HTTP ${status}).`,
    errorNotReady: 'Discord가 아직 이 목록을 준비하지 못했습니다. 잠시 후 다시 시도하세요.',
    errorUnexpected: 'Discord에서 예상하지 못한 응답을 받았습니다.',
    errorUnknown: '알 수 없는 오류가 발생했습니다.',
    errorWithDetail: (summary: string, detail: string) => `${summary} (${detail})`,

    invalidRange: '시작 날짜가 종료 날짜보다 늦습니다.',
    saveFailed: '파일을 저장하지 못했습니다.',
  },
  en: {
    appName: 'Discord Chat Extractor',
    demoMode: 'Demo mode',
    loading: 'Loading…',
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    ok: 'OK',
    reload: 'Reload page',
    connectedAs: (name) => `Connected as ${name}`,

    errorAuth: 'Your Discord login has expired or is not valid.',
    errorForbidden: 'You do not have access to this.',
    errorNotFound: 'Not found, or it has been deleted.',
    errorRateLimited: 'Discord rate limit reached. Please try again in a moment.',
    errorRateLimitedWait: (minutes) => `Discord asked us to wait about ${minutes} min before the next request. Try again after that.`,
    errorNetwork:
      'Could not reach Discord. Check your network connection. The browser may also be limiting requests for a moment, so wait a minute and try again.',
    errorServer: 'Discord server error. Please try again in a moment.',
    errorAborted: 'The request was cancelled.',
    errorBlocked: (status) => `Discord rejected the request (HTTP ${status}). This may be a temporary block - try again later.`,
    errorRejected: (status) => `Discord rejected the request (HTTP ${status}).`,
    errorNotReady: 'Discord has not finished preparing this list yet. Try again in a moment.',
    errorUnexpected: 'Discord sent an unexpected answer.',
    errorUnknown: 'An unknown error occurred.',
    errorWithDetail: (summary, detail) => `${summary} (${detail})`,

    invalidRange: 'The start date is later than the end date.',
    saveFailed: 'The file could not be saved.',
  },
});

type CommonStrings = (typeof common)[Locale];

/** The error sentences that are plain text; the ones that depend on the status or a number are chosen by `describeApiError`. */
type PlainErrorKey = 'errorAuth' | 'errorForbidden' | 'errorNotFound' | 'errorRateLimited' | 'errorNetwork' | 'errorServer' | 'errorAborted' | 'errorUnknown';

const ERROR_KEY_BY_KIND: Record<DiscordErrorKind, PlainErrorKey> = {
  auth: 'errorAuth',
  forbidden: 'errorForbidden',
  'not-found': 'errorNotFound',
  'rate-limited': 'errorRateLimited',
  network: 'errorNetwork',
  server: 'errorServer',
  aborted: 'errorAborted',
  unknown: 'errorUnknown',
};

const MAX_DETAIL_LENGTH = 200;

/** Discord answered 202: its thread search has not indexed the channel yet (see `DiscordClient.getActiveThreads`). */
const STATUS_INDEX_NOT_READY = 202;

/**
 * The sentence for an API error, built from its kind, status and wait only. `error.message` is the client's English text for
 * logs and bug reports (it carries the request path and Discord's own wording) and is never shown.
 */
function describeApiError(error: DiscordApiError, t: CommonStrings): string {
  const { status } = error;
  if (error.kind === 'rate-limited') {
    // A short wait was already sat through by the client; a long one (an IP / Cloudflare ban) blocks every request until it is over.
    const waitMs = error.retryAfterMs;
    return waitMs !== undefined && waitMs > MAX_RATE_LIMIT_WAIT_MS ? t.errorRateLimitedWait(Math.ceil(waitMs / 60_000)) : t.errorRateLimited;
  }
  if (error.kind === 'unknown' && status !== undefined) {
    if (status === STATUS_INDEX_NOT_READY) return t.errorNotReady;
    // A 403 without Discord's "no access" code is typically a Cloudflare / anti-abuse block, not a permission problem (see `DiscordErrorKind`).
    if (status === 403) return t.errorBlocked(status);
    if (status >= 400 && status < 500) return t.errorRejected(status);
    // Below 400 Discord refused nothing: it answered, but with something that could not be used (a 200 with a broken body).
    if (status < 400) return t.errorUnexpected;
  }
  return t[ERROR_KEY_BY_KIND[error.kind]];
}

/**
 * User-facing text for any thrown value. A `DiscordApiError` gets a localised sentence from its kind and status; anything
 * else shows its message as a detail (clipped).
 */
export function describeError(error: unknown, locale: Locale): string {
  const t = common[locale];
  if (error instanceof DiscordApiError) return describeApiError(error, t);
  const detail = error instanceof Error ? error.message.trim() : '';
  return detail === '' ? t.errorUnknown : t.errorWithDetail(t.errorUnknown, detail.slice(0, MAX_DETAIL_LENGTH));
}
