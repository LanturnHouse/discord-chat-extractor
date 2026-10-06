import type { Platform } from '@/app/platform/types';
import { describeError } from '../i18n/common';
import type { Session, StoreContext } from './context';
import { initialSessionData } from './initial';
import type { NeedsTokenReason } from './types';

/*
 * State transitions shared by several slices: leaving the session because the login is gone, failing the boot.
 * Plain functions over the store context (they keep no state of their own).
 */

/** Drops everything that belongs to the signed-in session (data of one account must never leak into the next boot). */
export function resetData(ctx: StoreContext): void {
  ctx.set(initialSessionData());
}

/** Back to the onboarding screen: aborts all in-flight work and forgets the data of the old session. */
export function enterNeedsToken(ctx: StoreContext, reason: NeedsTokenReason): void {
  ctx.runtime.endSession();
  resetData(ctx);
  ctx.set({ status: 'needs-token', needsTokenReason: reason, tokenDetected: false, fatalError: null });
}

/**
 * Discord rejected the login: show the onboarding screen and forget the rejected token (so a fresh capture is noticed).
 *
 * `usedToken` is the token the rejected request carried. It is forgotten only while it is still the stored one, so a 401
 * for an old token can never wipe a newer, valid capture; that newer token is then picked up right away because no storage
 * change would announce it. Without `usedToken` (a client that cannot say) the stored token is removed unconditionally.
 */
export function handleAuthFailure(ctx: StoreContext, reason: NeedsTokenReason, usedToken?: string): void {
  enterNeedsToken(ctx, reason);
  ctx.runtime.authLostAtJobId = ctx.runtime.exportJobId;
  const platform = ctx.get().platform;
  if (platform !== null) void forgetRejectedToken(ctx, platform, ctx.runtime.currentSession(), usedToken);
}

async function forgetRejectedToken(ctx: StoreContext, platform: Platform, episode: Session, usedToken: string | undefined): Promise<void> {
  try {
    await platform.clearToken(usedToken);
  } catch {
    // The state change must not depend on storage: a failing clearToken is not actionable.
  }
  if (usedToken === undefined || !episode.isCurrent()) return;

  let stored: string | null;
  try {
    stored = await platform.getToken();
  } catch {
    return;
  }
  // Still the rejected token (clearing failed) would only fail again, so only a different one is worth trying.
  if (stored === null || stored === usedToken || !episode.isCurrent()) return;
  const { status, tokenDetected } = ctx.get();
  if (status !== 'needs-token' || tokenDetected) return;
  ctx.set({ tokenDetected: true });
  await ctx.runtime.reconnect();
}

export function failBoot(ctx: StoreContext, error: unknown): void {
  ctx.set({ status: 'fatal', fatalError: describeError(error, ctx.get().locale), tokenDetected: false });
}
