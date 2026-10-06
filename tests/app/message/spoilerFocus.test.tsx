// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageItem, type MessageRenderContext } from '@/app/components/message';
import type { Attachment, Message, User } from '@/lib/discord/types';
import { buildNameResolver } from '@/lib/message';

afterEach(cleanup);

const CDN = 'https://cdn.discordapp.com';
const ALICE: User = { id: '1001', username: 'alice_a', global_name: 'Alice', avatar: null, discriminator: '0' };
const ctx: MessageRenderContext = { locale: 'en', timeZone: 'UTC', names: buildNameResolver() };

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: '41',
    filename: 'SPOILER_photo.png',
    content_type: 'image/png',
    size: 1234,
    url: `${CDN}/attachments/1/41/SPOILER_photo.png?ex=1`,
    proxy_url: `${CDN}/attachments/1/41/SPOILER_photo.png?ex=1`,
    width: 1280,
    height: 720,
    ...overrides,
  };
}

function show(attachments: Attachment[]): HTMLElement {
  const message: Message = {
    id: '6000001',
    channel_id: '7',
    author: ALICE,
    content: '',
    timestamp: new Date(Date.UTC(2026, 9, 5, 10)).toISOString(),
    edited_timestamp: null,
    mentions: [],
    mention_roles: [],
    attachments,
    embeds: [],
    type: 0,
  };
  return render(<MessageItem message={message} prev={undefined} ctx={ctx} />).container;
}

const cover = (root: HTMLElement): HTMLButtonElement => {
  const button = root.querySelector<HTMLButtonElement>('button.msg-spoiler-cover');
  if (button === null) throw new Error('no cover');
  return button;
};

describe('revealing a spoiler attachment keeps the keyboard focus (UI-7)', () => {
  it('moves it from the cover (which is removed) to the link around the picture', () => {
    const container = show([attachment()]);
    cover(container).focus();
    expect(document.activeElement).toBe(cover(container));

    fireEvent.click(cover(container));

    expect(container.querySelector('button.msg-spoiler-cover')).toBeNull();
    const link = container.querySelector<HTMLAnchorElement>('a.msg-image-link');
    expect(link?.getAttribute('href')).toContain('SPOILER_photo.png');
    expect(document.activeElement).toBe(link);
  });

  it('moves it to the video player, which stops being inert at the same moment', () => {
    const container = show([attachment({ filename: 'SPOILER_end.mp4', content_type: 'video/mp4' })]);
    cover(container).focus();
    fireEvent.click(cover(container));
    const video = container.querySelector<HTMLVideoElement>('video');
    expect(video?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(video);
  });

  it('moves it to the picture itself when there is no link around it', () => {
    const picture = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const container = show([attachment({ url: picture, proxy_url: picture })]);
    expect(container.querySelector('a.msg-image-link')).toBeNull();
    cover(container).focus();
    fireEvent.click(cover(container));
    const image = container.querySelector<HTMLImageElement>('img.msg-image');
    expect(document.activeElement).toBe(image);
    expect(image?.getAttribute('tabindex')).toBe('-1');
  });

  it('does not touch the focus for a picture that is not a spoiler', () => {
    const container = show([attachment({ filename: 'photo.png' })]);
    expect(container.querySelector('button.msg-spoiler-cover')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('only the attachment that was revealed gets the focus', () => {
    const container = show([attachment(), attachment({ id: '42', filename: 'SPOILER_two.png' })]);
    const covers = Array.from(container.querySelectorAll<HTMLButtonElement>('button.msg-spoiler-cover'));
    expect(covers).toHaveLength(2);
    covers[0].focus();
    fireEvent.click(covers[0]);
    expect(container.querySelectorAll('button.msg-spoiler-cover')).toHaveLength(1);
    expect((document.activeElement as HTMLElement).closest('.msg-attachment')).toBe(container.querySelectorAll('.msg-attachment')[0]);
  });
});
