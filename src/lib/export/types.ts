import type { ChannelKind } from '../discord/model';
import type { Message, Snowflake } from '../discord/types';
import type { NameResolver } from '../markdown/types';

export const EXPORT_FORMAT_IDS = ['html', 'txt', 'md', 'xlsx', 'csv', 'json'] as const;
export type ExportFormatId = (typeof EXPORT_FORMAT_IDS)[number];

/** Upper bound for a message count limit (the "newest N" mode keeps N messages in memory until they are written). */
export const MAX_EXPORT_LIMIT = 100_000;

/**
 * Which part of ONE channel's history is exported. Used as the default for every selected channel (ExportOptions) and as a
 * per-channel override (ExportTarget.scope).
 *
 * Semantics (this is the product contract - runner, UI and file headers all follow it):
 * - after = null, before = null, limit = null  => the whole history.
 * - after / before only                         => every message in that window (inclusive), oldest to newest.
 * - limit only (no dates)                       => the NEWEST `limit` messages: start at the present and walk back in time.
 * - after + limit (before optional)             => starting at `after` (the OLDEST end of the window) take the first `limit`
 *                                                  messages going forward, never beyond `before` when it is set.
 * - before + limit (no `after`)                 => the `limit` newest messages that are at/before `before`.
 * Output is always chronological (oldest first), whatever direction the messages were fetched in.
 */
export interface ExportScope {
  /** Only messages at/after this instant (ISO-8601, UTC). null => from the beginning of the channel. */
  after: string | null;
  /** Only messages at/before this instant. null => up to the newest message. */
  before: string | null;
  /** Maximum number of messages, an integer 1..MAX_EXPORT_LIMIT. null => no limit. */
  limit: number | null;
}

export interface ExportOptions {
  format: ExportFormatId;
  /** Default scope for every target (see ExportScope). */
  after: string | null;
  before: string | null;
  limit: number | null;
  /** HTML export colour scheme. */
  htmlTheme: 'dark' | 'light';
  /** Language for fixed strings inside exported files (headers, system messages, "Pinned a message"...). */
  locale: 'ko' | 'en';
  /** IANA time zone used to print timestamps (default: browser's). */
  timeZone: string;
}

/** One channel/DM/thread chosen for export. Self-contained: carries everything needed for naming and file headers. */
export interface ExportTarget {
  channelId: Snowflake;
  kind: ChannelKind;
  channelName: string;
  guildId: Snowflake | null;
  /** null for DMs / group DMs. */
  guildName: string | null;
  categoryName: string | null;
  /** Threads: the parent channel name. */
  parentChannelName: string | null;
  topic: string | null;
  /** Guild icon (or DM avatar) URL; optional decoration for headers. */
  iconUrl?: string | null;
  /** Per-channel override of the default scope in ExportOptions (all three fields replace the defaults). */
  scope?: ExportScope;
}

export type Chunk = string | Uint8Array;

export interface WriterContext {
  target: ExportTarget;
  /** Options with the EFFECTIVE scope of this target already merged in (after/before/limit come from target.scope when set). */
  options: ExportOptions;
  exportedAt: Date;
  names: NameResolver;
}

export interface WriterSummary {
  messageCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

/**
 * Streaming-ish writer for ONE channel. The runner feeds messages in **chronological order** (oldest -> newest),
 * in consecutive batches (a batch never overlaps another). Writers keep their own state between batches
 * (e.g. last author for grouping, last date for day dividers). Output chunks are concatenated in call order.
 * Binary formats (xlsx) may return everything from `end()`.
 */
export interface ExportWriter {
  start(): Chunk[];
  write(batch: readonly Message[]): Chunk[];
  end(summary: WriterSummary): Chunk[];
}

export interface ExportFormat {
  id: ExportFormatId;
  /** Human label, e.g. "HTML (.html)". */
  label: string;
  /** File extension without dot. */
  extension: string;
  mime: string;
  createWriter(ctx: WriterContext): ExportWriter;
}

export type TargetStatus = 'queued' | 'fetching' | 'done' | 'skipped' | 'error' | 'cancelled';

export interface TargetProgress {
  channelId: Snowflake;
  /** Display label such as "My Server / general". */
  label: string;
  status: TargetStatus;
  /** Messages fetched so far. */
  fetched: number;
  /** 0..1 estimate based on snowflake time between range start and now; null when unknowable. */
  ratio: number | null;
  /** Human readable error / skip reason. */
  error?: string;
}

export interface ExportProgress {
  /** fetching: channels are being downloaded; packaging: building the ZIP (several files); finished: output is ready. */
  phase: 'fetching' | 'packaging' | 'finished';
  targets: TargetProgress[];
  /** Index of the target being processed, -1 before start / after finish. */
  currentIndex: number;
  /** Total messages written across all targets. */
  totalMessages: number;
}

export interface ExportFailure {
  channelId: Snowflake;
  label: string;
  /** skipped = no access / not found (403, 404); error = anything else that dropped the channel. */
  kind: 'skipped' | 'error';
  reason: string;
}

export interface ExportOutput {
  /** Final file name, e.g. "general.html" or "Discord Export 2026-10-06.zip". Empty when nothing was completed (fileCount 0 => do not save). */
  filename: string;
  blob: Blob;
  /** Number of channel files inside (1 => not zipped). */
  fileCount: number;
  messageCount: number;
  failures: ExportFailure[];
  /** True when the user cancelled; `blob` then holds what was completed so far (may be empty => `fileCount` 0). */
  cancelled: boolean;
  /**
   * True when the run stopped early because Discord answered 401 (session expired). `blob` holds the channels that were
   * completed before that (may be empty => `fileCount` 0). The runner returns this instead of throwing so nothing is lost.
   */
  authExpired?: boolean;
}
