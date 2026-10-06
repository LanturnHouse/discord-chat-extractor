import { useMemo, useState, type ReactNode } from 'react';
import type { Embed } from '@/lib/discord/types';
import { DiscordMarkdown } from '@/lib/markdown';
import { formatFullTooltip, normalizeEmbed, type EmbedMediaView, type NormalizedEmbed } from '@/lib/message';
import { dateTimeAttr, headerTimestamp } from './format';
import { MsgIcon } from './Icon';
import { getMessageLabels } from './labels';
import { EXTERNAL_LINK, linkHost } from './links';
import { objectsOf } from './list';
import { fitBox, MEDIA_MAX_HEIGHT, MEDIA_MAX_WIDTH } from './media';
import { SafeImg } from './SafeImg';
import type { MessageRenderContext } from './types';

export interface EmbedViewProps {
  embed: Embed;
  ctx: MessageRenderContext;
}

export interface EmbedsProps {
  embeds: readonly Embed[];
  ctx: MessageRenderContext;
}

/** Fixed list so the type can become a CSS modifier without letting message data invent class names. */
const EMBED_TYPES: ReadonlySet<string> = new Set(['rich', 'image', 'video', 'gifv', 'article', 'link', 'poll_result']);

/** Picture-first embed types: the thumbnail is the main picture, not a small corner thumbnail. */
const MEDIA_TYPES: ReadonlySet<string> = new Set(['image', 'video', 'gifv']);

const THUMBNAIL_BOX = 80;

interface EmbedPictureProps {
  media: EmbedMediaView;
  className: string;
  alt: string;
  /** Safe link target (the embed URL); null => not clickable. */
  href: string | null;
  /** Show a play badge (a video embed whose player cannot be loaded here: the picture links to the source). */
  play: boolean;
  maxWidth: number;
  maxHeight: number;
  /** Accessible name of the link, for a picture whose own `alt` does not give it one. */
  linkLabel?: string;
}

/** Picture of an embed. When it fails to load the whole block disappears instead of leaving a broken-image icon. */
function EmbedPicture({ media, className, alt, href, play, maxWidth, maxHeight, linkLabel }: EmbedPictureProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === media.url) return null;
  const box = fitBox(media.width, media.height, maxWidth, maxHeight);
  const image = (
    <img
      className="msg-embed__image"
      src={media.url}
      alt={alt}
      width={box?.width}
      height={box?.height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedSrc(media.url)}
    />
  );
  return (
    <div className={className}>
      {href === null ? (
        image
      ) : (
        <a className="msg-embed__media-link" href={href} aria-label={linkLabel} {...EXTERNAL_LINK}>
          {image}
          {play && (
            <span className="msg-embed__play" aria-hidden="true">
              <MsgIcon name="play" size={24} />
            </span>
          )}
        </a>
      )}
    </div>
  );
}

function EmbedFields({ fields, ctx }: { fields: NormalizedEmbed['fields']; ctx: MessageRenderContext }) {
  // Inline fields share a row, three per row (a 12-column grid, four columns each); a block field resets the run.
  let run = 0;
  return (
    <div className="msg-embed__fields">
      {fields.map((field, index) => {
        let className = 'msg-embed__field';
        if (field.inline) {
          className += ` msg-embed__field--inline msg-embed__field--col${(run % 3) + 1}`;
          run += 1;
        } else {
          run = 0;
        }
        return (
          <div key={index} className={className}>
            {field.name.trim() !== '' && (
              <div className="msg-embed__field-name" dir="auto">
                {field.name}
              </div>
            )}
            {field.value.trim() !== '' && (
              <div className="msg-embed__field-value">
                <DiscordMarkdown content={field.value} ctx={ctx} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One embed: colour bar, provider, author, title, description, fields, thumbnail, main picture or video, footer.
 * Every URL comes from `normalizeEmbed`: links are http(s) only, pictures and videos Discord-hosted only.
 */
export function EmbedView({ embed, ctx }: EmbedViewProps) {
  const view = useMemo(() => normalizeEmbed(embed), [embed]);
  const labels = getMessageLabels(ctx.locale);
  const kind = EMBED_TYPES.has(view.type) ? view.type : 'rich';

  const thumbnailIsMain = view.image === null && view.thumbnail !== null && MEDIA_TYPES.has(kind);
  const mainImage = view.image ?? (thumbnailIsMain ? view.thumbnail : null);
  const cornerThumbnail = thumbnailIsMain ? null : view.thumbnail;

  const hasText =
    view.title !== null || view.description !== null || view.author !== null || view.provider !== null || view.fields.length > 0;
  const hasFooter = view.footer !== null || view.timestamp !== null;
  const hasMedia = view.video !== null || mainImage !== null;
  if (!hasText && !hasFooter && !hasMedia && cornerThumbnail === null) return null;

  const alt = view.title ?? view.provider ?? '';
  const colorStyle = view.colorHex === null ? undefined : { borderLeftColor: view.colorHex };

  let media: ReactNode = null;
  if (view.video !== null) {
    const poster = [view.thumbnail, view.image].find((m) => m !== null && m.url === view.video?.posterUrl);
    const box = fitBox(poster?.width, poster?.height);
    media = (
      <div className="msg-embed__media">
        <video
          className="msg-video"
          src={view.video.url}
          poster={view.video.posterUrl ?? undefined}
          controls
          preload="none"
          playsInline
          width={box?.width}
          height={box?.height}
          aria-label={alt || undefined}
        />
      </div>
    );
  } else if (mainImage !== null) {
    // A picture is named by its alt text (the embed's title or provider); a bare picture embed has none, and its link must still
    // have a name: the video label for a player that cannot be shown, else the site it leads to.
    let linkLabel: string | undefined;
    if (view.titleUrl !== null) {
      if (kind === 'video') linkLabel = labels.openVideo;
      else if (alt === '') linkLabel = labels.openLink(linkHost(view.titleUrl));
    }
    media = (
      <EmbedPicture
        media={mainImage}
        className="msg-embed__media"
        alt={alt}
        href={view.titleUrl}
        play={kind === 'video'}
        maxWidth={MEDIA_MAX_WIDTH}
        maxHeight={MEDIA_MAX_HEIGHT}
        linkLabel={linkLabel}
      />
    );
  }

  // A bare picture embed (an image link or GIF preview) is shown without the box, like Discord does.
  const bare =
    (kind === 'image' || kind === 'gifv') &&
    hasMedia &&
    view.title === null &&
    view.description === null &&
    view.author === null &&
    view.fields.length === 0 &&
    !hasFooter;
  if (bare) {
    return <div className={`msg-embed msg-embed--${kind} msg-embed--bare`}>{media}</div>;
  }

  const { author, footer } = view;
  return (
    <div className={`msg-embed msg-embed--${kind}`} style={colorStyle}>
      {(hasText || cornerThumbnail !== null) && (
        <div className="msg-embed__top">
          {hasText && (
            <div className="msg-embed__text">
              {view.provider !== null && (
                <div className="msg-embed__provider" dir="auto">
                  {view.provider}
                </div>
              )}
              {author !== null && (
                <div className="msg-embed__author">
                  <SafeImg className="msg-embed__author-icon" src={author.iconUrl} alt="" width={24} height={24} fallback={null} />
                  {author.url === null ? (
                    <span className="msg-embed__author-name" dir="auto">
                      {author.name}
                    </span>
                  ) : (
                    <a className="msg-embed__author-name" dir="auto" href={author.url} {...EXTERNAL_LINK}>
                      {author.name}
                    </a>
                  )}
                </div>
              )}
              {view.title !== null && (
                <div className="msg-embed__title" dir="auto">
                  {view.titleUrl === null ? (
                    view.title
                  ) : (
                    <a className="msg-embed__title-link" href={view.titleUrl} {...EXTERNAL_LINK}>
                      {view.title}
                    </a>
                  )}
                </div>
              )}
              {view.description !== null && (
                <div className="msg-embed__description">
                  <DiscordMarkdown content={view.description} ctx={ctx} />
                </div>
              )}
              {view.fields.length > 0 && <EmbedFields fields={view.fields} ctx={ctx} />}
            </div>
          )}
          {cornerThumbnail !== null && (
            <EmbedPicture
              media={cornerThumbnail}
              className="msg-embed__thumbnail"
              alt={alt}
              href={null}
              play={false}
              maxWidth={THUMBNAIL_BOX}
              maxHeight={THUMBNAIL_BOX}
            />
          )}
        </div>
      )}
      {media}
      {hasFooter && (
        <div className="msg-embed__footer">
          {footer !== null && (
            <SafeImg className="msg-embed__footer-icon" src={footer.iconUrl} alt="" width={20} height={20} fallback={null} />
          )}
          <span className="msg-embed__footer-text" dir="auto">
            {footer?.text}
            {footer !== null && view.timestamp !== null && (
              <span className="msg-embed__footer-sep" aria-hidden="true">
                {' • '}
              </span>
            )}
            {view.timestamp !== null && (
              <time dateTime={dateTimeAttr(view.timestamp)} title={formatFullTooltip(view.timestamp, ctx.timeZone, ctx.locale)}>
                {headerTimestamp(view.timestamp, ctx.timeZone, ctx.locale)}
              </time>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/** The embeds of one message (or snapshot), stacked. */
export function Embeds({ embeds, ctx }: EmbedsProps) {
  const items = objectsOf(embeds);
  if (items.length === 0) return null;
  return (
    <div className="msg-embeds">
      {items.map((embed, index) => (
        <EmbedView key={index} embed={embed} ctx={ctx} />
      ))}
    </div>
  );
}
