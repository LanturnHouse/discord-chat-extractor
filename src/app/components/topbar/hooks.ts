import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocale } from '@/app/i18n';
import type { NumberFormatter } from './format';

/** Keeps the newest value in a ref so long-lived listeners never call a stale closure. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** `Intl.NumberFormat` of the current language ("48,213"), built once per language. */
export function useNumberFormat(): NumberFormatter {
  const locale = useLocale();
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale);
    return (value: number): string => format.format(value);
  }, [locale]);
}

/** Formats a 0..1 ratio as a whole percent ("42%"). */
export function usePercentFormat(): NumberFormatter {
  const locale = useLocale();
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
    return (ratio: number): string => format.format(ratio);
  }, [locale]);
}

/** Milliseconds since `startedAt`, re-read every second. The interval exists only while `running`. */
export function useElapsedMs(startedAt: number | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
