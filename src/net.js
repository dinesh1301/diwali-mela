import * as THREE from 'three';
import { Character, randomLook } from './character.js';
import { NameTag } from './nametag.js';
import { profile } from './profile.js';
import { settings } from './settings.js';
import { track, trackIds } from './track.js';

/*
  Multiplayer client. Sends where our avatar is (world position of the character root, heading,
  pose, speed, what it holds) at up to 10 Hz, only when it changed plus a 1 s keepalive, and
  mirrors everyone else with the same Character rig. Positions travel as compact arrays: we send
  ['s', x, y, z, heading, speed, action, held, vehicle] and the server's snapshot is
  ['S', online, id, x, y, z, heading, speed, action, held, vehicle, id, ...] holding only the
  visitors who moved (and each one at least every 2 s).
  Also carries waves, shared wish lanterns, scores for the leaderboards and the wish wall.
  Without a server it degrades to a local-only mode (own bests and wishes kept in the browser).
*/
const SEND_MS = 100;
const KEEPALIVE_MS = 1000;
const SNAP_STRIDE = 9; // id + 8 state fields per visitor in an 'S' snapshot
const STALE_MS = 12000;
const LOCAL_KEY = 'melaLocalBoards';
const BOARD_ORDER = { golgappa: 'desc', lap: 'asc', striker: 'desc' };
const _v = new THREE.Vector3();
// only the nearest few visitors are drawn (and posed): within 70 m, 8 on phones, 16 elsewhere
const SHOW_R2 = 70 * 70;
const CULL_S = 0.25;

const ENV = import.meta.env ?? {};
// Same-origin attempts that never open before we give up (a static host has no socket to retry).
const SAME_ORIGIN_TRIES = 3;

const ROOM_RE = /^(?!\.+$)[a-z0-9._-]{1,40}$/;

/**
 * The creator room this page belongs to, or '' for the plain mela. Everyone on the same creator
 * link (mela.topmate.io/<slug>, or ?c=<slug>) meets in that creator's room and only there; the
 * plain mela is single-player (it never opens a socket). Same lookup order as creatorStage.js
 * (?c=, window.__MELA_CREATOR__, <meta name="mela-creator">).
 */
export function creatorRoom(params = new URLSearchParams(location.search)) {
  let slug = params.get('c') || '';
  if (!slug && typeof window.__MELA_CREATOR__ === 'string') slug = window.__MELA_CREATOR__;
  if (!slug) slug = document.querySelector('meta[name="mela-creator"]')?.getAttribute('content') || '';
  slug = slug.trim().toLowerCase();
  return slug !== 'public' && ROOM_RE.test(slug) ? slug : '';
}

/** The analytics label for this page: the creator room, or 'public' for the plain (offline) mela. */
export function melaRoom(params = new URLSearchParams(location.search)) {
  return creatorRoom(params) || 'public';
}

/**
 * VITE_WS_URL names a realtime server; a static build (VITE_STATIC=1) without one stays offline,
 * and so does every page that is not a creator's mela.
 */
function defaultUrl() {
  if (ENV.VITE_STATIC && !ENV.VITE_WS_URL) return null;
  const room = creatorRoom();
  if (!room) return null;
  const base = ENV.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const u = new URL(base, location.href);
  u.searchParams.set('room', room);
  const ids = trackIds(); // analytics: realtime rows carry the tracker's visitor + session
  if (ids?.vid) u.searchParams.set('vid', ids.vid);
  if (ids) u.searchParams.set('sid', ids.sid);
  return u.href;
}

/** Director / trailer capture never joins a room: no remote visitors in shots, nothing random. */
function offlinePage() {
  const p = new URLSearchParams(location.search);
  return p.has('director') || p.has('nonet') || typeof window.__director !== 'undefined';
}

export class Net {
  constructor(ctx, { url = defaultUrl() } = {}) {
    this.ctx = ctx;
    this.url = url;
    this.room = url ? new URL(url).searchParams.get('room') || '' : ''; // the creator room we join
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.online = 1;
    this.remote = new Map();
    this.boards = this.loadLocalBoards();
    this.wishes = [];
    this.listeners = {};
    this.lastSend = 0;
    this.lastState = [];
    this.lastSent = 0;
    this.retry = 1000;
    this.failures = 0; // consecutive attempts that never opened
    this.everOpened = false; // a server that answered once is only restarting: keep retrying it
    this.enabled = !!url;
    this.voice = null; // set by Voice
    this.tmpQ = new THREE.Quaternion();
    this.tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

    const { interactions, player } = ctx;
    interactions.add({
      pos: (o) => {
        const r = this.nearest();
        return r ? o.copy(r.cur) : o.set(1e9, 0, 1e9);
      },
      radius: 2.6,
      markerHeight: 2.4,
      label: () => {
        const r = this.nearest();
        return r ? `Wave to ${r.name} 👋` : '';
      },
      enabled: () => player.mode === 'walk' && this.remote.size > 0,
      action: () => {
        const r = this.nearest();
        if (r) this.wave(r);
      },
    });
  }

  on(evt, fn) {
    (this.listeners[evt] ??= []).push(fn);
  }

  emit(evt, ...args) {
    for (const fn of this.listeners[evt] ?? []) fn(...args);
  }

  // ---------- connection ----------

  connect() {
    if (!this.enabled || this.ws || offlinePage()) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 1000;
      this.failures = 0;
      this.everOpened = true;
      this.lastState = [];
      this.send({ t: 'hello', name: profile.name, handle: profile.handle, look: this.ctx.player.char.look });
      this.emit('status', true);
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = () => {
      const opened = this.connected;
      this.connected = false;
      this.ws = null;
      this.id = null;
      for (const id of [...this.remote.keys()]) this.removeRemote(id);
      this.online = 1;
      this.emit('status', false);
      // no server here at all (it never answered): stay local instead of retrying forever
      if (!opened && ++this.failures >= SAME_ORIGIN_TRIES && !this.everOpened && !ENV.VITE_WS_URL) return;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(15000, this.retry * 1.7);
    };
    ws.onerror = () => {};
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  // ---------- outgoing ----------

  /** Sends our state when it changed since the last send, or as a keepalive. */
  sendState(now) {
    const { player } = this.ctx;
    const root = player.char.root;
    root.getWorldPosition(_v);
    root.getWorldQuaternion(this.tmpQ);
    this.tmpE.setFromQuaternion(this.tmpQ);
    const st = [
      's',
      +_v.x.toFixed(2),
      +_v.y.toFixed(2),
      +_v.z.toFixed(2),
      +this.tmpE.y.toFixed(2),
      +player.speed.toFixed(1),
      player.char.action || 0,
      player.char.holdR || 0,
      player.mode === 'ride' ? 'ride' : 0,
    ];
    const last = this.lastState;
    let same = last.length === st.length;
    for (let i = 1; same && i < st.length; i++) same = st[i] === last[i];
    if (same && now - this.lastSent < KEEPALIVE_MS) return;
    this.lastState = st;
    this.lastSent = now;
    this.send(st);
  }

  sendLook() {
    this.send({ t: 'look', look: this.ctx.player.char.look, name: profile.name, handle: profile.handle });
  }

  sendLantern(text, pos, dir) {
    this.send({ t: 'lantern', text, x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dz: dir.z });
    if (!this.connected) this.addWish({ name: profile.name, handle: profile.handle, text, at: Date.now() });
  }

  sendBubble(text, kind = 'bubble') {
    this.send({ t: 'bubble', text });
    track('chat_sent', { kind, len: String(text).length, connected: this.connected, online: this.online }); // the text itself is stored by the realtime server
  }

  submitScore(kind, value) {
    this.recordLocal(kind, value);
    this.send({ t: 'score', kind, value });
  }

  wave(r) {
    const { player, ui, tasks } = this.ctx;
    player.char.setAction('wave');
    ui.bubble((o) => player.headWorld(o), `Hi ${r.name}! 👋`, 1.8);
    this.send({ t: 'wave', to: r.id });
    track('wave', { dir: 'out', to: r.name, online: this.online });
    this.sendBubble(`Hi ${r.name}! 👋`, 'wave');
    tasks.wait(1.6).then(() => player.char.action === 'wave' && player.char.clearAction());
  }

  // ---------- incoming ----------

  /** Moves (or creates) a remote visitor from a snapshot entry. */
  applyState(id, x, y, z, heading, speed, action, holdR, now) {
    if (!Number.isFinite(x)) return;
    const r = this.remote.get(id) ?? this.addRemote({ id, n: 'Visitor', h: '' });
    r.target.set(x, y, z);
    r.heading = heading ?? r.heading;
    r.action = action;
    r.speed = speed ?? 0;
    r.holdR = holdR;
    r.seenAt = now;
    if (!r.ready) {
      r.cur.copy(r.target);
      r.ready = true;
    }
  }

  handle(m) {
    const { ui, lanterns } = this.ctx;
    switch (Array.isArray(m) ? m[0] : m.t) {
      case 'welcome':
        // a hub that put us anywhere but our creator's room (an old server's 'public' fallback):
        // leave and play alone rather than mix with other creators' visitors
        if (m.room && this.room && m.room !== this.room) {
          this.enabled = false;
          this.ws?.close(4003, 'wrong room');
          break;
        }
        this.id = m.id;
        for (const p of m.players) this.addRemote(p);
        for (const p of m.players) this.voice?.peerJoined(p.id, !!p.mic);
        this.boards = this.mergeBoards(m.boards);
        this.wishes = m.wishes || [];
        this.online = (m.players?.length ?? 0) + 1;
        this.emit('boards');
        this.emit('wishes');
        this.emit('online', this.online);
        break;
      case 'join':
        this.addRemote(m.p);
        this.voice?.peerJoined(m.p.id, !!m.p.mic);
        ui.toast(`👋 ${m.p.n} joined the mela`, 2500);
        break;
      case 'leave':
        this.removeRemote(m.id);
        break;
      case 'S': {
        // compact snapshot: ['S', online, id, x, y, z, r, s, a, hr, v, id, ...]
        this.online = m[1];
        const now = performance.now();
        for (let i = 2; i + SNAP_STRIDE <= m.length; i += SNAP_STRIDE) {
          const id = m[i];
          if (id === this.id) continue;
          this.applyState(id, m[i + 1], m[i + 2], m[i + 3], m[i + 4], m[i + 5], m[i + 6] || null, m[i + 7] || null, now);
        }
        this.emit('online', this.online);
        break;
      }
      case 'snap':
        // the older object snapshot (kept so a client and server from different deploys still talk)
        this.online = m.n;
        for (const p of m.players) {
          if (p.id === this.id || p.x === undefined) continue;
          const r = this.remote.get(p.id) ?? this.addRemote({ ...p, n: 'Visitor', h: '' });
          r.target.set(p.x, p.y, p.z);
          r.heading = p.r ?? r.heading;
          r.action = p.a ?? null;
          r.speed = p.s ?? 0;
          r.holdR = p.hr ?? null;
          r.seenAt = performance.now();
          if (!r.ready) {
            r.cur.copy(r.target);
            r.ready = true;
          }
        }
        this.emit('online', this.online);
        break;
      case 'look': {
        const r = this.remote.get(m.id);
        if (!r) break;
        if (m.look) r.char.setLook(m.look);
        r.name = m.n || r.name;
        r.tag.set({ name: r.name, handle: m.h || '' });
        break;
      }
      case 'wave': {
        const r = this.remote.get(m.from);
        ui.toast(`👋 ${m.n} waved at you`, 2500, { important: true });
        track('wave', { dir: 'in', from: m.n });
        const { player, tasks } = this.ctx;
        if (player.mode === 'walk') {
          player.char.setAction('wave');
          tasks.wait(1.6).then(() => player.char.action === 'wave' && player.char.clearAction());
        }
        if (r) ui.bubble((o) => r.char.headTop.getWorldPosition(o), '👋', 1.5);
        break;
      }
      case 'bubble': {
        const r = this.remote.get(m.id);
        if (r) ui.bubble((o) => r.char.headTop.getWorldPosition(o), m.text, 2.5);
        break;
      }
      case 'lantern':
        lanterns.releaseAt?.(m.x, m.y, m.z, m.dx, m.dz, m.text);
        break;
      case 'wish':
        this.addWish(m.w);
        break;
      case 'boards':
        this.boards = this.mergeBoards(m.boards);
        this.emit('boards');
        break;
      case 'rtc':
        this.voice?.onSignal(m.from, m.data);
        break;
      case 'mic': {
        const r = this.remote.get(m.id);
        if (r) r.mic = m.on;
        if (m.on) this.voice?.peerJoined(m.id, true);
        else r?.tag.setSpeaking(false);
        break;
      }
    }
  }

  addRemote(p) {
    const have = this.remote.get(p.id);
    if (have) {
      // a snapshot can arrive before the join: fill in the name and look when they come
      if (p.n && have.name !== p.n) {
        have.name = p.n;
        have.tag.set({ name: p.n, handle: p.h || '' });
      }
      if (p.look) have.char.setLook(p.look);
      return have;
    }
    const char = new Character(p.look || randomLook());
    char.root.visible = false;
    this.ctx.scene.add(char.root);
    const tag = new NameTag(char.headTop, { name: p.n || 'Visitor', handle: p.h || '' });
    const r = { id: p.id, char, tag, name: p.n || 'Visitor', cur: new THREE.Vector3(), target: new THREE.Vector3(), heading: 0, action: null, speed: 0, holdR: null, ready: false, seenAt: performance.now() };
    if (p.x !== undefined) {
      r.target.set(p.x, p.y, p.z);
      r.cur.copy(r.target);
      // pose too: a visitor standing still is only resent every couple of seconds now
      r.heading = p.r ?? 0;
      r.char.root.rotation.y = r.heading;
      r.action = p.a ?? null;
      r.speed = p.s ?? 0;
      r.holdR = p.hr ?? null;
      r.ready = true;
    }
    this.remote.set(p.id, r);
    this.cullT = 0;
    return r;
  }

  removeRemote(id) {
    const r = this.remote.get(id);
    if (!r) return;
    this.voice?.dropPeer(id);
    this.remote.delete(id);
    // free the visitor's meshes and name label: people come and go all evening
    r.boat?.removeFromParent();
    r.tag.dispose();
    r.char.dispose();
  }

  nearest() {
    const p = this.ctx.player.pos;
    let best = null;
    let bd = Infinity;
    for (const r of this.remote.values()) {
      if (!r.ready || !r.shown) continue; // never wave at someone the culling hides
      const d = Math.hypot(r.cur.x - p.x, r.cur.z - p.z);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  // ---------- boards & wishes ----------

  loadLocalBoards() {
    try {
      const b = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if (b && typeof b === 'object') return { golgappa: [], lap: [], striker: [], ...b };
    } catch {
      // ignore
    }
    return { golgappa: [], lap: [], striker: [] };
  }

  recordLocal(kind, value) {
    if (!(kind in BOARD_ORDER)) return;
    const name = profile.name || 'You';
    const handle = profile.handle;
    const board = (this.boards[kind] ??= []);
    const me = board.find((e) => e.local);
    const better = (a, b) => (BOARD_ORDER[kind] === 'asc' ? a < b : a > b);
    if (me) {
      if (better(value, me.value)) me.value = value;
    } else board.push({ name, handle, value, local: true });
    board.sort((a, b) => (BOARD_ORDER[kind] === 'asc' ? a.value - b.value : b.value - a.value));
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(Object.fromEntries(Object.entries(this.boards).map(([k, v]) => [k, v.filter((e) => e.local)]))));
    } catch {
      // ignore
    }
    this.emit('boards');
  }

  /** Server boards win, but our own local best stays visible until the server has it. */
  mergeBoards(server) {
    const out = {};
    for (const kind of Object.keys(BOARD_ORDER)) {
      const list = [...(server?.[kind] ?? [])];
      const mine = (this.boards[kind] ?? []).find((e) => e.local);
      const key = profile.handle || profile.name;
      if (mine && !list.some((e) => (e.handle || e.name) === key)) list.push(mine);
      list.sort((a, b) => (BOARD_ORDER[kind] === 'asc' ? a.value - b.value : b.value - a.value));
      out[kind] = list.slice(0, 20);
    }
    return out;
  }

  addWish(w) {
    if (!w) return;
    this.wishes.push(w);
    if (this.wishes.length > 60) this.wishes.shift();
    this.emit('wishes');
  }

  // ---------- per frame ----------

  /** Marks the nearest K ready visitors within 70 m as shown. */
  cullRemote() {
    const p = this.ctx.player.pos;
    const near = (this._near ??= []);
    near.length = 0;
    for (const r of this.remote.values()) {
      r.shown = false;
      if (!r.ready) continue;
      r.d2 = (r.cur.x - p.x) ** 2 + (r.cur.z - p.z) ** 2;
      if (r.d2 < SHOW_R2) near.push(r);
    }
    near.sort((a, b) => a.d2 - b.d2);
    const k = Math.min(near.length, settings.tier === 'low' ? 8 : 16);
    for (let i = 0; i < k; i++) near[i].shown = true;
  }

  update(dt, now) {
    if (this.connected && now - this.lastSend > SEND_MS) {
      this.lastSend = now;
      this.sendState(now);
    }
    this.cullT = (this.cullT ?? 0) - dt;
    if (this.cullT <= 0) {
      this.cullT = CULL_S;
      this.cullRemote();
    }
    for (const [id, r] of this.remote) {
      if (now - r.seenAt > STALE_MS) {
        this.removeRemote(id);
        continue;
      }
      if (!r.ready) continue;
      const k = 1 - Math.exp(-dt * 12);
      r.cur.lerp(r.target, k);
      const root = r.char.root;
      root.position.copy(r.cur);
      let d = r.heading - root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      root.rotation.y += d * k;
      root.visible = !!r.shown;
      // a visitor at the oars is sent as a rower on the seat: draw a boat under them
      const rowing = r.action === 'row' && !!this.makeBoat;
      if (rowing && !r.boat) this.ctx.scene.add((r.boat = this.makeBoat()));
      if (r.boat) {
        r.boat.visible = rowing && !!r.shown;
        if (r.boat.visible) {
          // the seat sits 1.6 m aft of the boat's middle, 0.55 m down, and faces the stern
          const yaw = root.rotation.y - Math.PI;
          r.boat.position.set(root.position.x - Math.sin(yaw) * 1.6, root.position.y + 0.55, root.position.z - Math.cos(yaw) * 1.6);
          r.boat.rotation.set(0, yaw, 0);
        }
      }
      if (!r.shown) continue;
      if (r.action === 'row') r.char.actionParam += r.cur.distanceToSquared(r.target) > 1e-4 ? dt * 4.5 : 0;
      if (r.action !== r.char.action) {
        if (r.action) r.char.setAction(r.action);
        else r.char.clearAction();
      }
      r.char.holdR = r.holdR;
      r.char.update(dt, { speed: r.speed });
    }
  }
}
