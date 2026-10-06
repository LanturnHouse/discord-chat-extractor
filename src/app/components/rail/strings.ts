import { defineStrings } from '@/app/i18n';

export const railStrings = defineStrings({
  ko: {
    navLabel: '서버 목록',
    directMessages: '다이렉트 메시지',
    selectedCount: (count: number) => `${count}개 선택됨`,
    selectGuild: (name: string) => `${name} 서버의 모든 채널 선택`,
    guildLoadFailed: (name: string, reason: string) => `${name} 서버의 채널 목록을 불러오지 못했어요. ${reason}`,
    selectGuildRetry: (name: string, reason: string) =>
      `${name} 서버의 모든 채널 선택 (채널 목록을 불러오지 못했어요. ${reason} 다시 누르면 재시도해요)`,
  },
  en: {
    navLabel: 'Servers',
    directMessages: 'Direct Messages',
    selectedCount: (count) => `${count} selected`,
    selectGuild: (name) => `Select every channel of ${name}`,
    guildLoadFailed: (name, reason) => `Couldn't load the channels of ${name}. ${reason}`,
    selectGuildRetry: (name, reason) => `Select every channel of ${name} (couldn't load its channels. ${reason} Select again to retry)`,
  },
});
