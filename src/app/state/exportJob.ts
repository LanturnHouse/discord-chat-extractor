import { saveBlob } from '@/lib/export/download';
import { loadExportFormat } from '@/lib/export/formats';
import { runExport } from '@/lib/export/runner';
import type { Snowflake } from '@/lib/discord/types';
import { MAX_EXPORT_LIMIT, type ExportOptions, type ExportOutput, type ExportProgress, type ExportScope, type ExportTarget } from '@/lib/export/types';
import { common, describeError } from '../i18n/common';
import type { Locale } from '../i18n/core';
import { isAbortError, type StoreContext } from './context';
import { IDLE_EXPORT_JOB } from './initial';
import { copyScope, sameScope, type ScopeIssue } from './scope';
import { selectChannelNames, selectRoleNames, selectScopeProblem, selectSelectedTargets, selectUnsavedFileCount } from './selectors';
import { handleAuthFailure } from './session';
import { stateStrings } from './strings';
import type { AppActions, ExportJob, ExportJobOutput, ExportJobScope, ExportJobStatus } from './types';

export type ExportActions = Pick<
  AppActions,
  'setExportAfter' | 'setExportBefore' | 'setExportLimit' | 'setChannelScope' | 'startExport' | 'saveExportOutput' | 'cancelExport' | 'dismissExportJob'
>;

const EMPTY_BLOB = new Blob([]);

/** 'finished' only announces that the output is ready: the job keeps its last status until the file was handed over. */
function statusForPhase(phase: ExportProgress['phase'], current: ExportJobStatus): ExportJobStatus {
  if (phase === 'fetching') return 'running';
  if (phase === 'packaging') return 'packaging';
  return current;
}

/**
 * The summary stays in the state until dismissed; the (possibly huge) archive itself must not. Only call this once the file
 * was handed to the browser (or when there is none): an archive that could not be saved is kept by `keepBlob`.
 */
function releaseBlob(output: ExportOutput, saved: boolean): ExportJobOutput {
  return { ...output, blob: EMPTY_BLOB, saved };
}

/** A finished archive the browser did not accept yet: its blob stays, so `saveExportOutput` can try again. */
function keepBlob(output: ExportOutput): ExportJobOutput {
  return { ...output, saved: false };
}

/** "Server / channel" like the runner's labels (a DM is just its name). */
function targetLabel(target: ExportTarget): string {
  return target.guildName ? `${target.guildName} / ${target.channelName}` : target.channelName;
}

/** What a refused start tells the user: which scope (the default one, or one channel's own) is wrong and why. */
function scopeProblemMessage(locale: Locale, issue: ScopeIssue, target: ExportTarget | null): string {
  const t = stateStrings[locale];
  const reason = issue === 'inverted' ? common[locale].invalidRange : issue === 'date' ? t.invalidDate : t.invalidLimit(MAX_EXPORT_LIMIT);
  return target === null ? reason : t.scopeOf(targetLabel(target), reason);
}

function saveFailureMessage(locale: Locale, error: unknown): string {
  const t = common[locale];
  const detail = error instanceof Error ? error.message : '';
  return detail === '' ? t.saveFailed : t.errorWithDetail(t.saveFailed, detail);
}

/** What the job says after a save failed; a run that ended on a rejected login keeps saying why it stopped. */
function saveFailedMessage(locale: Locale, output: ExportOutput, error: unknown): string {
  const failure = saveFailureMessage(locale, error);
  return output.authExpired === true ? `${stateStrings[locale].sessionExpired} ${failure}` : failure;
}

export function createExportActions(ctx: StoreContext): ExportActions {
  const { get, set, runtime } = ctx;

  return {
    // Writing the value that is already there changes nothing (and wakes nobody up).
    setExportAfter(iso) {
      set((state) => (state.exportSettings.after === iso ? state : { exportSettings: { ...state.exportSettings, after: iso } }));
    },

    setExportBefore(iso) {
      set((state) => (state.exportSettings.before === iso ? state : { exportSettings: { ...state.exportSettings, before: iso } }));
    },

    setExportLimit(limit) {
      set((state) => (state.exportSettings.limit === limit ? state : { exportSettings: { ...state.exportSettings, limit } }));
    },

    setChannelScope(channelId, scope) {
      const { selection, exportOverrides } = get();
      if (!Object.hasOwn(selection, channelId)) return;
      if (scope === null) {
        if (!Object.hasOwn(exportOverrides, channelId)) return;
        const next = { ...exportOverrides };
        delete next[channelId];
        set({ exportOverrides: next });
        return;
      }
      const current = Object.hasOwn(exportOverrides, channelId) ? exportOverrides[channelId] : undefined;
      if (current !== undefined && sameScope(current, scope)) return;
      set({ exportOverrides: { ...exportOverrides, [channelId]: copyScope(scope) } });
    },

    async startExport() {
      const state = get();
      const { client, prefs, locale, exportSettings, exportOverrides } = state;
      if (client === null || state.status !== 'ready') return;
      if (state.exportJob.status === 'running' || state.exportJob.status === 'packaging') return;
      const selected = selectSelectedTargets(state);
      if (selected.length === 0) return;

      // A scope that cannot be exported would only fail halfway through the run (or silently export the wrong thing).
      const problem = selectScopeProblem(state);
      if (problem !== null) {
        const culprit = problem.channelId === null ? null : (selected.find((target) => target.channelId === problem.channelId) ?? null);
        set({ exportJob: { ...IDLE_EXPORT_JOB, status: 'error', error: scopeProblemMessage(locale, problem.issue, culprit), startedAt: Date.now() } });
        return;
      }

      const targets = selected.map((target) => {
        const own = Object.hasOwn(exportOverrides, target.channelId) ? exportOverrides[target.channelId] : undefined;
        return own === undefined ? target : { ...target, scope: copyScope(own) };
      });
      const overrides: Record<Snowflake, ExportScope> = {};
      for (const target of targets) if (target.scope !== undefined) overrides[target.channelId] = target.scope;
      const scope: ExportJobScope = { defaults: copyScope(exportSettings), overrides };
      const { after, before, limit } = exportSettings;

      const controller = new AbortController();
      runtime.exportController = controller;
      runtime.exportJobId += 1;
      const jobId = runtime.exportJobId;
      const isCurrent = (): boolean => runtime.exportJobId === jobId;
      const patchJob = (patch: Partial<ExportJob>): void => set((s) => ({ exportJob: { ...s.exportJob, ...patch } }));

      const startedAt = Date.now();
      // Kept next to the store: the login rejection that ends this job also resets the store's copy.
      let lastProgress: ExportProgress | null = null;
      set({ exportJob: { status: 'running', progress: null, output: null, error: null, startedAt, scope } });
      const options: ExportOptions = {
        format: prefs.exportFormat,
        after,
        before,
        limit,
        htmlTheme: prefs.htmlTheme,
        locale,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      /**
       * Discord rejected the login while the job ran. Nobody can click anything once the session is gone, so what was
       * completed is saved right away (from the runner's own result: the store's copy of the job is reset with the
       * session), then the session is left and the job ends in a terminal state that says what happened.
       */
      const endExpired = (output: ExportOutput): void => {
        const activeLocale = get().locale;
        const t = stateStrings[activeLocale];
        let message = t.sessionExpired;
        let saved = false;
        if (output.fileCount > 0) {
          try {
            saveBlob(output.blob, output.filename);
            saved = true;
            message = t.sessionExpiredSaved(output.fileCount);
          } catch (error) {
            message = saveFailedMessage(activeLocale, output, error);
          }
        }
        if (isCurrent()) handleAuthFailure(ctx, 'expired');
        // Otherwise the rejection already ended the session; unless something newer owns the state by now, report there.
        else if (runtime.authLostAtJobId !== runtime.exportJobId) return;
        // A save that failed keeps the archive: `saveExportOutput` can still hand it over while this state exists.
        const kept = output.fileCount > 0 && !saved ? keepBlob(output) : releaseBlob(output, saved);
        set({ exportJob: { status: 'error', progress: lastProgress, output: kept, error: message, startedAt, scope } });
      };

      try {
        const format = await loadExportFormat(prefs.exportFormat);
        if (!isCurrent()) return;
        const output = await runExport({
          client,
          targets,
          format,
          options,
          signal: controller.signal,
          onProgress: (progress) => {
            lastProgress = progress;
            if (isCurrent()) set((s) => ({ exportJob: { ...s.exportJob, progress, status: statusForPhase(progress.phase, s.exportJob.status) } }));
          },
          channelNames: (guildId) => selectChannelNames(get(), guildId),
          roleNames: (guildId) => selectRoleNames(get(), guildId),
        });
        if (output.authExpired === true) {
          endExpired(output);
          return;
        }
        if (!isCurrent()) return;

        if (output.cancelled) {
          // Cancelling is not a request to download: the completed channels wait (blob included) for `saveExportOutput`.
          patchJob({ status: 'cancelled', output: { ...output, saved: false }, error: null });
          return;
        }

        // Nothing completed (no access everywhere): there is no file to offer.
        if (output.fileCount > 0) {
          try {
            saveBlob(output.blob, output.filename);
          } catch (error) {
            // The finished export must not be lost with the failed download: the archive stays for `saveExportOutput`.
            patchJob({ status: 'error', output: keepBlob(output), error: saveFailedMessage(get().locale, output, error) });
            return;
          }
        }
        patchJob({ status: 'done', output: releaseBlob(output, output.fileCount > 0), error: null });
      } catch (error) {
        if (!isCurrent()) return;
        if (isAbortError(error)) patchJob({ status: 'cancelled' });
        else patchJob({ status: 'error', error: describeError(error, get().locale) });
      } finally {
        if (runtime.exportController === controller) runtime.exportController = null;
      }
    },

    saveExportOutput() {
      const { status, output } = get().exportJob;
      // Only a job that still holds an unsaved archive (cancelled, or failed while saving); any other was released already.
      if (output === null || selectUnsavedFileCount(get()) === 0) return;
      const locale = get().locale;
      try {
        saveBlob(output.blob, output.filename);
      } catch (error) {
        // The archive stays, so the user can try again.
        set((s) => ({ exportJob: { ...s.exportJob, error: saveFailedMessage(locale, output, error) } }));
        return;
      }
      // A run whose only problem was the download is complete now. One that Discord ended with 401 stays an error that says so.
      const expired = output.authExpired === true;
      set((s) => ({
        exportJob: {
          ...s.exportJob,
          status: status === 'error' && !expired ? 'done' : s.exportJob.status,
          output: releaseBlob(output, true),
          error: expired ? stateStrings[locale].sessionExpiredSaved(output.fileCount) : null,
        },
      }));
    },

    cancelExport() {
      runtime.exportController?.abort();
    },

    dismissExportJob() {
      const { status } = get().exportJob;
      if (status === 'done' || status === 'cancelled' || status === 'error') set({ exportJob: IDLE_EXPORT_JOB });
    },
  };
}
