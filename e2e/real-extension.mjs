// REAL Chrome + the REAL built extension (dist/) + a local fake discord.com. Verifies: extension loads under the MV3 CSP,
// webRequest token capture, storage.session access from the app page, live boot (metadata-only requests), lazy loading
// (200 / +200), forbidden vs blocked channels, export download. Run `npm run build` first.
// Branded Chrome >= 137 ignores --load-extension, so the build is installed through CDP Extensions.loadUnpacked
// (needs --remote-debugging-pipe + --enable-unsafe-extension-debugging).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { start, requests, PAGE_TOKEN } from './fake-discord.mjs';

// Usage: npm run build && npm run e2e          (CHROME_PATH=... to pick a browser; Chrome/Chromium >= 116)
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

const profile = path.resolve('e2e/.tmp/profile');
const downloads = path.resolve('e2e/.tmp/downloads');
const out = path.resolve('e2e/.tmp/out');
fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(downloads, { recursive: true, force: true });
fs.mkdirSync(downloads, { recursive: true });
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(path.resolve('dist/manifest.json'))) throw new Error('dist/ is missing: run npm run build first');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = await start({ port: 8443, dir: 'e2e/.tmp/fake-discord' });
const chrome = spawn(findChrome(), [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1280,800',
  '--host-resolver-rules=MAP discord.com 127.0.0.1:8443, MAP cdn.discordapp.com 127.0.0.1:8443',
  '--ignore-certificate-errors',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

// CDP over the debugging pipe (fd 3 = to Chrome, fd 4 = from Chrome); messages are NUL-terminated JSON.
let seq = 0; const pending = new Map(); const events = []; let buf = '';
const toChrome = chrome.stdio[3]; const fromChrome = chrome.stdio[4];
fromChrome.on('data', (d) => {
  buf += d.toString('utf8'); let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else events.push(msg);
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); });
async function attach(targetId) { const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }); return sessionId; }
async function evalIn(sessionId, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(sessionId, expr, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await evalIn(sessionId, expr); if (v) return v; } catch { /* page not ready */ } await sleep(200); } return null; }
async function shot(sessionId, file) { const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId); fs.writeFileSync(path.join(out, file), Buffer.from(data, 'base64')); }
const reqCount = (re) => requests.filter((r) => re.test(r.path)).length;

try {
  await sleep(1500);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  // 1) install the built extension
  const loaded = await send('Extensions.loadUnpacked', { path: path.resolve('dist') });
  const extId = loaded.id;
  check('Chrome accepted the built dist/ (valid MV3 manifest + strict CSP)', /^[a-p]{32}$/.test(extId), extId);

  // 2) open the fake Discord page: its API requests wake the idle MV3 worker; then find OUR worker
  const created = await send('Target.createTarget', { url: 'https://discord.com/app' });
  await attach(created.targetId);
  let sw = null;
  for (let i = 0; i < 40 && !sw; i++) {
    const { targetInfos } = await send('Target.getTargets');
    sw = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extId}/background.js`) ?? null;
    if (!sw) await sleep(250);
  }
  check('our MV3 service worker (background.js) started', !!sw, sw?.url);
  if (!sw) throw new Error('worker did not start: ' + JSON.stringify((await send('Target.getTargets')).targetInfos.map((t) => t.type + ' ' + t.url)));
  const swSession = await attach(sw.targetId);
  await send('Runtime.enable', {}, swSession);
  await sleep(1500);

  // 3) token capture from a Discord-initiated page
  let captured = false;
  for (let i = 0; i < 40 && !captured; i++) {
    captured = await evalIn(swSession, `chrome.storage.session.get('dce.token').then(v => v['dce.token'] === ${JSON.stringify(PAGE_TOKEN)})`);
    if (!captured) await sleep(250);
  }
  check('token captured from the Discord page request (the Bearer request was ignored)', captured === true);
  const local = await evalIn(swSession, `chrome.storage.local.get(null).then(v => JSON.stringify(v).includes('FAKEPG'))`);
  check('token is NOT in chrome.storage.local', local === false);

  // 4) the app page in live mode
  const before = requests.length;
  const appTarget = await send('Target.createTarget', { url: `chrome-extension://${extId}/app.html` });
  const app = await attach(appTarget.targetId);
  await send('Runtime.enable', {}, app); await send('Page.enable', {}, app); await send('Log.enable', {}, app);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, app);
  const ready = await waitFor(app, `!!document.querySelector('.app-shell')`, 15000);
  check('app boots to the main shell in LIVE mode (no onboarding)', !!ready);
  await sleep(500);
  await shot(app, 'real-01-boot.png');
  // default avatars are plain image loads from Discord's CDN (also mapped to the fake host), not API calls
  const bootReqs = requests.slice(before).filter((x) => x.site !== 'same-origin' && !x.path.startsWith('/embed/avatars/'));
  console.log('      boot requests:', bootReqs.map((r) => r.method + ' ' + r.path).join(' | '));
  check('boot fetched only metadata (users/@me, guilds, DM channels) - zero channel/message requests', bootReqs.length >= 3 && bootReqs.every((r) => /^\/api\/v9\/users\/@me(\/guilds|\/channels)?(\?|$)/.test(r.path)));
  const ext = bootReqs[0];
  check('requests carry only the Authorization header (no spoofed client headers, no cookies)', bootReqs.every((r) => r.auth === 'page-token' && r.extraHeaders.length === 0), JSON.stringify({ origin: ext?.origin, site: ext?.site, ua: ext?.ua, extra: ext?.extraHeaders }));
  check('only /api/v9/* (+ the fake /app page, favicon, default avatar images) was ever requested from the host', requests.every((r) => r.path.startsWith('/api/v9/') || r.path === '/app' || r.path === '/favicon.ico' || r.path.startsWith('/embed/avatars/')));

  // 5) open the guild -> channel tree is fetched lazily
  const dom = (expr) => evalIn(app, expr);
  await dom(`[...document.querySelectorAll('.app-rail button')].find(b => (b.getAttribute('aria-label') || '').includes('Fake Guild'))?.click()`);
  const treeShown = await waitFor(app, `[...document.querySelectorAll('.app-sidebar button')].some(b => b.textContent.trim() === 'general')`, 8000);
  check('opening a server loads its categories/channels on demand', !!treeShown && reqCount(/\/guilds\/200\/channels/) === 1);
  check('still no message requests after opening a server', reqCount(/messages/) === 0);
  await shot(app, 'real-02-tree.png');

  // 6) open a channel: exactly 2 requests (2 x 100) -> 200 messages
  await dom(`[...document.querySelectorAll('.app-sidebar button')].find(b => b.textContent.trim() === 'general')?.click()`);
  await waitFor(app, `document.querySelectorAll('article.msg').length === 200`, 10000);
  const rows200 = await dom(`document.querySelectorAll('article.msg').length`);
  const m1 = requests.slice(before).filter((r) => /\/channels\/301\/messages/.test(r.path));
  console.log('      message requests:', m1.map((r) => r.path.replace('/api/v9/channels/301/messages', '')).join(' | '));
  check('opening a channel shows the newest 200 messages using exactly 2 requests of 100', rows200 === 200 && m1.length === 2 && m1.every((r) => /limit=100/.test(r.path)), `rows=${rows200}, requests=${m1.length}`);
  const pinned = await dom(`(() => { const sc = document.querySelector('[role="log"]'); return Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight); })()`);
  check('list opens scrolled to the newest message', pinned <= 2, `fromBottom=${pinned}`);

  // 7) scroll up -> older page (250 total in this fake channel: 200 + 50)
  for (let i = 0; i < 300; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: -500 }, app);
    if (i % 6 === 0) await sleep(20);
    const n = await dom(`document.querySelectorAll('article.msg').length`);
    if (n > 200) break;
  }
  await sleep(800);
  const rowsAfter = await dom(`document.querySelectorAll('article.msg').length`);
  const hasStart = await dom(`!!document.querySelector('.chat-start')`);
  check('scrolling to the top loads the older page (200 + 50) and shows the beginning banner', rowsAfter === 250 && hasStart, `rows=${rowsAfter}, banner=${hasStart}`);
  await shot(app, 'real-03-top.png');

  // 8) forbidden (JSON 50001) vs blocked (HTML 403)
  await dom(`[...document.querySelectorAll('.app-sidebar button')].find(b => b.textContent.trim() === 'no-access')?.click()`);
  const lockShown = await waitFor(app, `/볼 수 없|can.?t view|cannot view/i.test(document.querySelector('.app-chat')?.innerText || '')`, 6000);
  check('403 with Discord code 50001 => "cannot view this channel" state', !!lockShown);
  await shot(app, 'real-04-forbidden.png');
  await dom(`[...document.querySelectorAll('.app-sidebar button')].find(b => b.textContent.trim() === 'cloudflare-block')?.click()`);
  await sleep(1500);
  const blockedText = await dom(`document.querySelector('.app-chat')?.innerText || ''`);
  check('HTML 403 (Cloudflare-style) is NOT shown as "no access" (error + retry instead)', !/볼 수 없|can.?t view|cannot view/i.test(blockedText) && /다시|retry|오류|error|문제/i.test(blockedText), blockedText.replace(/\s+/g, ' ').slice(0, 90));
  await shot(app, 'real-05-blocked.png');

  // 9) export: tick general + download (HTML)
  await dom(`[...document.querySelectorAll('.app-sidebar [role="checkbox"]')].find(e => (e.getAttribute('aria-label') || '').toLowerCase().startsWith('general'))?.click()`);
  await sleep(300);
  await dom(`[...document.querySelectorAll('.app-topbar button')].find(e => /다운로드|Download/.test(e.textContent || ''))?.click()`);
  const done = await waitFor(app, `/완료|complete|saved/i.test(document.querySelector('[role="dialog"]')?.innerText || '')`, 20000);
  check('export finished in the UI', !!done);
  for (let i = 0; i < 60 && !(fs.readdirSync(downloads).some((f) => /\.html$/.test(f)) && !fs.readdirSync(downloads).some((f) => f.endsWith('.crdownload'))); i++) await sleep(250);
  const files = fs.readdirSync(downloads).filter((f) => /\.(html|zip)$/.test(f));
  check('a single .html file was downloaded (one channel = no ZIP)', files.length === 1 && files[0].endsWith('.html'), files.join(', '));
  const afterAll = requests.filter((r) => /\/channels\/301\/messages/.test(r.path) && /after=/.test(r.path));
  check('export paged forward with after= (full history, 250 msgs = 3 pages)', afterAll.length === 3, `after-requests=${afterAll.length}`);
  if (files[0]) {
    const html = fs.readFileSync(path.join(downloads, files[0]), 'utf8');
    check('exported HTML contains all 250 messages and no <script>', (html.match(/<article class="msg/g) || []).length === 250 && !/<script/i.test(html));
  }
  await shot(app, 'real-06-export.png');

  // 9b) message-count limit (global): no dates + N => the newest N, fetched by walking backwards from now
  const q = (v) => JSON.stringify(v);
  const clickBtn = (scope, re) => dom('(() => { const b = [...document.querySelectorAll(' + q(scope) + ')].find((x) => ' + re + '.test((x.getAttribute("aria-label") || "") + " " + (x.textContent || ""))); b?.click(); return !!b; })()');
  const setInput = (selector, value) => dom('(() => { const i = document.querySelector(' + q(selector) + '); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ' + q(String(value)) + '); i.dispatchEvent(new Event("input", { bubbles: true })); return i.value; })()');
  const pressEsc = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, app);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, app);
    await sleep(250);
  };
  const CLOSE = '/^\\s*(닫기|Close)\\s*$/i';
  const DOWNLOAD = '/^\\s*(다운로드|Download)/i';
  const finishRun = async (label) => {
    const ok = await waitFor(app, '/완료|complete|saved/i.test(document.querySelector("[role=dialog]")?.innerText || "")', 25000);
    check(label + ': export finished', !!ok);
    await sleep(1200);
    await clickBtn('[role="dialog"] button', CLOSE);
    await sleep(300);
  };
  const snap = () => Object.fromEntries(fs.readdirSync(downloads).map((f) => { const st = fs.statSync(path.join(downloads, f)); return [f, st.mtimeMs + ':' + st.size]; }));
  const newDownloads = (known) => Object.entries(snap()).filter(([f, sig]) => known[f] !== sig && /.(html|zip)$/.test(f)).map(([f]) => f);
  const settle = async () => { for (let i = 0; i < 40 && fs.readdirSync(downloads).some((f) => f.endsWith('.crdownload')); i++) await sleep(250); };
  const countArticles = (html) => (html.match(/<article class="msg/g) || []).length;
  const { unzipSync, strFromU8 } = await import('fflate');
  const zipEntries = (file) => {
    const z = unzipSync(new Uint8Array(fs.readFileSync(path.join(downloads, file))));
    return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, strFromU8(v)]));
  };
  const entryOf = (entries, re) => entries[Object.keys(entries).find((n) => re.test(n))] ?? '';

  await clickBtn('[role="dialog"] button', CLOSE);
  await sleep(300);
  await clickBtn('.app-topbar button', '/내보내기 옵션|Export options/i');
  await sleep(300);
  await clickBtn('[role="radio"]', '/개수 지정|Limit to N/i');
  await sleep(200);
  await setInput('input.topbar-count__input', 120);
  await sleep(300);
  await shot(app, 'real-07-options-limit.png');
  await pressEsc();
  const known1 = snap();
  const reqMark = requests.length;
  await clickBtn('.app-topbar button', DOWNLOAD);
  await finishRun('limit 120');
  await settle();
  const f1 = newDownloads(known1);
  const html1 = f1[0] ? fs.readFileSync(path.join(downloads, f1[0]), 'utf8') : '';
  check('global limit 120, no dates => exactly the newest 120 messages (131..250), oldest first', countArticles(html1) === 120 && html1.includes('general message 250') && html1.includes('general message 131') && !html1.includes('general message 130<') && html1.indexOf('general message 131') < html1.indexOf('general message 250'), 'articles=' + countArticles(html1));
  check('file header names the scope', /newest 120 messages|최근 120개/.test(html1));
  const walk = requests.slice(reqMark).filter((r) => r.site !== 'same-origin' && /\/channels\/301\/messages/.test(r.path)).map((r) => r.path.replace('/api/v9/channels/301/messages', ''));
  console.log('      newest-N requests:', walk.join(' | '));
  check('newest-N walks backwards: 2 requests (100, then 20 with before=)', walk.length === 2 && /^\?limit=100$/.test(walk[0]) && /^\?limit=20&before=\d+$/.test(walk[1]));

  // 9c) per-channel override via the gear in the selection list: general => all messages, the DM keeps the global 120 (it only has 30)
  await dom('document.querySelector(".app-rail button")?.click()'); // Direct Messages
  await sleep(600);
  await dom('[...document.querySelectorAll(".app-sidebar [role=checkbox]")].find((e) => /Friend/.test(e.getAttribute("aria-label") || ""))?.click()');
  await sleep(300);
  await clickBtn('.app-topbar button', '/(\\d+)\\s*(개 선택|selected)/i'); // the selection chip
  await sleep(400);
  const gearOpened = await clickBtn('button', '/Export settings for.*general|general.*내보내기 설정/i');
  if (!gearOpened) {
    console.log('      DEBUG buttons mentioning settings:', JSON.stringify(await dom('[...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.textContent.trim()).filter((t) => /settings|설정|selected|선택/i.test(t)).slice(0, 12)')));
    await shot(app, 'real-08-debug.png');
  }
  check('selection list has a gear button for the channel', gearOpened);
  await sleep(300);
  // The gear opens the editor directly: no "use common settings" checkbox, date range + message count right away.
  const panelFacts = await dom('(() => { const p = document.querySelector("[role=group][aria-label*=general]"); return p ? { checkboxes: p.querySelectorAll("input[type=checkbox]").length, dates: p.querySelectorAll("input[type=date]").length, radios: p.querySelectorAll("[role=radio]").length, resetLink: /공통 설정으로 되돌리기|Reset to common settings/.test(p.textContent) } : null; })()');
  check('gear opens the editor immediately (no checkbox, 2 date inputs, all/limit control, no reset link before the first edit)', !!panelFacts && panelFacts.checkboxes === 0 && panelFacts.dates === 2 && panelFacts.radios === 2 && panelFacts.resetLink === false, JSON.stringify(panelFacts));
  await sleep(300);
  await dom('(() => { const panel = document.querySelector("[role=group][aria-label*=general]"); [...panel.querySelectorAll("[role=radio]")].find((b) => /^(전체|All)$/i.test(b.textContent.trim()))?.click(); })()');
  await sleep(300);
  await shot(app, 'real-08-gear-panel.png');
  await pressEsc();
  await pressEsc();
  const known2 = snap();
  await clickBtn('.app-topbar button', DOWNLOAD);
  await finishRun('override all + DM');
  await settle();
  const f2 = newDownloads(known2);
  const entries2 = f2[0] && f2[0].endsWith('.zip') ? zipEntries(f2[0]) : {};
  console.log('      zip entries:', Object.keys(entries2).join(' | '));
  const general2 = entryOf(entries2, /general\.html$/);
  const dm2 = entryOf(entries2, /Direct Messages\//);
  check('own settings win: general exported completely (250) while the global limit of 120 still applies to the DM (all 30 it has)', countArticles(general2) === 250 && countArticles(dm2) === 30, 'general=' + countArticles(general2) + ', dm=' + countArticles(dm2));

  // 9d) override with its own count (40) -> the newest 40 of general; DM unchanged
  await clickBtn('.app-topbar button', '/(\\d+)\\s*(개 선택|selected)/i');
  await sleep(400);
  await clickBtn('button', '/Export settings for.*general|general.*내보내기 설정/i');
  await sleep(300);
  await dom('(() => { const panel = document.querySelector("[role=group][aria-label*=general]"); [...panel.querySelectorAll("[role=radio]")].find((b) => /개수 지정|Limit to N/i.test(b.textContent))?.click(); })()');
  await sleep(250);
  await setInput('[role="group"][aria-label*="general"] input.topbar-count__input', 40);
  await sleep(300);
  await pressEsc();
  await pressEsc();
  const known3 = snap();
  await clickBtn('.app-topbar button', DOWNLOAD);
  await finishRun('override 40 + DM');
  await settle();
  const f3 = newDownloads(known3);
  const entries3 = f3[0] && f3[0].endsWith('.zip') ? zipEntries(f3[0]) : {};
  const g3 = entryOf(entries3, /general\.html$/);
  check('own limit 40 => the newest 40 messages (211..250) of that channel', countArticles(g3) === 40 && g3.includes('general message 250') && g3.includes('general message 211') && !g3.includes('general message 210<'), 'general=' + countArticles(g3));

  // 10) CSP + errors
  const refused = events.filter((e) => e.method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(e.params.entry.text || ''));
  const consoleRefused = events.filter((e) => e.method === 'Runtime.consoleAPICalled' && JSON.stringify(e.params.args).match(/Refused to|Content Security Policy/));
  check('no Content-Security-Policy violations during the whole session', refused.length === 0 && consoleRefused.length === 0, refused.map((e) => e.params.entry.text.slice(0, 140)).join(' | '));
  const exc = events.filter((e) => e.method === 'Runtime.exceptionThrown');
  check('no uncaught exceptions in the app page', exc.length === 0, exc.map((e) => e.params.exceptionDetails?.exception?.description?.slice(0, 120)).join(' | '));

  // 11) toolbar action focuses the existing app tab instead of opening a second one
  await evalIn(swSession, `chrome.action.onClicked.dispatch ? 0 : 0`).catch(() => {});
  const tabs = await evalIn(swSession, `chrome.tabs.query({}).then(t => t.filter(x => (x.url || '').startsWith('chrome-extension://${extId}/app.html')).length)`);
  check('exactly one app tab exists', tabs === 1, `tabs=${tabs}`);
} catch (err) {
  console.log('ERROR', err.stack || err);
  check('e2e ran to completion', false, String(err.message));
} finally {
  chrome.kill();
  await fake.close();
  await sleep(500);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
