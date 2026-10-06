import { defineStrings } from './core';

/** Strings of the shell itself (boot error panel, crash panel). */
export const appStrings = defineStrings({
  ko: {
    fatalTitle: 'Discord 데이터를 불러오지 못했어요',
    crashTitle: '화면을 표시하는 중 문제가 발생했어요',
    crashHint: '페이지를 새로고침하면 다시 시도할 수 있어요.',
  },
  en: {
    fatalTitle: 'Could not load your Discord data',
    crashTitle: 'Something went wrong while showing this screen',
    crashHint: 'Reloading the page lets you try again.',
  },
});
