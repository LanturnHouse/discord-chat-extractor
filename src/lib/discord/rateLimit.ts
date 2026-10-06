import { DiscordApiError } from './client';

/** Longest single wait we are willing to sit through (rate limits, 429 `retry_after`). Longer => fail with 'rate-limited'. */
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;
/** How many times a request that got HTTP 429 is retried before giving up. */
export const MAX_RATE_LIMIT_RETRIES = 6;
/** Retries for 5xx responses and network errors. */
export const MAX_TRANSIENT_RETRIES = 3;
/**
 * Default pause between two consecutive requests: none. Requests are strictly serial and each round trip already takes far
 * longer than a polite gap, while any timer, however short, costs a full second in a background tab (Chrome throttles hidden
 * pages to one timer tick per second) and would slow a long export to a crawl. Waits Discord announces still use timers.
 */
export const DEFAULT_MIN_GAP_MS = 0;

/** Used when a 429 carries no usable wait hint at all. */
const FALLBACK_RETRY_AFTER_MS = 1_000;
const MAX_TRACKED_BUCKETS = 256;
const MAX_TRACKED_ROUTES = 2_048;

/** The slice of `Headers` we read (lets tests pass plain fakes). */
export interface HeadersLike {
  get(name: string): string | null;
}

export function abortedError(): DiscordApiError {
  return new DiscordApiError('aborted', 'The request was cancelled.');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedError();
}

/** setTimeout-based sleep that rejects with `DiscordApiError('aborted')` as soon as `signal` fires. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseNonNegative(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Seconds (possibly fractional) -> whole milliseconds, rounded up; `toFixed` strips float noise such as 1100.0000000000002. */
function secondsToMs(seconds: number): number {
  return Math.ceil(Number((seconds * 1000).toFixed(6)));
}

export interface RateLimitHeaders {
  bucket: string | null;
  limit: number | null;
  remaining: number | null;
  resetAfterMs: number | null;
  global: boolean;
}

export function parseRateLimitHeaders(headers: HeadersLike): RateLimitHeaders {
  const resetAfter = parseNonNegative(headers.get('x-ratelimit-reset-after'));
  const bucket = headers.get('x-ratelimit-bucket');
  return {
    bucket: bucket !== null && bucket.trim() !== '' ? bucket.trim() : null,
    limit: parseNonNegative(headers.get('x-ratelimit-limit')),
    remaining: parseNonNegative(headers.get('x-ratelimit-remaining')),
    resetAfterMs: resetAfter === null ? null : secondsToMs(resetAfter),
    global: headers.get('x-ratelimit-global')?.trim().toLowerCase() === 'true',
  };
}

export interface RetryAfter {
  ms: number;
  global: boolean;
}

/**
 * How long a 429 asks us to wait. Discord's JSON body (`retry_after`, float seconds) is the most precise hint;
 * then the `Retry-After` header (Cloudflare 429s have no JSON), then `X-RateLimit-Reset-After`, then a 1 s default.
 */
export function parseRetryAfter(headers: HeadersLike, body: unknown): RetryAfter {
  const obj = typeof body === 'object' && body !== null ? (body as { retry_after?: unknown; global?: unknown }) : {};
  const seconds =
    parseNonNegative(obj.retry_after) ??
    parseNonNegative(headers.get('retry-after')) ??
    parseNonNegative(headers.get('x-ratelimit-reset-after'));
  return {
    ms: seconds === null ? FALLBACK_RETRY_AFTER_MS : secondsToMs(seconds),
    global: obj.global === true || headers.get('x-ratelimit-global')?.trim().toLowerCase() === 'true',
  };
}

/**
 * Exponential back-off with "equal jitter": the delay for retry `attempt` (0-based) is uniformly spread
 * over [exp/2, exp] where exp = min(cap, base * 2^attempt). Keeps clients from retrying in lock-step.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random, baseMs = 1_000, capMs = 8_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  const r = Math.min(1, Math.max(0, random()));
  return Math.round(exp / 2 + r * (exp / 2));
}

/** Discord's "major parameter" of a route (rate-limit buckets are per channel / guild / webhook). */
export function majorParameter(pathname: string): string {
  const m = /^\/(?:api\/v\d+\/)?(channels|guilds|webhooks)\/(\d+)/.exec(pathname);
  return m ? `${m[1]}/${m[2]}` : '';
}

/**
 * Bookkeeping for Discord's rate limits. Pure apart from the injected clock: it never sleeps itself,
 * it only says how long the caller has to wait (`delayFor`) and learns from responses.
 */
export class RateLimiter {
  /** state key -> epoch ms until which that bucket is exhausted */
  private readonly blockedUntil = new Map<string, number>();
  /** request path -> Discord bucket id (learned from `X-RateLimit-Bucket`) */
  private readonly bucketOfPath = new Map<string, string>();
  private globalUntil = 0;
  private lastFinishedAt: number | null = null;

  constructor(
    private readonly now: () => number,
    private readonly minGapMs: number = DEFAULT_MIN_GAP_MS,
  ) {}

  /** Milliseconds to wait before a request to `pathname` may be sent (0 = go). */
  delayFor(pathname: string): number {
    let until = this.globalUntil;
    const bucketUntil = this.blockedUntil.get(this.stateKey(pathname));
    if (bucketUntil !== undefined) until = Math.max(until, bucketUntil);
    if (this.lastFinishedAt !== null) until = Math.max(until, this.lastFinishedAt + this.minGapMs);
    return Math.max(0, until - this.now());
  }

  /** Call after every HTTP response (any status). */
  recordResponse(pathname: string, headers: RateLimitHeaders): void {
    const now = this.now();
    this.lastFinishedAt = now;
    if (headers.bucket !== null) {
      if (this.bucketOfPath.size >= MAX_TRACKED_ROUTES) this.bucketOfPath.clear();
      this.bucketOfPath.set(pathname, headers.bucket);
    }
    if (headers.remaining === null || headers.resetAfterMs === null) return;
    const key = this.stateKey(pathname);
    if (headers.remaining <= 0) {
      this.blockedUntil.set(key, now + headers.resetAfterMs);
      this.prune(now);
    } else {
      this.blockedUntil.delete(key);
    }
  }

  /** Call when the request failed without a response (network error). */
  recordFailure(): void {
    this.lastFinishedAt = this.now();
  }

  /**
   * Call on HTTP 429 with the wait Discord asked for. A wait beyond `MAX_RATE_LIMIT_WAIT_MS` is not a per-route bucket
   * (Discord's own buckets reset within seconds): it is an IP / Cloudflare style ban that applies to every route, so it
   * blocks the whole client instead of letting each other route send one more request into the ban.
   */
  recordRateLimited(pathname: string, waitMs: number, global: boolean): void {
    const until = this.now() + waitMs;
    if (global || waitMs > MAX_RATE_LIMIT_WAIT_MS) {
      this.globalUntil = Math.max(this.globalUntil, until);
      return;
    }
    const key = this.stateKey(pathname);
    this.blockedUntil.set(key, Math.max(this.blockedUntil.get(key) ?? 0, until));
  }

  private stateKey(pathname: string): string {
    const bucket = this.bucketOfPath.get(pathname);
    return bucket !== undefined ? `${bucket}:${majorParameter(pathname)}` : `route:${pathname}`;
  }

  private prune(now: number): void {
    if (this.blockedUntil.size <= MAX_TRACKED_BUCKETS) return;
    for (const [key, until] of this.blockedUntil) if (until <= now) this.blockedUntil.delete(key);
  }
}

interface QueueEntry {
  start(): void;
}

/**
 * Runs async tasks strictly one at a time in FIFO order. A task that is still waiting for its turn can be
 * cancelled through its AbortSignal without waiting for the tasks in front of it; a running task must watch the signal itself.
 */
export class SerialQueue {
  private readonly waiting: QueueEntry[] = [];
  private running = false;

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortedError());
        return;
      }
      let onAbort: (() => void) | undefined;
      const entry: QueueEntry = {
        start: () => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          new Promise<T>((done) => done(task())).then(resolve, reject).finally(() => {
            this.running = false;
            this.pump();
          });
        },
      };
      if (signal) {
        onAbort = () => {
          const index = this.waiting.indexOf(entry);
          if (index === -1) return;
          this.waiting.splice(index, 1);
          reject(abortedError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.waiting.push(entry);
      this.pump();
    });
  }

  private pump(): void {
    if (this.running) return;
    const next = this.waiting.shift();
    if (!next) return;
    this.running = true;
    next.start();
  }
}
