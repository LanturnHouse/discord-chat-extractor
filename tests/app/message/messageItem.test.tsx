// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DayDivider, MessageItem, type MessageRenderContext } from '@/app/components/message';
import { createMockClient, MOCK_IDS } from '@/lib/discord/mock';
import { fetchMessagePage } from '@/lib/discord/pagination';
import type { Message, User } from '@/lib/discord/types';
import { buildNameResolver } from '@/lib/message';

const renders = vi.hoisted(() => ({ reactionBar: 0 }));

// Counts how often a leaf component of a message row renders: the observable effect of React.memo on MessageItem.
vi.mock('@/app/components/message/ReactionBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/message/ReactionBar')>();
  return {
    ...actual,
    ReactionBar: (props: Parameters<typeof actual.ReactionBar>[0]) => {
      renders.reactionBar += 1;
      return actual.ReactionBar(props);
    },
  };
});

afterEach(() => {
  cleanup();
  renders.reactionBar = 0;
});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** Monday 2026-10-05 10:00 UTC (19:00 in Seoul). */
const T0 = Date.UTC(2026, 9, 5, 10, 0, 0);
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const ALICE: User = { id: '1001', username: 'alice_a', global_name: 'Alice', avatar: null, discriminator: '0' };
const BOB: User = { id: '1002', username: 'bob_b', global_name: 'Bob', avatar: null, discriminator: '0' };

let sequence = 0;
function msg(overrides: Partial<Message> = {}): Message {
  sequence += 1;
  return {
    id: String(5_000_000 + sequence),
    channel_id: '7',
    author: ALICE,
    content: 'hello',
    timestamp: at(0),
    edited_timestamp: null,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    type: 0,
    ...overrides,
  };
}

function makeCtx(locale: 'ko' | 'en' = 'en', timeZone = 'UTC'): MessageRenderContext {
  return { locale, timeZone, names: buildNameResolver() };
}

function List({ messages, ctx }: { messages: readonly Message[]; ctx: MessageRenderContext }) {
  return (
    <div>
      {messages.map((message, index) => (
        <MessageItem key={message.id} message={message} prev={messages[index - 1]} ctx={ctx} />
      ))}
    </div>
  );
}

function must<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`missing element: ${selector}`);
  return element;
}

const articles = (root: ParentNode): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('article.msg'));
const has = (element: Element, className: string): boolean => element.classList.contains(className);

describe('mock showcase channel', () => {
  it.each(['ko', 'en'] as const)('renders every message without throwing (%s)', async (locale) => {
    const page = await fetchMessagePage(createMockClient({ latencyMs: 0 }), MOCK_IDS.showcaseChannel, { size: 1000 });
    expect(page.messages.length).toBeGreaterThan(100);
    const ctx = makeCtx(locale);
    ctx.names.addMessages(page.messages);

    const { container } = render(<List messages={page.messages} ctx={ctx} />);

    expect(articles(container).map((a) => a.dataset.messageId)).toEqual(page.messages.map((m) => m.id));
  });

  it('renders without React warnings (keys, DOM nesting, unknown attributes)', async () => {
    const page = await fetchMessagePage(createMockClient({ latencyMs: 0 }), MOCK_IDS.showcaseChannel, { size: 1000 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = makeCtx('ko');
      ctx.names.addMessages(page.messages);
      const { container } = render(<List messages={page.messages} ctx={ctx} />);
      for (const cover of Array.from(container.querySelectorAll('button.msg-spoiler-cover'))) fireEvent.click(cover);
      expect(errors.mock.calls).toEqual([]);
      expect(warnings.mock.calls).toEqual([]);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it('shows every kind of message content', async () => {
    const page = await fetchMessagePage(createMockClient({ latencyMs: 0 }), MOCK_IDS.showcaseChannel, { size: 1000 });
    const ctx = makeCtx('en');
    ctx.names.addMessages(page.messages);

    const { container } = render(<List messages={page.messages} ctx={ctx} />);

    for (const selector of [
      '.msg-day-divider',
      '.msg--grouped',
      '.msg-reply',
      '.msg-reply--deleted',
      '.msg-forward-label',
      '.msg-forward',
      '.msg-tag',
      '.msg-edited',
      '.msg-attachment--image',
      '.msg-attachment--video',
      '.msg-attachment--audio',
      '.msg-attachment--file',
      '.msg-attachment--spoiler',
      '.msg-embed',
      '.msg-embed__fields',
      '.msg-sticker',
      '.msg-poll',
      '.msg-poll--closed',
      '.msg-reaction',
      '.msg-reaction--me',
      '.msg--system',
    ]) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }
  });
});

describe('grouping', () => {
  it('collapses a follow-up message of the same author into the first one', () => {
    const first = msg({ timestamp: at(0) });
    const second = msg({ timestamp: at(6 * MINUTE + 59 * SECOND), content: 'second' });
    const { container } = render(<List messages={[first, second]} ctx={makeCtx()} />);

    const [a, b] = articles(container);
    expect(has(a!, 'msg--first')).toBe(true);
    expect(a!.querySelector('.msg-avatar')).not.toBeNull();
    expect(a!.querySelector('.msg-author')!.textContent).toBe('Alice');

    expect(has(b!, 'msg--grouped')).toBe(true);
    expect(b!.querySelector('.msg-avatar')).toBeNull();
    expect(b!.querySelector('.msg-author')).toBeNull();
    expect(b!.querySelector('.msg-header')).toBeNull();
    expect(must(b!, '.msg-gutter-time').textContent).toBe('10:06 AM');
    expect(must(b!, '.msg-content').textContent).toBe('second');
  });

  it('starts a new group at exactly seven minutes, for another author and after a system message', () => {
    const base = msg({ timestamp: at(0) });
    const late = msg({ timestamp: at(7 * MINUTE) });
    const other = msg({ author: BOB, timestamp: at(7 * MINUTE + SECOND) });
    const system = msg({ type: 7, content: '', timestamp: at(7 * MINUTE + 2 * SECOND) });
    const after = msg({ author: ALICE, timestamp: at(7 * MINUTE + 3 * SECOND) });
    const { container } = render(<List messages={[base, late, other, system, after]} ctx={makeCtx()} />);

    const rows = articles(container);
    expect(rows.map((r) => has(r, 'msg--grouped'))).toEqual([false, false, false, false, false]);
    expect(has(rows[3]!, 'msg--system')).toBe(true);
  });

  it('never groups replies or messages across a day boundary', () => {
    const original = msg({ timestamp: at(0) });
    const reply = msg({
      type: 19,
      timestamp: at(MINUTE),
      message_reference: { message_id: original.id },
      referenced_message: original,
    });
    const beforeMidnight = msg({ timestamp: '2026-10-05T23:59:00.000Z' });
    const afterMidnight = msg({ timestamp: '2026-10-06T00:01:00.000Z' }); // two minutes later, but another day
    const { container } = render(<List messages={[original, reply, beforeMidnight, afterMidnight]} ctx={makeCtx()} />);

    expect(articles(container).map((r) => has(r, 'msg--grouped'))).toEqual([false, false, false, false]);
  });

  it('keeps the clock of a grouped message in the viewer time zone', () => {
    const first = msg({ timestamp: at(0) });
    const second = msg({ timestamp: at(MINUTE) });
    const { container } = render(<List messages={[first, second]} ctx={makeCtx('ko', 'Asia/Seoul')} />);

    expect(must(articles(container)[1]!, '.msg-gutter-time').textContent).toBe('오후 7:01');
  });
});

describe('day divider', () => {
  it('appears before the first message and whenever the calendar day changes', () => {
    const a = msg({ timestamp: at(0) });
    const b = msg({ timestamp: at(MINUTE) });
    const c = msg({ timestamp: at(24 * 60 * MINUTE) });
    const { container } = render(<List messages={[a, b, c]} ctx={makeCtx('en')} />);

    const dividers = Array.from(container.querySelectorAll('.msg-day-divider'));
    expect(dividers.map((d) => d.textContent)).toEqual(['October 5, 2026', 'October 6, 2026']);
    expect(dividers[0]!.getAttribute('role')).toBe('separator');
    expect(dividers[0]!.getAttribute('aria-label')).toBe('October 5, 2026');
    // The divider is a sibling placed right before the row of its first message.
    expect(dividers[1]!.nextElementSibling).toBe(articles(container)[2]);
    expect(dividers[0]!.nextElementSibling).toBe(articles(container)[0]);
  });

  it('is localised', () => {
    const { container } = render(<List messages={[msg()]} ctx={makeCtx('ko')} />);
    expect(must(container, '.msg-day-divider__label').textContent).toBe('2026년 10월 5일');
  });

  it('follows the time zone of the viewer', () => {
    const late = msg({ timestamp: '2026-10-05T23:30:00.000Z' });
    const early = msg({ timestamp: '2026-10-06T00:30:00.000Z', author: BOB });

    const utc = render(<List messages={[late, early]} ctx={makeCtx('en', 'UTC')} />);
    expect(utc.container.querySelectorAll('.msg-day-divider')).toHaveLength(2);
    utc.unmount();

    // 08:30 and 09:30 on the same day in Seoul
    const seoul = render(<List messages={[late, early]} ctx={makeCtx('en', 'Asia/Seoul')} />);
    expect(seoul.container.querySelectorAll('.msg-day-divider')).toHaveLength(1);
  });

  it('renders nothing for an unreadable timestamp', () => {
    const { container } = render(<DayDivider timestamp="not a date" ctx={makeCtx()} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('header', () => {
  it('shows avatar, display name and a timestamp with a full tooltip', () => {
    const { container } = render(<List messages={[msg()]} ctx={makeCtx('en')} />);

    const avatar = must<HTMLImageElement>(container, 'img.msg-avatar');
    expect(avatar.width).toBe(40);
    expect(avatar.getAttribute('alt')).toBe('');
    expect(avatar.getAttribute('loading')).toBe('lazy');
    expect(avatar.getAttribute('src')).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/\d\.png$/);
    expect(must(container, '.msg-author').textContent).toBe('Alice');

    const time = must<HTMLTimeElement>(container, '.msg-timestamp');
    expect(time.textContent).toBe('10/05/2026 10:00 AM');
    expect(time.title).toBe('Monday, October 5, 2026 at 10:00 AM');
    expect(time.getAttribute('datetime')).toBe(at(0));
  });

  it('uses Korean formats for the Korean locale', () => {
    const { container } = render(<List messages={[msg()]} ctx={makeCtx('ko')} />);
    expect(must(container, '.msg-timestamp').textContent).toBe('2026. 10. 05. 오전 10:00');
    expect(must<HTMLElement>(container, '.msg-timestamp').title).toBe('2026년 10월 5일 월요일 오전 10:00');
  });

  it('falls back from the display name to the username, then to a placeholder', () => {
    const plain: User = { id: '1003', username: 'carol_c', global_name: null, avatar: null };
    const broken = msg({ author: undefined as unknown as User });
    const { container } = render(<List messages={[msg({ author: plain }), broken]} ctx={makeCtx('en')} />);
    expect(Array.from(container.querySelectorAll('.msg-author')).map((n) => n.textContent)).toEqual(['carol_c', 'Unknown user']);
  });

  it('tags bots and webhooks', () => {
    const bot: User = { id: '1004', username: 'HelperBot', avatar: null, bot: true };
    const { container, rerender } = render(<List messages={[msg({ author: bot }), msg()]} ctx={makeCtx('en')} />);
    const tags = container.querySelectorAll('.msg-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.textContent).toBe('APP');
    expect(has(articles(container)[0]!, 'msg--app')).toBe(true);

    rerender(<List messages={[msg({ webhook_id: '99' })]} ctx={makeCtx('ko')} />);
    expect(must(container, '.msg-tag').textContent).toBe('앱');
  });

  it('marks edited messages with a localised muted marker and a tooltip', () => {
    const edited = msg({ edited_timestamp: at(30 * MINUTE) });
    const { container, rerender } = render(<List messages={[edited]} ctx={makeCtx('en')} />);
    const marker = must<HTMLElement>(container, '.msg-edited');
    expect(marker.textContent).toBe('(edited)');
    expect(marker.title).toBe('Monday, October 5, 2026 at 10:30 AM');
    // the marker is inside the content block, next to the text
    expect(marker.parentElement!.classList.contains('msg-content')).toBe(true);

    rerender(<List messages={[msg({ edited_timestamp: at(30 * MINUTE) })]} ctx={makeCtx('ko')} />);
    expect(must(container, '.msg-edited').textContent).toBe('(수정됨)');

    rerender(<List messages={[msg()]} ctx={makeCtx('en')} />);
    expect(container.querySelector('.msg-edited')).toBeNull();
  });

  it('exposes the author and time as the accessible name of the article', () => {
    const { container } = render(<List messages={[msg()]} ctx={makeCtx('en')} />);
    expect(articles(container)[0]!.getAttribute('aria-label')).toBe('Alice, Monday, October 5, 2026 at 10:00 AM');
    expect(articles(container)[0]!.dataset.messageId).toBeDefined();
  });

  it('renders no text block for an empty message', () => {
    const { container } = render(<List messages={[msg({ content: '   ' })]} ctx={makeCtx('en')} />);
    expect(container.querySelector('.msg-content')).toBeNull();
  });
});

describe('reply preview', () => {
  const original = msg({ author: BOB, content: '**Bold** original\nsecond line', timestamp: at(-MINUTE) });

  it('shows a connector, the mini avatar, @name and the one-line text of the original', () => {
    const reply = msg({ type: 19, message_reference: { message_id: original.id }, referenced_message: original });
    const { container } = render(<List messages={[reply]} ctx={makeCtx('en')} />);

    const row = articles(container)[0]!;
    expect(has(row, 'msg--reply')).toBe(true);
    const preview = must(row, '.msg-reply');
    expect(row.firstElementChild).toBe(preview);
    const miniAvatar = must<HTMLImageElement>(preview, '.msg-reply__avatar');
    expect(miniAvatar.width).toBe(16);
    expect(must(preview, '.msg-reply__name').textContent).toBe('Replying to @Bob');
    expect(must(preview, '.msg-reply__name .msg-sr-only').textContent).toBe('Replying to ');
    expect(must(preview, '.msg-reply__text').textContent).toBe('Bold original second line');
    expect(preview.classList.contains('msg-reply--deleted')).toBe(false);
    // the reply itself still has an avatar and a header
    expect(must(row, '.msg-author').textContent).toBe('Alice');
  });

  it('says so when the original was deleted (italic, localised, no author)', () => {
    const reply = msg({ type: 19, message_reference: { message_id: '1' }, referenced_message: null });
    const en = render(<List messages={[reply]} ctx={makeCtx('en')} />);
    const preview = must(en.container, '.msg-reply');
    expect(has(preview, 'msg-reply--deleted')).toBe(true);
    expect(must(preview, '.msg-reply__text').textContent).toBe('Original message was deleted');
    expect(preview.querySelector('.msg-reply__avatar')).toBeNull();
    expect(preview.querySelector('.msg-reply__name')).toBeNull();
    en.unmount();

    const ko = render(<List messages={[reply]} ctx={makeCtx('ko')} />);
    expect(must(ko.container, '.msg-reply__text').textContent).toBe('원본 메시지가 삭제되었어요');
  });

  it('distinguishes a deleted original from one the API did not deliver', () => {
    const reply = msg({ type: 19, message_reference: { message_id: '1' } });
    const { container } = render(<List messages={[reply]} ctx={makeCtx('en')} />);
    expect(must(container, '.msg-reply__text').textContent).toBe('Original message is unavailable');
  });

  it('describes an original that only had an attachment', () => {
    const media = msg({
      author: BOB,
      content: '',
      attachments: [{ id: '1', filename: 'a.png', size: 10, url: 'https://cdn.discordapp.com/a.png' }],
    });
    const reply = msg({ type: 19, message_reference: { message_id: media.id }, referenced_message: media });
    const { container } = render(<List messages={[reply]} ctx={makeCtx('ko')} />);
    expect(must(container, '.msg-reply__text').textContent).toBe('첨부 파일 보기');
  });

  it('labels a forwarded message instead of showing a reply line', () => {
    const forward = msg({
      content: '',
      message_reference: { type: 1, message_id: '1', channel_id: '2' },
      message_snapshots: [{ message: { content: 'forwarded text', attachments: [], embeds: [] } }],
    });
    const en = render(<List messages={[forward]} ctx={makeCtx('en')} />);
    const row = articles(en.container)[0]!;
    expect(has(row, 'msg--forward')).toBe(true);
    expect(row.querySelector('.msg-reply')).toBeNull();
    expect(must(row, '.msg-forward-label').textContent).toBe('Forwarded');
    expect(must(row, '.msg-forward .msg-content').textContent).toBe('forwarded text');
    en.unmount();

    const ko = render(<List messages={[forward]} ctx={makeCtx('ko')} />);
    expect(must(ko.container, '.msg-forward-label').textContent).toBe('전달됨');
  });
});

describe('system messages', () => {
  it.each([
    ['en', 7, '', 'Alice joined the server.', 'join'],
    ['ko', 7, '', 'Alice님이 서버에 참여했어요.', 'join'],
    ['en', 6, '', 'Alice pinned a message to this channel.', 'pin'],
    ['ko', 6, '', 'Alice님이 이 채널에 메시지를 고정했어요.', 'pin'],
    ['en', 8, '', 'Alice boosted the server.', 'boost'],
    ['ko', 8, '2', 'Alice님이 서버를 2번 부스트했어요.', 'boost'],
    ['en', 18, 'Release notes', 'Alice started a thread: Release notes', 'neutral'],
    ['ko', 18, '릴리스 노트', 'Alice님이 스레드를 시작했어요: 릴리스 노트', 'neutral'],
  ] as const)('renders %s type %i as an icon and a sentence', (locale, type, content, text, tone) => {
    const { container } = render(<List messages={[msg({ type, content })]} ctx={makeCtx(locale)} />);

    const row = articles(container)[0]!;
    expect(has(row, 'msg--system')).toBe(true);
    expect(row.querySelector('.msg-avatar')).toBeNull();
    expect(row.querySelector('.msg-header')).toBeNull();
    expect(must(row, '.msg-system__icon').classList.contains(`msg-system__icon--${tone}`)).toBe(true);
    expect(must(row, '.msg-system__icon svg').getAttribute('aria-hidden')).toBe('true');
    expect(must(row, '.msg-system__text').textContent!.startsWith(text)).toBe(true);
    expect(must(row, '.msg-system__actor').textContent).toBe('Alice');
    expect(must(row, '.msg-timestamp').textContent).not.toBe('');
  });

  it('falls back to a generic sentence and a neutral icon for unknown types', () => {
    const { container } = render(<List messages={[msg({ type: 99, content: '' })]} ctx={makeCtx('en')} />);
    expect(must(container, '.msg-system__text').textContent!.startsWith('[System message (type 99)]')).toBe(true);
    expect(has(must(container, '.msg-system__icon'), 'msg-system__icon--neutral')).toBe(true);
  });

  it('does not emphasise a name that is not part of the sentence', () => {
    const { container } = render(<List messages={[msg({ type: 22, content: '' })]} ctx={makeCtx('en')} />);
    expect(container.querySelector('.msg-system__actor')).toBeNull();
    expect(must(container, '.msg-system__text').textContent!.startsWith('Reminder: invite people to the server.')).toBe(true);
  });
});

describe('images that fail to load', () => {
  it('replaces a broken avatar with a coloured circle showing the initial', () => {
    const { container } = render(<List messages={[msg()]} ctx={makeCtx('en')} />);
    fireEvent.error(must(container, 'img.msg-avatar'));

    expect(container.querySelector('img.msg-avatar')).toBeNull();
    const fallback = must(container, '.msg-avatar.msg-avatar-fallback');
    expect(fallback.textContent).toBe('A');
    expect(fallback.getAttribute('aria-hidden')).toBe('true');
    expect(fallback.className).toMatch(/msg-avatar-fallback--[0-5]/);
  });

  it('keeps a flag or a joined emoji at the start of the name whole in the initial', () => {
    for (const [global_name, initial] of [
      ['🇰🇷 Korea', '🇰🇷'],
      ['👨‍👩‍👧 Family', '👨‍👩‍👧'],
    ] as const) {
      const { container } = render(<List messages={[msg({ author: { ...ALICE, global_name } })]} ctx={makeCtx('en')} />);
      fireEvent.error(must(container, 'img.msg-avatar'));
      expect(must(container, '.msg-avatar.msg-avatar-fallback').textContent).toBe(initial);
      cleanup();
    }
  });

  it('does the same for the mini avatar of a reply and keeps the rest of the row', () => {
    const original = msg({ author: BOB });
    const reply = msg({ type: 19, message_reference: { message_id: original.id }, referenced_message: original });
    const { container } = render(<List messages={[reply]} ctx={makeCtx('en')} />);
    fireEvent.error(must(container, 'img.msg-reply__avatar'));

    const fallback = must(container, '.msg-reply__avatar.msg-avatar-fallback');
    expect(fallback.textContent).toBe('B');
    expect(must(container, '.msg-reply__name').textContent).toContain('@Bob');
    expect(container.querySelector('img.msg-avatar')).not.toBeNull();
  });

  it('shows :name: for a custom emoji reaction and the name for a sticker', () => {
    const message = msg({
      reactions: [{ count: 2, emoji: { id: '123456789012345678', name: 'party_parrot', animated: true } }],
      sticker_items: [{ id: '223456789012345678', name: 'wave', format_type: 1 }],
    });
    const { container } = render(<List messages={[message]} ctx={makeCtx('en')} />);

    const emoji = must<HTMLImageElement>(container, '.msg-reaction img.msg-reaction__img');
    expect(emoji.alt).toBe(':party_parrot:');
    fireEvent.error(emoji);
    expect(container.querySelector('.msg-reaction img')).toBeNull();
    expect(must(container, '.msg-reaction__emoji--text').textContent).toBe(':party_parrot:');

    fireEvent.error(must(container, 'img.msg-sticker__image'));
    expect(container.querySelector('img.msg-sticker__image')).toBeNull();
    expect(must(container, '.msg-sticker__name').textContent).toBe('wave');
  });

  it('drops a broken embed picture and turns a broken attachment image into a file card', () => {
    const message = msg({
      content: '',
      attachments: [
        { id: '9', filename: 'photo.png', content_type: 'image/png', size: 2048, url: 'https://cdn.discordapp.com/attachments/1/9/photo.png' },
      ],
      embeds: [
        {
          type: 'rich',
          title: 'Title',
          image: { url: 'https://cdn.discordapp.com/a.png', width: 100, height: 50 },
          author: { name: 'Someone', icon_url: 'https://cdn.discordapp.com/icon.png' },
        },
      ],
    });
    const { container } = render(<List messages={[message]} ctx={makeCtx('en')} />);

    fireEvent.error(must(container, '.msg-attachment--image img'));
    expect(container.querySelector('.msg-attachment--image')).toBeNull();
    expect(must(container, '.msg-attachment--file .msg-file__name').textContent).toBe('photo.png');

    fireEvent.error(must(container, '.msg-embed__author-icon'));
    expect(container.querySelector('.msg-embed__author-icon')).toBeNull();
    expect(must(container, '.msg-embed__author-name').textContent).toBe('Someone');

    fireEvent.error(must(container, '.msg-embed__media img'));
    expect(container.querySelector('.msg-embed__media')).toBeNull();
    expect(must(container, '.msg-embed__title').textContent).toBe('Title');
  });

  it('never leaves an <img> without a source behind', async () => {
    const page = await fetchMessagePage(createMockClient({ latencyMs: 0 }), MOCK_IDS.showcaseChannel, { size: 1000 });
    const { container } = render(<List messages={page.messages} ctx={makeCtx('en')} />);
    for (const image of Array.from(container.querySelectorAll('img'))) {
      expect(image.getAttribute('src'), image.outerHTML.slice(0, 120)).toBeTruthy();
    }
  });
});

describe('memoisation', () => {
  const withReactions = msg({ reactions: [{ count: 1, emoji: { id: null, name: '👍' } }] });
  const previous = msg({ author: BOB, timestamp: at(-MINUTE) });

  it('does not re-render a row when it is given identical props', () => {
    const ctx = makeCtx();
    const { rerender } = render(<MessageItem message={withReactions} prev={previous} ctx={ctx} />);
    expect(renders.reactionBar).toBe(1);

    rerender(<MessageItem message={withReactions} prev={previous} ctx={ctx} />);
    expect(renders.reactionBar).toBe(1);
  });

  it('treats a copy of the same message (same ids) as unchanged', () => {
    const ctx = makeCtx();
    const { rerender } = render(<MessageItem message={withReactions} prev={previous} ctx={ctx} />);

    rerender(<MessageItem message={structuredClone(withReactions)} prev={structuredClone(previous)} ctx={ctx} />);
    expect(renders.reactionBar).toBe(1);
  });

  it('re-renders when the message, its predecessor or the context changes', () => {
    const ctx = makeCtx();
    const { rerender } = render(<MessageItem message={withReactions} prev={previous} ctx={ctx} />);

    rerender(<MessageItem message={withReactions} prev={undefined} ctx={ctx} />);
    expect(renders.reactionBar).toBe(2);

    rerender(<MessageItem message={withReactions} prev={undefined} ctx={makeCtx()} />);
    expect(renders.reactionBar).toBe(3);

    rerender(<MessageItem message={{ ...withReactions, id: '5999999' }} prev={undefined} ctx={makeCtx()} />);
    expect(renders.reactionBar).toBe(4);
  });

  it('keeps unrelated rows untouched when only one of them changes in a list', () => {
    const ctx = makeCtx();
    const rows = [msg({ reactions: withReactions.reactions }), msg({ reactions: withReactions.reactions })];
    const { rerender } = render(<List messages={rows} ctx={ctx} />);
    expect(renders.reactionBar).toBe(2);

    // Prepending a message renders the new row and the old first row (its `prev` changed), but not the second row.
    const older = msg({ author: BOB, timestamp: at(-5 * MINUTE) });
    rerender(<List messages={[older, ...rows]} ctx={ctx} />);
    expect(renders.reactionBar).toBe(4);
  });
});
