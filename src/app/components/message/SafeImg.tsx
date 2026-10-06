import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';

export interface SafeImgProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onError' | 'loading' | 'decoding' | 'referrerPolicy' | 'draggable'> {
  /** Must already have passed `safeMediaUrl` (or be a CDN builder result); null renders the fallback right away. */
  src: string | null;
  alt: string;
  /** Shown instead of the image when there is no `src` or the image failed to load: never a broken-image icon. */
  fallback: ReactNode;
}

/**
 * `<img>` that degrades gracefully. The failed URL is remembered (not a boolean), so a new `src` is tried again.
 * `no-referrer` keeps the extension's page address out of CDN requests.
 */
export function SafeImg({ src, alt, fallback, ...rest }: SafeImgProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src === null || src === failedSrc) return <>{fallback}</>;
  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  );
}
