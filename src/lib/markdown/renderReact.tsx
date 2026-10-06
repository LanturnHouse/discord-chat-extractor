import { Fragment, memo, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { emojiUrl } from '../discord/cdn';
import { linkHostNote, misleadingLinkHost } from './linkHost';
import { isEmojiOnly, parseMarkdown, splitUnicodeEmoji } from './parse';
import { formatRelativeTime, formatTimestamp, mentionLabel, renderText } from './renderText';
import type { MarkdownContext, MdNode } from './types';
import { safeMediaUrl, safeUrl } from './url';

const SPOILER_LABEL = { ko: '스포일러 (클릭하여 보기)', en: 'Spoiler (click to reveal)' } as const;

export interface RenderReactOptions {
  /** Enlarge emoji (message that consists only of emoji). <DiscordMarkdown> detects this automatically. */
  jumbo?: boolean;
}

interface Env {
  ctx: MarkdownContext;
  jumbo: boolean;
}

/**
 * Hidden until clicked (or Enter / Space). The revealed state is per spoiler, like in Discord.
 * The revealed span is the same DOM element: it keeps `tabIndex={-1}` so that a focused spoiler stays focused (an element that
 * stops being focusable is blurred by the browser, which would send a keyboard user back to the top of the page).
 */
function Spoiler({ locale, children }: { locale: MarkdownContext['locale']; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return (
      <span className="md-spoiler md-spoiler-revealed" tabIndex={-1}>
        {children}
      </span>
    );
  }
  const reveal = () => setRevealed(true);
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      reveal();
    }
  };
  return (
    <span className="md-spoiler" role="button" tabIndex={0} aria-label={SPOILER_LABEL[locale]} onClick={reveal} onKeyDown={onKeyDown}>
      {children}
    </span>
  );
}

interface CustomEmojiProps {
  src: string;
  alt: string;
  jumbo: boolean;
}

/**
 * A custom emoji picture. Deleted emoji and unreachable CDNs are common in old chats: on a load error the `:name:` text takes
 * its place instead of a broken-image icon (the same fallback as the reaction bar). `no-referrer` keeps the page's address
 * out of CDN requests.
 */
function CustomEmoji({ src, alt, jumbo }: CustomEmojiProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <>{alt}</>;
  return (
    <img
      className={jumbo ? 'md-emoji md-emoji-jumbo' : 'md-emoji'}
      alt={alt}
      title={alt}
      src={src}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  );
}

function renderChildren(nodes: MdNode[], env: Env): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, env, index));
}

function renderTextNode(text: string, jumbo: boolean, key: number): ReactNode {
  if (!jumbo) return text;
  return (
    <Fragment key={key}>
      {splitUnicodeEmoji(text).map((run, i) =>
        run.emoji ? (
          <span key={i} className="md-emoji-jumbo">
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </Fragment>
  );
}

function renderNode(node: MdNode, env: Env, key: number): ReactNode {
  const { ctx, jumbo } = env;
  switch (node.type) {
    case 'text':
      return renderTextNode(node.text, jumbo, key);
    case 'br':
      return <br key={key} />;
    case 'strong':
      return <strong key={key}>{renderChildren(node.children, env)}</strong>;
    case 'em':
      return <em key={key}>{renderChildren(node.children, env)}</em>;
    case 'underline':
      return <u key={key}>{renderChildren(node.children, env)}</u>;
    case 'strike':
      return <s key={key}>{renderChildren(node.children, env)}</s>;
    case 'spoiler':
      return (
        <Spoiler key={key} locale={ctx.locale}>
          {renderChildren(node.children, env)}
        </Spoiler>
      );
    case 'inlineCode':
      return (
        <code key={key} className="md-code">
          {node.text}
        </code>
      );
    case 'codeBlock':
      return (
        <pre key={key} className="md-pre" data-lang={node.lang ?? undefined}>
          <code>{node.text}</code>
        </pre>
      );
    case 'blockQuote':
      return (
        <blockquote key={key} className="md-quote">
          {renderChildren(node.children, env)}
        </blockquote>
      );
    case 'heading':
      return (
        <div key={key} className={`md-heading md-h${node.level}`} role="heading" aria-level={node.level}>
          {renderChildren(node.children, env)}
        </div>
      );
    case 'subtext':
      return (
        <div key={key} className="md-subtext">
          {renderChildren(node.children, env)}
        </div>
      );
    case 'list': {
      const items = node.items.map((item, i) => <li key={i}>{renderChildren(item, env)}</li>);
      if (!node.ordered) {
        return (
          <ul key={key} className="md-list">
            {items}
          </ul>
        );
      }
      return (
        <ol key={key} className="md-list" start={Number.isSafeInteger(node.start) && node.start !== 1 ? node.start : undefined}>
          {items}
        </ol>
      );
    }
    case 'link': {
      const inner = renderChildren(node.children, env);
      const href = safeUrl(node.url, { allowMailto: true });
      if (href === null) return <Fragment key={key}>{inner}</Fragment>;
      // The text names another site than the link opens (`[https://discord.com/login](https://evil.example)`): say where it goes.
      const host = node.masked ? misleadingLinkHost(renderText(node.children, ctx), href) : null;
      return (
        <a key={key} className="md-link" href={href} target="_blank" rel="noopener noreferrer nofollow" title={node.masked ? href : undefined}>
          {inner}
          {host === null ? null : <span className="md-link-host">{linkHostNote(host)}</span>}
        </a>
      );
    }
    case 'emoji': {
      const src = safeMediaUrl(emojiUrl(node.id, node.animated));
      const alt = `:${node.name}:`;
      if (src === null) return alt;
      return <CustomEmoji key={key} src={src} alt={alt} jumbo={jumbo} />;
    }
    case 'timestamp': {
      const date = new Date(node.unix * 1000);
      if (Number.isNaN(date.getTime())) return formatTimestamp(node.unix, node.style, ctx);
      const text = node.style === 'R' ? formatRelativeTime(node.unix, ctx.locale) : formatTimestamp(node.unix, node.style, ctx);
      return (
        <time key={key} className="md-time" dateTime={date.toISOString()} title={formatTimestamp(node.unix, 'F', ctx)}>
          {text}
        </time>
      );
    }
    default:
      return (
        <span key={key} className="md-mention">
          {mentionLabel(node, ctx)}
        </span>
      );
  }
}

/**
 * React elements for the parsed message. Plain React elements only (text is rendered as text nodes, never as HTML),
 * links are scheme-checked with safeUrl(), images come from the CDN builders. Class names (md-*) are shared with
 * renderHtml.ts and markdown.css.
 */
export function renderReact(nodes: MdNode[], ctx: MarkdownContext, opts: RenderReactOptions = {}): ReactNode {
  return renderChildren(nodes, { ctx, jumbo: opts.jumbo === true });
}

export interface DiscordMarkdownProps {
  content: string;
  /** Keep this object referentially stable (e.g. useMemo) so that unchanged messages do not re-render. */
  ctx: MarkdownContext;
}

/** Parses once per `content`; messages made only of emoji are shown with jumbo emoji automatically. */
export const DiscordMarkdown = memo(function DiscordMarkdown({ content, ctx }: DiscordMarkdownProps) {
  const nodes = useMemo(() => parseMarkdown(content), [content]);
  const jumbo = useMemo(() => isEmojiOnly(nodes), [nodes]);
  const body = useMemo(() => renderReact(nodes, ctx, { jumbo }), [nodes, ctx, jumbo]);
  return <div className="md-root">{body}</div>;
});
