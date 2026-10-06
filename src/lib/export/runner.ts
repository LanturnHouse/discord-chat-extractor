import { DiscordApiError, type DiscordClient, type DiscordErrorKind } from '../discord/client';
import { MAX_RATE_LIMIT_WAIT_MS } from '../discord/rateLimit';
import type { Snowflake } from '../discord/types';
import { buildNameResolver } from '../message';
import { entryPathFor, singleFileName, zipFileName } from './filename';
import { fetchHistory, snowflakeTime } from './paging';
import { resolveScope, type ResolvedScope } from './scope';
import type {
  ExportFailure,
  ExportFormat,
  ExportOptions,
  ExportOutput,
  ExportProgress,
  ExportTarget,
  TargetProgress,
  TargetStatus,
} from './types';
import { BlobAssembler, buildZip, MAX_ZIP_ENTRIES, MAX_ZIP_INPUT_BYTES, ZipLimitError, type ZipLimitKind } from './zip';

export interface RunExportArgs {
  client: DiscordClient;
  targets: readonly ExportTarget[];
  format: ExportFormat;
  options: ExportOptions;
  signal?: AbortSignal;
  onProgress?(progress: ExportProgress): void;
  /** Role id -> name for the guild (undefined for DMs / unknown guilds). Used to render @role mentions. */
  roleNames?(guildId: Snowflake | null): Record<Snowflake, string> | undefined;
  /** Channel id -> name for the guild. Used to render #channel mentions. */
  channelNames?(guildId: Snowflake | null): Record<Snowflake, string> | undefined;
  now?(): Date;
}

/** Progress updates that are not status changes are limited to about 10 per second. */
const MIN_PROGRESS_INTERVAL_MS = 100;

type Locale = ExportOptions['locale'];

/** Fixed reasons by error kind; the kinds that are not listed ('unknown') are described by UNKNOWN_REASONS. */
const REASONS: Record<Locale, Partial<Record<DiscordErrorKind, string>>> = {
  en: {
    auth: 'Not signed in to Discord (401).',
    forbidden: 'No access to this channel (403).',
    'not-found': 'Channel not found or deleted (404).',
    'rate-limited': 'Discord rate limit reached; try again later.',
    network: 'Network error while contacting Discord.',
    server: 'Discord server error; try again later.',
  },
  ko: {
    auth: 'Discord에 로그인되어 있지 않습니다 (401).',
    forbidden: '이 채널에 접근할 수 없습니다 (403).',
    'not-found': '채널을 찾을 수 없거나 삭제되었습니다 (404).',
    'rate-limited': 'Discord 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
    network: 'Discord에 연결하는 중 네트워크 오류가 발생했습니다.',
    server: 'Discord 서버 오류입니다. 잠시 후 다시 시도하세요.',
  },
};

/** An answer that cannot be used although Discord did not refuse anything: no response status at all, or a 2xx with a broken body. */
const UNEXPECTED_ANSWER: Record<Locale, string> = {
  en: 'Discord sent an unexpected answer',
  ko: 'Discord에서 예상하지 못한 응답을 받았어요',
};

/**
 * `kind: 'unknown'` is whatever Discord answered that has no kind of its own, told apart by the HTTP status when there is one.
 * A 403 here is not a permission error (those are 'forbidden'): it is a block by Cloudflare or Discord's anti-abuse, usually temporary.
 * A status below 400 is no refusal, so "did not accept the request" would be untrue for it.
 */
const UNKNOWN_REASONS: Record<Locale, (status: number | undefined) => string> = {
  en: (status) => {
    if (status === 403) return 'Discord refused the request (403). It may be a temporary block; try again later.';
    return status === undefined || status < 400 ? UNEXPECTED_ANSWER.en : `Discord did not accept the request (HTTP ${status}).`;
  },
  ko: (status) => {
    if (status === 403) return 'Discord가 요청을 거부했습니다 (403). 일시적인 차단일 수 있으니 잠시 후 다시 시도하세요.';
    return status === undefined || status < 400 ? UNEXPECTED_ANSWER.ko : `Discord가 요청을 받아들이지 않았습니다 (HTTP ${status}).`;
  },
};

/** Shown on the channels that were not fetched because Discord answered 401 for an earlier one. */
const SESSION_EXPIRED: Record<Locale, string> = {
  en: 'Not exported: the Discord session expired.',
  ko: '내보내지 못했습니다: Discord 로그인 세션이 만료되었습니다.',
};

/**
 * Shown on the channel that hit a rate limit too long to sit through, and on the channels that were not fetched because of it.
 * The live client refuses every later request while such a ban lasts, so going on would only fail the rest one by one.
 */
const RATE_LIMIT_STOP: Record<Locale, (minutes: number) => string> = {
  en: (minutes) => `Discord asked us to wait ${minutes} min - try again later.`,
  ko: (minutes) => `Discord에서 ${minutes}분 동안 기다려 달라고 요청했습니다. 나중에 다시 시도하세요.`,
};

/** A plain ZIP cannot hold more than ~3.75 GB or 65,535 files (see zip.ts). */
const ZIP_LIMIT_REASONS: Record<Locale, Record<ZipLimitKind, string>> = {
  en: {
    bytes: 'Too large for one ZIP file (limit: about 3.75 GB). Export fewer channels at once.',
    entries: 'Too many files for one ZIP file (limit: 65,535). Export fewer channels at once.',
  },
  ko: {
    bytes: 'ZIP 파일 하나에 담기에는 너무 큽니다 (한도: 약 3.75GB). 한 번에 내보내는 채널 수를 줄이세요.',
    entries: 'ZIP 파일 하나에 담기에는 파일이 너무 많습니다 (한도: 65,535개). 한 번에 내보내는 채널 수를 줄이세요.',
  },
};

/** Total on purpose: an unexpected locale value falls back to English instead of throwing in the middle of a run. */
const inLocale = <T>(table: Record<Locale, T>, locale: Locale): T => (locale === 'ko' ? table.ko : table.en);

/**
 * The reason recorded for a failed channel. For Discord errors it is built from `kind` and `status` only, never from the error's
 * message (developer text, English): the wording stays stable and in the export's language whatever the client says.
 */
function describeError(error: unknown, locale: Locale): string {
  if (error instanceof DiscordApiError) return inLocale(REASONS, locale)[error.kind] ?? inLocale(UNKNOWN_REASONS, locale)(error.status);
  if (error instanceof ZipLimitError) return inLocale(ZIP_LIMIT_REASONS, locale)[error.limit];
  return error instanceof Error ? error.message : String(error);
}

/** Minutes (rounded up) Discord asked us to wait when that is too long to sit through; null for every other failure. */
function longRateLimitMinutes(error: unknown): number | null {
  if (!(error instanceof DiscordApiError) || error.kind !== 'rate-limited') return null;
  const waitMs = error.retryAfterMs;
  return waitMs !== undefined && waitMs > MAX_RATE_LIMIT_WAIT_MS ? Math.ceil(waitMs / 60_000) : null;
}

function labelOf(target: ExportTarget): string {
  return target.guildName ? `${target.guildName} / ${target.channelName}` : target.channelName;
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DiscordApiError && error.kind === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

/** Emits immutable progress snapshots; status changes are always delivered, fetch-count updates are rate limited. */
class ProgressTracker {
  private targets: TargetProgress[];
  private currentIndex = -1;
  private totalMessages = 0;
  private phase: ExportProgress['phase'] = 'fetching';
  private lastEmitAt = Number.NEGATIVE_INFINITY;

  constructor(
    targets: readonly ExportTarget[],
    private readonly sink: ((progress: ExportProgress) => void) | undefined,
  ) {
    this.targets = targets.map((target) => ({
      channelId: target.channelId,
      label: labelOf(target),
      status: 'queued',
      fetched: 0,
      ratio: 0,
    }));
  }

  start(): void {
    this.emit();
  }

  setStatus(index: number, status: TargetStatus, extra: { error?: string; ratio?: number | null } = {}): void {
    const previous = this.targets[index];
    this.replace(index, { ...previous, status, ...extra });
    if (status === 'fetching') this.currentIndex = index;
    this.emit();
  }

  setFetched(index: number, fetched: number, ratio: number | null): void {
    const previous = this.targets[index];
    this.totalMessages += fetched - previous.fetched;
    this.replace(index, { ...previous, fetched, ratio });
    if (performance.now() - this.lastEmitAt >= MIN_PROGRESS_INTERVAL_MS) this.emit();
  }

  /** All channels are done: with several files a ZIP is still to be built ("packaging"), otherwise we are finished. */
  finish(packaging: boolean): void {
    this.currentIndex = -1;
    this.phase = packaging ? 'packaging' : 'finished';
    this.emit();
  }

  complete(): void {
    this.phase = 'finished';
    this.emit();
  }

  private replace(index: number, next: TargetProgress): void {
    const targets = this.targets.slice();
    targets[index] = next;
    this.targets = targets;
  }

  private emit(): void {
    this.lastEmitAt = performance.now();
    try {
      this.sink?.({
        phase: this.phase,
        targets: this.targets,
        currentIndex: this.currentIndex,
        totalMessages: this.totalMessages,
      });
    } catch {
      // A throwing UI callback must not be mistaken for a failure of the channel being exported.
    }
  }
}

/** What one target exports: its validated scope and the options its writer sees (the effective scope already merged in). */
interface TargetPlan {
  scope: ResolvedScope;
  options: ExportOptions;
}

/** A target's own scope replaces the defaults as a unit (all three fields); everything else in the options stays global. */
function planFor(target: ExportTarget, options: ExportOptions): TargetPlan {
  const own = target.scope;
  if (own === undefined) return { scope: resolveScope(options, 'the export options'), options };
  return {
    scope: resolveScope(own, `the scope of "${labelOf(target)}"`),
    options: { ...options, after: own.after, before: own.before, limit: own.limit },
  };
}

interface CompletedTarget {
  target: ExportTarget;
  blob: Blob;
  messageCount: number;
}

/**
 * Exports `targets` one after another: pages each channel's history through `client.getMessages`, feeds the writer of
 * `format` oldest -> newest, and packages the result (one file as is, several as a ZIP).
 *
 * - Which part of a channel is exported is its scope (see ExportScope): `target.scope` when set, else the dates and the
 *   limit of `options`. Without a limit the window is paged forward; with `after` + limit the first messages from `after`
 *   are taken; with a limit and no `after` the newest ones are found by walking backwards (nothing is written before that
 *   walk ends). A bad scope (limit outside 1..MAX_EXPORT_LIMIT, unparsable date, after later than before) rejects the whole
 *   run before the first request.
 * - 403 / 404 on a channel => that target is "skipped" and listed in `failures`; other errors => "error" and listed.
 * - a 401 stops fetching (the rest is "cancelled" with a "session expired" reason) but is not thrown: the channels
 *   completed so far are packaged and returned with `authExpired: true`, so hours of fetching are not lost.
 * - a 429 asking for more than `MAX_RATE_LIMIT_WAIT_MS` blocks the live client for every later request, so it ends the run the
 *   same way: that channel is listed in `failures`, the rest is "cancelled" with a "try again in N min" reason, and what was
 *   completed is returned (not `cancelled`, not `authExpired`). Shorter rate limits only fail their own channel.
 * - aborting `signal` stops immediately: unfinished targets become "cancelled" and the output (`cancelled: true`)
 *   contains only the targets that had already completed. Once packaging has started it is local, bounded work that
 *   always runs to the end: an abort during it still delivers the finished archive (flagged `cancelled`).
 * - a ZIP cannot exceed its limits (zip.ts): a channel that no longer fits is listed in `failures` instead of being
 *   packaged, so the channels that do fit are still delivered.
 */
export async function runExport(args: RunExportArgs): Promise<ExportOutput> {
  const { client, targets, format, options, signal } = args;
  const now = args.now ?? (() => new Date());
  const exportedAt = now();
  const plans = targets.map((target) => planFor(target, options));

  const tracker = new ProgressTracker(targets, args.onProgress);
  const failures: ExportFailure[] = [];
  const completed: CompletedTarget[] = [];
  /** Bytes of `completed`, which a ZIP would have to hold. */
  let completedBytes = 0;

  // The app's own resolver: it learns user names (and `mention_channels`) from the messages themselves, so mentions
  // resolve without extra API calls and exactly like in the chat view. Channels and roles are set per target below.
  const names = buildNameResolver();
  const targetChannelNames = Object.fromEntries(targets.map((t) => [t.channelId, t.channelName]));

  // Without an `after` bound the channel's creation time stands in for the start of its history.
  const rangeStartOf = (index: number): number | null => plans[index].scope.afterMs ?? snowflakeTime(targets[index].channelId);
  // An end date in the future (up to 9999-12-31 can be typed) must not stretch the estimate: nothing exists beyond the present.
  const rangeEndOf = (index: number): number => Math.min(plans[index].scope.beforeMs ?? exportedAt.getTime(), exportedAt.getTime());
  // A counted export knows how far it is from the count alone; otherwise the time between range start and end is the estimate,
  // and null (unknowable) when that range is empty, inverted or has no usable start.
  const initialRatio = (index: number): number | null => {
    if (plans[index].scope.limit !== null) return 0;
    const start = rangeStartOf(index);
    return start !== null && rangeEndOf(index) > start ? 0 : null;
  };

  const exportTarget = async (index: number): Promise<CompletedTarget> => {
    const target = targets[index];
    const { scope } = plans[index];
    // The guild's channel tree wins over the names of the exported targets (which stand in for #mentions of themselves).
    names.setChannels({ ...targetChannelNames, ...args.channelNames?.(target.guildId) });
    names.setRoles({ ...args.roleNames?.(target.guildId) });
    const writer = format.createWriter({ target, options: plans[index].options, exportedAt, names });
    const output = new BlobAssembler();
    for (const chunk of writer.start()) output.push(chunk);

    const rangeStart = rangeStartOf(index);
    const rangeEnd = rangeEndOf(index);
    let ratio = initialRatio(index);
    let written = 0;
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;

    await fetchHistory({
      client,
      channelId: target.channelId,
      scope,
      signal,
      sink: {
        write: (batch) => {
          names.addMessages(batch);
          for (const chunk of writer.write(batch)) output.push(chunk);
          written += batch.length;
          firstTimestamp ??= batch[0].timestamp;
          lastTimestamp = batch[batch.length - 1].timestamp;
        },
        collected: (count, newestId) => {
          if (scope.limit !== null) {
            ratio = Math.max(ratio ?? 0, Math.min(1, count / scope.limit));
          } else {
            const newestAt = snowflakeTime(newestId);
            if (ratio !== null && rangeStart !== null && newestAt !== null) {
              const progress = Math.min(1, Math.max(0, (newestAt - rangeStart) / (rangeEnd - rangeStart)));
              ratio = Math.max(ratio, progress);
            }
          }
          tracker.setFetched(index, count, ratio);
        },
      },
    });

    for (const chunk of writer.end({ messageCount: written, firstTimestamp, lastTimestamp })) output.push(chunk);
    return { target, blob: output.toBlob(format.mime), messageCount: written };
  };

  const markRemainingCancelled = (fromIndex: number, reason?: string): void => {
    for (let i = fromIndex; i < targets.length; i += 1) tracker.setStatus(i, 'cancelled', reason === undefined ? {} : { error: reason });
  };

  /** The target did not make it into the output: shown on its progress row and listed in the summary. */
  const dropTarget = (index: number, status: 'skipped' | 'error', reason: string): void => {
    tracker.setStatus(index, status, { error: reason });
    failures.push({ channelId: targets[index].channelId, label: labelOf(targets[index]), kind: status, reason });
  };

  /** Which ZIP limit adding a finished channel would break; null when it fits (the first file is never zipped). */
  const zipLimitHit = (blob: Blob): ZipLimitKind | null => {
    if (completed.length === 0) return null;
    if (completed.length + 1 > MAX_ZIP_ENTRIES) return 'entries';
    return completedBytes + blob.size > MAX_ZIP_INPUT_BYTES ? 'bytes' : null;
  };

  let cancelled = false;
  let authExpired = false;
  tracker.start();

  for (let index = 0; index < targets.length; index += 1) {
    if (signal?.aborted) {
      cancelled = true;
      markRemainingCancelled(index);
      break;
    }
    tracker.setStatus(index, 'fetching', { ratio: initialRatio(index) });
    try {
      const finished = await exportTarget(index);
      const limit = zipLimitHit(finished.blob);
      if (limit === null) {
        completed.push(finished);
        completedBytes += finished.blob.size;
        tracker.setStatus(index, 'done', { ratio: 1 });
      } else {
        dropTarget(index, 'error', inLocale(ZIP_LIMIT_REASONS, options.locale)[limit]);
      }
    } catch (error) {
      // Checked before the cancellation test: a 401 may arrive together with an abort that the app triggered itself.
      if (error instanceof DiscordApiError && error.kind === 'auth') {
        dropTarget(index, 'error', describeError(error, options.locale));
        markRemainingCancelled(index + 1, inLocale(SESSION_EXPIRED, options.locale));
        authExpired = true;
        break;
      }
      if (isCancellation(error, signal)) {
        cancelled = true;
        markRemainingCancelled(index);
        break;
      }
      const waitMinutes = longRateLimitMinutes(error);
      if (waitMinutes !== null) {
        const reason = inLocale(RATE_LIMIT_STOP, options.locale)(waitMinutes);
        dropTarget(index, 'error', reason);
        markRemainingCancelled(index + 1, reason);
        break;
      }
      const skipped = error instanceof DiscordApiError && (error.kind === 'forbidden' || error.kind === 'not-found');
      dropTarget(index, skipped ? 'skipped' : 'error', describeError(error, options.locale));
    }
  }
  tracker.finish(completed.length > 1);

  const messageCount = completed.reduce((sum, c) => sum + c.messageCount, 0);
  // An expired session is reported on its own; otherwise an abort that lands after the last channel finished, or while
  // the ZIP is being built, still counts as the user's cancel.
  const flags = (): Pick<ExportOutput, 'cancelled' | 'authExpired'> =>
    authExpired ? { cancelled: false, authExpired: true } : { cancelled: cancelled || signal?.aborted === true };

  if (completed.length === 0) {
    return { filename: '', blob: new Blob([]), fileCount: 0, messageCount: 0, failures, ...flags() };
  }

  if (completed.length === 1) {
    const only = completed[0];
    return {
      filename: singleFileName(only.target, format.extension),
      blob: only.blob,
      fileCount: 1,
      messageCount,
      failures,
      ...flags(),
    };
  }

  const usedPaths = new Set<string>();
  const entries = completed.map((c) => ({ path: entryPathFor(c.target, format.extension, usedPaths), blob: c.blob }));
  let zip: Blob;
  try {
    // Deliberately without the abort signal: packaging is local and bounded, and everything it needs has been fetched.
    zip = await buildZip(entries);
  } catch (error) {
    throw new Error(describeError(error, options.locale), { cause: error });
  }
  tracker.complete();
  return { filename: zipFileName(now()), blob: zip, fileCount: completed.length, messageCount, failures, ...flags() };
}
