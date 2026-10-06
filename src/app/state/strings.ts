import { defineStrings } from '../i18n/core';

/** Texts the store itself puts into the state (everything else is rendered by the components from their own tables). */
export const stateStrings = defineStrings({
  ko: {
    sessionExpired: 'Discord 로그인이 만료되어 내보내기가 중단되었습니다.',
    sessionExpiredSaved: (channels: number) => `Discord 로그인이 만료되어 내보내기가 중단되었습니다. 완료된 ${channels}개 채널은 파일로 저장했습니다.`,
    invalidDate: '내보내기 기간이 올바르지 않습니다: 날짜가 올바르지 않습니다.',
    invalidLimit: (max: number) => `메시지 개수가 올바르지 않습니다: 1에서 ${max.toLocaleString('ko-KR')} 사이의 정수를 입력하세요.`,
    scopeOf: (label: string, reason: string) => `${label} 설정: ${reason}`,
  },
  en: {
    sessionExpired: 'Your Discord session expired, so the export was stopped.',
    sessionExpiredSaved: (channels) =>
      `Your Discord session expired, so the export was stopped. The ${channels} completed ${channels === 1 ? 'channel was' : 'channels were'} saved.`,
    invalidDate: 'Invalid export range: a date is not valid.',
    invalidLimit: (max) => `Invalid number of messages: enter a whole number from 1 to ${max.toLocaleString('en-US')}.`,
    scopeOf: (label, reason) => `Settings for ${label}: ${reason}`,
  },
});
