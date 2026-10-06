// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { context, mockChannelMessages, namesFor, parseDocument, renderExport, showcaseMessages } from './htmlTestKit';
import { MessageItem, type MessageRenderContext } from '@/app/components/message';
import { MOCK_IDS } from '../../../../src/lib/discord/mock';
import type { Message } from '../../../../src/lib/discord/types';
import { createHtmlEnv, renderMessageItem } from '../../../../src/lib/export/formats/htmlMessage';
import { cleanText } from '../../../../src/lib/export/formats/text';

/**
 * The HTML export mirrors the React message view; message.css, shipped inside the export, only styles both the same
 * while the two stay in sync. Every message is rendered by the real <MessageItem/> (server-side, static markup) and by
 * the export, and the two DOMs are compared: the set of CSS classes (what the stylesheet sees), the order of the
 * elements, and the attributes that carry meaning (roles, labels, links, picture sources, sizes, time values).
 *
 * Differences that are intended, because a file has no script, are listed here and normalised before comparing:
 *  - spoiler text carries `role="button"` and a label in the app (it toggles on click); in the file it is a plain
 *    focusable span revealed by :hover / :focus (see markdown.css);
 *  - the cover of a spoiler picture or video is a `<button>` in the app and a focusable `<span>` in the file; the picture's
 *    link has no `href` and the video is `inert` while the spoiler is closed in the app, which nothing can undo in a file;
 *  - `referrerpolicy` and `draggable` are set per picture in the app; the file uses one `<meta name="referrer">` and lets
 *    readers drag pictures out of it;
 *  - relative `<t:...:R>` markers are shown as an absolute date in the file (the file is read at an unknown later time);
 *  - control characters are removed from the text of the file, so the app is given the cleaned content.
 */

const NOT_COMPARED = new Set(['referrerpolicy', 'draggable']);

/** The message the file effectively shows: control characters (which the app would pass on as they are) are removed. */
function sanitised(message: Message): Message {
  return {
    ...message,
    content: cleanText(message.content),
    message_snapshots: message.message_snapshots?.map((snapshot) => ({ message: { ...snapshot.message, content: cleanText(snapshot.message.content) } })),
  };
}

function fragment(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function classSet(root: Element): string[] {
  const names = new Set<string>();
  for (const element of Array.from(root.querySelectorAll('[class]'))) for (const name of Array.from(element.classList)) names.add(name);
  return [...names].sort();
}

/** Tag, attributes and (for time markers) nothing else of every element, in document order, with the known differences removed. */
function fingerprint(root: Element): string[] {
  return Array.from(root.querySelectorAll('*')).map((element) => {
    const skipped = new Set(NOT_COMPARED);
    let tag = element.tagName.toLowerCase();
    if (element.matches('.md-spoiler')) {
      skipped.add('role');
      skipped.add('aria-label');
    }
    if (element.matches('.msg-spoiler-cover')) {
      tag = 'span';
      for (const name of ['type', 'aria-label', 'tabindex', 'title']) skipped.add(name);
    }
    if (element.matches('.msg-attachment--spoiler .msg-image-link')) {
      skipped.add('href');
      skipped.add('title');
    }
    if (element.matches('.msg-attachment--spoiler video')) skipped.add('inert');
    const attributes = Array.from(element.attributes)
      .filter((attribute) => !skipped.has(attribute.name))
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .sort()
      .join(' ');
    return `${tag}[${attributes}]`;
  });
}

/** Visible text without the (intentionally different) text of relative time markers. */
function visibleText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const time of Array.from(copy.querySelectorAll('time.md-time'))) time.textContent = '';
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

interface Mismatch {
  index: number;
  id: string;
  what: string;
}

/** Renders every message with both renderers and lists what differs. */
function compare(messages: readonly Message[], locale: 'ko' | 'en', timeZone: string): Mismatch[] {
  const names = namesFor(messages);
  const ctx: MessageRenderContext = { locale, timeZone, names };
  const env = createHtmlEnv(context({ names, options: { locale, timeZone } }));
  const mismatches: Mismatch[] = [];
  messages.forEach((original, index) => {
    const message = sanitised(original);
    const prev = index === 0 ? undefined : sanitised(messages[index - 1]!);
    const app = fragment(renderToStaticMarkup(createElement(MessageItem, { message, prev, ctx })));
    const file = fragment(renderMessageItem(message, prev, env));
    const report = (what: string): number => mismatches.push({ index, id: message.id, what });

    const appClasses = classSet(app).join(' ');
    const fileClasses = classSet(file).join(' ');
    if (appClasses !== fileClasses) report(`classes\n  app : ${appClasses}\n  file: ${fileClasses}`);

    const appPrint = fingerprint(app);
    const filePrint = fingerprint(file);
    if (appPrint.join('\n') !== filePrint.join('\n')) {
      let at = 0;
      while (at < appPrint.length && appPrint[at] === filePrint[at]) at += 1;
      report(`element ${at}\n  app : ${appPrint[at]}\n  file: ${filePrint[at]}`);
    }

    if (visibleText(app) !== visibleText(file)) report(`text\n  app : ${visibleText(app)}\n  file: ${visibleText(file)}`);
  });
  return mismatches;
}

const SETUPS = [
  ['en', 'UTC'],
  ['ko', 'Asia/Seoul'],
] as const;

describe('the file renders messages like the app does', () => {
  it.each([
    ['showcase', MOCK_IDS.showcaseChannel],
    ['general (newest 600)', MOCK_IDS.generalChannel],
    ['friend DM', MOCK_IDS.dmFriend],
    ['named group DM', MOCK_IDS.groupDmNamed],
    ['large group DM', MOCK_IDS.groupDmLarge],
    ['thread', MOCK_IDS.generalThread],
    ['announcement thread', MOCK_IDS.announcementThread],
  ])('%s', async (_name, channelId) => {
    const messages = await mockChannelMessages(channelId, 600);
    expect(messages.length).toBeGreaterThan(0);
    for (const [locale, zone] of SETUPS) expect(compare(messages, locale, zone), `${locale} ${zone}`).toEqual([]);
  });

  it('covers every kind of block through the showcase channel', async () => {
    const messages = await showcaseMessages();
    const classes = new Set<string>();
    const env = createHtmlEnv(context({ names: namesFor(messages) }));
    messages.forEach((message, index) => {
      for (const name of classSet(fragment(renderMessageItem(sanitised(message), messages[index - 1], env)))) classes.add(name);
    });
    for (const name of [
      'msg-day-divider',
      'msg--grouped',
      'msg--reply',
      'msg--forward',
      'msg--app',
      'msg--system',
      'msg-reply--deleted',
      'msg-attachment--spoiler',
      'msg-embed--bare',
      'msg-embed--rich',
      'msg-embed__field--col3',
      'msg-poll--closed',
      'msg-reaction--me',
      'msg-system__icon--pin',
      'msg-system__icon--boost',
      'md-spoiler',
      'md-mention',
      'md-emoji-jumbo',
    ]) {
      expect(classes.has(name), name).toBe(true);
    }
    expect(classes.size).toBeGreaterThan(90);
  });

  it('writes the same markup for a message whether it is rendered alone or as part of the whole file', async () => {
    const messages = await showcaseMessages();
    const ctx = context({ names: namesFor(messages) });
    const env = createHtmlEnv(ctx);
    const whole = renderExport([messages], ctx);
    const items = messages.map((message, index) => renderMessageItem(message, messages[index - 1], env));
    expect(whole).toContain(items.join('\n'));
    const doc = parseDocument(whole);
    expect(doc.querySelectorAll('main > article').length).toBe(messages.length);
  });

  it('notices a difference (the comparison itself is not vacuous)', async () => {
    const messages = (await showcaseMessages()).slice(0, 12);
    const names = namesFor(messages);
    const env = createHtmlEnv(context({ names }));
    const ctx: MessageRenderContext = { locale: 'en', timeZone: 'UTC', names };
    const app = fragment(renderToStaticMarkup(createElement(MessageItem, { message: messages[1]!, prev: messages[0], ctx })));
    const file = fragment(renderMessageItem(messages[1]!, messages[0], env).replace('msg--grouped', 'msg--first'));
    expect(classSet(app)).not.toEqual(classSet(file));
    expect(fingerprint(app)).not.toEqual(fingerprint(file));
  });
});
