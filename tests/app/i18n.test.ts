import { describe, expect, it } from 'vitest';
import { common, describeError } from '@/app/i18n/common';
import { LOCALES, defineStrings, getStrings, resolveLocale } from '@/app/i18n/core';
import { onboardingStrings } from '@/app/i18n/onboarding';
import { appStrings } from '@/app/i18n/app';
import { DiscordApiError, type DiscordErrorKind } from '@/lib/discord/client';

describe('defineStrings', () => {
  const table = defineStrings({
    ko: { title: '제목', count: (n: number) => `${n}개` },
    en: { title: 'Title', count: (n) => `${n} items` },
  });

  it('returns the table unchanged and picks a locale', () => {
    expect(getStrings(table, 'ko').title).toBe('제목');
    expect(getStrings(table, 'en').title).toBe('Title');
    expect(getStrings(table, 'ko').count(3)).toBe('3개');
    expect(getStrings(table, 'en').count(3)).toBe('3 items');
    expect(LOCALES).toEqual(['ko', 'en']);
  });

  it('rejects locales with different shapes at compile time', () => {
    // These calls are only checked by `tsc` (the directives fail the typecheck if the call stops being an error).
    // @ts-expect-error `en` lacks a key that `ko` has
    defineStrings({ ko: { a: 'x', b: 'y' }, en: { a: 'x' } });
    // @ts-expect-error `en` has a key that `ko` lacks
    defineStrings({ ko: { a: 'x' }, en: { a: 'x', b: 'y' } });
    // @ts-expect-error a string in one locale, a function in the other
    defineStrings({ ko: { a: 'x' }, en: { a: () => 'x' } });
    // @ts-expect-error function parameters must match
    defineStrings({ ko: { n: (count: number) => `${count}` }, en: { n: (count: string) => count } });
    // @ts-expect-error only strings and functions returning strings are allowed
    defineStrings({ ko: { n: 1 }, en: { n: 1 } });
    expect(true).toBe(true);
  });

  it('every shipped table has both locales with the same keys', () => {
    for (const tableOfStrings of [common, onboardingStrings, appStrings]) {
      expect(Object.keys(tableOfStrings.en).sort()).toEqual(Object.keys(tableOfStrings.ko).sort());
      for (const key of Object.keys(tableOfStrings.ko)) {
        const ko = (tableOfStrings.ko as Record<string, unknown>)[key];
        const en = (tableOfStrings.en as Record<string, unknown>)[key];
        expect(typeof en).toBe(typeof ko);
        if (typeof ko === 'string') expect(ko.trim()).not.toBe('');
      }
    }
  });
});

describe('resolveLocale', () => {
  it('an explicit preference wins over the browser language', () => {
    expect(resolveLocale('ko', 'en-US')).toBe('ko');
    expect(resolveLocale('en', 'ko-KR')).toBe('en');
  });

  it("'auto' maps ko* to Korean and any other known language to English", () => {
    for (const language of ['ko', 'ko-KR', 'KO', 'ko-kp', ' ko-KR ']) expect(resolveLocale('auto', language)).toBe('ko');
    for (const language of ['en-US', 'ja', 'de-DE', 'zh-CN']) expect(resolveLocale('auto', language)).toBe('en');
  });

  it("'auto' without any language information falls back to Korean, the product default", () => {
    for (const language of ['', '  ', undefined, null]) expect(resolveLocale('auto', language)).toBe('ko');
  });

  it('an explicit preference wins even without language information', () => {
    expect(resolveLocale('en', undefined)).toBe('en');
    expect(resolveLocale('ko', '')).toBe('ko');
  });
});

describe('describeError', () => {
  const kinds: DiscordErrorKind[] = ['auth', 'forbidden', 'not-found', 'rate-limited', 'network', 'server', 'aborted', 'unknown'];

  it('has a localised sentence for every DiscordApiError kind', () => {
    for (const locale of LOCALES) {
      const seen = new Set<string>();
      for (const kind of kinds.filter((k) => k !== 'unknown')) {
        const text = describeError(new DiscordApiError(kind, 'raw message'), locale);
        expect(text).not.toContain('raw message');
        expect(text.length).toBeGreaterThan(5);
        seen.add(text);
      }
      expect(seen.size).toBe(kinds.length - 1);
    }
  });

  it('keeps the detail of an unknown API error', () => {
    expect(describeError(new DiscordApiError('unknown', 'Missing Permissions (code 50013)'), 'en')).toBe(
      'An unknown error occurred. (Missing Permissions (code 50013))',
    );
    expect(describeError(new DiscordApiError('unknown', ''), 'en')).toBe(common.en.errorUnknown);
  });

  it('handles other errors and non-errors', () => {
    expect(describeError(new Error('boom'), 'en')).toBe('An unknown error occurred. (boom)');
    expect(describeError(new Error(''), 'ko')).toBe(common.ko.errorUnknown);
    expect(describeError('plain string', 'en')).toBe(common.en.errorUnknown);
    expect(describeError(undefined, 'ko')).toBe(common.ko.errorUnknown);
  });

  it('limits the detail length', () => {
    const text = describeError(new Error('x'.repeat(1000)), 'en');
    expect(text.length).toBeLessThan(260);
  });
});
