import { ChromePlatform } from './chrome';
import { DevPlatform } from './dev';
import type { Platform } from './types';

let cached: Platform | null = null;

/** True only inside a real extension page that can reach `chrome.storage.session` (false in a normal tab / dev server / tests). */
function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) && Boolean(chrome.storage?.session);
}

export function getPlatform(): Platform {
  cached ??= isExtensionContext() ? new ChromePlatform() : new DevPlatform();
  return cached;
}

/** Demo mode: `?mock=1` in the URL, or no extension to get a token from. */
export function isMockRequested(): boolean {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('mock') === '1') return true;
  return getPlatform().kind === 'dev';
}
