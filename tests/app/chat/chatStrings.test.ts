import { describe, expect, it } from 'vitest';
import { chatStrings } from '@/app/components/chat/chatStrings';

describe('chat strings', () => {
  const ko = chatStrings.ko as Record<string, unknown>;
  const en = chatStrings.en as Record<string, unknown>;

  it('have the same keys and kinds in both languages, and nothing blank', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    for (const key of Object.keys(ko)) {
      expect(typeof en[key], key).toBe(typeof ko[key]);
      if (typeof ko[key] === 'string') {
        expect((ko[key] as string).trim(), `ko.${key}`).not.toBe('');
        expect((en[key] as string).trim(), `en.${key}`).not.toBe('');
      }
    }
  });

  it('say the required things', () => {
    expect(chatStrings.ko.emptyTitle).toBe('채널을 선택하세요');
    expect(chatStrings.en.emptyBody).toBe('Pick a channel on the left; tick the boxes to choose what to download.');
    expect(chatStrings.en.forbiddenTitle).toBe("You can't view this channel");
    expect(chatStrings.ko.forbiddenTitle).toBe('이 채널을 볼 수 없어요');
    expect(chatStrings.en.loadingOlder).toBe('Loading older messages…');
    expect(chatStrings.en.jumpToLatest).toBe('Jump to latest');
    expect(chatStrings.ko.jumpToLatest).toBe('맨 아래로');
    expect(chatStrings.en.welcomeTitle('general')).toBe('Welcome to #general!');
    expect(chatStrings.ko.welcomeTitle('general')).toBe('#general 채널에 오신 것을 환영합니다!');
    expect(chatStrings.en.channelStart('general')).toBe('This is the start of the #general channel.');
    expect(chatStrings.en.dmStart('Alex')).toBe('This is the beginning of your direct message history with Alex.');
  });

  it('put the given name in every sentence that takes one, untouched', () => {
    const name = '<b>x</b> & "y"';
    for (const table of [chatStrings.ko, chatStrings.en]) {
      for (const build of [table.listLabelChannel, table.listLabelThread, table.listLabelDm, table.welcomeTitle, table.channelStart, table.dmStart, table.groupStart]) {
        expect(build(name)).toContain(name);
      }
    }
  });
});
