import { DiscordApiError, type DiscordErrorKind } from '@/lib/discord/client';
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
    errorNetwork: 'Discord에 연결할 수 없습니다. 네트워크 연결을 확인하세요.',
    errorServer: 'Discord 서버 오류입니다. 잠시 후 다시 시도하세요.',
    errorAborted: '요청이 취소되었습니다.',
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
    errorNetwork: 'Could not reach Discord. Check your network connection.',
    errorServer: 'Discord server error. Please try again in a moment.',
    errorAborted: 'The request was cancelled.',
    errorUnknown: 'An unknown error occurred.',
    errorWithDetail: (summary, detail) => `${summary} (${detail})`,

    invalidRange: 'The start date is later than the end date.',
    saveFailed: 'The file could not be saved.',
  },
});

type CommonStrings = (typeof common)[Locale];

type ErrorKey = Exclude<Extract<keyof CommonStrings, `error${string}`>, 'errorWithDetail'>;

const ERROR_KEY_BY_KIND: Record<DiscordErrorKind, ErrorKey> = {
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

/**
 * User-facing text for any thrown value. Known `DiscordApiError` kinds get a localised sentence; an 'unknown' API error
 * keeps Discord's own wording as a detail (it is already sanitised by the client); anything else shows its message.
 */
export function describeError(error: unknown, locale: Locale): string {
  const t = common[locale];
  if (error instanceof DiscordApiError) {
    const summary = t[ERROR_KEY_BY_KIND[error.kind]];
    if (error.kind === 'unknown' && error.message.trim() !== '') {
      return t.errorWithDetail(summary, error.message.trim().slice(0, MAX_DETAIL_LENGTH));
    }
    return summary;
  }
  const detail = error instanceof Error ? error.message.trim() : '';
  return detail === '' ? t.errorUnknown : t.errorWithDetail(t.errorUnknown, detail.slice(0, MAX_DETAIL_LENGTH));
}
