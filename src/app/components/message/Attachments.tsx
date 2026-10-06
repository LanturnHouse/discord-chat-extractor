import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Attachment } from '@/lib/discord/types';
import { safeUrl } from '@/lib/markdown';
import { attachmentMediaUrl, classifyAttachment, formatBytes, isSpoilerAttachment } from '@/lib/message';
import { MsgIcon } from './Icon';
import { getMessageLabels, type MessageLabels } from './labels';
import { EXTERNAL_LINK } from './links';
import { objectsOf } from './list';
import { fitBox } from './media';
import type { MessageRenderContext } from './types';

export interface AttachmentsProps {
  attachments: readonly Attachment[];
  ctx: MessageRenderContext;
}

interface ItemProps {
  attachment: Attachment;
  ctx: MessageRenderContext;
}

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

const nameOf = (attachment: Attachment, labels: MessageLabels): string => textOf(attachment.filename) ?? labels.unnamedFile;

/** A plain link target for the user to click; unlike the media URL it may point at any http(s) host. */
function linkOf(attachment: Attachment): string | null {
  return safeUrl(textOf(attachment.url)) ?? safeUrl(textOf(attachment.proxy_url));
}

/**
 * Covers spoiler media until the first click (Discord marks them with a `SPOILER_` file name or a flag).
 * The media sits inside `inert` while hidden so it cannot be reached with the keyboard either.
 */
function MediaFrame({
  kind,
  spoiler,
  labels,
  children,
}: {
  kind: 'image' | 'video';
  spoiler: boolean;
  labels: MessageLabels;
  children: (revealed: boolean) => ReactNode;
}) {
  const [revealed, setRevealed] = useState(!spoiler);
  const frameRef = useRef<HTMLDivElement>(null);
  const focusRevealed = useRef(false);
  const state = spoiler ? (revealed ? ' msg-attachment--spoiler msg-attachment--revealed' : ' msg-attachment--spoiler') : '';

  // The cover button is removed on reveal; the keyboard focus it held moves to the media it was covering (the picture's link,
  // the video player, or the picture itself) instead of being dropped to <body>.
  useEffect(() => {
    if (!revealed || !focusRevealed.current) return;
    focusRevealed.current = false;
    const target = frameRef.current?.querySelector<HTMLElement>('a[href], video, img');
    if (target === null || target === undefined) return;
    target.focus();
    // A picture without a link is not focusable by itself.
    if (document.activeElement !== target) {
      target.tabIndex = -1;
      target.focus();
    }
  }, [revealed]);

  return (
    <div ref={frameRef} className={`msg-attachment msg-attachment--${kind}${state}`}>
      {children(revealed)}
      {!revealed && (
        <button
          type="button"
          className="msg-spoiler-cover"
          aria-label={labels.spoilerReveal}
          onClick={() => {
            focusRevealed.current = true;
            setRevealed(true);
          }}
        >
          <span className="msg-spoiler-cover__badge">{labels.spoilerBadge}</span>
        </button>
      )}
    </div>
  );
}

function FileAttachment({ attachment, ctx, audioSrc }: ItemProps & { audioSrc?: string }) {
  const labels = getMessageLabels(ctx.locale);
  const name = nameOf(attachment, labels);
  const href = linkOf(attachment);
  return (
    <div className={`msg-attachment msg-attachment--${audioSrc === undefined ? 'file' : 'audio'} msg-file`}>
      <MsgIcon name={audioSrc === undefined ? 'file' : 'audio'} className="msg-file__icon" size={32} />
      <div className="msg-file__info">
        {href === null ? (
          <span className="msg-file__name" dir="auto">
            {name}
          </span>
        ) : (
          <a className="msg-file__name" dir="auto" href={href} {...EXTERNAL_LINK}>
            {name}
          </a>
        )}
        <div className="msg-file__size">{formatBytes(attachment.size, ctx.locale)}</div>
        {audioSrc !== undefined && <audio className="msg-audio" src={audioSrc} controls preload="none" aria-label={name} />}
      </div>
    </div>
  );
}

function ImageAttachment({ attachment, ctx, src }: ItemProps & { src: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // A picture that cannot be loaded (expired signed URL, offline) degrades to a file card with the name and a link.
  if (failedSrc === src) return <FileAttachment attachment={attachment} ctx={ctx} />;

  const labels = getMessageLabels(ctx.locale);
  const name = nameOf(attachment, labels);
  const description = textOf(attachment.description) ?? name;
  const box = fitBox(attachment.width, attachment.height);
  const href = linkOf(attachment);

  const picture = (revealed: boolean): ReactNode => {
    const image = (
      <img
        className="msg-image"
        src={src}
        alt={revealed ? description : ''}
        width={box?.width}
        height={box?.height}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailedSrc(src)}
      />
    );
    if (href === null) return image;
    // Always wrapped (without href until revealed) so that revealing does not remount, and so reload, the image.
    return (
      <a className="msg-image-link" href={revealed ? href : undefined} title={revealed ? labels.openOriginal : undefined} {...EXTERNAL_LINK}>
        {image}
      </a>
    );
  };

  return (
    <MediaFrame kind="image" spoiler={isSpoilerAttachment(attachment)} labels={labels}>
      {picture}
    </MediaFrame>
  );
}

function VideoAttachment({ attachment, ctx, src }: ItemProps & { src: string }) {
  const labels = getMessageLabels(ctx.locale);
  const box = fitBox(attachment.width, attachment.height);
  return (
    <MediaFrame kind="video" spoiler={isSpoilerAttachment(attachment)} labels={labels}>
      {(revealed) => (
        <video
          className="msg-video"
          src={src}
          controls
          preload="none"
          playsInline
          width={box?.width}
          height={box?.height}
          aria-label={nameOf(attachment, labels)}
          inert={!revealed}
        />
      )}
    </MediaFrame>
  );
}

function AttachmentItem({ attachment, ctx }: ItemProps) {
  const kind = classifyAttachment(attachment);
  // Automatic loading (img / video / audio) only from Discord's own hosts; anything else is a plain link card.
  const src = attachmentMediaUrl(attachment);
  if (src !== null) {
    if (kind === 'image') return <ImageAttachment attachment={attachment} ctx={ctx} src={src} />;
    if (kind === 'video') return <VideoAttachment attachment={attachment} ctx={ctx} src={src} />;
    if (kind === 'audio') return <FileAttachment attachment={attachment} ctx={ctx} audioSrc={src} />;
  }
  return <FileAttachment attachment={attachment} ctx={ctx} />;
}

/** Inline images (max 400x300), players for Discord-hosted video and audio, and file cards for everything else. */
export function Attachments({ attachments, ctx }: AttachmentsProps) {
  const items = objectsOf(attachments);
  if (items.length === 0) return null;
  return (
    <div className="msg-attachments">
      {items.map((attachment, index) => (
        <AttachmentItem key={index} attachment={attachment} ctx={ctx} />
      ))}
    </div>
  );
}
