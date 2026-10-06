import type { ExportJobStatus } from '@/app/state/types';
import type { ExportProgress, TargetProgress } from '@/lib/export/types';

/** The job is still working (the dialog shows live progress and offers Cancel). */
export function isActiveStatus(status: ExportJobStatus): boolean {
  return status === 'running' || status === 'packaging';
}

/** The job ended (the dialog shows the summary and offers Close). */
export function isFinishedStatus(status: ExportJobStatus): boolean {
  return status === 'done' || status === 'cancelled' || status === 'error';
}

/** Targets that were processed (exported, skipped or failed): the "3" of "3/12". Cancelled and queued ones do not count. */
export function countProcessed(targets: readonly TargetProgress[]): number {
  let count = 0;
  for (const target of targets) if (target.status === 'done' || target.status === 'skipped' || target.status === 'error') count += 1;
  return count;
}

// Selectors run on every store update; the progress snapshot only changes a few times per second, so remember the last count.
let countedProgress: ExportProgress | null = null;
let countedProcessed = 0;

/** `countProcessed` of a snapshot (0 without one), memoised on the snapshot's identity. */
export function processedCount(progress: ExportProgress | null): number {
  if (progress === null) return 0;
  if (progress !== countedProgress) {
    countedProgress = progress;
    countedProcessed = countProcessed(progress.targets);
  }
  return countedProcessed;
}

/** 0..1 over all targets: processed ones count fully, the one being fetched by its own ratio (0 when unknown). */
export function overallRatio(progress: ExportProgress | null): number {
  if (progress === null || progress.targets.length === 0) return 0;
  let sum = 0;
  for (const target of progress.targets) {
    if (target.status === 'fetching') sum += Math.min(1, Math.max(0, target.ratio ?? 0));
    else if (target.status === 'done' || target.status === 'skipped' || target.status === 'error') sum += 1;
  }
  return sum / progress.targets.length;
}
