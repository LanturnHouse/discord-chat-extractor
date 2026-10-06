import type { StoreApi } from 'zustand/vanilla';
import { getPlatform, isMockRequested } from '@/app/platform';
import type { Platform } from '@/app/platform/types';
import { LiveDiscordClient, type LiveDiscordClientOptions } from '@/lib/discord/api';
import { DiscordApiError, type DiscordClient } from '@/lib/discord/client';
import type { User } from '@/lib/discord/types';
import type { AppState } from './types';

/** Everything the store takes from its environment, so tests can replace it. All have production defaults. */
export interface StoreDeps {
  getPlatform: () => Platform;
  isMockRequested: () => boolean;
  /** Demo world. A dynamic import in production: the fixtures are large and must stay out of the main chunk. */
  loadDemo: () => Promise<{ client: DiscordClient; me: User }>;
  createLiveClient: (options: LiveDiscordClientOptions) => DiscordClient;
  /** Reloads the page in demo mode. */
  navigateToDemo: () => void;
}

export const defaultDeps: StoreDeps = {
  getPlatform,
  isMockRequested,
  loadDemo: async () => {
    const { createMockClient, MOCK_ME } = await import('@/lib/discord/mock');
    return { client: createMockClient(), me: MOCK_ME };
  },
  createLiveClient: (options) => new LiveDiscordClient(options),
  navigateToDemo: () => {
    location.search = '?mock=1';
  },
};

/** One boot of the app (one account / one client). Asynchronous work captures it and drops its result once it is stale. */
export interface Session {
  readonly epoch: number;
  readonly signal: AbortSignal;
  /** False once a newer session started or this one ended (new boot, token lost, account changed). */
  isCurrent(): boolean;
}

export interface MessageLoad {
  controller: AbortController;
  kind: 'initial' | 'older';
  /** Settles when the load ended (never rejects); a second caller for the same channel waits on it. */
  done: Promise<void>;
}

/**
 * Non-reactive bookkeeping of one store: in-flight work and cancellation. It does not belong in the zustand state because
 * no component renders it. A new session aborts everything of the previous one.
 */
export class Runtime {
  private epoch = 0;
  private controller = new AbortController();

  readonly treeLoads = new Map<string, Promise<void>>();
  readonly messageLoads = new Map<string, MessageLoad>();
  exportController: AbortController | null = null;
  /** Distinguishes export jobs; progress / results of an older job are dropped. */
  exportJobId = 0;
  /**
   * `exportJobId` as the last rejected login left it (-1: none yet). It still equals `exportJobId` only while nothing newer
   * (a new boot, a new job) happened, which is how an export that outlives its session knows it may still report there.
   */
  authLostAtJobId = -1;
  /** Boots the live session again with whatever token is stored. Installed by the boot slice for the shared transitions. */
  reconnect: () => Promise<void> = () => Promise.resolve();

  /** Ends the current session (aborting its work) and starts a new one. */
  startSession(): Session {
    this.endSession();
    const { epoch, controller } = this;
    return { epoch, signal: controller.signal, isCurrent: () => this.epoch === epoch };
  }

  /** Aborts everything in flight; the next `startSession` call makes a fresh session. */
  endSession(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.epoch += 1;
    this.treeLoads.clear();
    for (const load of this.messageLoads.values()) load.controller.abort();
    this.messageLoads.clear();
    this.exportController?.abort();
    this.exportController = null;
    this.exportJobId += 1;
  }

  /** The session requests made right now belong to. */
  currentSession(): Session {
    const { epoch, controller } = this;
    return { epoch, signal: controller.signal, isCurrent: () => this.epoch === epoch };
  }
}

export type SetState = StoreApi<AppState>['setState'];

export interface StoreContext {
  get: () => AppState;
  set: SetState;
  deps: StoreDeps;
  runtime: Runtime;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DiscordApiError && error.kind === 'aborted') ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
  );
}

export function isAuthError(error: unknown): boolean {
  return error instanceof DiscordApiError && error.kind === 'auth';
}

export function isForbiddenError(error: unknown): boolean {
  return error instanceof DiscordApiError && error.kind === 'forbidden';
}
