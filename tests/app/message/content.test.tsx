// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageItem, type MessageRenderContext } from '@/app/components/message';
import type { Attachment, Embed, Message, Poll, User } from '@/lib/discord/types';
import { buildNameResolver } from '@/lib/message';

afterEach(cleanup);

const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 9, 5, 10, 0, 0);
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const CDN = 'https://cdn.discordapp.com';
const MEDIA = 'https://media.discordapp.net';

const ALICE: User = { id: '1001', username: 'alice_a', global_name: 'Alice', avatar: null, discriminator: '0' };

let sequence = 0;
function msg(overrides: Partial<Message> = {}): Message {
  sequence += 1;
  return {
    id: String(6_000_000 + sequence),
    channel_id: '7',
    author: ALICE,
    content: '',
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

function renderMsg(overrides: Partial<Message>, locale: 'ko' | 'en' = 'en') {
  return render(<MessageItem message={msg(overrides)} prev={undefined} ctx={makeCtx(locale)} />);
}

function must<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`missing element: ${selector}`);
  return element;
}

const all = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] => Array.from(root.querySelectorAll<T>(selector));
const texts = (root: ParentNode, selector: string): (string | null)[] => all(root, selector).map((e) => e.textContent);

function att(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: '41',
    filename: 'photo.png',
    content_type: 'image/png',
    size: 1234,
    url: `${CDN}/attachments/1/41/photo.png?ex=1`,
    proxy_url: `${MEDIA}/attachments/1/41/photo.png?ex=1`,
    width: 1280,
    height: 720,
    ...overrides,
  };
}

describe('attachments', () => {
  it('shows an image inline, lazily loaded, with alt text and a link to the original', () => {
    const { container } = renderMsg({ attachments: [att({ description: 'A red bicycle' })] });

    const img = must<HTMLImageElement>(container, '.msg-attachment--image img.msg-image');
    expect(img.getAttribute('src')).toBe(`${MEDIA}/attachments/1/41/photo.png?ex=1`);
    expect(img.alt).toBe('A red bicycle');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');

    const link = must<HTMLAnchorElement>(container, 'a.msg-image-link');
    expect(link.getAttribute('href')).toBe(`${CDN}/attachments/1/41/photo.png?ex=1`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.rel.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer']);
    expect(link.contains(img)).toBe(true);
  });

  it('uses the file name as alt text when there is no description', () => {
    const { container } = renderMsg({ attachments: [att({ filename: 'IMG_0001.jpg' })] });
    expect(must<HTMLImageElement>(container, 'img.msg-image').alt).toBe('IMG_0001.jpg');
  });

  it.each([
    [1280, 720, 400, 225],
    [1080, 1920, 169, 300],
    [3000, 2000, 400, 267],
    [600, 1200, 150, 300],
    [100, 50, 100, 50], // never upscaled
  ])('fits a %ix%i image into the 400x300 box as %ix%i', (width, height, expectedWidth, expectedHeight) => {
    const { container } = renderMsg({ attachments: [att({ width, height })] });
    const img = must<HTMLImageElement>(container, 'img.msg-image');
    expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual([String(expectedWidth), String(expectedHeight)]);
  });

  it('leaves the size to CSS when the dimensions are unknown or garbage', () => {
    const { container } = renderMsg({
      attachments: [att({ width: null, height: null }), att({ width: 'wide' as unknown as number, height: -5 })],
    });
    for (const img of all(container, 'img.msg-image')) {
      expect(img.hasAttribute('width')).toBe(false);
      expect(img.hasAttribute('height')).toBe(false);
    }
  });

  it('keeps a spoiler image blurred behind a button until it is clicked', () => {
    const { container } = renderMsg({ attachments: [att({ filename: 'SPOILER_secret.png', description: 'the twist' })] }, 'ko');

    const frame = must(container, '.msg-attachment--image');
    expect(frame.classList.contains('msg-attachment--spoiler')).toBe(true);
    expect(frame.classList.contains('msg-attachment--revealed')).toBe(false);
    expect(must<HTMLImageElement>(frame, 'img').alt).toBe(''); // the description would give the spoiler away
    expect(frame.querySelector('a.msg-image-link')!.hasAttribute('href')).toBe(false);
    const cover = must<HTMLButtonElement>(frame, 'button.msg-spoiler-cover');
    expect(cover.getAttribute('aria-label')).toBe('스포일러: 클릭하여 보기');
    expect(cover.textContent).toBe('스포일러');

    fireEvent.click(cover);

    expect(frame.classList.contains('msg-attachment--revealed')).toBe(true);
    expect(frame.querySelector('button.msg-spoiler-cover')).toBeNull();
    expect(must<HTMLImageElement>(frame, 'img').alt).toBe('the twist');
    expect(frame.querySelector('a.msg-image-link')!.getAttribute('href')).toBe(`${CDN}/attachments/1/41/photo.png?ex=1`);
  });

  it('also honours the spoiler flag of attachments whose name has no prefix', () => {
    const { container } = renderMsg({ attachments: [att({ flags: 8 })] });
    expect(container.querySelector('.msg-attachment--spoiler button.msg-spoiler-cover')).not.toBeNull();
  });

  it('plays Discord-hosted video with native controls, no poster and nothing preloaded', () => {
    const video = att({ filename: 'demo.mp4', content_type: 'video/mp4', width: 1920, height: 1080, size: 12_345_678 });
    const { container } = renderMsg({ attachments: [video] });

    const element = must<HTMLVideoElement>(container, '.msg-attachment--video video.msg-video');
    expect(element.getAttribute('src')).toBe(`${MEDIA}/attachments/1/41/photo.png?ex=1`);
    expect(element.controls).toBe(true);
    expect(element.getAttribute('preload')).toBe('none');
    expect(element.hasAttribute('poster')).toBe(false);
    expect(element.hasAttribute('autoplay')).toBe(false);
    expect(element.getAttribute('width')).toBe('400');
    expect(element.getAttribute('height')).toBe('225');
    expect(element.getAttribute('aria-label')).toBe('demo.mp4');
  });

  it('never creates a <video> or <audio> for a host other than Discord', () => {
    const { container } = renderMsg({
      attachments: [
        att({ filename: 'clip.mp4', content_type: 'video/mp4', url: 'https://evil.example/clip.mp4', proxy_url: undefined }),
        att({ filename: 'song.mp3', content_type: 'audio/mpeg', url: 'https://evil.example/song.mp3', proxy_url: undefined }),
        att({ filename: 'pic.png', url: 'https://evil.example/pic.png', proxy_url: undefined }),
        att({ filename: 'lookalike.mp4', content_type: 'video/mp4', url: 'https://cdn.discordapp.com.evil.example/x.mp4', proxy_url: undefined }),
      ],
    });

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('audio')).toBeNull();
    expect(container.querySelector('img.msg-image')).toBeNull();
    expect(container.querySelector('source')).toBeNull();
    // They are plain cards with a link the user may click.
    const cards = all(container, '.msg-attachment--file');
    expect(cards).toHaveLength(4);
    expect(texts(container, '.msg-file__name')).toEqual(['clip.mp4', 'song.mp3', 'pic.png', 'lookalike.mp4']);
    expect(all<HTMLAnchorElement>(container, 'a.msg-file__name')[0]!.getAttribute('href')).toBe('https://evil.example/clip.mp4');
  });

  it('renders Discord-hosted audio with controls inside a card', () => {
    const audio = att({ filename: 'voice-note.mp3', content_type: 'audio/mpeg', size: 2_345_678 });
    const { container } = renderMsg({ attachments: [audio] });

    const card = must(container, '.msg-attachment--audio.msg-file');
    const player = must<HTMLAudioElement>(card, 'audio.msg-audio');
    expect(player.controls).toBe(true);
    expect(player.getAttribute('preload')).toBe('none');
    expect(player.getAttribute('src')).toBe(`${MEDIA}/attachments/1/41/photo.png?ex=1`);
    expect(must(card, '.msg-file__name').textContent).toBe('voice-note.mp3');
    expect(must(card, '.msg-file__size').textContent).toBe('2.2 MB');
  });

  it('shows other files as cards with icon, name link and size', () => {
    const file = att({ filename: 'report-Q3.pdf', content_type: 'application/pdf', size: 905_000, width: undefined, height: undefined });
    const { container } = renderMsg({ attachments: [file] });

    const card = must(container, '.msg-attachment--file.msg-file');
    expect(must(card, 'svg.msg-file__icon').getAttribute('aria-hidden')).toBe('true');
    const link = must<HTMLAnchorElement>(card, 'a.msg-file__name');
    expect(link.textContent).toBe('report-Q3.pdf');
    expect(link.getAttribute('href')).toBe(`${CDN}/attachments/1/41/photo.png?ex=1`);
    expect(link.rel).toContain('noopener');
    expect(must(card, '.msg-file__size').textContent).toBe('883.8 KB');
  });

  it('formats sizes in the active locale and names unnamed files', () => {
    const { container } = renderMsg({ attachments: [att({ filename: '', content_type: 'application/zip', size: 148_000_000 })] }, 'ko');
    expect(must(container, '.msg-file__name').textContent).toBe('이름 없는 파일');
    expect(must(container, '.msg-file__size').textContent).toBe('141.1 MB');
  });

  it('hides a spoiler video behind the same cover and keeps its controls unreachable until revealed', () => {
    const video = att({ filename: 'SPOILER_end.mp4', content_type: 'video/mp4' });
    const { container } = renderMsg({ attachments: [video] });

    const player = must<HTMLVideoElement>(container, 'video');
    expect(player.hasAttribute('inert')).toBe(true);
    fireEvent.click(must(container, 'button.msg-spoiler-cover'));
    expect(player.hasAttribute('inert')).toBe(false);
  });

  it('renders nothing for an empty or malformed attachment list', () => {
    const { container } = renderMsg({ attachments: [null, 'x', 3] as unknown as Attachment[] });
    expect(container.querySelector('.msg-attachments')).toBeNull();
    const none = renderMsg({ attachments: undefined as unknown as Attachment[] });
    expect(none.container.querySelector('.msg-attachments')).toBeNull();
  });
});

describe('embeds', () => {
  const rich: Embed = {
    type: 'rich',
    color: 0x5865f2,
    provider: { name: 'Status Page' },
    author: { name: 'Status Bot', url: 'https://example.com/bot', icon_url: `${CDN}/icons/bot.png` },
    title: 'Scheduled maintenance',
    url: 'https://example.com/status',
    description: '**Tonight** 02:00 [details](https://example.com/d)',
    fields: [
      { name: 'A', value: '1', inline: true },
      { name: 'B', value: '2', inline: true },
      { name: 'C', value: '3', inline: true },
      { name: 'D', value: '4', inline: true },
      { name: 'Wide', value: '`code`', inline: false },
      { name: 'E', value: '5', inline: true },
    ],
    thumbnail: { url: 'https://example.com/t.png', proxy_url: `${MEDIA}/external/t.png`, width: 256, height: 256 },
    image: { url: 'https://example.com/i.png', proxy_url: `${MEDIA}/external/i.png`, width: 800, height: 400 },
    footer: { text: 'Status Bot', icon_url: `${CDN}/icons/footer.png` },
    timestamp: at(0),
  };

  it('renders every part of a rich embed', () => {
    const { container } = renderMsg({ embeds: [rich] });

    const embed = must(container, '.msg-embeds > .msg-embed.msg-embed--rich');
    expect(embed.style.borderLeftColor).toBe('rgb(88, 101, 242)');
    expect(must(embed, '.msg-embed__provider').textContent).toBe('Status Page');

    const authorLink = must<HTMLAnchorElement>(embed, 'a.msg-embed__author-name');
    expect(authorLink.getAttribute('href')).toBe('https://example.com/bot');
    expect(must<HTMLImageElement>(embed, 'img.msg-embed__author-icon').getAttribute('src')).toBe(`${CDN}/icons/bot.png`);

    const title = must<HTMLAnchorElement>(embed, '.msg-embed__title a.msg-embed__title-link');
    expect(title.textContent).toBe('Scheduled maintenance');
    expect(title.getAttribute('href')).toBe('https://example.com/status');
    expect(title.rel).toBe('noopener noreferrer nofollow');
    expect(title.getAttribute('target')).toBe('_blank');

    const description = must(embed, '.msg-embed__description');
    expect(must(description, 'strong').textContent).toBe('Tonight');
    expect(must<HTMLAnchorElement>(description, 'a.md-link').getAttribute('href')).toBe('https://example.com/d');

    // pictures: only the Discord proxy URLs, thumbnail in the corner, image below the text
    expect(must<HTMLImageElement>(embed, '.msg-embed__thumbnail img').getAttribute('src')).toBe(`${MEDIA}/external/t.png`);
    const image = must<HTMLImageElement>(embed, '.msg-embed__media img');
    expect(image.getAttribute('src')).toBe(`${MEDIA}/external/i.png`);
    expect([image.getAttribute('width'), image.getAttribute('height')]).toEqual(['400', '200']);
    expect(must<HTMLImageElement>(embed, '.msg-embed__thumbnail img').getAttribute('width')).toBe('80');

    const footer = must(embed, '.msg-embed__footer');
    expect(must(footer, '.msg-embed__footer-icon').getAttribute('src')).toBe(`${CDN}/icons/footer.png`);
    expect(footer.textContent).toBe('Status Bot • 10/05/2026 10:00 AM');
    expect(must<HTMLTimeElement>(footer, 'time').getAttribute('datetime')).toBe(at(0));
  });

  it('lays inline fields out in rows of three and lets block fields break the row', () => {
    const { container } = renderMsg({ embeds: [rich] });

    const fields = all(container, '.msg-embed__field');
    expect(fields.map((f) => f.className.replace('msg-embed__field', '').trim())).toEqual([
      'msg-embed__field--inline msg-embed__field--col1',
      'msg-embed__field--inline msg-embed__field--col2',
      'msg-embed__field--inline msg-embed__field--col3',
      'msg-embed__field--inline msg-embed__field--col1',
      '',
      'msg-embed__field--inline msg-embed__field--col1',
    ]);
    expect(texts(container, '.msg-embed__field-name')).toEqual(['A', 'B', 'C', 'D', 'Wide', 'E']);
    expect(must(fields[4]!, '.msg-embed__field-value code.md-code').textContent).toBe('code');
  });

  it('omits the colour for embeds without one and never takes it from the wrong place', () => {
    const { container } = renderMsg({ embeds: [{ title: 'Plain' }, { title: 'Bad colour', color: -1 }, { title: 'Huge', color: 2 ** 30 }] });
    for (const embed of all(container, '.msg-embed')) expect(embed.getAttribute('style')).toBeNull();
  });

  it('drops hostile URLs and links, keeping the text', () => {
    const { container } = renderMsg({
      embeds: [
        {
          title: '<script>alert(1)</script>',
          url: 'javascript:alert(1)',
          description: '[x](javascript:alert(1)) <img src=x onerror=alert(1)>',
          author: { name: '"><svg onload=alert(1)>', url: 'javascript:alert(1)', icon_url: 'javascript:alert(1)', proxy_icon_url: 'data:text/html,<script>alert(1)</script>' },
          footer: { text: '<b>footer</b>', icon_url: 'https://evil.example/pixel.gif' },
          image: { url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' },
          thumbnail: { url: 'https://evil.example/track.png' },
          fields: [{ name: '<img src=x onerror=alert(1)>', value: '[v](javascript:alert(1))' }],
        },
      ],
    });

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('svg:not(.msg-icon)')).toBeNull();
    expect(all(container, 'a').filter((a) => /^javascript:/i.test(a.getAttribute('href') ?? ''))).toHaveLength(0);
    expect(container.querySelector('.msg-embed__title a')).toBeNull();
    expect(container.querySelector('a.msg-embed__author-name')).toBeNull();
    expect(must(container, '.msg-embed__title').textContent).toBe('<script>alert(1)</script>');
    expect(must(container, '.msg-embed__author-name').textContent).toBe('"><svg onload=alert(1)>');
    expect(must(container, '.msg-embed__footer-text').textContent).toBe('<b>footer</b>');
    expect(container.querySelectorAll('img')).toHaveLength(1); // only the avatar of the message author
  });

  it('only loads pictures that Discord itself hosts', () => {
    const { container } = renderMsg({
      embeds: [
        {
          title: 'External',
          image: { url: 'https://example.com/a.png' }, // no proxy_url: a bare third-party URL must not be fetched
          thumbnail: { url: 'https://example.com/b.png', proxy_url: 'https://tracker.example/b.png' },
        },
        { title: 'Proxied', thumbnail: { url: 'https://example.com/c.png', proxy_url: `${MEDIA}/external/c.png` } },
      ],
    });

    expect(all<HTMLImageElement>(container, '.msg-embed img').map((i) => i.getAttribute('src'))).toEqual([`${MEDIA}/external/c.png`]);
  });

  it('falls back to the thumbnail and a link for video from other hosts, and plays Discord-hosted video', () => {
    const thumbnail = { url: 'https://example.com/v.png', proxy_url: `${MEDIA}/external/v.png`, width: 1280, height: 720 };
    const { container } = renderMsg({
      embeds: [
        {
          type: 'video',
          url: 'https://example.com/watch?v=1',
          title: 'Intro',
          provider: { name: 'ExampleTube' },
          thumbnail,
          video: { url: 'https://example.com/embed/1', width: 1280, height: 720 },
        },
        {
          type: 'video',
          title: 'Hosted',
          thumbnail,
          video: { url: `${CDN}/videos/1.mp4`, proxy_url: `${MEDIA}/videos/1.mp4`, width: 1280, height: 720 },
        },
      ],
    });

    const [thirdParty, hosted] = all(container, '.msg-embed');
    expect(thirdParty!.querySelector('video')).toBeNull();
    const link = must<HTMLAnchorElement>(thirdParty!, '.msg-embed__media a.msg-embed__media-link');
    expect(link.getAttribute('href')).toBe('https://example.com/watch?v=1');
    expect(link.getAttribute('aria-label')).toBe('Open video');
    expect(link.querySelector('.msg-embed__play svg')).not.toBeNull();
    expect(link.querySelector('img')!.getAttribute('src')).toBe(`${MEDIA}/external/v.png`);
    expect(thirdParty!.querySelector('.msg-embed__thumbnail')).toBeNull(); // the thumbnail is the main picture here

    const player = must<HTMLVideoElement>(hosted!, 'video.msg-video');
    expect(player.getAttribute('src')).toBe(`${MEDIA}/videos/1.mp4`);
    expect(player.getAttribute('poster')).toBe(`${MEDIA}/external/v.png`);
    expect(player.getAttribute('preload')).toBe('none');
    expect(player.controls).toBe(true);
  });

  it('shows a picture-only embed without the box', () => {
    const { container } = renderMsg({
      embeds: [{ type: 'image', url: 'https://example.com/cat.png', thumbnail: { url: 'x', proxy_url: `${MEDIA}/external/cat.png`, width: 640, height: 480 } }],
    });

    const embed = must(container, '.msg-embed--image.msg-embed--bare');
    expect(embed.querySelector('.msg-embed__top')).toBeNull();
    expect(embed.querySelector('.msg-embed__footer')).toBeNull();
    const link = must<HTMLAnchorElement>(embed, 'a.msg-embed__media-link');
    expect(link.getAttribute('href')).toBe('https://example.com/cat.png');
    expect(must(link, 'img').getAttribute('width')).toBe('400');
  });

  it('gives the link of a picture-only embed an accessible name: the site it leads to, in the active locale', () => {
    const bare = (type: string): Partial<Message> => ({
      embeds: [{ type, url: 'https://example.com/images/cat.png', thumbnail: { url: 'x', proxy_url: `${MEDIA}/external/cat.png`, width: 640, height: 480 } }],
    });
    for (const type of ['image', 'gifv']) {
      const english = renderMsg(bare(type), 'en');
      const link = must<HTMLAnchorElement>(english.container, '.msg-embed--bare a.msg-embed__media-link');
      expect(link.getAttribute('aria-label'), type).toBe('Open example.com');
      expect(must(link, 'img').getAttribute('alt')).toBe('');
      english.unmount();
      const korean = renderMsg(bare(type), 'ko');
      expect(must(korean.container, '.msg-embed--bare a.msg-embed__media-link').getAttribute('aria-label'), type).toBe('example.com 열기');
      korean.unmount();
    }
  });

  it('every link of the embeds has a name: its text, its aria-label or the alt text of its picture', () => {
    const picture = { url: 'x', proxy_url: `${MEDIA}/external/cat.png`, width: 640, height: 480 };
    const { container } = renderMsg({
      embeds: [
        { type: 'image', url: 'https://example.com/a.png', thumbnail: picture },
        { type: 'image', url: 'https://example.com/b.png', title: 'A cat', thumbnail: picture },
        { type: 'rich', url: 'https://example.com:8443/c', description: 'Only a description', image: picture },
        { type: 'link', url: 'https://example.com/d', provider: { name: 'ExampleSite' }, thumbnail: picture },
        { type: 'video', url: 'https://example.com/watch', thumbnail: picture, video: { url: 'https://example.com/embed/1', width: 1280, height: 720 } },
      ],
    });
    const links = all<HTMLAnchorElement>(container, '.msg-embeds a[href]');
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      const name = (link.getAttribute('aria-label') ?? '').trim() || (link.textContent ?? '').trim() || (link.querySelector('img')?.getAttribute('alt') ?? '').trim();
      expect(name, link.outerHTML).not.toBe('');
    }
    // A picture that already has a name (the title) is not renamed, and the host keeps its port.
    const pictures = all<HTMLAnchorElement>(container, 'a.msg-embed__media-link');
    expect(pictures).toHaveLength(4);
    expect(pictures[1].getAttribute('aria-label')).toBeNull();
    expect(must(pictures[1], 'img').getAttribute('alt')).toBe('A cat');
    expect(pictures[2].getAttribute('aria-label')).toBe('Open example.com:8443');
    expect(pictures[3].getAttribute('aria-label')).toBe('Open video');
  });

  it('renders nothing for an embed that has no usable content', () => {
    const { container } = renderMsg({
      embeds: [{ type: 'image', image: { url: 'https://evil.example/x.png' } }, {}, null as unknown as Embed],
    });
    expect(container.querySelector('.msg-embed')).toBeNull();
  });

  it('cannot be given arbitrary class names through the embed type', () => {
    const { container } = renderMsg({ embeds: [{ type: 'rich" onclick="alert(1) msg-embed--bare', title: 'x' }] });
    expect(must(container, '.msg-embed').className).toBe('msg-embed msg-embed--rich');
  });
});

describe('reactions', () => {
  it('renders emoji and counts, and tints the ones the account added', () => {
    const { container } = renderMsg({
      reactions: [
        { count: 3, me: true, emoji: { id: null, name: '👍' } },
        { count: 12, emoji: { id: '123456789012345678', name: 'party_parrot', animated: true } },
        { count: 1, emoji: { id: '223456789012345678', name: 'pepe' } },
      ],
    });

    const group = must(container, '.msg-reactions');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Reactions');
    const pills = all(group, '.msg-reaction');
    expect(pills.map((p) => p.classList.contains('msg-reaction--me'))).toEqual([true, false, false]);
    expect(texts(group, '.msg-reaction__count')).toEqual(['3', '12', '1']);
    expect(must(pills[0]!, '.msg-reaction__emoji').textContent).toBe('👍');

    const animated = must<HTMLImageElement>(pills[1]!, 'img.msg-reaction__img');
    expect(animated.getAttribute('src')).toBe(`${CDN}/emojis/123456789012345678.webp?size=32&animated=true`);
    expect(animated.alt).toBe(':party_parrot:');
    expect(must<HTMLImageElement>(pills[2]!, 'img').getAttribute('src')).toBe(`${CDN}/emojis/223456789012345678.png?size=32`);
  });

  it('describes each pill for assistive technology in the active locale', () => {
    const reactions = [
      { count: 3, me: true, emoji: { id: null, name: '👍' } },
      { count: 1, emoji: { id: null, name: '🎉' } },
    ];
    const en = renderMsg({ reactions }, 'en');
    expect(all(en.container, '.msg-reaction').map((p) => p.getAttribute('aria-label'))).toEqual([
      '👍, 3 reactions, including you',
      '🎉, 1 reaction',
    ]);
    en.unmount();

    const ko = renderMsg({ reactions }, 'ko');
    expect(must(ko.container, '.msg-reactions').getAttribute('aria-label')).toBe('리액션');
    expect(all(ko.container, '.msg-reaction').map((p) => p.getAttribute('aria-label'))).toEqual(['👍, 반응 3개, 내가 반응함', '🎉, 반응 1개']);
  });

  it('shows :name: for a custom emoji with an unusable id and survives malformed entries', () => {
    const { container } = renderMsg({
      reactions: [
        { count: 2, emoji: { id: 'not-a-snowflake', name: 'odd' } },
        { count: 1, emoji: {} },
        null,
        { count: Number.NaN, emoji: { id: null, name: '🔥' } },
      ] as never,
    });

    expect(texts(container, '.msg-reaction__emoji')).toEqual([':odd:', '', '🔥']);
    expect(container.querySelector('.msg-reaction img')).toBeNull();
    expect(texts(container, '.msg-reaction__count')).toEqual(['2', '1', '0']);
  });

  it('renders no bar for an empty list', () => {
    expect(renderMsg({ reactions: [] }).container.querySelector('.msg-reactions')).toBeNull();
  });
});

describe('polls', () => {
  const poll: Poll = {
    question: { text: 'Where should we go?' },
    answers: [
      { answer_id: 1, poll_media: { text: 'Ramen', emoji: { id: null, name: '🍜' } } },
      { answer_id: 2, poll_media: { text: 'Pizza' } },
      { answer_id: 3, poll_media: { text: 'Salad' } },
    ],
    allow_multiselect: false,
    results: { is_finalized: false, answer_counts: [{ id: 1, count: 3 }, { id: 2, count: 1 }] },
  };

  it('shows the question, the answers, vote counts and bars', () => {
    const { container } = renderMsg({ poll });

    const box = must(container, '.msg-poll');
    expect(box.classList.contains('msg-poll--closed')).toBe(false);
    expect(must(box, '.msg-poll__question').textContent).toBe('Where should we go?');
    expect(must(box, '.msg-poll__hint').textContent).toBe('Select one answer');
    expect(texts(box, '.msg-poll__text')).toEqual(['Ramen', 'Pizza', 'Salad']);
    expect(texts(box, '.msg-poll__emoji')).toEqual(['🍜']);
    expect(texts(box, '.msg-poll__votes')).toEqual(['3 votes · 75%', '1 vote · 25%', '0 votes · 0%']);
    expect(all<HTMLProgressElement>(box, 'progress.msg-poll__bar').map((p) => [p.max, p.value])).toEqual([
      [4, 3],
      [4, 1],
      [4, 0],
    ]);
    expect(must(box, '.msg-poll__footer').textContent).toBe('4 votes');
    expect(box.querySelector('.msg-poll__answer--winner')).toBeNull();
  });

  it('marks the finished state and highlights the winner(s)', () => {
    const closed: Poll = {
      ...poll,
      results: { is_finalized: true, answer_counts: [{ id: 1, count: 5 }, { id: 2, count: 5 }, { id: 3, count: 1 }] },
    };
    const { container } = renderMsg({ poll: closed });

    const box = must(container, '.msg-poll');
    expect(box.classList.contains('msg-poll--closed')).toBe(true);
    expect(all(box, '.msg-poll__answer').map((a) => a.classList.contains('msg-poll__answer--winner'))).toEqual([true, true, false]);
    expect(box.querySelector('.msg-poll__hint')).toBeNull();
    expect(must(box, '.msg-poll__footer').textContent).toBe('11 votes · Poll closed');
  });

  it('says when several answers may be chosen and localises counts', () => {
    const { container } = renderMsg({ poll: { ...poll, allow_multiselect: true } }, 'ko');
    expect(must(container, '.msg-poll__hint').textContent).toBe('답변을 하나 이상 선택하세요');
    expect(texts(container, '.msg-poll__votes')[0]).toBe('3표 · 75%');
    expect(must(container, '.msg-poll__footer').textContent).toBe('4표');
  });

  it('shows no counts when the API sent no results', () => {
    const { container } = renderMsg({ poll: { ...poll, results: undefined } });
    expect(texts(container, '.msg-poll__text')).toEqual(['Ramen', 'Pizza', 'Salad']);
    expect(container.querySelector('.msg-poll__votes')).toBeNull();
    expect(container.querySelector('progress')).toBeNull();
    expect(container.querySelector('.msg-poll__footer')).toBeNull();
  });

  it('copes with a poll nobody voted in', () => {
    const { container } = renderMsg({ poll: { ...poll, results: { is_finalized: true, answer_counts: [] } } });
    expect(texts(container, '.msg-poll__votes')).toEqual(['0 votes · 0%', '0 votes · 0%', '0 votes · 0%']);
    expect(all<HTMLProgressElement>(container, 'progress').every((p) => p.max === 1 && p.value === 0)).toBe(true);
    expect(container.querySelector('.msg-poll__answer--winner')).toBeNull();
  });
});

describe('stickers', () => {
  it('shows a sticker picture with its name as alt text', () => {
    const { container } = renderMsg({
      sticker_items: [
        { id: '123456789012345678', name: 'wave', format_type: 1 },
        { id: '223456789012345678', name: 'dance', format_type: 4 },
      ],
    });
    const images = all<HTMLImageElement>(container, 'img.msg-sticker__image');
    expect(images.map((i) => i.getAttribute('src'))).toEqual([
      `${MEDIA}/stickers/123456789012345678.png?size=160`,
      `${MEDIA}/stickers/223456789012345678.gif?size=160`,
    ]);
    expect(images.map((i) => i.alt)).toEqual(['wave', 'dance']);
    expect(images[0]!.getAttribute('width')).toBe('160');
  });

  it('shows the name of a Lottie sticker, which has no static image', () => {
    const { container } = renderMsg({ sticker_items: [{ id: '123456789012345678', name: '웃는 고양이', format_type: 3 }] });
    expect(container.querySelector('img.msg-sticker__image')).toBeNull();
    expect(must(container, '.msg-sticker .msg-sticker__name').textContent).toBe('웃는 고양이');
  });

  it('names an unnamed sticker in the active locale', () => {
    const { container } = renderMsg({ sticker_items: [{ id: '123456789012345678', name: '', format_type: 3 }] }, 'ko');
    expect(must(container, '.msg-sticker__name').textContent).toBe('스티커');
  });
});

describe('forwarded messages', () => {
  const snapshot = (overrides: Partial<Message> = {}) => ({
    message: {
      content: 'see **this**',
      timestamp: at(-3 * 60 * MINUTE),
      attachments: [att()],
      embeds: [{ type: 'rich' as const, title: 'Quoted embed', description: 'text' }],
      ...overrides,
    },
  });

  it('puts each original in a bordered box with its text, attachments, embeds and time', () => {
    const forward = { content: '', message_reference: { type: 1, message_id: '1', channel_id: '2' }, message_snapshots: [snapshot(), snapshot({ content: 'second' })] };
    const { container } = renderMsg(forward);

    expect(must(container, '.msg-forward-label').textContent).toBe('Forwarded');
    const boxes = all(container, '.msg-forward');
    expect(boxes).toHaveLength(2);
    expect(must(boxes[0]!, '.msg-content strong').textContent).toBe('this');
    expect(boxes[0]!.querySelector('.msg-attachment--image img')).not.toBeNull();
    expect(must(boxes[0]!, '.msg-embed__title').textContent).toBe('Quoted embed');
    expect(must(boxes[0]!, 'time.msg-forward__time').textContent).toBe('10/05/2026 7:00 AM');
    expect(must(boxes[1]!, '.msg-content').textContent).toBe('second');
    // the forwarder's own row has no text of its own
    expect(container.querySelectorAll('.msg-body > .msg-content')).toHaveLength(0);
    // label first, then the boxes
    expect(must(container, '.msg-forward-label').nextElementSibling).toBe(boxes[0]);
  });

  it('keeps hostile content of a snapshot inert', () => {
    const { container } = renderMsg({
      content: '',
      message_reference: { type: 1 },
      message_snapshots: [snapshot({ content: '<script>alert(1)</script> [a](javascript:alert(1))', attachments: [att({ filename: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', proxy_url: undefined, content_type: 'application/pdf' })] })],
    });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(must(container, '.msg-file__name').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('.msg-file__name')!.tagName).toBe('SPAN');
  });

  it('shows just the label when the snapshot data is missing', () => {
    const { container } = renderMsg({ content: '', message_reference: { type: 1 } });
    expect(container.querySelector('.msg-forward-label')).not.toBeNull();
    expect(container.querySelector('.msg-forward')).toBeNull();
  });
});

describe('message text', () => {
  it('renders markdown through the shared renderer', () => {
    const { container } = renderMsg({ content: '**bold** and `code` and https://example.com/a' });
    const content = must(container, '.msg-content');
    expect(must(content, '.md-root strong').textContent).toBe('bold');
    expect(must(content, 'code.md-code').textContent).toBe('code');
    expect(must<HTMLAnchorElement>(content, 'a.md-link').getAttribute('href')).toBe('https://example.com/a');
  });

  it('resolves mentions with the names of the context', () => {
    const ctx = makeCtx('en');
    ctx.names.addMessages([msg({ author: { id: '42', username: 'zed', global_name: 'Zed' } })]);
    const { container } = render(<MessageItem message={msg({ content: 'hi <@42>' })} prev={undefined} ctx={ctx} />);
    expect(must(container, '.md-mention').textContent).toBe('@Zed');
  });
});

describe('security', () => {
  const EVIL = '<script>alert(1)</script><img src=x onerror=alert(1)>';

  /** Nothing in the DOM may execute or load from where it should not. */
  function assertInert(root: ParentNode): void {
    const forbiddenTags = new Set(['script', 'iframe', 'frame', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'input', 'textarea']);
    const discordHost = /^https:\/\/([a-z0-9-]+\.)*(discordapp\.com|discordapp\.net|discord\.com|discordcdn\.com)\//i;
    for (const element of all(root, '*')) {
      const tag = element.tagName.toLowerCase();
      expect(forbiddenTags.has(tag), `<${tag}>`).toBe(false);
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.name.startsWith('on'), `<${tag} ${attribute.name}>`).toBe(false);
        expect(attribute.name === 'srcdoc' || attribute.name === 'formaction', `<${tag} ${attribute.name}>`).toBe(false);
        const value = attribute.value.trim();
        if (attribute.name === 'href') expect(value, `<${tag} href>`).toMatch(/^(https?:\/\/|mailto:)/i);
        if (attribute.name === 'src' || attribute.name === 'poster') {
          expect(discordHost.test(value) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(value), `<${tag} ${attribute.name}=${value.slice(0, 60)}>`).toBe(true);
        }
      }
    }
  }

  const hostileAuthor: User = { id: '1666', username: EVIL, global_name: EVIL, avatar: 'javascript:alert(1)' };

  function hostileMessages(): Message[] {
    const original = msg({ author: hostileAuthor, content: EVIL });
    return [
      msg({
        author: hostileAuthor,
        content: `${EVIL} [click](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==) <javascript:alert(1)> ||${EVIL}|| \`${EVIL}\``,
        edited_timestamp: at(MINUTE),
        attachments: [
          att({ filename: `${EVIL}.png`, description: EVIL, url: 'javascript:alert(1)', proxy_url: 'javascript:alert(1)' }),
          att({ filename: `${EVIL}.pdf`, content_type: 'application/pdf', url: 'javascript:alert(1)', proxy_url: undefined }),
          att({ filename: `SPOILER_${EVIL}.mp4`, content_type: 'video/mp4', url: 'data:text/html,<script>alert(1)</script>', proxy_url: undefined }),
          att({ filename: '"><svg onload=alert(1)>.mp3', content_type: 'audio/mpeg', url: 'vbscript:msgbox(1)', proxy_url: undefined }),
        ],
        embeds: [
          {
            title: EVIL,
            url: 'javascript:alert(1)',
            description: `${EVIL}\n[x](javascript:alert(1))`,
            provider: { name: EVIL, url: 'javascript:alert(1)' },
            author: { name: EVIL, url: 'javascript:alert(1)', icon_url: 'javascript:alert(1)' },
            footer: { text: EVIL, icon_url: 'javascript:alert(1)' },
            image: { url: 'javascript:alert(1)' },
            thumbnail: { url: 'data:text/html,<script>alert(1)</script>' },
            video: { url: 'javascript:alert(1)' },
            fields: [{ name: EVIL, value: `${EVIL} [x](javascript:alert(1))`, inline: true }],
            timestamp: 'javascript:alert(1)',
            color: 0xff0000,
          },
        ],
        reactions: [{ count: 1, emoji: { id: '1" onerror="alert(1)', name: EVIL } }, { count: 1, emoji: { id: null, name: EVIL } }],
        sticker_items: [{ id: '1" onerror="alert(1)', name: EVIL, format_type: 1 }],
        poll: {
          question: { text: EVIL },
          answers: [{ answer_id: 1, poll_media: { text: EVIL, emoji: { id: null, name: EVIL } } }],
          results: { is_finalized: true, answer_counts: [{ id: 1, count: 1 }] },
        },
      }),
      msg({ type: 19, content: EVIL, message_reference: { message_id: original.id }, referenced_message: original }),
      msg({
        content: '',
        message_reference: { type: 1 },
        message_snapshots: [{ message: { content: `${EVIL} [a](javascript:alert(1))`, attachments: [att({ filename: EVIL, url: 'javascript:alert(1)', proxy_url: undefined })], embeds: [{ title: EVIL, url: 'javascript:alert(1)' }] } }],
      }),
      msg({ type: 7, author: hostileAuthor, content: '' }),
      msg({ type: 18, author: hostileAuthor, content: EVIL }),
    ];
  }

  it('renders attacker-controlled text as text and nothing executable', () => {
    const messages = hostileMessages();
    const { container } = render(
      <div>
        {messages.map((message, index) => (
          <MessageItem key={message.id} message={message} prev={messages[index - 1]} ctx={makeCtx('en')} />
        ))}
      </div>,
    );

    assertInert(container);
    // The payloads are visible as plain text in the places they were sent to ...
    expect(container.textContent).toContain(EVIL);
    expect(must(container, '.msg-author').textContent).toBe(EVIL);
    expect(texts(container, '.msg-file__name')).toContain(`${EVIL}.pdf`);
    // ... and every unsafe URL was dropped.
    expect(all<HTMLAnchorElement>(container, 'a').every((a) => a.hasAttribute('rel') || a.classList.contains('md-link'))).toBe(true);
    for (const link of all<HTMLAnchorElement>(container, 'a[target="_blank"]')) expect(link.rel).toBe('noopener noreferrer nofollow');
  });

  it('keeps hostile text inert in the Korean locale and in a time zone the browser does not know', () => {
    const messages = hostileMessages();
    const { container } = render(
      <div>
        {messages.map((message, index) => (
          <MessageItem key={message.id} message={message} prev={messages[index - 1]} ctx={makeCtx('ko', 'Not/AZone')} />
        ))}
      </div>,
    );
    assertInert(container);
  });

  it('never uses an HTML-injection API in the source of the view', () => {
    // From this file, not the working directory; a string, because jsdom's URL cannot resolve against `import.meta.url`.
    const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/app/components/message');
    const files = readdirSync(directory).filter((name) => /\.tsx?$/.test(name));
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) {
      expect(readFileSync(join(directory, file), 'utf8'), file).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/,
      );
    }
  });

  it('survives messages that are missing most of their fields', () => {
    const bare = { id: '8000001', channel_id: '7', type: 0 } as unknown as Message;
    const weird = { ...msg(), author: null, content: null, timestamp: 'garbage', mentions: null, attachments: 'x', embeds: { a: 1 }, reactions: 7, sticker_items: 'y', poll: 'z' } as unknown as Message;
    const { container } = render(
      <div>
        <MessageItem message={bare} prev={undefined} ctx={makeCtx('en')} />
        <MessageItem message={weird} prev={bare} ctx={makeCtx('ko')} />
      </div>,
    );
    expect(container.querySelectorAll('article.msg')).toHaveLength(2);
    assertInert(container);
  });
});
