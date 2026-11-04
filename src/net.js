import * as THREE from 'three';
import { Character, randomLook } from './character.js';
import { NameTag } from './nametag.js';
import { profile } from './profile.js';

/*
  Multiplayer client. Sends where our avatar is (world position of the character root, heading,
  pose, speed, what it holds) at 10 Hz and mirrors everyone else with the same Character rig.
  Also carries waves, shared wish lanterns, scores for the leaderboards and the wish wall.
  Without a server it degrades to a local-only mode (own bests and wishes kept in the browser).
*/
const SEND_MS = 100;
const STALE_MS = 12000;
const LOCAL_KEY = 'melaLocalBoards';
const BOARD_ORDER = { golgappa: 'desc', lap: 'asc', striker: 'desc' };
const _v = new THREE.Vector3();

const ENV = import.meta.env ?? {};
// Same-origin attempts that never open before we give up (a static host has no socket to retry).
const SAME_ORIGIN_TRIES = 3;

/** VITE_WS_URL names a realtime server; a static build (VITE_STATIC=1) without one stays offline. */
function defaultUrl() {
  if (ENV.VITE_WS_URL) return ENV.VITE_WS_URL;
  if (ENV.VITE_STATIC) return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class Net {
  constructor(ctx, { url = defaultUrl() } = {}) {
    this.ctx = ctx;
    this.url = url;
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.online = 1;
    this.remote = new Map();
    this.boards = this.loadLocalBoards();
    this.wishes = [];
    this.listeners = {};
    this.lastSend = 0;
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
    if (!this.enabled || this.ws) return;
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

  sendState() {
    const { player } = this.ctx;
    const root = player.char.root;
    root.getWorldPosition(_v);
    root.getWorldQuaternion(this.tmpQ);
    this.tmpE.setFromQuaternion(this.tmpQ);
    this.send({
      t: 'state',
      x: +_v.x.toFixed(2),
      y: +_v.y.toFixed(2),
      z: +_v.z.toFixed(2),
      r: +this.tmpE.y.toFixed(3),
      a: player.char.action,
      s: +player.speed.toFixed(2),
      hr: player.char.holdR,
      v: player.mode === 'ride' ? 'ride' : null,
    });
  }

  sendLook() {
    this.send({ t: 'look', look: this.ctx.player.char.look, name: profile.name, handle: profile.handle });
  }

  sendLantern(text, pos, dir) {
    this.send({ t: 'lantern', text, x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dz: dir.z });
    if (!this.connected) this.addWish({ name: profile.name, handle: profile.handle, text, at: Date.now() });
  }

  sendBubble(text) {
    this.send({ t: 'bubble', text });
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
    this.sendBubble(`Hi ${r.name}! 👋`);
    tasks.wait(1.6).then(() => player.char.action === 'wave' && player.char.clearAction());
  }

  // ---------- incoming ----------

  handle(m) {
    const { ui, lanterns } = this.ctx;
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        for (const p of m.players) this.addRemote(p);
        for (const p of m.players) this.voice?.peerJoined(p.id, !!p.mic);
        this.boards = this.mergeBoards(m.boards);
        this.wishes = m.wishes || [];
        this.emit('boards');
        this.emit('wishes');
        break;
      case 'join':
        this.addRemote(m.p);
        this.voice?.peerJoined(m.p.id, !!m.p.mic);
        ui.toast(`👋 ${m.p.n} joined the mela`, 2500);
        break;
      case 'leave':
        this.removeRemote(m.id);
        break;
      case 'snap':
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
      r.ready = true;
    }
    this.remote.set(p.id, r);
    return r;
  }

  removeRemote(id) {
    const r = this.remote.get(id);
    if (!r) return;
    this.voice?.dropPeer(id);
    r.char.root.removeFromParent();
    this.remote.delete(id);
  }

  nearest() {
    const p = this.ctx.player.pos;
    let best = null;
    let bd = Infinity;
    for (const r of this.remote.values()) {
      if (!r.ready) continue;
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

  update(dt, now) {
    if (this.connected && now - this.lastSend > SEND_MS) {
      this.lastSend = now;
      this.sendState();
    }
    for (const [id, r] of this.remote) {
      if (now - r.seenAt > STALE_MS) {
        this.removeRemote(id);
        continue;
      }
      if (!r.ready) continue;
      r.char.root.visible = true;
      const k = 1 - Math.exp(-dt * 12);
      r.cur.lerp(r.target, k);
      const root = r.char.root;
      root.position.copy(r.cur);
      let d = r.heading - root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      root.rotation.y += d * k;
      if (r.action !== r.char.action) {
        if (r.action) r.char.setAction(r.action);
        else r.char.clearAction();
      }
      r.char.holdR = r.holdR;
      r.char.update(dt, { speed: r.speed });
    }
  }
}
