import { defineStrings } from './core';

export const onboardingStrings = defineStrings({
  ko: {
    title: 'Discord 로그인 정보가 필요해요',
    subtitle: 'Chrome에서 이미 로그인한 Discord를 그대로 사용해 대화를 내보냅니다.',

    reasonNoToken: '아직 Discord 로그인 정보를 찾지 못했어요.',
    reasonExpired: 'Discord 로그인 정보가 만료되었어요. 다시 로그인해 주세요.',
    reasonInvalid: 'Discord가 로그인 정보를 거부했어요. Discord 탭에서 다시 로그인해 주세요.',

    stepsLabel: '진행 방법',
    step1Title: 'discord.com에 먼저 로그인하세요',
    step1Body: 'Chrome의 새 탭에서 Discord에 로그인해 두면 됩니다.',
    step2Title: '이미 열린 Discord 탭의 로그인을 읽어요',
    step2Body:
      'Chrome은 Discord가 요청을 보낼 때만 로그인 정보를 볼 수 있어요. 탭이 이미 열려 있었다면 새로고침으로 그 요청을 다시 일으키세요.',
    step3Title: '내 컴퓨터 밖으로 아무것도 나가지 않아요',
    step3Body: '데이터는 이 브라우저와 Discord 사이에서만 오가며, 별도 서버·분석 도구로 전송되지 않습니다.',

    tabsChecking: 'Discord 탭을 확인하는 중…',
    tabsNone: '열려 있는 Discord 탭이 없어요',
    tabsCount: (count: number) => `열려 있는 Discord 탭 ${count}개`,

    openDiscord: 'Discord 열기',
    reloadTabs: 'Discord 탭 새로고침',
    reloadHint: '새로고침하면 Discord가 요청을 다시 보내고, 그때 로그인 정보를 읽어 올 수 있어요.',
    reloadedTabs: (count: number) => `탭 ${count}개를 새로고침했어요. Discord가 불러오는 동안 잠시 기다려 주세요…`,
    reloadFailed: '탭을 새로고침하지 못했어요. 직접 새로고침해 주세요.',
    openFailed: 'Discord를 열지 못했어요. 직접 discord.com을 열어 주세요.',

    tokenDetected: '로그인 정보를 확인했어요. 불러오는 중…',
    tryDemo: '데모 모드로 둘러보기',
    demoHint: '가상의 서버와 대화로 화면을 미리 체험할 수 있어요. Discord 계정은 필요 없어요.',

    notice:
      '내 계정의 로그인 정보로 읽기만 합니다. Discord 이용약관과 충돌할 수 있으니 본인 대화의 개인 백업 용도로만 사용하세요.',
  },
  en: {
    title: 'Discord login needed',
    subtitle: 'Exports your chats using the Discord you are already logged in to in Chrome.',

    reasonNoToken: 'No Discord login found yet.',
    reasonExpired: 'Your Discord login has expired. Please log in again.',
    reasonInvalid: 'Discord rejected the login. Please log in again in a Discord tab.',

    stepsLabel: 'How it works',
    step1Title: 'Log in at discord.com first',
    step1Body: 'Open Discord in a regular Chrome tab and sign in.',
    step2Title: 'We read the login your open Discord tab already has',
    step2Body:
      'Chrome only sees the login when Discord makes a request. If the tab was already open, reload it to trigger one.',
    step3Title: 'Nothing leaves your computer',
    step3Body: 'Data only travels between this browser and Discord. No server of ours, no analytics.',

    tabsChecking: 'Checking for Discord tabs…',
    tabsNone: 'No Discord tab is open',
    tabsCount: (count) => `${count} Discord ${count === 1 ? 'tab' : 'tabs'} open`,

    openDiscord: 'Open Discord',
    reloadTabs: 'Reload Discord tabs',
    reloadHint: 'Reloading makes Discord send its requests again, which lets us pick up the login.',
    reloadedTabs: (count) => `Reloaded ${count} ${count === 1 ? 'tab' : 'tabs'}. Give Discord a moment to load…`,
    reloadFailed: 'Could not reload the tabs. Please reload them yourself.',
    openFailed: 'Could not open Discord. Please open discord.com yourself.',

    tokenDetected: 'Login detected. Loading…',
    tryDemo: 'Explore in demo mode',
    demoHint: 'Try the interface with made-up servers and chats. No Discord account needed.',

    notice:
      'Uses your own session and only reads. This may conflict with Discord’s Terms of Service, so use it for personal backups of your own conversations only.',
  },
});
