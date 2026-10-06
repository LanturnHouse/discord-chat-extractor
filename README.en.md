# Discord Chat Extractor

A Chrome extension that exports the Discord chats of the account you are logged in with (servers, channels, DMs) as HTML, TXT, Markdown, Excel, CSV or JSON files.

[한국어](README.md) | **English**

[![CI](https://github.com/LanturnHouse/discord-chat-extractor/actions/workflows/ci.yml/badge.svg)](https://github.com/LanturnHouse/discord-chat-extractor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](public/manifest.json)
[![Release](https://img.shields.io/github/v/release/LanturnHouse/discord-chat-extractor?include_prereleases)](https://github.com/LanturnHouse/discord-chat-extractor/releases/latest)

![Discord Chat Extractor: server list, channel list and messages. Every server and chat on screen is made-up demo data.](docs/images/en/01-main.png)

> [!WARNING]
> **Read this before you use it.**
>
> - **Risk to your account**: the tool calls the Discord API directly with the token of the account you are logged in with. Discord's Terms of Service and developer policy do not allow automating a user account (so-called "self-bots"), so you may get a warning, lose features, or have your account suspended. Read-only, one-at-a-time requests lower the risk; they do **not remove it.**
> - **Other people's data**: exported files contain other people's messages, names and profile picture links. Whether keeping, sharing or using them is lawful is **your responsibility.**
> - **Unofficial**: a personal project that has nothing to do with Discord. No warranty, no support.
>
> Please read the [Disclaimer](DISCLAIMER.md) and the [Terms of Use](TERMS.md) for the details.

## Features

- **A read-only screen that looks like Discord**: server list, categories and channels, and messages in the Discord dark theme. There is no message box, search or profile on purpose.
- **A light start**: at start-up it only fetches your server list and DM list. A server's channel list is fetched when you first open the server, and messages only when you open a channel.
- **200 at a time**: opening a channel shows the newest 200 messages; scrolling up adds 200 more above.
- **Tick boxes to select**: channels, DMs, categories and whole servers (a tri-state box when only some are selected). Clicking a row views it; the checkbox selects it for export. The selection survives switching servers.
- **The whole history, or a part of it**: by default a channel is exported *completely*. Narrow it with a **date range** (start and end date) and a **number of messages** (1 to 100,000, counted per channel).
  - Only a number, no dates: the **newest N** messages
  - A start date and a number: **N messages from the start date** (never past the end date, if there is one)
  - Only an end date and a number: **the newest N up to the end date**
- **Settings per channel**: in the "N selected" list, press the gear next to a channel to give just that channel its own date range and number. For example the newest 200 for one channel and everything for the rest.
- **6 formats**: HTML (looks like Discord, dark or light), TXT, Markdown, Excel (.xlsx), CSV, JSON. With two or more channels you get one ZIP file with a folder layout.
- **A progress window**: progress per channel, cancel, and a list of skipped channels (no access) and errors. Cancelling does not save anything by itself; the channels that were already finished can be saved by hand.
- **Korean and English**: the screen and the fixed text inside exported files use the same language. By default it follows the browser language.
- **Demo mode**: made-up servers, channels, DMs and thousands of messages let you try the whole interface and the export without a Discord account.

## Quick start

You need Chrome 116 or newer. Install it in one of two ways.

### A. From the release ZIP (recommended)

1. Download `discord-chat-extractor-v<version>.zip` from the [latest release](https://github.com/LanturnHouse/discord-chat-extractor/releases/latest).
2. Unzip it. Do not delete the unzipped folder while you use the extension: Chrome reads its files straight from there.
3. Open `chrome://extensions` in Chrome and turn on **Developer mode** at the top right.
4. Press **Load unpacked** and choose the folder that directly contains `manifest.json`.

### B. Build from source

You need Node.js 22.12 or newer.

```bash
git clone https://github.com/LanturnHouse/discord-chat-extractor.git
cd discord-chat-extractor
npm ci
npm run build
```

Then do steps 3 and 4 of A on `chrome://extensions` and choose the `dist` folder of this repository.

Installing, updating and troubleshooting are covered in more detail in the [usage guide](docs/USAGE.en.md).

## How to use it in 60 seconds

1. Log in to <https://discord.com/app> in the same Chrome.
2. Click the **Discord Chat Extractor** icon in the toolbar; the app opens in a new tab. If it has not found your login yet, press **Reload Discord tabs** on the help screen.
3. Click a server icon on the left (the speech bubble at the top is your DMs), then click a channel to see what is in it.
4. Tick the checkbox of what you want to export. Servers, categories, channels and DMs all work, and the **N selected** chip at the top right lists your selection.

   ![Channels and a DM picked with checkboxes; the chip at the top right says 5 selected](docs/images/en/02-selection.png)

5. Press **Download** at the top right and the export starts right away. Change the format, date range or number of messages with the **▾** next to it.

   ![The export progress window showing the progress of every channel](docs/images/en/05-progress.png)

## Export formats

| Format | Pick it when | Notes |
| --- | --- | --- |
| **HTML** (default) | You want to read it | One file that looks like Discord. Dark or light. It contains no script. |
| **TXT** | You want the simplest text log | Opens anywhere. |
| **Markdown** | You are moving it to Notion, Obsidian or GitHub | Raw HTML in messages and forged headings or quotes are escaped. |
| **Excel (.xlsx)** | You want to sort and filter | Every cell is a text cell, so nothing runs as a formula and the long IDs stay exact. If you will open it in Excel, use this instead of CSV. |
| **CSV** | Data analysis, scripts | UTF-8 with BOM. Excel shows 18 to 19 digit IDs as `1.42E+18`, and saving from Excel can destroy the last digits. |
| **JSON** | Programs, or an archive of the raw data | Messages are exactly the objects the Discord API returned. |

In every format attachments are **not downloaded**, only their links are written down. Discord's attachment links can expire after a while.

## Privacy and security in short

- **The login (token)**: read from the `Authorization` header of the API requests your Discord tab sends. It is only read, and kept only in `chrome.storage.session`, which disappears when you close the browser. It is never written to disk, logs or exported files. Cookies and the content of the Discord page are not read.
- **Network**: requests only go to the `discord.com` API. There is no analytics, remote code or external font, and the extension's Content Security Policy (CSP) enforces that. Pictures are loaded from Discord's image servers.
- **Permissions**: `webRequest` (only looks at the headers of the Discord page's requests; it never blocks or changes them), `storage`, and host access to the Discord addresses (`discord.com`, `ptb.discord.com`, `canary.discord.com`, `discordapp.com`).
- **Untrusted input**: messages, names and embeds are all treated as values that may be forged. The screen is drawn without `dangerouslySetInnerHTML`, exported HTML has no script and a strict CSP, and CSV/Excel are protected against formula injection.
- When you open an exported HTML file later, your browser asks Discord's image servers for the pictures it links to.

More: [Privacy Policy](PRIVACY.md) · [Security Policy](SECURITY.md)

## Known limitations

- **It has not been tested with a real Discord account** (to avoid handling a token). The API layer was checked with mocked-request tests, the interface in demo mode, and the extension itself in a real Chrome talking to a local fake Discord server (`npm run e2e`). The finer behaviour of the real Discord API is based on public documentation and open-source implementations, so it may differ with a real account.
- Attachment files are not downloaded; only their links are written down.
- Because of what a user token can do, threads are limited to the **active posts of forum and media channels (at most 100 per channel)**. Threads under ordinary text or announcement channels are not listed, and archived threads are not supported (demo mode does show threads).
- The number of messages is at most 100,000 per channel. Use "All" if you need everything.
- One export can make a ZIP of about 3.75 GB / 65,535 files. A channel that no longer fits is listed as failed and the rest is saved.
- XLSX is built with a whole channel in memory, so for more than a few hundred thousand messages CSV or JSON is the better choice.
- Server folders and ordering, live updates (new messages appearing by themselves) and role colours are not supported. The screen is a snapshot.
- Below a window width of 900 px the page scrolls sideways; there is no mobile or narrow layout.
- It has only been checked in Chrome (Manifest V3, version 116 or newer).

The decisions made along the way and the features that were left out on purpose are in [docs/DECISIONS.md](docs/DECISIONS.md) (Korean, with an English summary at the top).

## FAQ

<details>
<summary><b>My login (token) is not detected</b></summary>

Chrome needs a tab with Discord open and logged in. On the help screen press **Reload Discord tabs** (or **Open Discord** if no Discord tab is open) and wait until Discord has finished loading. If that does not help, see [Troubleshooting in the usage guide](docs/USAGE.en.md#troubleshooting).
</details>

<details>
<summary><b>Why does a Discord tab have to be open?</b></summary>

A Chrome extension can only see the login of a request at the moment the Discord page sends it. A tab that was already open before you installed the extension has to be reloaded to make it send one again. Once the login has been read it is kept until you close the browser, so after that only the app needs to be open. If Discord invalidates the login (for example when you log out), it has to be read again.
</details>

<details>
<summary><b>Can it export somebody else's account or chats?</b></summary>

No. It can only export the **chats the account you are logged in with can see.** Channels you may not read show a padlock and cannot be selected. Using it on an account that is not yours is a use the [Terms of Use](TERMS.md) ask you not to make.
</details>

<details>
<summary><b>The export takes a long time</b></summary>

The Discord API returns at most 100 messages per request, and to go easy on Discord the requests are sent one after another, so more messages take longer (for example 100,000 messages need at least 1,000 requests). **Do not close or reload the tab** while the progress window is open. If Discord asks the app to wait (a rate limit) it waits by itself; if Discord asks for a wait of more than 60 seconds, it saves the channels that are finished by then and stops.
</details>

<details>
<summary><b>Excel shows my CSV IDs wrongly</b></summary>

Excel reads 18 to 19 digit numbers as numbers, shows them like `1.42E+18`, and saving can destroy the last digits. If you want to use the data in Excel choose the **Excel (.xlsx)** format. If you must open a CSV in Excel, use "Data > From Text/CSV" and set the ID columns to Text.
</details>

<details>
<summary><b>The pictures in the HTML file do not show</b></summary>

Attachments and pictures are not stored in the file; it only holds links to Discord's servers. Those links can expire after a while, so pictures in an old export may stop loading. Download any attachment you want to keep separately.
</details>

<details>
<summary><b>Will my account be banned if I use this?</b></summary>

Nobody knows, and the chance is not zero. The tool only sends read-only, one-at-a-time requests and does not pretend to be the official client, but Discord prohibits automating user accounts, so you can be penalised, and this project does not know the real odds. If it is an account you cannot afford to lose, it is safer not to use it. Read the [Disclaimer](DISCLAIMER.md) and decide for yourself.
</details>

<details>
<summary><b>Does it send my data anywhere?</b></summary>

No. The project has no server, no analytics and no remote code. Data only travels between your browser and Discord, and exported files are saved to your computer by the browser's normal download. The extension page's CSP blocks requests to anything but Discord, and `npm run verify` checks that.
</details>

## Development

```bash
npm ci              # install dependencies (from package-lock.json)
npm run dev         # http://localhost:5173/app.html?mock=1 (demo mode)
npm test            # Vitest (including jsdom component tests)
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + build dist/
npm run verify      # static check that dist/ loads as an extension (including the CSP)
npm run e2e         # load the built extension into a real Chrome and test it against a fake Discord server (e2e/README.md)
npm run pack        # build + check + make discord-chat-extractor-v<version>.zip
npm run licenses    # check and regenerate the third-party license list (THIRD_PARTY_LICENSES.md)
```

Tech stack: Manifest V3 · Vite · TypeScript (strict) · React 19 · Zustand · fflate (4 runtime dependencies). The XLSX writer and the ZIP streaming are written by hand. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the structure and the rules.

```
src/background/   service worker: token capture, icon click -> open the app tab
src/app/          the web app: state (zustand), components (rail, sidebar, chat, topbar, message), i18n, styles, platform
src/lib/discord/  API client, permissions, tree, pagination, demo (mock) client
src/lib/markdown/ Discord markdown parser + React / HTML / text renderers
src/lib/message/  message semantics (system messages, embeds, time, grouping rules ...)
src/lib/export/   runner, ZIP, XLSX, file names, formats (html/txt/md/csv/xlsx/json)
tests/            Vitest tests that mirror the structure of src/
e2e/              real-Chrome end-to-end test and the documentation screenshot script
docs/             usage guide, design decisions (DECISIONS), architecture (ARCHITECTURE), images
```

The screenshots in the docs only contain the fictional data of demo mode and can be remade with `node e2e/screenshots.mjs`.

## Contributing, security, license

- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
- Reporting a security problem: [SECURITY.md](SECURITY.md). **Never post a token or real chats in a public issue.**
- Legal documents: [Terms of Use](TERMS.md) · [Disclaimer](DISCLAIMER.md) · [Privacy Policy](PRIVACY.md)
- License: [MIT](LICENSE). Third-party licenses are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Trademark

Discord is a trademark of Discord Inc. This project is an unofficial tool that has nothing to do with Discord, is not sponsored or approved by Discord, and does not use Discord's logo or assets.
