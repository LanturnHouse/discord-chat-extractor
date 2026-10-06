// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/lib/markdown/parse';
import { DiscordMarkdown, renderReact } from '@/lib/markdown/renderReact';
import type { MarkdownContext, MdNode } from '@/lib/markdown/types';
import { fastestRunMs } from './timing';

const parseSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/markdown/parse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/markdown/parse')>();
  return {
    ...actual,
    parseMarkdown: (src: string) => {
      parseSpy(src);
      return actual.parseMarkdown(src);
    },
  };
});

const USERS: Record<string, string> = { '1': 'Alice', '666': '<img src=x onerror=alert(1)>' };
const CHANNELS: Record<string, string> = { '5': 'general' };
const ROLES: Record<string, string> = { '9': 'Mods' };

const makeCtx = (locale: 'ko' | 'en' = 'en'): MarkdownContext => ({
  names: { user: (id) => USERS[id], channel: (id) => CHANNELS[id], role: (id) => ROLES[id] },
  locale,
  timeZone: 'UTC',
});
const ctx = makeCtx();

const md = (content: string, c: MarkdownContext = ctx) => render(createElement(DiscordMarkdown, { content, ctx: c }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  parseSpy.mockClear();
});

describe('DiscordMarkdown: structure', () => {
  it('renders inline formatting as semantic elements', () => {
    const { container } = md('**b** *i* __u__ ~~s~~ `c` plain');
    const root = container.querySelector('.md-root')!;
    expect(root.querySelector('strong')!.textContent).toBe('b');
    expect(root.querySelector('em')!.textContent).toBe('i');
    expect(root.querySelector('u')!.textContent).toBe('u');
    expect(root.querySelector('s')!.textContent).toBe('s');
    expect(root.querySelector('code.md-code')!.textContent).toBe('c');
    expect(root.textContent).toBe('b i u s c plain');
  });

  it('renders newlines as <br>', () => {
    const { container } = md('a\nb\n\nc');
    expect(container.querySelectorAll('br')).toHaveLength(3);
    expect(container.querySelector('.md-root')!.textContent).toBe('abc');
  });

  it('renders block elements', () => {
    const { container } = md('# H1\n### H3\n-# small\n> quote\n- a\n  - b\n1. x\n```js\ncode\n```');
    expect(container.querySelector('.md-h1[role="heading"]')!.getAttribute('aria-level')).toBe('1');
    expect(container.querySelector('.md-h3')!.textContent).toBe('H3');
    expect(container.querySelector('.md-subtext')!.textContent).toBe('small');
    expect(container.querySelector('blockquote.md-quote')!.textContent).toBe('quote');
    expect(container.querySelector('ul.md-list > li > ul.md-list > li')!.textContent).toBe('b');
    expect(container.querySelector('ol.md-list li')!.textContent).toBe('x');
    const pre = container.querySelector('pre.md-pre')!;
    expect(pre.getAttribute('data-lang')).toBe('js');
    expect(pre.textContent).toBe('code');
  });

  it('numbers ordered lists from their first number', () => {
    const { container } = md('3. a\n4. b');
    expect(container.querySelector('ol')!.getAttribute('start')).toBe('3');
  });

  it('renders mentions as chips with resolved names', () => {
    const { container } = md('<@1> <#5> <@&9> <@404> @everyone @here');
    const chips = Array.from(container.querySelectorAll('.md-mention')).map((e) => e.textContent);
    expect(chips).toEqual(['@Alice', '#general', '@Mods', '@Unknown User', '@everyone', '@here']);
  });

  it('localises unknown mentions', () => {
    const { container } = md('<@404> <#404> <@&404>', makeCtx('ko'));
    expect(Array.from(container.querySelectorAll('.md-mention')).map((e) => e.textContent)).toEqual([
      '@알 수 없는 사용자',
      '#알 수 없는 채널',
      '@삭제된-역할',
    ]);
  });

  it('renders korean text', () => {
    const { container } = md('**안녕** 세계 `코드`');
    expect(container.querySelector('strong')!.textContent).toBe('안녕');
    expect(container.textContent).toBe('안녕 세계 코드');
  });

  it('renders nothing for empty content', () => {
    const { container } = md('');
    expect(container.querySelector('.md-root')!.childNodes).toHaveLength(0);
  });

  it('produces no React warnings (keys, DOM nesting) for a message using every construct', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    md(
      [
        '# h',
        '**a** *b* __c__ ~~d~~ ||e|| `f` [g](https://a.com) https://b.com <@1> <#5> <@&9> @everyone <:x:1> <a:y:2> <t:1700000000:R> <t:1700000000>',
        '> quote **bold**',
        '- a',
        '  - b',
        '2. c',
        '```js',
        'x',
        '```',
        '-# small',
        '😀',
      ].join('\n'),
    );
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });
});

describe('DiscordMarkdown: spoilers', () => {
  it('are hidden until clicked', () => {
    const { container, getByRole, queryByRole } = md('||secret||');
    const spoiler = getByRole('button', { name: 'Spoiler (click to reveal)' });
    expect(spoiler.className).toBe('md-spoiler');
    expect(spoiler.getAttribute('tabindex')).toBe('0');
    expect(spoiler.textContent).toBe('secret');
    fireEvent.click(spoiler);
    const revealed = container.querySelector('.md-spoiler')!;
    expect(revealed.classList.contains('md-spoiler-revealed')).toBe(true);
    expect(queryByRole('button')).toBeNull();
    expect(revealed.textContent).toBe('secret');
  });

  it('stay revealed when clicked again', () => {
    const { container } = md('||secret||');
    fireEvent.click(container.querySelector('.md-spoiler')!);
    fireEvent.click(container.querySelector('.md-spoiler')!);
    expect(container.querySelector('.md-spoiler-revealed')).not.toBeNull();
  });

  it.each([['Enter'], [' ']])('reveal with the %j key', (key) => {
    const { container, getByRole } = md('||secret||');
    fireEvent.keyDown(getByRole('button'), { key });
    expect(container.querySelector('.md-spoiler-revealed')).not.toBeNull();
  });

  it('ignore other keys', () => {
    const { container, getByRole } = md('||secret||');
    fireEvent.keyDown(getByRole('button'), { key: 'a' });
    fireEvent.keyDown(getByRole('button'), { key: 'Tab' });
    expect(container.querySelector('.md-spoiler-revealed')).toBeNull();
  });

  it('keep their state per spoiler', () => {
    const { container, getAllByRole } = md('||one|| and ||two||');
    const buttons = getAllByRole('button');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    const spoilers = container.querySelectorAll('.md-spoiler');
    expect(spoilers[0]!.classList.contains('md-spoiler-revealed')).toBe(true);
    expect(spoilers[1]!.classList.contains('md-spoiler-revealed')).toBe(false);
    expect(getAllByRole('button')).toHaveLength(1);
  });

  it('can contain formatting and mentions', () => {
    const { container, getByRole } = md('||a **b** <@1>||');
    const spoiler = getByRole('button');
    expect(spoiler.querySelector('strong')!.textContent).toBe('b');
    expect(spoiler.querySelector('.md-mention')!.textContent).toBe('@Alice');
    fireEvent.click(spoiler);
    expect(container.querySelector('.md-spoiler-revealed strong')).not.toBeNull();
  });

  it('are labelled in the UI language', () => {
    const { getByRole } = md('||x||', makeCtx('ko'));
    expect(getByRole('button', { name: '스포일러 (클릭하여 보기)' })).toBeTruthy();
  });

  it.each([['Enter'], [' ']])('keep the keyboard focus when revealed with the %j key', (key) => {
    const { container, getByRole } = md('||secret||');
    const spoiler = getByRole('button');
    spoiler.focus();
    expect(document.activeElement).toBe(spoiler);
    fireEvent.keyDown(spoiler, { key });
    const revealed = container.querySelector<HTMLElement>('.md-spoiler-revealed')!;
    // Same element, still focusable (but out of the tab order): a browser blurs a focused element that stops being focusable.
    expect(revealed).toBe(spoiler);
    expect(revealed.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(revealed);
  });
});

describe('DiscordMarkdown: links', () => {
  it('open in a new tab without leaking the opener', () => {
    const { container } = md('see https://a.com/x.');
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://a.com/x');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(a.getAttribute('title')).toBeNull();
    expect(container.querySelector('.md-root')!.textContent).toBe('see https://a.com/x.');
  });

  it('show the real url of masked links in the title', () => {
    const { container } = md('[click me](https://a.com/real)');
    const a = container.querySelector('a')!;
    expect(a.textContent).toBe('click me');
    expect(a.getAttribute('title')).toBe('https://a.com/real');
    expect(a.getAttribute('href')).toBe('https://a.com/real');
  });

  it('say where a masked link really goes when its text names another site', () => {
    const { container } = md('[https://discord.com/login](https://evil.example/phish)');
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://evil.example/phish');
    expect(a.querySelector('.md-link-host')!.textContent).toBe(' ↗ (evil.example)');
    expect(a.textContent).toBe('https://discord.com/login ↗ (evil.example)');
  });

  it('leave masked links with ordinary text, and links to the same site, alone', () => {
    expect(md('[click me](https://a.com/real)').container.querySelector('.md-link-host')).toBeNull();
    cleanup();
    expect(md('[a.com](https://www.a.com/real)').container.querySelector('.md-link-host')).toBeNull();
    cleanup();
    expect(md('https://a.com/x').container.querySelector('.md-link-host')).toBeNull();
  });

  it('never render unsafe schemes as links', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      const { container, unmount } = md(`[click](${bad})`);
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toBe(`[click](${bad})`);
      unmount();
    }
  });

  it('refuses hand-built nodes with unsafe urls', () => {
    const nodes: MdNode[] = [{ type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'x' }], masked: true }];
    const { container } = render(createElement('div', null, renderReact(nodes, ctx)));
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('x');
  });

  it('allows mailto on hand-built nodes', () => {
    const nodes: MdNode[] = [{ type: 'link', url: 'mailto:a@b.co', children: [{ type: 'text', text: 'mail' }], masked: false }];
    const { container } = render(createElement('div', null, renderReact(nodes, ctx)));
    expect(container.querySelector('a')!.getAttribute('href')).toBe('mailto:a@b.co');
  });
});

describe('DiscordMarkdown: never injects raw HTML', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<style>*{display:none}</style>',
    '<a href="javascript:alert(1)">x</a>',
    '**<script>alert(1)</script>**',
    '`<img src=x onerror=alert(1)>`',
    '```html\n<script>alert(1)</script>\n```',
    '> <script>alert(1)</script>',
    '# <img src=x onerror=alert(1)>',
    '||<script>alert(1)</script>||',
    '[x](https://a.com" onmouseover="alert(1))',
    '[<img src=x onerror=alert(1)>](https://a.com)',
    '<@666>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '<:x"onerror="alert(1):1>',
  ];

  it.each(payloads.map((p) => [JSON.stringify(p).slice(0, 60), p]))('%s', (_label, payload) => {
    const { container } = md(payload as string);
    expect(container.querySelector('script, iframe, svg, style, object, embed, form, input, meta, link')).toBeNull();
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) expect(attr.name.startsWith('on'), `${el.tagName} ${attr.name}`).toBe(false);
    }
    for (const a of Array.from(container.querySelectorAll('a'))) expect(a.getAttribute('href')).toMatch(/^https?:/);
    for (const img of Array.from(container.querySelectorAll('img'))) expect(img.getAttribute('src')).toMatch(/^https:\/\/cdn\.discordapp\.com\//);
  });

  it('shows markup as literal text', () => {
    const { container } = md('<script>alert(1)</script> <b>x</b>');
    expect(container.querySelector('.md-root')!.textContent).toBe('<script>alert(1)</script> <b>x</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows names from the resolver as text', () => {
    const { container } = md('<@666>');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.md-mention')!.textContent).toBe('@<img src=x onerror=alert(1)>');
  });

  it('the renderer sources never use innerHTML', () => {
    for (const file of ['renderReact.tsx']) {
      // From this file, not the working directory; a string, because jsdom's URL cannot resolve against `import.meta.url`.
      const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/lib/markdown', file), 'utf8');
      expect(source).not.toMatch(/dangerouslySetInnerHTML/);
      expect(source).not.toMatch(/innerHTML/);
    }
  });
});

describe('DiscordMarkdown: emoji', () => {
  it('renders custom emoji from the CDN with alt text and lazy loading', () => {
    const { container } = md('a <:smile:111> b <a:dance:222>');
    const imgs = container.querySelectorAll('img.md-emoji');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.getAttribute('src')).toBe('https://cdn.discordapp.com/emojis/111.png?size=44');
    expect(imgs[0]!.getAttribute('alt')).toBe(':smile:');
    expect(imgs[0]!.getAttribute('loading')).toBe('lazy');
    expect(imgs[1]!.getAttribute('src')).toBe('https://cdn.discordapp.com/emojis/222.webp?size=44&animated=true');
    expect(imgs[0]!.classList.contains('md-emoji-jumbo')).toBe(false);
  });

  it('loads emoji without a referrer and decodes them off the main thread', () => {
    const img = md('<:smile:111>').container.querySelector('img.md-emoji')!;
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('title')).toBe(':smile:');
  });

  it('shows the :name: text instead of a broken-image icon when the picture cannot be loaded', () => {
    const { container } = md('listen <:party_parrot:111> now and <:other:222>');
    const imgs = container.querySelectorAll('img.md-emoji');
    expect(imgs).toHaveLength(2);
    fireEvent.error(imgs[0]!);
    // Only the failed one is replaced; the text around it is untouched.
    expect(container.querySelectorAll('img.md-emoji')).toHaveLength(1);
    expect(container.querySelector('img[alt=":other:"]')).not.toBeNull();
    expect(container.querySelector('.md-root')!.textContent).toBe('listen :party_parrot: now and ');
  });

  it('also falls back for jumbo emoji and for animated ones', () => {
    const { container } = md('<a:dance:222>');
    expect(container.querySelector('img.md-emoji-jumbo')).not.toBeNull();
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.md-root')!.textContent).toBe(':dance:');
  });

  it('uses jumbo emoji when the message is only emoji', () => {
    const { container } = md('<:a:1> <:b:2>');
    expect(container.querySelectorAll('img.md-emoji.md-emoji-jumbo')).toHaveLength(2);
  });

  it('wraps unicode emoji in jumbo spans when the message is only emoji', () => {
    const { container } = md('😀 😎');
    const spans = Array.from(container.querySelectorAll('span.md-emoji-jumbo')).map((e) => e.textContent);
    expect(spans).toEqual(['😀', '😎']);
  });

  it('is not jumbo when there is text or too many emoji', () => {
    expect(md('hi <:a:1>').container.querySelector('.md-emoji-jumbo')).toBeNull();
    cleanup();
    expect(md('😀 hi').container.querySelector('.md-emoji-jumbo')).toBeNull();
    cleanup();
    expect(md('😀'.repeat(28)).container.querySelector('.md-emoji-jumbo')).toBeNull();
    cleanup();
    expect(md('😀'.repeat(27)).container.querySelectorAll('.md-emoji-jumbo')).toHaveLength(27);
  });

  it('renderReact only applies jumbo when asked to', () => {
    const nodes = parseMarkdown('<:a:1>');
    const plain = render(createElement('div', null, renderReact(nodes, ctx)));
    expect(plain.container.querySelector('.md-emoji-jumbo')).toBeNull();
    plain.unmount();
    const jumbo = render(createElement('div', null, renderReact(nodes, ctx, { jumbo: true })));
    expect(jumbo.container.querySelector('.md-emoji-jumbo')).not.toBeNull();
  });
});

describe('DiscordMarkdown: timestamps', () => {
  it('renders absolute styles with the full date as title', () => {
    const { container } = md('<t:1543392060:f> <t:1543392060:t>');
    const times = container.querySelectorAll('time.md-time');
    expect(times[0]!.textContent).toBe('November 28, 2018 8:01 AM');
    expect(times[0]!.getAttribute('datetime')).toBe('2018-11-28T08:01:00.000Z');
    expect(times[0]!.getAttribute('title')).toBe('Wednesday, November 28, 2018 8:01 AM');
    expect(times[1]!.textContent).toBe('8:01 AM');
  });

  it('computes relative time at render time and keeps the absolute date in the title', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const { container } = md('<t:1699992800:R> <t:1700010800:R>');
    const times = container.querySelectorAll('time.md-time');
    expect(times[0]!.textContent).toBe('2 hours ago');
    expect(times[1]!.textContent).toBe('in 3 hours');
    expect(times[0]!.getAttribute('title')).toBe('Tuesday, November 14, 2023 8:13 PM');
  });

  it('relative time follows the UI language', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const { container } = md('<t:1699992800:R>', makeCtx('ko'));
    expect(container.querySelector('time')!.textContent).toBe('2시간 전');
  });
});

describe('DiscordMarkdown: memoisation', () => {
  it('parses once per content', () => {
    const view = md('**a**');
    expect(parseSpy).toHaveBeenCalledTimes(1);
    view.rerender(createElement(DiscordMarkdown, { content: '**a**', ctx: makeCtx() })); // new ctx object, same content
    expect(parseSpy).toHaveBeenCalledTimes(1);
    view.rerender(createElement(DiscordMarkdown, { content: '**b**', ctx }));
    expect(parseSpy).toHaveBeenCalledTimes(2);
    expect(view.container.querySelector('strong')!.textContent).toBe('b');
  });

  it('keeps a revealed spoiler revealed across re-renders with the same content', () => {
    const view = md('||x||');
    fireEvent.click(view.getByRole('button'));
    view.rerender(createElement(DiscordMarkdown, { content: '||x||', ctx }));
    expect(view.container.querySelector('.md-spoiler-revealed')).not.toBeNull();
  });
});

describe('renderReact', () => {
  it('returns nodes that can be placed anywhere', () => {
    const out: ReactNode = renderReact(parseMarkdown('a **b**'), ctx);
    const { container } = render(createElement('p', null, out));
    expect(container.innerHTML).toBe('<p>a <strong>b</strong></p>');
  });

  it('handles a large message without trouble', () => {
    const content = '**a** <@1> [x](https://a.com) `c` ||s|| # h\n'.repeat(500);
    let view: ReturnType<typeof md> | undefined;
    const renderOnce = (): void => {
      cleanup();
      view = md(content);
    };
    expect(fastestRunMs(5_000, renderOnce)).toBeLessThan(5_000);
    expect(view?.container.querySelectorAll('strong')).toHaveLength(500);
  });
});
