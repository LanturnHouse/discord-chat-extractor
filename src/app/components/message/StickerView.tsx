import type { StickerItem } from '@/lib/discord/types';
import { safeMediaUrl } from '@/lib/markdown';
import { stickerView } from '@/lib/message';
import { getMessageLabels } from './labels';
import { objectsOf } from './list';
import { SafeImg } from './SafeImg';
import type { MessageRenderContext } from './types';

export interface StickerViewProps {
  sticker: StickerItem;
  ctx: MessageRenderContext;
}

export interface StickersProps {
  stickers: readonly StickerItem[];
  ctx: MessageRenderContext;
}

const STICKER_SIZE = 160;

/** A sticker picture; Lottie stickers (no static image) and pictures that fail to load show the sticker name. */
export function StickerView({ sticker, ctx }: StickerViewProps) {
  const view = stickerView(sticker);
  const name = view.name === '' ? getMessageLabels(ctx.locale).stickerFallback : view.name;
  return (
    <div className="msg-sticker">
      <SafeImg
        className="msg-sticker__image"
        src={safeMediaUrl(view.imageUrl)}
        alt={name}
        title={name}
        width={STICKER_SIZE}
        height={STICKER_SIZE}
        fallback={
          <span className="msg-sticker__name" dir="auto">
            {name}
          </span>
        }
      />
    </div>
  );
}

export function Stickers({ stickers, ctx }: StickersProps) {
  const items = objectsOf(stickers);
  if (items.length === 0) return null;
  return (
    <div className="msg-stickers">
      {items.map((sticker, index) => (
        <StickerView key={index} sticker={sticker} ctx={ctx} />
      ))}
    </div>
  );
}
