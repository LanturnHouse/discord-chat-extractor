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

  it('never shows the text of the error itself (it is English and carries the request path), whatever the kind and status', () => {
    const raw =
      'Discord API error 403 for GET /channels/304/messages (not a missing-permission error; this may be a temporary block, try again later)';
    for (const locale of LOCALES) {
      for (const error of [
        new DiscordApiError('unknown', raw, { status: 403 }),
        new DiscordApiError('unknown', 'Discord API error 400 for GET /channels/307/messages: Bad things', { status: 400, code: 50035 }),
        new DiscordApiError('unknown', 'Discord returned an invalid JSON response.', { status: 200 }),
        new DiscordApiError('unknown', 'Waiting for Discord was interrupted.'),
        new DiscordApiError('server', 'Discord API error 503 for GET /channels/1/messages', { status: 503 }),
      ]) {
        const text = describeError(error, locale);
        expect(text, `${locale}: ${error.message}`).not.toContain('/channels/');
        expect(text).not.toContain('Discord API error');
        expect(text).not.toContain('Bad things');
        expect(text).not.toContain('interrupted');
      }
    }
  });

  it('an unknown error with an HTTP status says which one in a localised sentence', () => {
    const blocked = new DiscordApiError('unknown', 'English text', { status: 403 });
    expect(describeError(blocked, 'en')).toBe('Discord rejected the request (HTTP 403). This may be a temporary block - try again later.');
    expect(describeError(blocked, 'ko')).toMatch(/^Discord가 요청을 거부했습니다 \(HTTP 403\)\. 일시적인 차단/);

    const rejected = new DiscordApiError('unknown', 'English text', { status: 400 });
    expect(describeError(rejected, 'en')).toBe('Discord rejected the request (HTTP 400).');
    expect(describeError(rejected, 'ko')).toBe('Discord가 요청을 거부했습니다 (HTTP 400).');
    expect(describeError(new DiscordApiError('unknown', 'x', { status: 429 }), 'en')).toContain('HTTP 429');

    // An error that never reached Discord has no status to tell.
    const unsent = new DiscordApiError('unknown', 'no status');
    expect(describeError(unsent, 'en')).toBe(common.en.errorUnknown);
    expect(describeError(unsent, 'ko')).toBe(common.ko.errorUnknown);
  });

  it('a 2xx answer that could not be read is "an unexpected answer", never a rejection (NEW-6)', () => {
    for (const status of [200, 201, 204]) {
      const unreadable = new DiscordApiError('unknown', 'Discord returned an invalid JSON response.', { status });
      expect(describeError(unreadable, 'en'), String(status)).toBe('Discord sent an unexpected answer.');
      expect(describeError(unreadable, 'ko'), String(status)).toBe(common.ko.errorUnexpected);
      for (const locale of LOCALES) {
        expect(describeError(unreadable, locale)).not.toMatch(/HTTP|reject|거부|accept|받아들/);
        expect(describeError(unreadable, locale)).not.toBe(common[locale].errorUnknown);
      }
    }
    // Statuses that are refusals keep their own sentences.
    expect(describeError(new DiscordApiError('unknown', 'x', { status: 400 }), 'en')).toBe(common.en.errorRejected(400));
    expect(describeError(new DiscordApiError('unknown', 'x', { status: 403 }), 'en')).toBe(common.en.errorBlocked(403));
    expect(common.ko.errorUnexpected).toMatch(/[가-힣]/);
  });

  it('a thread search that is not indexed yet (202) is a "try again in a moment", not an unknown error', () => {
    const notReady = new DiscordApiError('unknown', 'Discord has not indexed this channel for search yet (HTTP 202); try again later.', {
      status: 202,
      code: 110000,
      retryAfterMs: 1000,
    });
    expect(describeError(notReady, 'en')).toBe(common.en.errorNotReady);
    expect(describeError(notReady, 'ko')).toBe(common.ko.errorNotReady);
    expect(common.en.errorNotReady).not.toBe(common.en.errorUnknown);
  });

  it('a long rate limit says how many minutes to wait, a short one just "in a moment"', () => {
    const banned = new DiscordApiError('rate-limited', 'Discord rate limit: would have to wait 3600 s.', { retryAfterMs: 3_600_000 });
    expect(describeError(banned, 'en')).toBe('Discord asked us to wait about 60 min before the next request. Try again after that.');
    expect(describeError(banned, 'ko')).toBe('Discord에서 약 60분 동안 기다려 달라고 요청했습니다. 그 뒤에 다시 시도하세요.');
    // Rounded up: 61 s is 2 minutes, never "1 minute" that is over before the client lets a request through.
    expect(describeError(new DiscordApiError('rate-limited', 'x', { retryAfterMs: 61_000 }), 'en')).toContain('about 2 min');
    expect(describeError(new DiscordApiError('rate-limited', 'x', { retryAfterMs: 59_900 }), 'en')).toBe(common.en.errorRateLimited);
    expect(describeError(new DiscordApiError('rate-limited', 'x'), 'ko')).toBe(common.ko.errorRateLimited);
  });

  it('the network sentence also tells that the browser may be limiting requests for a moment', () => {
    expect(describeError(new DiscordApiError('network', 'x'), 'en')).toMatch(/browser may also be limiting requests.*wait a minute/);
    expect(describeError(new DiscordApiError('network', 'x'), 'ko')).toMatch(/브라우저가 일시적으로 요청을 제한.*1분/);
  });

  it('English sentences contain no Korean and the other way round', () => {
    const errors = [
      ...kinds.map((kind) => new DiscordApiError(kind, 'raw', { status: kind === 'unknown' ? 403 : undefined, retryAfterMs: kind === 'rate-limited' ? 600_000 : undefined })),
      new DiscordApiError('unknown', 'raw', { status: 400 }),
      new DiscordApiError('unknown', 'raw', { status: 202 }),
    ];
    for (const error of errors) {
      expect(describeError(error, 'en')).not.toMatch(/[가-힣]/);
      expect(describeError(error, 'ko')).toMatch(/[가-힣]/);
    }
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
