import { defineStrings } from '@/app/i18n';

export const chatStrings = defineStrings({
  ko: {
    chatLabel: '메시지',
    emptyTitle: '채널을 선택하세요',
    emptyBody: '왼쪽에서 채널을 고르고, 체크박스를 눌러 다운로드할 항목을 선택하세요.',
    emptyDmTitle: '대화를 선택하세요',
    emptyDmBody: '왼쪽에서 대화를 고르고, 체크박스를 눌러 다운로드할 대화를 선택하세요.',

    loadingMessages: '메시지를 불러오는 중…',
    forbiddenTitle: '이 채널을 볼 수 없어요',
    forbiddenBody: '접근 권한이 없어서 이 채널의 메시지를 표시하거나 내보낼 수 없어요.',
    errorTitle: '메시지를 불러오지 못했어요',
    forumTitle: '포럼 채널이에요',
    forumBody: '포럼에는 메시지가 없고 게시글만 있어요. 왼쪽 목록에서 게시글을 선택하세요.',

    loadingOlder: '이전 메시지를 불러오는 중…',
    olderFailed: '이전 메시지를 불러오지 못했어요',
    jumpToLatest: '맨 아래로',

    listLabelChannel: (name: string) => `#${name} 채널의 메시지`,
    listLabelThread: (name: string) => `${name} 스레드의 메시지`,
    listLabelDm: (name: string) => `${name}님과의 메시지`,

    welcomeTitle: (name: string) => `#${name} 채널에 오신 것을 환영합니다!`,
    channelStart: (name: string) => `여기는 #${name} 채널의 시작이에요.`,
    threadStart: '여기는 이 스레드의 시작이에요.',
    dmStart: (name: string) => `${name}님과 주고받은 다이렉트 메시지 기록의 시작이에요.`,
    groupStart: (name: string) => `${name} 그룹 대화의 시작이에요.`,
  },
  en: {
    chatLabel: 'Messages',
    emptyTitle: 'Pick a channel',
    emptyBody: 'Pick a channel on the left; tick the boxes to choose what to download.',
    emptyDmTitle: 'Pick a conversation',
    emptyDmBody: 'Pick a conversation on the left; tick the boxes to choose which ones to download.',

    loadingMessages: 'Loading messages…',
    forbiddenTitle: "You can't view this channel",
    forbiddenBody: "You don't have permission to read it, so its messages can't be shown or exported.",
    errorTitle: "Couldn't load the messages",
    forumTitle: 'This is a forum channel',
    forumBody: 'A forum has posts instead of messages. Pick one of its posts in the list on the left.',

    loadingOlder: 'Loading older messages…',
    olderFailed: "Couldn't load older messages",
    jumpToLatest: 'Jump to latest',

    listLabelChannel: (name) => `Messages in #${name}`,
    listLabelThread: (name) => `Messages in the thread ${name}`,
    listLabelDm: (name) => `Messages with ${name}`,

    welcomeTitle: (name) => `Welcome to #${name}!`,
    channelStart: (name) => `This is the start of the #${name} channel.`,
    threadStart: 'This is the start of the thread.',
    dmStart: (name) => `This is the beginning of your direct message history with ${name}.`,
    groupStart: (name) => `This is the beginning of the ${name} group conversation.`,
  },
});
