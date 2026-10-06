/** Chat messages shown per "page" in the web app (initial load and every scroll-up load). */
export const UI_PAGE_SIZE = 200;
/** Hard limit of `GET /channels/{id}/messages?limit=`. */
export const API_MESSAGE_LIMIT = 100;

export const API_BASE = 'https://discord.com/api/v9';
export const CDN_BASE = 'https://cdn.discordapp.com';
export const MEDIA_BASE = 'https://media.discordapp.net';

/** `chrome.storage.session` keys (memory only, never written to disk). */
export const SESSION_KEYS = {
  /** Authorization header value captured from discord.com page traffic. */
  token: 'dce.token',
  /** Epoch ms of last capture; lets the app know a *new* token arrived. */
  tokenCapturedAt: 'dce.tokenCapturedAt',
} as const;

/** `chrome.storage.local` keys (non-sensitive preferences only — NEVER store the token here). */
export const LOCAL_KEYS = {
  prefs: 'dce.prefs',
} as const;

export const APP_PAGE = 'app.html';
export const DISCORD_APP_URL = 'https://discord.com/app';
export const DISCORD_TAB_URL_PATTERNS = [
  'https://discord.com/*',
  'https://ptb.discord.com/*',
  'https://canary.discord.com/*',
] as const;
