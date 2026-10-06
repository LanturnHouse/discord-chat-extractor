// A tiny fake "discord.com" (HTTPS, self-signed) used to drive the REAL built extension in a REAL Chrome without touching
// any real account. Records every request so tests can assert what the extension asked for (and with which headers).
import https from 'node:https';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const PAGE_TOKEN = 'e2e-fake-token.FAKEPG.' + 'a'.repeat(30);
const EPOCH = 1420070400000n;
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const snow = (ms, i) => ((BigInt(ms) - EPOCH << 22n) + BigInt(i)).toString();

const ME = { id: '100', username: 'tester', discriminator: '0', global_name: 'Tester', avatar: null };
const FRIEND = { id: '101', username: 'friend', discriminator: '0', global_name: 'Friend', avatar: null };

function makeMessages(channelId, count, author = FRIEND, text = 'message') {
  const msgs = [];
  for (let i = 0; i < count; i++) {
    const ms = NOW - (count - i) * 60_000;
    msgs.push({
      id: snow(ms, i), channel_id: channelId, author, content: `${text} ${i + 1}`, timestamp: new Date(ms).toISOString(),
      edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false, type: 0,
    });
  }
  return msgs; // ascending
}

const channels = {
  '301': makeMessages('301', 250, FRIEND, 'general message'),
  '302': [],
  '400': makeMessages('400', 30, FRIEND, 'dm message'),
};

export const requests = [];

/** OpenSSL for the throw-away TLS certificate: $OPENSSL, Git for Windows' bundled one, or whatever is on PATH. */
function findOpenssl() {
  if (process.env.OPENSSL) return process.env.OPENSSL;
  const gitWindows = 'C:/Program Files/Git/usr/bin/openssl.exe';
  return existsSync(gitWindows) ? gitWindows : 'openssl';
}

export async function start({ port = 8443, dir = 'e2e/.tmp/fake-discord' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(cert)) {
    execFileSync(findOpenssl(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=discord.com', '-addext', 'subjectAltName=DNS:discord.com,DNS:cdn.discordapp.com'], { stdio: 'ignore' });
  }
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const url = new URL(req.url, 'https://discord.com');
    const h = req.headers;
    requests.push({
      t: Date.now(), method: req.method, path: url.pathname + url.search,
      auth: h.authorization ? (h.authorization === PAGE_TOKEN ? 'page-token' : 'other') : null,
      origin: h.origin ?? null, referer: h.referer ?? null, site: h['sec-fetch-site'] ?? null, ua: (h['user-agent'] ?? '').slice(0, 40),
      extraHeaders: Object.keys(h).filter((k) => /^(x-super|x-discord|x-debug|cookie)/.test(k)),
    });
    const json = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'authorization'); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'authorization'); res.setHeader('access-control-allow-methods', 'GET'); return res.end(); }
    const p = url.pathname;
    if (p === '/app' || p === '/channels/@me') {
      res.setHeader('content-type', 'text/html');
      return res.end(`<!doctype html><title>fake discord</title><h1>fake discord web client</h1><script>
        // like the real client: keep talking to the API for a while (the extension's worker may still be starting up)
        let n = 0; const t = setInterval(() => { fetch('/api/v9/users/@me', { headers: { Authorization: '${PAGE_TOKEN}' } }); fetch('/api/v9/oauth2/applications/@me', { headers: { Authorization: 'Bearer ${'z'.repeat(40)}' } }); if (++n >= 20) clearInterval(t); }, 300);
      </script>`);
    }
    if (!p.startsWith('/api/v9/')) { res.statusCode = 404; return res.end('not found'); }
    const rest = p.slice('/api/v9'.length);
    if (rest === '/users/@me') return json(200, ME);
    if (rest === '/users/@me/guilds') return json(200, [{ id: '200', name: 'Fake Guild', icon: null, owner: true, permissions: '8', features: [] }]);
    if (rest === '/users/@me/channels') return json(200, [{ id: '400', type: 1, last_message_id: channels['400'].at(-1).id, recipients: [FRIEND] }]);
    if (rest === '/guilds/200/channels') return json(200, [
      { id: '300', type: 4, name: 'Text Channels', position: 0, guild_id: '200' },
      { id: '301', type: 0, name: 'general', position: 0, parent_id: '300', guild_id: '200', topic: 'The topic' },
      { id: '302', type: 0, name: 'empty-one', position: 1, parent_id: '300', guild_id: '200' },
      { id: '303', type: 0, name: 'no-access', position: 2, parent_id: '300', guild_id: '200' },
      { id: '304', type: 0, name: 'cloudflare-block', position: 3, parent_id: '300', guild_id: '200' },
    ]);
    if (rest === '/guilds/200/roles') return json(200, [{ id: '200', name: '@everyone', permissions: '1049600', position: 0 }]);
    if (rest === '/users/@me/guilds/200/member') return json(200, { roles: [], user: ME });
    const m = rest.match(/^\/channels\/(\d+)\/messages$/);
    if (m) {
      const id = m[1];
      if (id === '303') return json(403, { message: 'Missing Access', code: 50001 });
      if (id === '304') { res.statusCode = 403; res.setHeader('content-type', 'text/html'); return res.end('<html>Attention Required! | Cloudflare</html>'); }
      const all = channels[id];
      if (!all) return json(404, { message: 'Unknown Channel', code: 10003 });
      const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 50));
      const before = url.searchParams.get('before');
      const after = url.searchParams.get('after');
      let list = all.slice();
      if (before) list = list.filter((x) => BigInt(x.id) < BigInt(before));
      if (after) { list = list.filter((x) => BigInt(x.id) > BigInt(after)); list = list.slice(0, limit); } // oldest 'limit' after the cursor
      else list = list.slice(-limit);
      return json(200, list.reverse()); // newest first, like the real API
    }
    return json(404, { message: 'Unknown route ' + rest, code: 0 });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, close: () => new Promise((r) => server.close(r)) };
}
