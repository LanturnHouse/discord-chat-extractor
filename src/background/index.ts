// MV3 service worker. All listeners are registered synchronously at the top level (required for the worker to be
// woken for them); the logic lives in token.ts / tabs.ts so it can be unit tested.
import { APP_PAGE } from '@/shared/constants';
import { createAppTabOpener } from './tabs';
import { createTokenCapture, DISCORD_API_URL_PATTERNS } from './token';

const capture = createTokenCapture({ storage: chrome.storage.session, now: Date.now });

// Read-only observation of the page's own API traffic: no 'blocking', the request is never touched.
// 'extraHeaders' is required for Chrome to include headers such as Authorization in `requestHeaders`.
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    void capture.handle(details);
    return undefined;
  },
  { urls: DISCORD_API_URL_PATTERNS, types: ['xmlhttprequest'] },
  ['requestHeaders', 'extraHeaders'],
);

// Keeps the in-memory dedupe honest when the app clears the token after a 401.
chrome.storage.onChanged.addListener((changes, areaName) => capture.onStorageChanged(changes, areaName));

const openAppTab = createAppTabOpener({
  appUrl: chrome.runtime.getURL(APP_PAGE),
  tabs: chrome.tabs,
  windows: chrome.windows,
  runtime: chrome.runtime,
});

chrome.action.onClicked.addListener(() => {
  openAppTab().catch((error: unknown) => {
    console.error('[Discord Chat Extractor] could not open the app tab', error);
  });
});
