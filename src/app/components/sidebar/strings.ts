import { defineStrings } from '@/app/i18n';

export const sidebarStrings = defineStrings({
  ko: {
    channelsLabel: '채널 목록',
    dmsLabel: '다이렉트 메시지',

    // DM list
    dmFilterPlaceholder: '대화 찾기',
    dmFilterClear: '검색어 지우기',
    dmSection: '다이렉트 메시지',
    dmMatches: (count: number) => `${count}개 일치`,
    dmSelectAll: '모든 대화 선택',
    dmSelectMatches: (count: number) => `검색된 대화 ${count}개 모두 선택`,
    dmEmpty: '아직 대화가 없어요',
    dmNoMatch: (query: string) => `"${query}"에 해당하는 대화가 없어요`,
    groupMembers: (count: number) => `멤버 ${count}명`,

    // channel tree
    selectServer: '서버의 모든 채널 선택',
    selectCategory: (name: string) => `${name} 카테고리의 모든 채널 선택`,
    selectForExport: (name: string) => `${name} 내보내기 선택`,
    noAccess: '접근 권한 없음',
    noChannels: '표시할 채널이 없어요',
  },
  en: {
    channelsLabel: 'Channels',
    dmsLabel: 'Direct Messages',

    dmFilterPlaceholder: 'Find a conversation',
    dmFilterClear: 'Clear search',
    dmSection: 'Direct Messages',
    dmMatches: (count) => `${count} ${count === 1 ? 'match' : 'matches'}`,
    dmSelectAll: 'Select all conversations',
    dmSelectMatches: (count) => `Select all ${count} matching ${count === 1 ? 'conversation' : 'conversations'}`,
    dmEmpty: 'No conversations yet',
    dmNoMatch: (query) => `No conversations match "${query}"`,
    groupMembers: (count) => `${count} ${count === 1 ? 'member' : 'members'}`,

    selectServer: 'Select every channel of this server',
    selectCategory: (name) => `Select every channel in ${name}`,
    selectForExport: (name) => `Select ${name} for export`,
    noAccess: 'No access',
    noChannels: 'There are no channels to show',
  },
});
