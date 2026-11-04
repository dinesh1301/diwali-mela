/*
  The mela's little realtime server: who is where (positions relayed at 10 Hz), waves, shared
  wish lanterns, the leaderboards and the wish wall. JSON over WebSocket, one shared room.
  Positions use compact arrays (see net.js): clients send ['s', x, y, z, r, s, a, hr, v] when they
  change (plus a 1 s keepalive) and each tick's snapshot ['S', online, id, ...8 fields, id, ...]
  carries only the visitors who changed, each repeated at least every KEEP_MS so nobody goes stale.
  A ping heartbeat drops dead sockets, and snapshots skip clients that can't keep up.
  Runs inside `vite dev`/`vite preview` (attach) or on its own (`node server/realtime.mjs`).
  Scores and wishes persist in server/data.json.
*/
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data.json');
const BOARDS = { golgappa: 'desc', lap: 'asc', striker: 'desc' };
const MAX_WISHES = 200;
const TICK_MS = 100;
const KEEP_MS = 2000; // resend an unchanged visitor this often (clients drop silent ones after 12 s)
const PING_MS = 15000;
const MAX_BUFFERED = 64 * 1024; // a client this far behind skips snapshots until it catches up
const NO_STATE = null;

const store = loadStore();
const clients = new Map(); // id -> { ws, state, name, handle, seenAt }
let nextId = 1;
let saveTimer = null;

function loadStore() {
  try {
    const s = JSON.parse(readFileSync(DATA, 'utf8'));
    return { boards: { golgappa: [], lap: [], striker: [], ...(s.boards || {}) }, wishes: Array.isArray(s.wishes) ? s.wishes : [] };
  } catch {
    return { boards: { golgappa: [], lap: [], striker: [] }, wishes: [] };
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(HERE, { recursive: true });
      writeFileSync(DATA, JSON.stringify(store));
    } catch (e) {
      console.warn('[mela] could not save data.json:', e.message);
    }
  }, 500);
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : 0);

/** The state tuple [x, y, z, r, s, a, hr, v] as the object fields welcome/join messages use. */
function stateObject(st) {
  if (!st) return {};
  return { x: st[0], y: st[1], z: st[2], r: st[3], s: st[4], a: st[5] || null, hr: st[6] || null, v: st[7] || null };
}

function publicPlayer(id, c) {
  return { id, n: c.name, h: c.handle, look: c.look, mic: !!c.mic, ...stateObject(c.state) };
}

const str = (v, n) => (v ? clean(v, n) || 0 : 0);

/** Validates a state message (compact array or the older object form) into a tuple. */
function readState(m) {
  const a = Array.isArray(m) ? m : ['s', m.x, m.y, m.z, m.r, m.s, m.a, m.hr, m.v];
  return [num(a[1], -400, 400), num(a[2], -10, 300), num(a[3], -400, 400), num(a[4], -10, 10), num(a[5], 0, 60), str(a[6], 16), str(a[7], 8), str(a[8], 8)];
}

const sameState = (a, b) => {
  if (!a || !b) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg, except = null) {
  const s = JSON.stringify(msg);
  for (const [id, c] of clients) if (id !== except && c.ws.readyState === 1) c.ws.send(s);
}

function recordScore(kind, value, name, handle) {
  if (!(kind in BOARDS)) return false;
  const board = store.boards[kind];
  const key = handle || name;
  const prev = board.find((e) => (e.handle || e.name) === key);
  const better = (a, b) => (BOARDS[kind] === 'asc' ? a < b : a > b);
  if (prev) {
    if (!better(value, prev.value)) return false;
    prev.value = value;
    prev.name = name;
    prev.at = Date.now();
  } else {
    board.push({ name, handle, value, at: Date.now() });
  }
  board.sort((a, b) => (BOARDS[kind] === 'asc' ? a.value - b.value : b.value - a.value));
  board.length = Math.min(board.length, 20);
  saveSoon();
  return true;
}

function handleMessage(id, c, raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (!m || typeof m !== 'object') return;
  switch (Array.isArray(m) ? m[0] : m.t) {
    case 'hello':
      c.name = clean(m.name, 24) || 'Visitor';
      c.handle = clean(m.handle, 40).replace(/^@/, '');
      c.look = m.look && typeof m.look === 'object' ? m.look : null;
      send(c.ws, {
        t: 'welcome',
        id,
        players: [...clients].filter(([pid]) => pid !== id).map(([pid, pc]) => publicPlayer(pid, pc)),
        boards: store.boards,
        wishes: store.wishes.slice(-60),
      });
      broadcast({ t: 'join', p: publicPlayer(id, c) }, id);
      break;
    case 's':
    case 'state': {
      const st = readState(m);
      if (!sameState(st, c.state)) {
        c.state = st;
        c.dirty = true;
      }
      c.seenAt = Date.now();
      break;
    }
    case 'look':
      c.look = m.look && typeof m.look === 'object' ? m.look : c.look;
      c.name = clean(m.name, 24) || c.name;
      c.handle = clean(m.handle, 40).replace(/^@/, '');
      broadcast({ t: 'look', id, look: c.look, n: c.name, h: c.handle }, id);
      break;
    case 'wave': {
      const to = clients.get(+m.to);
      if (to) send(to.ws, { t: 'wave', from: id, n: c.name });
      break;
    }
    case 'bubble':
      broadcast({ t: 'bubble', id, text: clean(m.text, 60) }, id);
      break;
    case 'lantern': {
      const text = clean(m.text, 60) || 'Happy Diwali!';
      broadcast({ t: 'lantern', id, text, x: num(m.x, -400, 400), y: num(m.y, -10, 300), z: num(m.z, -400, 400), dx: num(m.dx, -1, 1), dz: num(m.dz, -1, 1) }, id);
      store.wishes.push({ name: c.name, handle: c.handle, text, at: Date.now() });
      if (store.wishes.length > MAX_WISHES) store.wishes.splice(0, store.wishes.length - MAX_WISHES);
      saveSoon();
      broadcast({ t: 'wish', w: store.wishes[store.wishes.length - 1] });
      break;
    }
    case 'rtc': {
      // WebRTC offers/answers/candidates between two visitors; the server only forwards them
      const to = clients.get(+m.to);
      if (to && m.data && typeof m.data === 'object') send(to.ws, { t: 'rtc', from: id, data: m.data });
      break;
    }
    case 'mic':
      c.mic = !!m.on;
      broadcast({ t: 'mic', id, on: c.mic }, id);
      break;
    case 'score':
      if (recordScore(clean(m.kind, 16), num(m.value, 0, 1e9), c.name, c.handle)) broadcast({ t: 'boards', boards: store.boards });
      break;
  }
}

/** Shares one http server with Vite (or anything else) and answers WebSocket upgrades on /ws. */
export function attachRealtime(httpServer, path = '/ws') {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wire(wss);
  return wss;
}

function wire(wss) {
  wss.on('connection', (ws) => {
    const id = nextId++;
    const c = { ws, state: NO_STATE, dirty: false, sentAt: 0, behind: false, name: 'Visitor', handle: '', look: null, seenAt: Date.now(), alive: true };
    clients.set(id, c);
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (raw) => handleMessage(id, c, raw));
    ws.on('close', () => {
      clients.delete(id);
      broadcast({ t: 'leave', id });
    });
    ws.on('error', () => {});
  });
  let lastN = 0;
  setInterval(() => {
    if (!clients.size) return;
    const now = Date.now();
    const delta = ['S', clients.size];
    const full = ['S', clients.size];
    for (const [id, c] of clients) {
      if (!c.state) continue;
      full.push(id, ...c.state);
      if (c.dirty || now - c.sentAt >= KEEP_MS) {
        delta.push(id, ...c.state);
        c.dirty = false;
        c.sentAt = now;
      }
    }
    if (delta.length === 2 && clients.size === lastN && !hasBehind()) return;
    lastN = clients.size;
    const ds = JSON.stringify(delta);
    let fs = null;
    for (const c of clients.values()) {
      if (c.ws.readyState !== 1) continue;
      // a slow phone on a bad network: don't pile more positions onto its socket
      if (c.ws.bufferedAmount > MAX_BUFFERED) {
        c.behind = true;
        continue;
      }
      if (c.behind) {
        // it missed some deltas: catch it up with everyone's current state
        c.behind = false;
        c.ws.send((fs ??= JSON.stringify(full)));
      } else c.ws.send(ds);
    }
  }, TICK_MS);

  // heartbeat: a socket that misses a pong is gone (sleeping phone, dropped Wi-Fi)
  const beat = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        // closing already
      }
    }
  }, PING_MS);
  wss.on('close', () => clearInterval(beat));
}

function hasBehind() {
  for (const c of clients.values()) if (c.behind) return true;
  return false;
}

export function startStandalone(port = Number(process.env.PORT) || 8787) {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end(`Topmate Diwali Mela realtime · ${clients.size} online`);
  });
  attachRealtime(server);
  server.listen(port, () => console.log(`[mela] realtime server on ws://localhost:${port}/ws`));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startStandalone();
