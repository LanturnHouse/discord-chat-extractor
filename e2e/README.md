# Real-browser end-to-end check

`npm run build && npm run e2e` loads the **built extension** (`dist/`) into a real headless Chrome, points `discord.com`
at a local fake Discord server (`fake-discord.mjs`, self-signed TLS, fake token — no real account involved) and checks:

- the MV3 manifest + strict CSP are accepted, the service worker starts
- the token is captured from a Discord-page request (Bearer/Bot values ignored) and never written to `chrome.storage.local`
- the app boots in live mode with metadata-only requests (`users/@me`, guild list, DM list), then loads channels on demand
- opening a channel = exactly 2 requests of 100 → 200 messages; scrolling up loads the older page; beginning banner
- 403 with a Discord code ⇒ locked channel, Cloudflare-style 403 ⇒ retryable error (not locked)
- the export downloads a complete HTML file (full history via `after=` paging), no CSP violations, no exceptions

Requirements: Chrome/Chromium ≥ 116 (`CHROME_PATH` to override the auto-detected path) and OpenSSL (`OPENSSL` to override;
Git for Windows' bundled one is used automatically). Branded Chrome ≥ 137 ignores `--load-extension`, so the build is
installed through the DevTools `Extensions.loadUnpacked` command over a debugging pipe.
Output (screenshots, downloads, throw-away profile) goes to `e2e/.tmp/` (git-ignored).
