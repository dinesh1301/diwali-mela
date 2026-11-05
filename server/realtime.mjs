/*
  The mela's little realtime server: who is where (positions relayed at 10 Hz), waves, shared
  wish lanterns, the leaderboards and the wish wall. JSON over WebSocket, one ROOM per creator
  link: a visitor connects to /ws?room=<creator slug> (no room, or an unknown one: 'public', the
  plain mela) and only ever sees, hears and scores against the people in the same room.

  Positions use compact arrays (see net.js): clients send ['s', x, y, z, r, s, a, hr, v] when they
  change (plus a 1 s keepalive) and each tick's snapshot ['S', online, id, ...8 fields, id, ...]
  carries only the room's visitors who changed, each repeated at least every KEEP_MS so nobody
  goes stale. A ping heartbeat drops dead sockets (well under Cloudflare's 100 s idle cut-off), and
  snapshots skip clients that can't keep up.

  Abuse basics: a per-IP connection cap, per-room and room-count caps, a message size cap, a
  token-bucket rate limit per socket (plus cooldowns on lanterns/bubbles/looks/scores) and
  sanitised names, wishes and looks.

  Each room's scores and wishes persist as <dataDir>/<room>.json (debounced, atomic writes); empty
  rooms are flushed and dropped from memory after a minute.

  This file is shared: the mela-launch service vendors it as src/realtime/realtime.mjs (keep the
  two identical; scripts/sync-game.sh there warns when they drift). Runs inside `vite dev`/
  `vite preview` (attachRealtime), on its own (`node server/realtime.mjs`), or embedded anywhere
  via createRealtime().
*/
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOARDS = { golgappa: 'desc', lap: 'asc', striker: 'desc' };
const MAX_WISHES = 200;
const TICK_MS = 100;
const KEEP_MS = 2000; // resend an unchanged visitor this often (clients drop silent ones after 12 s)
const PING_MS = 25000; // Cloudflare closes a socket idle for 100 s; a ping every 25 s keeps it busy
const MAX_BUFFERED = 64 * 1024; // a client this far behind skips snapshots until it catches up
export const ROOM_RE = /^(?!\.+$)[a-z0-9._-]{1,40}$/; // the service's creator slug
export const PUBLIC_ROOM = 'public';

// per-socket rate limit: a token bucket (10 Hz state + WebRTC candidate bursts fit easily)
const RATE_PER_S = 25;
const RATE_BURST = 60;
const MAX_DROPS = 400; // a socket that keeps flooding past the limit is cut off
// minimum gap between the messages everyone else has to render or store
const COOLDOWN_MS = { lantern: 2000, bubble: 600, score: 400 };
const LOOK_GAP_MS = 800; // look changes are coalesced to one broadcast per gap (the last one always goes out)

export const DEFAULTS = {
  maxRooms: 2000, // rooms held in memory at once (an empty room is dropped after idleRoomMs)
  maxPerRoom: 200,
  maxClients: 6000,
  maxPerIp: 16, // a family or an office behind one NAT, several tabs each
  maxPayload: 32 * 1024, // the biggest honest message is a WebRTC offer (a few KB)
  saveMs: 1500,
  idleRoomMs: 60_000,
};

// control characters become spaces; zero-width and bidi overrides (spoofing) go entirely
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : 0);
const str = (v, n) => (v ? clean(v, n) || 0 : 0);
const cleanHandle = (v) => clean(v, 40).replace(/^@+/, '').replace(/[^\p{L}\p{N}._-]/gu, '');

/** A look is a flat bag of colours and style names (see character.js randomLook); keep it that. */
function cleanLook(look) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(look)) {
    if (n >= 32 || !/^[A-Za-z]{1,20}$/.test(k)) continue;
    if (v === null || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 20);
    else continue;
    n++;
  }
  return out;
}

/** WebRTC signalling is forwarded as-is between two visitors; only keep it a plain small object. */
function cleanSignal(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data;
}

/** The state tuple [x, y, z, r, s, a, hr, v] as the object fields welcome/join messages use. */
function stateObject(st) {
  if (!st) return {};
  return { x: st[0], y: st[1], z: st[2], r: st[3], s: st[4], a: st[5] || null, hr: st[6] || null, v: st[7] || null };
}

function publicPlayer(id, c) {
  return { id, n: c.name, h: c.handle, look: c.look, mic: !!c.mic, ...stateObject(c.state) };
}

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
  if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

const emptyStore = () => ({ boards: { golgappa: [], lap: [], striker: [] }, wishes: [] });

function parseStore(text) {
  const s = JSON.parse(text);
  const boards = emptyStore().boards;
  for (const k of Object.keys(BOARDS)) if (Array.isArray(s?.boards?.[k])) boards[k] = s.boards[k].slice(0, 20);
  return { boards, wishes: Array.isArray(s?.wishes) ? s.wishes.slice(-MAX_WISHES) : [] };
}

/** Turns ?room= into a room name: lower-cased creator slug, else the public mela. */
export function roomName(raw) {
  const r = String(raw ?? '').trim().toLowerCase();
  return ROOM_RE.test(r) ? r : PUBLIC_ROOM;
}

/** The address a socket came from: Cloudflare's header when trusted, else the TCP peer. */
function defaultIpOf(req) {
  return req.socket?.remoteAddress || '?';
}

/**
 * One realtime hub with many rooms.
 *   dataDir     where <room>.json files live (null: memory only)
 *   roomFile    (room) => path, to override the file layout (e.g. a legacy data.json for 'public')
 *   allowRoom   (room) => boolean; a room it refuses falls back to 'public' (e.g. unknown slugs)
 *   ipOf        (req) => client address for the per-IP cap
 */
export function createRealtime(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const roomFile = o.roomFile ?? ((room) => (o.dataDir ? join(o.dataDir, `${room}.json`) : null));
  const allowRoom = o.allowRoom ?? (() => true);
  const ipOf = o.ipOf ?? defaultIpOf;
  const log = o.log ?? ((m) => console.log(`[mela] ${m}`));
  const rooms = new Map(); // name -> room
  const perIp = new Map(); // ip -> open sockets
  let nextId = 1;
  let clientCount = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: o.maxPayload, perMessageDeflate: false, clientTracking: false });

  // ---------- rooms + persistence ----------

  function loadStore(name) {
    const f = roomFile(name);
    if (!f) return emptyStore();
    try {
      return parseStore(readFileSync(f, 'utf8'));
    } catch {
      return emptyStore();
    }
  }

  function saveNow(room) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
    if (!room.unsaved) return;
    room.unsaved = false;
    const f = roomFile(room.name);
    if (!f) return;
    try {
      mkdirSync(dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(room.store));
      renameSync(tmp, f);
    } catch (e) {
      log(`could not save ${f}: ${e.message}`);
    }
  }

  function saveSoon(room) {
    room.unsaved = true;
    if (room.saveTimer) return; // debounced: at most one write per saveMs per room
    room.saveTimer = setTimeout(() => saveNow(room), o.saveMs);
    room.saveTimer.unref?.();
  }

  function dropRoom(room) {
    saveNow(room);
    rooms.delete(room.name);
  }

  /** The room by name, created (and its file read) on first use; null when no slot is free. */
  function getRoom(name) {
    let room = rooms.get(name);
    if (room) return room;
    if (rooms.size >= o.maxRooms) {
      // make space: the room that has been empty longest goes first
      let oldest = null;
      for (const r of rooms.values()) if (!r.clients.size && (!oldest || r.emptySince < oldest.emptySince)) oldest = r;
      if (!oldest) return null;
      dropRoom(oldest);
    }
    room = { name, clients: new Map(), store: loadStore(name), lastN: 0, emptySince: Date.now(), saveTimer: null, unsaved: false };
    rooms.set(name, room);
    return room;
  }

  function broadcast(room, msg, except = null) {
    const s = JSON.stringify(msg);
    for (const [id, c] of room.clients) if (id !== except && c.ws.readyState === 1) c.ws.send(s);
  }

  function recordScore(room, kind, value, name, handle) {
    if (!(kind in BOARDS)) return false;
    const board = room.store.boards[kind];
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
    saveSoon(room);
    return true;
  }

  // ---------- messages ----------

  /** Token bucket; false when this message is over the socket's budget. */
  function allow(c, now) {
    c.tokens = Math.min(RATE_BURST, c.tokens + ((now - c.tokenAt) / 1000) * RATE_PER_S);
    c.tokenAt = now;
    if (c.tokens >= 1) {
      c.tokens -= 1;
      return true;
    }
    if (++c.drops > MAX_DROPS) c.ws.close(1008, 'rate');
    return false;
  }

  function cooled(c, kind, now) {
    const gap = COOLDOWN_MS[kind];
    if (!gap) return true;
    if (now - (c.last[kind] || 0) < gap) return false;
    c.last[kind] = now;
    return true;
  }

  function handleMessage(room, id, c, raw) {
    const now = Date.now();
    if (!allow(c, now)) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    const kind = Array.isArray(m) ? m[0] : m.t;
    if (!cooled(c, kind, now)) return;
    switch (kind) {
      case 'hello':
        if (c.greeted) return; // one hello per socket
        c.greeted = true;
        c.name = clean(m.name, 24) || 'Visitor';
        c.handle = cleanHandle(m.handle);
        c.look = cleanLook(m.look);
        send(c.ws, {
          t: 'welcome',
          id,
          room: room.name,
          players: [...room.clients].filter(([pid]) => pid !== id).map(([pid, pc]) => publicPlayer(pid, pc)),
          boards: room.store.boards,
          wishes: room.store.wishes.slice(-60),
        });
        broadcast(room, { t: 'join', p: publicPlayer(id, c) }, id);
        break;
      case 's':
      case 'state': {
        const st = readState(m);
        if (!sameState(st, c.state)) {
          c.state = st;
          c.dirty = true;
        }
        c.seenAt = now;
        break;
      }
      case 'look': {
        c.look = cleanLook(m.look) ?? c.look;
        c.name = clean(m.name, 24) || c.name;
        c.handle = cleanHandle(m.handle);
        const out = () => {
          c.lookTimer = null;
          c.last.look = Date.now();
          if (room.clients.get(id) === c) broadcast(room, { t: 'look', id, look: c.look, n: c.name, h: c.handle }, id);
        };
        const wait = LOOK_GAP_MS - (now - (c.last.look || 0));
        if (wait <= 0) out();
        else if (!c.lookTimer) c.lookTimer = setTimeout(out, wait);
        break;
      }
      case 'wave': {
        const to = room.clients.get(+m.to);
        if (to && +m.to !== id && cooled(c, `wave${m.to}`, now)) send(to.ws, { t: 'wave', from: id, n: c.name });
        break;
      }
      case 'bubble': {
        const text = clean(m.text, 60);
        if (text) broadcast(room, { t: 'bubble', id, text }, id);
        break;
      }
      case 'lantern': {
        const text = clean(m.text, 60) || 'Happy Diwali!';
        broadcast(room, { t: 'lantern', id, text, x: num(m.x, -400, 400), y: num(m.y, -10, 300), z: num(m.z, -400, 400), dx: num(m.dx, -1, 1), dz: num(m.dz, -1, 1) }, id);
        const w = { name: c.name, handle: c.handle, text, at: now };
        room.store.wishes.push(w);
        if (room.store.wishes.length > MAX_WISHES) room.store.wishes.splice(0, room.store.wishes.length - MAX_WISHES);
        saveSoon(room);
        broadcast(room, { t: 'wish', w });
        break;
      }
      case 'rtc': {
        // WebRTC offers/answers/candidates between two visitors of the same room; only forwarded
        const to = room.clients.get(+m.to);
        const data = cleanSignal(m.data);
        if (to && data && +m.to !== id) send(to.ws, { t: 'rtc', from: id, data });
        break;
      }
      case 'mic':
        c.mic = !!m.on;
        broadcast(room, { t: 'mic', id, on: c.mic }, id);
        break;
      case 'score':
        if (recordScore(room, clean(m.kind, 16), num(m.value, 0, 1e9), c.name, c.handle)) broadcast(room, { t: 'boards', boards: room.store.boards });
        break;
    }
  }

  // ---------- connections ----------

  /** Refuses an upgrade before it becomes a WebSocket (the client sees a failed connect). */
  function refuse(socket, status, text) {
    try {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`);
    } catch {
      // gone already
    }
    socket.destroy();
  }

  /** Handles one HTTP upgrade request (call it from your server's 'upgrade' event). */
  function handleUpgrade(req, socket, head) {
    const url = new URL(req.url || '/', 'http://localhost');
    let name = roomName(url.searchParams.get('room'));
    if (name !== PUBLIC_ROOM && !allowRoom(name)) name = PUBLIC_ROOM;
    const ip = ipOf(req);
    if ((perIp.get(ip) || 0) >= o.maxPerIp) return refuse(socket, 429, 'Too many connections');
    if (clientCount >= o.maxClients) return refuse(socket, 503, 'Mela is full');
    const room = getRoom(name);
    if (!room) return refuse(socket, 503, 'Mela is full');
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    clientCount++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clientCount--;
      const n = (perIp.get(ip) || 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    };
    socket.once('close', release);
    wss.handleUpgrade(req, socket, head, (ws) => {
      if ((rooms.get(name) ?? room).clients.size >= o.maxPerRoom) {
        // the client opened, so it backs off and retries; it gets in once someone leaves
        send(ws, { t: 'full', room: name });
        ws.close(4001, 'room full');
        return;
      }
      // the room may have been evicted (or re-created) while the handshake ran
      let r = rooms.get(name);
      if (!r) rooms.set(name, (r = room));
      admit(r, ws);
    });
  }

  function admit(room, ws) {
    const id = nextId++;
    const now = Date.now();
    const c = { ws, state: null, dirty: false, sentAt: 0, behind: false, name: 'Visitor', handle: '', look: null, mic: false, seenAt: now, alive: true, greeted: false, tokens: RATE_BURST, tokenAt: now, drops: 0, last: {} };
    room.clients.set(id, c);
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (raw) => handleMessage(room, id, c, raw));
    ws.on('close', () => {
      clearTimeout(c.lookTimer);
      if (!room.clients.delete(id)) return;
      if (!room.clients.size) room.emptySince = Date.now();
      broadcast(room, { t: 'leave', id });
    });
    ws.on('error', () => {});
  }

  // ---------- the tick ----------

  function tickRoom(room, now) {
    const { clients } = room;
    const delta = ['S', clients.size];
    let full = null;
    let behind = false;
    for (const [id, c] of clients) {
      if (c.behind) behind = true;
      if (!c.state) continue;
      if (c.dirty || now - c.sentAt >= KEEP_MS) {
        delta.push(id, ...c.state);
        c.dirty = false;
        c.sentAt = now;
      }
    }
    if (delta.length === 2 && clients.size === room.lastN && !behind) return;
    room.lastN = clients.size;
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
        if (!fs) {
          full = ['S', clients.size];
          for (const [id, pc] of clients) if (pc.state) full.push(id, ...pc.state);
          fs = JSON.stringify(full);
        }
        c.ws.send(fs);
      } else c.ws.send(ds);
    }
  }

  const tick = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.clients.size) tickRoom(room, now);
      else if (now - room.emptySince > o.idleRoomMs) dropRoom(room);
    }
  }, TICK_MS);
  tick.unref?.();

  // heartbeat: a socket that misses a pong is gone (sleeping phone, dropped Wi-Fi)
  const beat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const c of room.clients.values()) {
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
    }
  }, o.pingMs ?? PING_MS);
  beat.unref?.();

  /** Answers WebSocket upgrades on `path` of an http server; other upgrades are left alone. */
  function attach(httpServer, path = '/ws', { exclusive = false } = {}) {
    httpServer.on('upgrade', (req, socket, head) => {
      const p = new URL(req.url || '/', 'http://localhost').pathname;
      if (p === path) handleUpgrade(req, socket, head);
      else if (exclusive) refuse(socket, 404, 'Not found');
    });
    return api;
  }

  function stats() {
    let active = 0;
    const top = [];
    for (const r of rooms.values()) {
      if (r.clients.size) active++;
      top.push([r.name, r.clients.size]);
    }
    top.sort((a, b) => b[1] - a[1]);
    return { clients: clientCount, rooms: rooms.size, activeRooms: active, ips: perIp.size, top: top.slice(0, 10) };
  }

  /** Flushes every room's file and closes every socket (shutdown, tests). */
  function close() {
    clearInterval(tick);
    clearInterval(beat);
    for (const room of rooms.values()) {
      saveNow(room);
      for (const c of room.clients.values()) c.ws.terminate();
    }
    rooms.clear();
  }

  const api = { wss, handleUpgrade, attach, stats, close, flush: () => rooms.forEach(saveNow), rooms };
  return api;
}

// ---------- the game repo's own server (vite dev/preview, standalone) ----------

const HERE = dirname(fileURLToPath(import.meta.url));
let devHub = null;
/** The dev hub: the public mela keeps the old server/data.json, creator rooms go to server/rooms/. */
function hub() {
  return (devHub ??= createRealtime({
    roomFile: (room) => (room === PUBLIC_ROOM ? join(HERE, 'data.json') : join(HERE, 'rooms', `${room}.json`)),
  }));
}

/** Shares one http server with Vite (or anything else) and answers WebSocket upgrades on /ws. */
export function attachRealtime(httpServer, path = '/ws') {
  return hub().attach(httpServer, path);
}

export function startStandalone(port = Number(process.env.PORT) || 8787) {
  const h = hub();
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    const s = h.stats();
    res.end(`Topmate Diwali Mela realtime · ${s.clients} online in ${s.activeRooms} rooms`);
  });
  h.attach(server);
  server.listen(port, () => console.log(`[mela] realtime server on ws://localhost:${port}/ws`));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startStandalone();
