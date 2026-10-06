import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordApiError } from '@/lib/discord/client';
import {
  DEFAULT_MIN_GAP_MS,
  MAX_RATE_LIMIT_WAIT_MS,
  RateLimiter,
  SerialQueue,
  abortableSleep,
  backoffDelayMs,
  majorParameter,
  parseRateLimitHeaders,
  parseRetryAfter,
  type HeadersLike,
  type RateLimitHeaders,
} from '@/lib/discord/rateLimit';

function headers(values: Record<string, string>): HeadersLike {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

const NO_LIMITS: RateLimitHeaders = { bucket: null, limit: null, remaining: null, resetAfterMs: null, global: false };

describe('parseRateLimitHeaders', () => {
  it('reads bucket, limit, remaining and reset-after (float seconds -> ms)', () => {
    const parsed = parseRateLimitHeaders(
      headers({
        'X-RateLimit-Bucket': 'abc123',
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset-After': '1.1',
      }),
    );
    expect(parsed).toEqual({ bucket: 'abc123', limit: 5, remaining: 0, resetAfterMs: 1100, global: false });
  });

  it('returns nulls for missing or garbage headers', () => {
    expect(parseRateLimitHeaders(headers({}))).toEqual(NO_LIMITS);
    const garbage = parseRateLimitHeaders(
      headers({ 'x-ratelimit-remaining': 'soon', 'x-ratelimit-reset-after': '-3', 'x-ratelimit-bucket': '  ' }),
    );
    expect(garbage).toEqual(NO_LIMITS);
  });

  it('detects the global flag case-insensitively', () => {
    expect(parseRateLimitHeaders(headers({ 'x-ratelimit-global': 'TRUE' })).global).toBe(true);
    expect(parseRateLimitHeaders(headers({ 'x-ratelimit-global': 'false' })).global).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('prefers the JSON body retry_after (float seconds, rounded up to whole ms)', () => {
    expect(parseRetryAfter(headers({ 'retry-after': '9' }), { retry_after: 0.52, global: false })).toEqual({ ms: 520, global: false });
    expect(parseRetryAfter(headers({}), { retry_after: 1.1 })).toEqual({ ms: 1100, global: false });
    expect(parseRetryAfter(headers({}), { retry_after: 0.0004 }).ms).toBe(1);
  });

  it('falls back to Retry-After, then X-RateLimit-Reset-After, then 1 second', () => {
    expect(parseRetryAfter(headers({ 'retry-after': '3' }), undefined).ms).toBe(3000);
    expect(parseRetryAfter(headers({ 'x-ratelimit-reset-after': '2.5' }), '<html>').ms).toBe(2500);
    expect(parseRetryAfter(headers({}), {}).ms).toBe(1000);
    expect(parseRetryAfter(headers({ 'retry-after': 'tomorrow' }), { retry_after: 'soon' }).ms).toBe(1000);
  });

  it('reads the global flag from the body or the header', () => {
    expect(parseRetryAfter(headers({}), { retry_after: 1, global: true }).global).toBe(true);
    expect(parseRetryAfter(headers({ 'x-ratelimit-global': 'true' }), undefined).global).toBe(true);
    expect(parseRetryAfter(headers({}), { retry_after: 1 }).global).toBe(false);
  });

  it('accepts a retry_after of 0', () => {
    expect(parseRetryAfter(headers({ 'retry-after': '5' }), { retry_after: 0 }).ms).toBe(0);
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt with equal jitter between exp/2 and exp', () => {
    expect(backoffDelayMs(0, () => 0)).toBe(500);
    expect(backoffDelayMs(0, () => 0.999999)).toBe(1000);
    expect(backoffDelayMs(1, () => 0)).toBe(1000);
    expect(backoffDelayMs(1, () => 1)).toBe(2000);
    expect(backoffDelayMs(2, () => 0.5)).toBe(3000);
  });

  it('is capped', () => {
    expect(backoffDelayMs(10, () => 1)).toBe(8000);
    expect(backoffDelayMs(10, () => 0)).toBe(4000);
    expect(backoffDelayMs(3, () => 1, 100, 250)).toBe(250);
  });

  it('clamps a misbehaving random source and negative attempts', () => {
    expect(backoffDelayMs(0, () => 5)).toBe(1000);
    expect(backoffDelayMs(0, () => -5)).toBe(500);
    expect(backoffDelayMs(-3, () => 0)).toBe(500);
  });

  it('never leaves the [exp/2, exp] window with the real random source', () => {
    for (let i = 0; i < 200; i++) {
      const d = backoffDelayMs(2);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });
});

describe('majorParameter', () => {
  it('extracts channel / guild / webhook ids', () => {
    expect(majorParameter('/api/v9/channels/123/messages')).toBe('channels/123');
    expect(majorParameter('/channels/123/messages/456')).toBe('channels/123');
    expect(majorParameter('/api/v9/guilds/77/roles')).toBe('guilds/77');
    expect(majorParameter('/api/v10/webhooks/5/token')).toBe('webhooks/5');
  });

  it('is empty for routes without a major parameter', () => {
    expect(majorParameter('/api/v9/users/@me/guilds')).toBe('');
    expect(majorParameter('/api/v9/users/@me/guilds/55/member')).toBe('');
  });
});

describe('RateLimiter', () => {
  function setup(minGapMs = 50) {
    let t = 10_000;
    const limiter = new RateLimiter(() => t, minGapMs);
    return { limiter, advance: (ms: number) => (t += ms), time: () => t };
  }

  it('lets the very first request through immediately', () => {
    expect(setup().limiter.delayFor('/api/v9/users/@me')).toBe(0);
  });

  it('enforces the minimum gap after a finished request', () => {
    const { limiter, advance } = setup(50);
    limiter.recordResponse('/a', NO_LIMITS);
    expect(limiter.delayFor('/b')).toBe(50);
    advance(20);
    expect(limiter.delayFor('/b')).toBe(30);
    advance(30);
    expect(limiter.delayFor('/b')).toBe(0);
  });

  it('has no minimum gap by default: a request right after another one never waits (timers cost 1 s in a background tab)', () => {
    expect(DEFAULT_MIN_GAP_MS).toBe(0);
    let t = 10_000;
    const limiter = new RateLimiter(() => t);
    limiter.recordResponse('/a', NO_LIMITS);
    expect(limiter.delayFor('/a')).toBe(0);
    expect(limiter.delayFor('/b')).toBe(0);
    limiter.recordFailure();
    expect(limiter.delayFor('/b')).toBe(0);
  });

  it('counts a network failure as a finished request too', () => {
    const { limiter } = setup(50);
    limiter.recordFailure();
    expect(limiter.delayFor('/b')).toBe(50);
  });

  it('waits for the reset when a bucket is exhausted, and only for that bucket', () => {
    const { limiter, advance } = setup(0);
    limiter.recordResponse('/api/v9/channels/1/messages', { ...NO_LIMITS, bucket: 'B', remaining: 0, resetAfterMs: 2500 });
    expect(limiter.delayFor('/api/v9/channels/1/messages')).toBe(2500);
    expect(limiter.delayFor('/api/v9/users/@me')).toBe(0);
    advance(1000);
    expect(limiter.delayFor('/api/v9/channels/1/messages')).toBe(1500);
    advance(1500);
    expect(limiter.delayFor('/api/v9/channels/1/messages')).toBe(0);
  });

  it('does not wait while requests remain, and clears an earlier block', () => {
    const { limiter } = setup(0);
    limiter.recordResponse('/p', { ...NO_LIMITS, remaining: 0, resetAfterMs: 1000 });
    expect(limiter.delayFor('/p')).toBe(1000);
    limiter.recordResponse('/p', { ...NO_LIMITS, remaining: 3, resetAfterMs: 1000 });
    expect(limiter.delayFor('/p')).toBe(0);
  });

  it('ignores remaining=0 without a reset time', () => {
    const { limiter } = setup(0);
    limiter.recordResponse('/p', { ...NO_LIMITS, remaining: 0 });
    expect(limiter.delayFor('/p')).toBe(0);
  });

  it('shares a bucket between routes with the same bucket id and major parameter', () => {
    const { limiter } = setup(0);
    const bucket = 'shared';
    // Learn that both paths belong to the bucket (still plenty of requests left).
    limiter.recordResponse('/api/v9/channels/1/messages', { ...NO_LIMITS, bucket, remaining: 4, resetAfterMs: 1000 });
    limiter.recordResponse('/api/v9/channels/1/messages/9', { ...NO_LIMITS, bucket, remaining: 4, resetAfterMs: 1000 });
    limiter.recordResponse('/api/v9/channels/2/messages', { ...NO_LIMITS, bucket, remaining: 4, resetAfterMs: 1000 });
    // Exhaust it through one route...
    limiter.recordResponse('/api/v9/channels/1/messages', { ...NO_LIMITS, bucket, remaining: 0, resetAfterMs: 4000 });
    // ...the sibling route of the same channel waits, another channel (other major parameter) does not.
    expect(limiter.delayFor('/api/v9/channels/1/messages/9')).toBe(4000);
    expect(limiter.delayFor('/api/v9/channels/2/messages')).toBe(0);
  });

  it('blocks only the route on a normal 429 and everything on a global 429', () => {
    const { limiter, advance } = setup(0);
    limiter.recordRateLimited('/a', 1500, false);
    expect(limiter.delayFor('/a')).toBe(1500);
    expect(limiter.delayFor('/b')).toBe(0);
    limiter.recordRateLimited('/a', 3000, true);
    expect(limiter.delayFor('/b')).toBe(3000);
    advance(3000);
    expect(limiter.delayFor('/a')).toBe(0);
    expect(limiter.delayFor('/b')).toBe(0);
  });

  it('treats a 429 wait beyond the cap as a ban on every route, even without the global flag', () => {
    const { limiter, advance } = setup(0);
    limiter.recordRateLimited('/a', MAX_RATE_LIMIT_WAIT_MS, false);
    expect(limiter.delayFor('/a')).toBe(MAX_RATE_LIMIT_WAIT_MS);
    expect(limiter.delayFor('/b')).toBe(0);

    limiter.recordRateLimited('/a', MAX_RATE_LIMIT_WAIT_MS + 1, false);
    expect(limiter.delayFor('/b')).toBe(MAX_RATE_LIMIT_WAIT_MS + 1);
    expect(limiter.delayFor('/c/with/another/route')).toBe(MAX_RATE_LIMIT_WAIT_MS + 1);
    advance(MAX_RATE_LIMIT_WAIT_MS + 1);
    expect(limiter.delayFor('/a')).toBe(0);
    expect(limiter.delayFor('/b')).toBe(0);
  });

  it('never shortens an existing block', () => {
    const { limiter } = setup(0);
    limiter.recordRateLimited('/a', 5000, false);
    limiter.recordRateLimited('/a', 100, false);
    expect(limiter.delayFor('/a')).toBe(5000);
  });

  it('keeps working with thousands of distinct routes (bookkeeping is bounded)', () => {
    const { limiter, advance } = setup(0);
    for (let i = 0; i < 3000; i++) {
      limiter.recordResponse(`/api/v9/channels/${i}/messages`, { ...NO_LIMITS, bucket: `b${i}`, remaining: 0, resetAfterMs: 10 });
      advance(20);
    }
    expect(limiter.delayFor('/api/v9/channels/2999/messages')).toBe(0);
  });
});

describe('SerialQueue', () => {
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('runs tasks one at a time in FIFO order', async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const task = (name: string, ms: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      active--;
      return name;
    };
    const results = await Promise.all([queue.run(task('a', 15)), queue.run(task('b', 1)), queue.run(task('c', 5))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('keeps going after a failing task and passes its rejection through', async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new Error('boom');
    });
    const syncThrow = queue.run(() => {
      throw new Error('sync boom');
    });
    const ok = queue.run(async () => 42);
    await expect(failing).rejects.toThrow('boom');
    await expect(syncThrow).rejects.toThrow('sync boom');
    await expect(ok).resolves.toBe(42);
  });

  it('rejects immediately for an already aborted signal without running the task', async () => {
    const queue = new SerialQueue();
    const task = vi.fn(async () => 1);
    const controller = new AbortController();
    controller.abort();
    const error = await queue.run(task, controller.signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiscordApiError);
    expect((error as DiscordApiError).kind).toBe('aborted');
    expect(task).not.toHaveBeenCalled();
  });

  it('cancels a queued task right away, without waiting for the running one, and never runs it', async () => {
    const queue = new SerialQueue();
    const gate = deferred();
    const first = queue.run(() => gate.promise.then(() => 'first'));
    const controller = new AbortController();
    const queuedTask = vi.fn(async () => 'second');
    const second = queue.run(queuedTask, controller.signal);
    const third = queue.run(async () => 'third');

    controller.abort();
    await expect(second).rejects.toMatchObject({ kind: 'aborted' });
    expect(queuedTask).not.toHaveBeenCalled();

    gate.resolve();
    await expect(first).resolves.toBe('first');
    await expect(third).resolves.toBe('third');
    expect(queuedTask).not.toHaveBeenCalled();
  });

  it('does not touch a task that is already running when its signal fires (the task owns that)', async () => {
    const queue = new SerialQueue();
    const controller = new AbortController();
    const gate = deferred();
    const running = queue.run(() => gate.promise.then(() => 'finished'), controller.signal);
    await Promise.resolve();
    controller.abort();
    gate.resolve();
    await expect(running).resolves.toBe('finished');
  });
});

describe('abortableSleep', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    let done = false;
    const sleeping = abortableSleep(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(done).toBe(true);
  });

  it('rejects with an aborted DiscordApiError as soon as the signal fires, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = abortableSleep(60_000, controller.signal);
    const assertion = expect(sleeping).rejects.toMatchObject({ kind: 'aborted' });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects immediately for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(10, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
  });
});
