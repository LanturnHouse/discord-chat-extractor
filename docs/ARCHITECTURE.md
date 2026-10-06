# Discord Chat Extractor — Architecture & Contracts

Chrome (MV3) extension. The user is already logged in to Discord in Chrome. Clicking the toolbar icon opens a **web app**
(`chrome-extension://<id>/app.html`, a normal browser tab) that looks like Discord (server rail, channel sidebar, chat view)
but is **read-only and export-focused**. The user ticks servers / categories / channels / DMs and presses **Download**
(top-right) to export them as HTML / TXT / Markdown / Excel (.xlsx) / CSV / JSON.

Read `docs/DECISIONS.md` too (product decisions + what is deliberately NOT built).

## Stack
Vite 8 + TypeScript (strict) + React 19 + Zustand 5 + fflate. Vitest 5 (+ jsdom, opt-in per file with `// @vitest-environment jsdom`).
Commands: `npm run typecheck`, `npm test`, `npm run build` (→ `dist/`, loadable via chrome://extensions → "Load unpacked"), `npm run dev` (UI at http://localhost:5173/app.html?mock=1).
Path alias `@/` = `src/`. No other runtime deps without a strong reason (extension bundle stays small, supply-chain surface stays small).
No remote code, no CDN scripts/fonts, no analytics, no network traffic except to Discord hosts — enforced by the extension-page CSP (`default-src 'none'`, `connect-src 'self' https://discord.com`, image/media only from Discord hosts) and checked by `npm run verify`.

## Data flow
```
discord.com tab ──(page's own API calls)──► background service worker (chrome.webRequest.onBeforeSendHeaders, read-only)
                                              └─ stores Authorization value in chrome.storage.session  (memory only)
toolbar click ► background opens/focuses app.html
app.html (extension page, host_permissions ⇒ no CORS) ──fetch + Authorization──► https://discord.com/api/v9/...
```
* Only `getToken()` of the Platform touches the token. The token never goes to: logs, URLs, localStorage, chrome.storage.local, exported files, any non-`discord.com/api` origin.
* Demo mode: `app.html?mock=1` (also when not running inside an extension) uses `MockDiscordClient` — no Discord, no token. Used for development, tests and "try the UI".

## Module map
```
app.html                         entry
public/manifest.json             MV3 manifest. background.js is built from src/background/index.ts
src/shared/constants.ts          UI_PAGE_SIZE=200, API_MESSAGE_LIMIT=100, storage keys
src/background/index.ts          service worker: token capture + action click → open app tab
src/app/platform/                types.ts, chrome.ts, dev.ts, index.ts (getPlatform())
src/app/main.tsx, App.tsx        bootstrap + shell
src/app/state/                   zustand store(s) + data-loading actions
src/app/i18n/                    defineStrings({ ko, en }) + useStrings(table) — each UI area owns its own strings file (type-checked: ko/en keys must match)
src/app/components/rail|sidebar|chat|topbar|message|common   ServerRail, Sidebar (channel tree + DM list), ChatPane/MessageList, TopBar (selection chip, download split button, options, progress dialog), MessageItem & friends, shared primitives (Icons, Checkbox, …); Onboarding.tsx
src/app/state/                   zustand store split per concern (boot, navigation, trees, messages, selection, exportJob) + typed hooks/selectors; UI imports only from '@/app/state'
src/app/styles/                  theme.css (tokens), base.css, layout.css, markdown.css, message.css (plain CSS + custom properties; no CSS-in-JS). markdown.css + message.css are ALSO embedded in HTML exports.
src/lib/discord/types.ts         raw API types (Snowflake = string!)
src/lib/discord/client.ts        DiscordClient interface + DiscordApiError
src/lib/discord/model.ts         GuildNode / ChannelNode / GuildTree / DmNode view models
src/lib/discord/snowflake.ts     BigInt-safe helpers
src/lib/discord/api.ts           LiveDiscordClient (fetch, rate limits, retries, abort)
src/lib/discord/cdn.ts           avatar / guild icon / emoji / sticker URL builders
src/lib/discord/permissions.ts   best-effort channel visibility (roles + overwrites)
src/lib/discord/tree.ts          raw channels → GuildTree, raw DM channels → DmNode[], GuildSummary → GuildNode, toExportTarget
src/lib/discord/pagination.ts    fetchMessagePage (UI paging) — built on client.getMessages
src/lib/discord/mock/            MockDiscordClient + deterministic fixtures
src/lib/markdown/                types.ts, parse.ts, renderReact.tsx, renderHtml.ts, renderText.ts, index.ts
src/lib/message/                 message semantics shared by UI + exports (system message text, attachment kinds, formatting, display names)
src/lib/export/                  types.ts, runner.ts, zip.ts, filename.ts, download.ts, xlsx.ts, formats/*.ts, index.ts
tests/                           vitest specs mirroring src/lib paths
```

## Core contracts (change a signature only together with every consumer of it)
* `DiscordClient` (`src/lib/discord/client.ts`). `getMessages()` returns **raw API order: newest first**, ≤100/page.
* `fetchMessagePage(client, channelId, { before?, size = UI_PAGE_SIZE }, signal?)` → `{ messages: Message[] /* ascending: oldest→newest */, hasMore: boolean }`.
  Chains sequential 100-sized requests (cursor = oldest id so far) until `size` reached or the channel start (a short page) is hit.
* Message order inside the app: **ascending** (oldest at top, like Discord). Prepending older pages keeps scroll position.
* `ExportWriter` / `ExportFormat` / `ExportTarget` / `ExportOptions` (`src/lib/export/types.ts`). `runExport()` drives them.
* Markdown AST (`src/lib/markdown/types.ts`) with 3 renderers (React / HTML string / plain text).

## Behaviour requirements (product)
1. **First paint = metadata only**: `users/@me`, the guild list (name+icon) and the DM list (friend name+avatar) — 3 requests. Per-guild categories+channels are fetched **when a server is first opened (or first selected for export)**, then cached in memory. Messages are NEVER fetched until a channel is opened or exported.
2. **Opening a channel** loads the newest **200** messages (2 sequential API calls of 100); scrolling to the top loads the next **200** older and prepends them **without the viewport jumping**. At channel start show a "this is the beginning of #channel" banner and stop requesting.
3. **Selection** (checkboxes): channel/DM rows, category (tri-state), server (tri-state, triggers channel fetch), "select all DMs" (applies to the filtered list). Selection survives navigation. Clicking a row (not the checkbox) = view it, like Discord.
4. **Download button (top-right)**: split button. Main part starts the export immediately with the current format/options; caret opens a popover (format, date range, HTML theme, language). A cancelled run saves nothing by itself (the dialog offers "save the completed channels"); a 401 mid-run auto-saves what was completed. Progress panel with per-channel status, cancel, and a final summary (failures listed). 1 file ⇒ saved as is; >1 files ⇒ one ZIP with folders `Server/Category/channel.ext` (`Direct Messages/name.ext`).
5. Export scope (`ExportScope` in src/lib/export/types.ts, defaults in `ExportOptions`, per-channel override in `ExportTarget.scope`): by default the **entire** history of each target, oldest→newest via `after` paging, 100/request. Optional date window and message count N (1..100,000, per channel): no dates ⇒ newest N (walk backwards from now, output re-ordered ascending); start date ⇒ first N going forward from it (never beyond the end date); end date only ⇒ newest N up to it. The UI's "N selected" list offers a gear per row to override date window + count for that one channel (format/theme/language stay global).
6. Read-only: no message composer, no profile panel, no pins, no member list, no search, no settings, no voice. A tiny static "connected as <name>" label is allowed (account sanity check), nothing interactive.

## Security rules (non-negotiable; reviewers will check these)
* Message content, usernames, embeds, filenames, channel names, topics are **attacker-controlled**. In React never use `dangerouslySetInnerHTML` for them. HTML export: escape everything, allow only `http:`/`https:` (and `mailto:`) URLs in `href`/`src`, `rel="noopener noreferrer nofollow"`, and ship a restrictive `<meta http-equiv="Content-Security-Policy">` in exported HTML (no scripts; `img-src https: data:` only).
* Embed/thumbnail/video images: use Discord's `proxy_url` when present — do not hot-link arbitrary third-party hosts (privacy). If only `url` exists on a non-Discord host, do not load it automatically (show as a link).
* CSV / spreadsheet cells starting with `= + - @ \t \r` must be neutralised against formula injection (CSV: prefix `'`; XLSX: always inline *string* cells, never formulas).
* File/ZIP entry names: strip path separators, control chars, Windows reserved names (CON, NUL, COM1…), trailing dots/spaces, limit length, dedupe collisions. Never allow `..`.
* The token: see Data flow. `LiveDiscordClient` attaches `Authorization` only to requests whose URL starts with `https://discord.com/api/`.
* Do not mimic or spoof the official client (no fake `X-Super-Properties`, no fake User-Agent). Be a polite client: sequential requests, honour `Retry-After` / `X-RateLimit-*`, exponential back-off, give up gracefully.

## Visual spec (Discord dark theme — replicate closely, but do NOT copy Discord's logo/wordmark/assets; draw your own simple SVG icons)
Tokens: `--bg-primary #313338`, `--bg-secondary #2b2d31` (channel sidebar), `--bg-tertiary #1e1f22` (server rail), `--bg-message-hover #2e3035`, `--text-normal #dbdee1`, `--text-header #f2f3f5`, `--text-muted #949ba4`, `--channel-icon #80848e`, `--interactive-normal #b5bac1`, `--interactive-hover #dbdee1`, `--brand #5865f2`, `--brand-hover #4752c4`, `--link #00a8fc`, `--divider #3f4147`, `--danger #f23f43`, `--bg-modifier-hover rgba(78,80,88,.3)`, `--bg-modifier-selected rgba(78,80,88,.6)`, `--code-bg #2b2d31`, `--embed-bg #2b2d31`.
Font: `"gg sans","Noto Sans","Segoe UI","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif`; code: `Consolas,"Andale Mono WT","Andale Mono","Lucida Console",monospace`.
Metrics: server rail 72px (icons 48px, circle → 16px-radius rounded square on hover/selected, white 4px-wide pill indicator on the left edge: hidden by default, 20px tall on hover, 40px tall when selected), channel sidebar 240px, top bar 48px with 1px bottom shadow, message avatar 40px with 72px left gutter, message text 16px/1.375, username 16px/500, timestamp 12px muted, date divider = centered 12px/600 muted text over a 1px line, category label 12px/600 uppercase muted with chevron, channel row 32px high radius 4px, selected row `--bg-modifier-selected` + white text.
Cozy layout; consecutive messages by the same author within 7 minutes collapse into the first (no repeated avatar/name; timestamp appears on hover in the gutter). Replies: small connector line + mini avatar + `@name` + faded one-line content above the message. System messages: small icon + text line.
Selected-for-export affordance: Discord-style rounded checkbox (brand blue when checked, dash when partial) at the right end of channel / category / DM rows (overlay, so names keep their Discord alignment); visible on hover/focus or when checked. Server rail icons get a top-left checkbox + a bottom-right count badge.

## Quality bar
* `npm run typecheck`, `npm test` and `npm run build` must stay green after every change.
* Every pure module gets unit tests (`tests/…`). Network is always mocked in tests (never hit Discord).
* No `any` unless commented why. No dead code, no TODO placeholders in finished modules. Code comments only where the *why* is non-obvious.
* Accessibility basics: real `<button>`s, `aria-label`s on icon buttons, `role="tree"`-ish semantics not required, but keyboard focusability + visible focus ring are.
