// Serves the site from ./public and runs the rooms for playing with friends.
// No dependencies: plain Node, with Server-Sent Events for live updates.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 4000;
const AWAY_MS = 10 * 60000;     // a player who stays disconnected this long is removed
const HOST_AWAY_MS = 30000;     // a disconnected host hands the room to someone else after this
const NEVER_CAME_MS = 60000;    // someone who joined but never connected is removed after this
const IDLE_MS = 3 * 3600000;    // rooms untouched this long are deleted

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const rooms = new Map();

// ---------- activity log: the site's small database ----------
// One JSON object per line in data/events.jsonl. Recent events are also held
// in memory, which is what the admin dashboard reads.
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA, 'events.jsonl');
const BLOCK_FILE = path.join(DATA, 'blocked.json');
const KEEP = 20000;
fs.mkdirSync(DATA, { recursive: true });

let events = [];
try {
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  events = lines.slice(-KEEP).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (lines.length > KEEP) fs.writeFileSync(LOG_FILE, events.map(e => JSON.stringify(e)).join('\n') + '\n');
} catch {}

let blocked = new Set();
try { blocked = new Set(JSON.parse(fs.readFileSync(BLOCK_FILE, 'utf8'))); } catch {}

// The dashboard password. Set ADMIN_KEY on the host; otherwise one is made up
// and saved in data/admin-key.txt.
const ADMIN_KEY = process.env.ADMIN_KEY || (() => {
  const file = path.join(DATA, 'admin-key.txt');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch {}
  const key = crypto.randomBytes(9).toString('base64url');
  fs.writeFileSync(file, key);
  return key;
})();

// Behind a host like Render the visitor's address arrives in X-Forwarded-For.
// That header is only believed there (or when TRUST_PROXY is set), because
// anyone connecting directly could write whatever they like in it.
const TRUST_PROXY = !!(process.env.RENDER || process.env.TRUST_PROXY);
const ipOf = req => ((TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())
  || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const agentOf = req => String(req.headers['user-agent'] || '').slice(0, 160);

function record(type, req, extra) {
  const e = Object.assign({ t: Date.now(), type, ip: ipOf(req), ua: agentOf(req) }, extra);
  events.push(e);
  if (events.length > KEEP) events = events.slice(-KEEP);
  fs.appendFile(LOG_FILE, JSON.stringify(e) + '\n', () => {});
}

// ---------- bot checks ----------
const BOT_AGENT = /bot|crawl|spider|curl|wget|python|headless|scrapy|http-?client|axios|node-fetch|go-http/i;
// Scores no person could get. A score outside these is thrown out.
const PLAUSIBLE = {
  reaction: { min: 110 }, trail: { min: 8 }, stroop: { max: 90 }, span: { max: 20 }, vanish: { max: 25 }
};
const flagged = new Map();  // "ip|reason" -> when, so one visitor is not flagged over and over
const hits = new Map();     // "ip|bucket" -> recent request times

function flag(req, reason, detail) {
  const key = ipOf(req) + '|' + reason;
  if (Date.now() - (flagged.get(key) || 0) < 3600000) return;
  flagged.set(key, Date.now());
  record('flag', req, { reason, detail });
}
function checkAgent(req) {
  const ua = agentOf(req);
  if (!ua || BOT_AGENT.test(ua)) flag(req, 'bot-like browser', ua.slice(0, 80) || 'no browser name sent');
}
// True when this address has gone over `max` requests in the window.
function limited(req, bucket, max, windowMs) {
  const key = ipOf(req) + '|' + bucket, now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (list.length <= max) return false;
  flag(req, 'too many requests', bucket);
  return true;
}
const TOO_MANY = { error: 'Too many requests from this device. Wait a few minutes and try again.' };

// ---------- admin only ----------
// The dashboard is not part of the public site and nothing links to it.
// Opening /admin?key=<ADMIN_KEY> once sets a cookie on that browser; after
// that /admin works there. Everyone else gets the same "Not found" as for any
// page that does not exist, so players cannot tell the route is there.
const ADMIN_PAGE = path.join(__dirname, 'admin', 'dashboard.html');
const ADMIN_TOKEN = crypto.createHash('sha256').update('wits-admin:' + ADMIN_KEY).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function isAdmin(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)wits_admin=([a-f0-9]+)/);
  return !!m && same(m[1], ADMIN_TOKEN);
}
const notFound = res => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };

function adminPage(req, res, url) {
  const key = url.searchParams.get('key');
  if (key != null) {
    if (limited(req, 'admin', 10, 600000) || !same(key, ADMIN_KEY)) {
      flag(req, 'wrong dashboard key', '');
      return notFound(res);
    }
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.writeHead(302, {
      'Set-Cookie': `wits_admin=${ADMIN_TOKEN}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict${secure}`,
      'Location': '/admin', 'Cache-Control': 'no-store'
    });
    return res.end();
  }
  if (!isAdmin(req)) return notFound(res);
  fs.readFile(ADMIN_PAGE, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function stats() {
  const day = t => new Date(t).toISOString().slice(0, 10);
  const days = new Map(), games = new Map(), ips = new Map();
  for (const e of events) {
    const d = day(e.t);
    let x = days.get(d);
    if (!x) days.set(d, x = { day: d, visits: 0, seen: new Set(), rooms: 0, rounds: 0, flags: 0 });
    let v = ips.get(e.ip);
    if (!v) ips.set(e.ip, v = { ip: e.ip, visits: 0, rooms: 0, joins: 0, flags: 0, names: new Set(), last: 0, ua: '' });
    v.last = e.t;
    if (e.ua) v.ua = e.ua;
    if (e.name) v.names.add(e.name);
    if (e.type === 'visit') { x.visits++; x.seen.add(e.ip); v.visits++; }
    if (e.type === 'room') { x.rooms++; v.rooms++; }
    if (e.type === 'join') v.joins++;
    if (e.type === 'round') { x.rounds++; games.set(e.game, (games.get(e.game) || 0) + 1); }
    if (e.type === 'flag') { x.flags++; v.flags++; }
  }
  const live = [...rooms.values()];
  return {
    now: Date.now(),
    live: {
      rooms: live.length,
      players: live.reduce((n, r) => n + [...r.players.values()].filter(p => p.streams.size).length, 0)
    },
    rooms: live.map(r => ({
      code: r.code, state: r.state, game: r.game, round: r.round, since: r.created,
      players: [...r.players.values()].map(p => ({
        name: p.name, ip: p.ip, on: p.streams.size > 0, wins: p.wins, host: p.n === r.host
      }))
    })),
    days: [...days.values()].slice(-14).reverse().map(x => ({
      day: x.day, visits: x.visits, visitors: x.seen.size, rooms: x.rooms, rounds: x.rounds, flags: x.flags
    })),
    games: [...games].map(([game, rounds]) => ({ game, rounds })).sort((a, b) => b.rounds - a.rounds),
    ips: [...ips.values()].sort((a, b) => b.last - a.last).slice(0, 100).map(v => ({
      ip: v.ip, visits: v.visits, rooms: v.rooms, joins: v.joins, flags: v.flags,
      names: [...v.names].slice(0, 6), last: v.last, ua: v.ua, blocked: blocked.has(v.ip)
    })),
    flags: events.filter(e => e.type === 'flag').slice(-50).reverse(),
    recent: events.slice(-80).reverse(),
    blocked: [...blocked]
  };
}

async function admin(req, res, url) {
  if (!isAdmin(req)) return notFound(res);
  if (url.pathname === '/api/admin/stats' && req.method === 'GET') return json(res, 200, stats());
  if (url.pathname === '/api/admin/block' && req.method === 'POST') {
    const body = await readBody(req);
    const ip = String(body.ip || '').slice(0, 64);
    if (!ip) return json(res, 400, { error: 'No address given.' });
    if (body.on) blocked.add(ip); else blocked.delete(ip);
    fs.writeFile(BLOCK_FILE, JSON.stringify([...blocked]), () => {});
    return json(res, 200, { blocked: [...blocked] });
  }
  return json(res, 404, { error: 'Not found.' });
}

// ---------- rooms ----------
function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they read as 1 and 0
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function addPlayer(room, name, req) {
  const p = {
    pid: crypto.randomBytes(12).toString('hex'), // secret, known only to that player
    n: ++room.counter,                            // public number
    name, ip: ipOf(req), wins: 0, streams: new Set(), away: null,
    label: '', pct: null, done: false, dnf: false, score: null, secs: null
  };
  room.players.set(p.pid, p);
  if (!room.host) room.host = p.n;
  // Dropped again if they never actually connect.
  p.away = setTimeout(() => removePlayer(room, p), NEVER_CAME_MS);
  return p;
}

function snapshot(room) {
  return {
    code: room.code, state: room.state, now: Date.now(), host: room.host,
    game: room.game, better: room.better, seed: room.seed, startAt: room.startAt, endsAt: room.endsAt,
    round: room.round, winners: room.winners,
    players: [...room.players.values()].map(p => ({
      n: p.n, name: p.name, wins: p.wins, on: p.streams.size > 0,
      label: p.label, pct: p.pct, done: p.done, dnf: p.dnf, score: p.score, secs: p.secs
    }))
  };
}

function broadcast(room) {
  room.touched = Date.now();
  const data = `data: ${JSON.stringify(snapshot(room))}\n\n`;
  for (const p of room.players.values()) for (const res of p.streams) res.write(data);
}

function removePlayer(room, p) {
  clearTimeout(p.away);
  clearTimeout(p.hostAway);
  for (const res of p.streams) res.end();
  room.players.delete(p.pid);
  if (!room.players.size) {
    clearTimeout(room.deadline);
    rooms.delete(room.code);
    return;
  }
  if (room.host === p.n) room.host = Math.min(...[...room.players.values()].map(x => x.n));
  if (!settle(room)) broadcast(room);
}

// Close the round once every connected player has finished. Returns true if it did.
function settle(room, force) {
  if (room.state !== 'playing') return false;
  const players = [...room.players.values()];
  const active = players.filter(p => p.streams.size > 0);
  if (!force && !(active.length && active.every(p => p.done))) return false;

  clearTimeout(room.deadline);
  players.forEach(p => { if (!p.done) { p.done = true; p.dnf = true; } });
  const fin = players.filter(p => !p.dnf && typeof p.score === 'number')
    // Best score first; on equal scores, whoever played for less time.
    .sort((a, b) => (room.better === 'low' ? a.score - b.score : b.score - a.score) || (a.secs || 0) - (b.secs || 0));
  room.winners = fin.filter(p => p.score === fin[0].score && (p.secs || 0) === (fin[0].secs || 0)).map(p => p.n);
  if (room.winners.length === 1) fin[0].wins++;
  room.state = 'results';
  broadcast(room);
  return true;
}

// ---------- API ----------
function json(res, status, body) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS));
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 4096) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}') || {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 16);

async function api(req, res, url) {
  const m = url.pathname.match(/^\/api\/rooms(?:\/([A-Za-z]{4})(?:\/([a-z]+))?)?$/);
  if (!m) return json(res, 404, { error: 'Not found.' });
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const [, rawCode, action] = m;
  if (blocked.has(ipOf(req))) {
    if (action === 'events') { res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream' }, CORS)); return res.end('event: gone\ndata: {}\n\n'); }
    return json(res, 403, { error: 'This device has been blocked from playing with friends.' });
  }
  if (req.method === 'POST' && limited(req, 'api', 900, 60000)) return json(res, 429, TOO_MANY);

  // Create a room.
  if (!rawCode) {
    if (req.method !== 'POST') return json(res, 405, { error: 'Not allowed.' });
    const name = cleanName((await readBody(req)).name);
    if (!name) return json(res, 400, { error: 'Enter your name first.' });
    if (limited(req, 'create', 6, 600000)) return json(res, 429, TOO_MANY);
    checkAgent(req);
    const room = {
      code: newCode(), state: 'lobby', players: new Map(), counter: 0, host: 0,
      game: '', better: 'high', seed: 0, startAt: 0, endsAt: 0, round: 0, winners: [],
      deadline: null, touched: Date.now(), created: Date.now()
    };
    rooms.set(room.code, room);
    const p = addPlayer(room, name, req);
    record('room', req, { room: room.code, name });
    return json(res, 200, { code: room.code, pid: p.pid, n: p.n });
  }

  const room = rooms.get(rawCode.toUpperCase());

  // Live updates.
  if (action === 'events' && req.method === 'GET') {
    res.writeHead(200, Object.assign({
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
    }, CORS));
    const p = room && room.players.get(url.searchParams.get('pid'));
    if (!p) return res.end('event: gone\ndata: {}\n\n');
    clearTimeout(p.away);
    clearTimeout(p.hostAway);
    p.streams.add(res);
    res.on('close', () => {
      p.streams.delete(res);
      if (!room.players.has(p.pid)) return;
      if (!p.streams.size) {
        // Phones drop the connection whenever the browser goes to the background
        // or the screen locks, so keep their place for a good while.
        clearTimeout(p.away);
        p.away = setTimeout(() => removePlayer(room, p), AWAY_MS);
        // But do not leave the room stuck waiting on a host who is not there.
        clearTimeout(p.hostAway);
        p.hostAway = setTimeout(() => {
          if (p.streams.size || room.host !== p.n || !room.players.has(p.pid)) return;
          const here = [...room.players.values()].filter(x => x.streams.size);
          if (!here.length) return;
          room.host = Math.min(...here.map(x => x.n));
          broadcast(room);
        }, HOST_AWAY_MS);
      }
      if (!settle(room)) broadcast(room);
    });
    return broadcast(room);
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Not allowed.' });
  if (!room) return json(res, 404, { error: 'No room has that code. Check it and try again.' });
  const body = await readBody(req);

  if (action === 'join') {
    const name = cleanName(body.name);
    if (!name) return json(res, 400, { error: 'Enter your name first.' });
    if (room.state === 'playing') return json(res, 409, { error: 'A round is being played. Try again in a minute.' });
    if (room.players.size >= MAX_PLAYERS) return json(res, 409, { error: `That room is full (${MAX_PLAYERS} players).` });
    if (limited(req, 'join', 20, 600000)) return json(res, 429, TOO_MANY);
    checkAgent(req);
    const p = addPlayer(room, name, req);
    record('join', req, { room: room.code, name });
    broadcast(room);
    return json(res, 200, { code: room.code, pid: p.pid, n: p.n });
  }

  const p = room.players.get(body.pid);
  if (!p) return json(res, 403, { error: 'You are not in that room.' });
  const isHost = room.host === p.n;

  if (action === 'start') {
    if (!isHost) return json(res, 403, { error: 'Only the host can start a round.' });
    if (room.state === 'playing') return json(res, 409, { error: 'A round is already being played.' });
    if (room.players.size < 2) return json(res, 409, { error: 'You need at least two players.' });
    const game = String(body.game || '');
    if (!/^[a-z0-9-]{1,24}$/.test(game)) return json(res, 400, { error: 'Unknown game.' });
    const secs = Math.max(10, Math.min(600, Number(body.secs) || 120));
    room.game = game;
    room.better = body.better === 'low' ? 'low' : 'high';
    room.seed = crypto.randomInt(2 ** 32);
    room.round++;
    room.winners = [];
    room.startAt = Date.now() + COUNTDOWN_MS;
    room.state = 'playing';
    for (const x of room.players.values()) { x.label = ''; x.pct = null; x.done = false; x.dnf = false; x.score = null; x.secs = null; }
    clearTimeout(room.deadline);
    room.endsAt = room.startAt + secs * 1000 + 8000;
    room.deadline = setTimeout(() => settle(room, true), room.endsAt - Date.now());
    record('round', req, { room: room.code, game, players: room.players.size });
    broadcast(room);
    return json(res, 200, {});
  }

  if (action === 'progress') {
    if (room.state !== 'playing' || body.round !== room.round || p.done) return json(res, 200, {});
    if (typeof body.label === 'string') p.label = body.label.slice(0, 24);
    if (typeof body.pct === 'number' && isFinite(body.pct)) p.pct = Math.max(0, Math.min(1, body.pct));
    if (body.done) {
      p.done = true;
      p.dnf = !!body.dnf || typeof body.score !== 'number' || !isFinite(body.score);
      p.score = p.dnf ? null : body.score;
      p.secs = typeof body.secs === 'number' && isFinite(body.secs) ? Math.max(0, Math.min(3600, body.secs)) : null;
      // Throw out results no person could get: too good, or sent before the round began.
      const lim = PLAUSIBLE[room.game] || {};
      if (!p.dnf && (p.score < (lim.min != null ? lim.min : -Infinity) || p.score > (lim.max != null ? lim.max : Infinity)
          || Date.now() < room.startAt)) {
        flag(req, 'impossible score', `${room.game}: ${p.score}`);
        p.dnf = true; p.score = null;
      }
      record('finish', req, { room: room.code, game: room.game, name: p.name, score: p.score });
    }
    if (!settle(room)) broadcast(room);
    return json(res, 200, {});
  }

  if (action === 'lobby') {
    if (!isHost) return json(res, 403, { error: 'Only the host can do that.' });
    if (room.state === 'results') { room.state = 'lobby'; broadcast(room); }
    return json(res, 200, {});
  }

  if (action === 'leave') {
    removePlayer(room, p);
    return json(res, 200, {});
  }

  return json(res, 404, { error: 'Not found.' });
}

// ---------- static files ----------
function serveFile(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = '/'; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  if (rel === '/index.html' && req.method === 'GET') { record('visit', req); checkAgent(req); }
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    return (url.pathname.startsWith('/api/admin/') ? admin : api)(req, res, url).catch(() => { if (!res.headersSent) json(res, 500, { error: 'Server error.' }); });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (url.pathname === '/admin') return adminPage(req, res, url);
  serveFile(req, res, url);
}).listen(PORT, () => {
  console.log(`Wits is running on http://localhost:${PORT}`);
  console.log('Dashboard (admin only): ' + (process.env.ADMIN_KEY
    ? `/admin?key=<your ADMIN_KEY>`
    : `http://localhost:${PORT}/admin?key=${ADMIN_KEY}`));
});

// Keep connections alive through proxies, and sweep abandoned rooms.
setInterval(() => {
  for (const room of rooms.values()) {
    let live = 0;
    for (const p of room.players.values()) for (const res of p.streams) { res.write(': ping\n\n'); live++; }
    if (!live && Date.now() - room.touched > IDLE_MS) {
      clearTimeout(room.deadline);
      rooms.delete(room.code);
    }
  }
  const now = Date.now();
  for (const [key, list] of hits) if (now - list[list.length - 1] > 600000) hits.delete(key);
}, 20000);
