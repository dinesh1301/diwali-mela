import * as THREE from 'three';
import './tambola.css';
import { Character, randomLook } from '../character.js';
import { beam, canvasTexture, setLayer, pick, rand, WARM_PALETTE } from '../utils.js';
import { signTexture, stripes } from '../stalls.js';
import { mergeStatic } from '../merge.js';
import { settings } from '../settings.js';
import { track } from '../track.js';

/*
  Tambola (housie) in a tent east of the gate, past the Selfie Point. A caller draws a number every
  couple of seconds (spoken by the browser when it can), your ticket marks itself, and the prizes go
  to whoever gets there first: the other players at the tables claim some too. The ticket panel is
  this module's own light overlay (the scene stays live behind it). The director's 'tambola' shot
  drives the same tent through stageShot() / callShot().
*/
export const TAMBOLA_POS = new THREE.Vector3(33, 0, 58);
const POS = TAMBOLA_POS;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const ZERO = new THREE.Vector3();
const CALLS = {
  1: "Kelly's eye", 2: 'One little duck', 3: 'Cup of tea', 4: 'Knock at the door', 5: 'Man alive', 7: 'Lucky seven', 8: 'Garden gate', 9: "Doctor's orders", 10: "Diwali's ten",
  11: 'Legs eleven', 13: 'Unlucky for some', 16: 'Sweet sixteen', 21: 'Key of the door', 22: 'Two little ducks', 25: 'Duck and dive', 33: 'All the threes',
  39: 'Those famous steps', 44: 'Droopy drawers', 45: 'Halfway there', 50: 'Half a century', 55: 'Snakes alive', 57: 'Heinz varieties', 66: 'Clickety click',
  69: 'Either way up', 76: 'Trombones', 77: 'Sunset strip', 80: 'Gandhi’s den', 86: 'Between the sticks', 88: 'Two fat ladies', 90: 'Top of the shop',
};
const PRIZES = [
  { id: 'early', name: 'Early Five', icon: '✋' },
  { id: 'top', name: 'Top Line', icon: '⬆️' },
  { id: 'middle', name: 'Middle Line', icon: '➡️' },
  { id: 'bottom', name: 'Bottom Line', icon: '⬇️' },
  { id: 'full', name: 'Full House', icon: '🏠' },
];
const RIVALS = ['Meena', 'Rohit', 'Dadi', 'Kabir', 'Aunty ji', 'Sana'];

/** A standard ticket: 3 rows x 9 columns, 15 numbers, five per row, column ranges 1-9, 10-19 … 80-90. */
export function makeTicket() {
  for (;;) {
    const counts = Array(9).fill(1);
    for (let k = 0; k < 6; k++) {
      const c = Math.floor(Math.random() * 9);
      if (counts[c] < 3) counts[c]++;
      else k--;
    }
    const rows = [0, 0, 0];
    const grid = Array.from({ length: 3 }, () => Array(9).fill(null));
    let ok = true;
    const order = [...Array(9).keys()].sort((a, b) => counts[b] - counts[a]);
    for (const c of order) {
      const avail = [0, 1, 2].filter((r) => rows[r] < 5).sort((a, b) => rows[a] - rows[b] || Math.random() - 0.5);
      if (avail.length < counts[c]) {
        ok = false;
        break;
      }
      const lo = c === 0 ? 1 : c * 10;
      const hi = c === 8 ? 90 : c * 10 + 9;
      const nums = new Set();
      while (nums.size < counts[c]) nums.add(lo + Math.floor(Math.random() * (hi - lo + 1)));
      const sorted = [...nums].sort((a, b) => a - b);
      const chosen = avail.slice(0, counts[c]).sort((a, b) => a - b);
      chosen.forEach((r, i) => {
        grid[r][c] = sorted[i];
        rows[r]++;
      });
    }
    if (ok && rows.every((r) => r === 5)) return grid;
  }
}

export class Tambola {
  constructor(ctx, lights, { low = false } = {}) {
    this.ctx = ctx;
    this.panelOpen = false;
    const { scene, world, interactions, player } = ctx;
    this.active = false;
    const g = new THREE.Group();
    g.position.copy(POS);
    scene.add(g);

    // tent: eight poles, a striped conical roof, open sides
    const fabric = std(0xffffff, 0.9, { map: stripes('#ff006e', '#ffd166', 16), side: THREE.DoubleSide });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.6, 8, 1, true), fabric);
    roof.position.y = 3.3 + 1.3;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.6, 8, 1, true), fabric);
    skirt.position.y = 3.0;
    g.add(roof, skirt);
    const poleMat = std(0x3d2a1c);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 5.6;
      const z = Math.sin(a) * 5.6;
      g.add(beam(V(x, 0, z), V(x, 3.3, z), 0.07, poleMat));
      world.colliders.push({ type: 'circle', x: POS.x + x, z: POS.z + z, r: 0.15 });
    }
    // no centre pole: it would stand between the tables and the caller's board
    const rug = new THREE.Mesh(new THREE.CircleGeometry(5.8, 32), std(0x9b2226, 0.95, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.03;
    g.add(rug);

    // caller's table and the big number board
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.8), std(0x6b3f22, 0.8));
    table.position.set(0, 0.9, -3.2);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.9, 0.9), std(0xffd166, 0.9));
    cloth.position.set(0, 0.45, -3.2);
    g.add(table, cloth);
    world.colliders.push({ type: 'box', minX: POS.x - 1.3, maxX: POS.x + 1.3, minZ: POS.z - 3.7, maxZ: POS.z - 2.7 });
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 1024;
    this.boardCanvas.height = 640;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    // redrawn on every call: no mipmap chain to rebuild each time
    this.boardTex.generateMipmaps = false;
    this.boardTex.minFilter = THREE.LinearFilter;
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.125), new THREE.MeshBasicMaterial({ map: this.boardTex, color: new THREE.Color(0.92, 0.92, 0.92) }));
    boardMesh.position.set(0, 2.74, -4.4); // clear of the caller's head, under the roof's slope
    g.add(boardMesh);
    this.caller = new Character(randomLook());
    this.caller.root.position.set(0, 0, -3.8);
    this.caller.root.rotation.y = 0;
    g.add(this.caller.root);

    // three tables with benches and rival players
    this.rivals = [];
    const seatSpots = [];
    for (const z of [-1.4, 0.4, 2.2]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.06, 0.7), std(0x6b3f22, 0.8));
      t.position.set(0, 0.76, z);
      g.add(t);
      for (const lx of [-2.5, 2.5]) g.add(beam(V(lx, 0, z), V(lx, 0.73, z), 0.05, poleMat));
      const bench = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.06, 0.4), std(0x8a5a2b, 0.8));
      bench.position.set(0, 0.45, z + 0.75);
      g.add(bench);
      world.colliders.push({ type: 'box', minX: POS.x - 2.8, maxX: POS.x + 2.8, minZ: POS.z + z - 0.4, maxZ: POS.z + z + 0.4 });
      for (const sx of [-1.9, -0.6, 0.7, 2.0]) seatSpots.push([sx, z + 0.75]);
    }
    const ticketGeo = new THREE.PlaneGeometry(0.42, 0.16);
    const ticketMat = std(0xe8dcc0, 0.9);
    const mine = seatSpots.splice(5, 1)[0];
    this.seat = new THREE.Object3D();
    this.seat.position.set(mine[0], 0, mine[1]);
    this.seat.rotation.y = Math.PI; // face the caller
    g.add(this.seat);
        this.tickets = [];
    for (const [sx, sz] of seatSpots.filter(() => Math.random() < 0.6).slice(0, low ? 4 : 7)) {
      const ch = new Character(randomLook({ kid: Math.random() < 0.2 }));
      ch.root.position.set(sx, -0.05, sz);
      ch.root.rotation.y = Math.PI;
      ch.setAction('sit');
      g.add(ch.root);
      const tkt = new THREE.Mesh(ticketGeo, ticketMat);
      tkt.rotation.x = -Math.PI / 2;
      tkt.position.set(sx, 0.8, sz - 0.9);
      g.add(tkt);
      this.rivals.push(ch);
    }

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.95),
      new THREE.MeshBasicMaterial({ map: signTexture('Tambola Tent', 'Housie · Full House jeeto!', '#4a0d4a', '#ffe7a3', 1024, 288), side: THREE.DoubleSide })
    );
    sign.position.set(0, 4.2, 5.9);
    g.add(sign);
    this.sign = sign; // the Tambola place chip frames it clear of the phone HUD
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      pts.push(V(POS.x + Math.cos(a) * 5.7, 3.35, POS.z + Math.sin(a) * 5.7));
    }
    lights.addPolyline(pts, { spacing: 0.35, palette: WARM_PALETTE, mode: 'twinkle' });
    const lamp = new THREE.PointLight(0xffd9a0, 40, 16, 2);
    lamp.position.set(0, 3, 0);
    g.add(lamp);
    const people = new Set([this.caller.root, ...this.rivals.map((r) => r.root)]);
    mergeStatic(g, { skip: (o) => people.has(o) || o === boardMesh });
    setLayer(g, 1);
    this.group = g;

    interactions.add({
      pos: V(POS.x, 0, POS.z + 6.5),
      radius: 3.2,
      markerHeight: 2.6,
      markAt: V(POS.x, 0, POS.z + 5),
      label: 'Play Tambola 🎟️',
      enabled: () => player.mode === 'walk' && !this.active,
      action: () => this.play(),
    });
    this.drawBoard(new Set());
    this.panel = buildPanel(ctx.ui, () => (this.leave = true), this);
  }

  /** called: a Set of the numbers called so far. */
  drawBoard(called, current = null) {
    const c = this.boardCanvas.getContext('2d');
    const w = this.boardCanvas.width;
    const h = this.boardCanvas.height;
    c.fillStyle = '#1a1030';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffcf5c';
    c.font = '600 44px Poppins, sans-serif';
    c.textAlign = 'left';
    c.fillText('TAMBOLA', 30, 60);
    c.textAlign = 'right';
    if (current) {
      // the number just called, on an orange disc (warm, not white: it reads without blooming out)
      c.fillStyle = '#ff6d3a';
      c.beginPath();
      c.arc(w - 120, 92, 82, 0, Math.PI * 2);
      c.fill();
      c.font = '700 104px Poppins, sans-serif';
      c.fillStyle = '#2a0c00';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(current), w - 120, 98);
      c.textBaseline = 'alphabetic';
    }
    const cw = (w - 60) / 10;
    const ch = (h - 200) / 9;
    c.font = '600 30px Poppins, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let n = 1; n <= 90; n++) {
      const col = (n - 1) % 10;
      const row = Math.floor((n - 1) / 10);
      const x = 30 + col * cw;
      const y = 190 + row * ch;
      const on = called.has(n);
      c.fillStyle = n === current ? '#ff6d3a' : on ? '#ffcf5c' : 'rgba(255,255,255,0.08)';
      c.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      c.fillStyle = on || n === current ? '#2a0c00' : 'rgba(255,246,229,0.7)';
      c.fillText(String(n), x + cw / 2, y + ch / 2);
    }
    this.boardTex.needsUpdate = true;
  }

  say(n) {
    const { audio } = this.ctx;
    audio.beep(n % 2 === 0);
    if (audio.muted || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const call = CALLS[n] ? `${CALLS[n]}, ${n}` : `${Math.floor(n / 10) ? `${Math.floor(n / 10)} and ${n % 10}, ` : ''}${n}`;
      const u = new SpeechSynthesisUtterance(call);
      u.rate = 1.0;
      u.pitch = 1.05;
      u.volume = 0.8;
      const voice = speechSynthesis.getVoices().find((v) => /en-IN/i.test(v.lang)) ?? speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang));
      if (voice) u.voice = voice;
      speechSynthesis.speak(u);
    } catch {
      // no speech, the beep will do
    }
  }

  async play() {
    const { player, ui, tasks, passport, audio, shops, net } = this.ctx;
    this.active = true;
    player.mode = 'anim';
    player.vel.set(0, 0, 0);
    const seatW = this.seat.getWorldPosition(new THREE.Vector3());
    const from = player.pos.clone();
    player.faceTowards(seatW.x, seatW.z);
    player.animSpeed = 2;
    await tasks.tween(Math.max(0.3, from.distanceTo(seatW) / 2.2), (k) => player.pos.lerpVectors(from, seatW, k), (k) => k);
    player.animSpeed = 0;
    player.sitOn(this.seat, ZERO, 0, 'sit');
    player.cam.yaw = 0;
    player.cam.pitch = 0.3;
    player.cam.targetDist = 4.5;

    const ticket = makeTicket();
    const bag = [...Array(90).keys()].map((n) => n + 1).sort(() => Math.random() - 0.5);
    const called = new Set();
    const won = {};
    const claimed = {};
    const rivalPlan = { early: rand(9, 16), top: rand(28, 44), middle: rand(30, 48), bottom: rand(26, 46), full: rand(62, 80) };
    const panel = this.panel.open(ticket);
    this.leave = false;
    passport.stamp('tambola');
    track('game_play', { game: 'tambola', action: 'start' });
    ui.bubble((o) => this.caller.headTop.getWorldPosition(o), 'Eyes down! Pehla number…', 2.5);
    await tasks.wait(1.6);

    const marked = (n) => called.has(n);
    const rowDone = (r) => ticket[r].every((v) => v === null || marked(v));
    const count = () => ticket.flat().filter((v) => v !== null && marked(v)).length;
    const interval = settings.reduceMotion ? 2.4 : 1.8;
    let result = null;
    while (bag.length && !this.leave && !won.full && !claimed.full) {
      const n = bag.pop();
      called.add(n);
      this.caller.setAction('give');
      this.say(n);
      this.drawBoard(called, n);
      panel.called(n, CALLS[n] || '', called.size);
      ui.bubble((o) => this.caller.headTop.getWorldPosition(o), `${CALLS[n] ? CALLS[n] + ' · ' : ''}${n}`, 1.4);
      // our claims
      const checks = [
        ['early', count() >= 5],
        ['top', rowDone(0)],
        ['middle', rowDone(1)],
        ['bottom', rowDone(2)],
        ['full', count() === 15],
      ];
      for (const [id, ok] of checks) {
        if (ok && !won[id] && !claimed[id]) {
          won[id] = true;
          const prize = PRIZES.find((p) => p.id === id);
          panel.prize(prize, 'you');
          audio.cheer();
          ui.toast(`🎉 ${prize.name}! You claimed it first`, 3000, { important: true });
          this.ctx.debris.burst(player.headWorld(new THREE.Vector3()), { count: 36, colors: [0xffd166, 0xff006e, 0x06d6a0], speed: 2.5, up: 3, size: 0.06, flat: true, life: 2.5, floor: player.pos.y });
          net?.sendBubble(`${prize.name} in Tambola! 🎉`, 'tambola');
        }
      }
      // the room claims the rest
      for (const [id, at] of Object.entries(rivalPlan)) {
        if (!won[id] && !claimed[id] && called.size >= at) {
          claimed[id] = pick(RIVALS);
          const prize = PRIZES.find((p) => p.id === id);
          panel.prize(prize, claimed[id]);
          const rival = pick(this.rivals);
          if (rival) {
            rival.setAction('cheer');
            setTimeout(() => rival.setAction('sit'), 2200);
            ui.bubble((o) => rival.headTop.getWorldPosition(o), `${prize.name}! 🙌`, 2);
          }
        }
      }
      await tasks.wait(0.35);
      this.caller.clearAction();
      await tasks.wait(interval - 0.35);
    }
    const mine = Object.keys(won).length;
    track('game_score', { game: 'tambola', score: mine, win: mine > 0, prizes: Object.keys(won), calls: called.size, left: !!this.leave });
    if (!this.leave) {
      result = await ui.result({
        icon: mine ? '🎟️' : '🙂',
        title: mine ? `You won ${mine} prize${mine > 1 ? 's' : ''}!` : 'No luck this round',
        text: mine ? `${Object.keys(won).map((id) => PRIZES.find((p) => p.id === id).name).join(', ')}. Here's a gift box 🎁` : `${claimed.full || 'Someone'} got the full house. Another round?`,
        buttons: [{ label: 'Done', value: 'ok', primary: true }],
      });
    }
    this.panel.close();
    try {
      speechSynthesis?.cancel();
    } catch {
      // ignore
    }
    // back on your feet just outside the tent, facing it: the follow camera (behind you) stays out in
    // the open instead of inside the canopy
    player.standUp(POS.x, POS.z + 6.8, Math.PI);
    player.cam.pitch = 0.22;
    player.cam.targetDist = 5;
    this.active = false;
    if (mine) shops.givePrize('gift');
    void result;
  }

  update(dt) {
    // nobody watches the tent from afar: past 45 m (and no game running) the players freeze
    if (!this.active && this.ctx.camera.position.distanceToSquared(POS) > 45 * 45) return;
    this.caller.update(dt);
    for (const r of this.rivals) r.update(dt);
  }

  // ---------- director ('tambola' trailer shot) ----------

  /** A round already under way: `count` numbers on the board and the player seated with a ticket. */
  stageShot(count = 22) {
    const { player } = this.ctx;
    this.shotBag = [...Array(90).keys()].map((n) => n + 1).sort(() => Math.random() - 0.5);
    this.shotCalled = new Set(this.shotBag.splice(0, count));
    this.drawBoard(this.shotCalled, [...this.shotCalled].pop());
    player.sitOn(this.seat, ZERO, 0, 'sit');
    for (const r of this.rivals) r.setAction('sit');
  }

  /** The caller draws the next number (no speech, no DOM: the board and the caller carry it). */
  callShot() {
    const n = this.shotBag.shift();
    this.shotCalled.add(n);
    this.drawBoard(this.shotCalled, n);
    this.caller.setAction('give');
    return n;
  }

  /** A player at the tables claims a prize: stands and cheers, confetti over their head. */
  claimShot(i = null) {
    // by default the one nearest the middle of the middle row (in the trailer camera's view)
    const score = (c) => Math.abs(c.root.position.x) + 2 * Math.abs(c.root.position.z - 1.15);
    const r = i ?? this.rivals.slice().sort((a, b) => score(a) - score(b))[0];
    if (!r) return;
    r.setAction('cheer');
    this.ctx.debris?.burst(r.headTop.getWorldPosition(new THREE.Vector3()), { count: 30, colors: [0xffd166, 0xff006e, 0x06d6a0], speed: 2.2, up: 3, size: 0.06, flat: true, life: 2.5, floor: 0 });
  }
}

/** The ticket panel: a light overlay over the live scene, opened and closed through the UI's modal count. */
function buildPanel(ui, onLeave, owner) {
  const el = document.createElement('div');
  el.id = 'tambola';
  el.className = 'overlay light hidden';
  el.innerHTML = `<div class="modal-card tambola-card">
    <div class="tb-head">
      <div><div class="tb-current">–</div><div class="tb-call"></div></div>
      <div class="tb-side"><div class="tb-count"></div><div class="tb-recent"></div></div>
    </div>
    <div class="ticket"></div>
    <div class="tb-prizes"></div>
    <div class="row"><button class="ghost" id="tambolaLeave">Leave the table <kbd>Esc</kbd></button></div>
  </div>`;
  document.body.appendChild(el);
  const $ = (q) => el.querySelector(q);
  $('#tambolaLeave').addEventListener('click', onLeave);
  addEventListener('keydown', (e) => {
    if (owner.panelOpen && e.code === 'Escape') onLeave();
  });
  const grid = $('.ticket');
  return {
    open(ticket) {
      grid.innerHTML = ticket.map((row) => row.map((v) => `<div class="cell ${v === null ? 'blank' : ''}" data-n="${v ?? ''}">${v ?? ''}</div>`).join('')).join('');
      $('.tb-current').textContent = '–';
      $('.tb-call').textContent = 'Eyes down…';
      $('.tb-count').textContent = '';
      $('.tb-prizes').innerHTML = PRIZES.map((p) => `<span class="prize" data-prize="${p.id}">${p.name}</span>`).join('');
      $('.tb-recent').innerHTML = '';
      owner.panelOpen = true;
      ui.open(el);
      return {
        called(n, call, count) {
          $('.tb-current').textContent = n;
          $('.tb-call').textContent = call || '';
          $('.tb-count').textContent = `${count} of 90 called`;
          grid.querySelector(`[data-n="${n}"]`)?.classList.add('marked');
          const recent = $('.tb-recent');
          const chip = document.createElement('span');
          chip.textContent = n;
          recent.prepend(chip);
          while (recent.children.length > 8) recent.lastChild.remove();
        },
        prize(prize, who) {
          const p = $(`[data-prize="${prize.id}"]`);
          if (!p) return;
          p.classList.add(who === 'you' ? 'mine' : 'gone');
          p.textContent = `${prize.icon} ${prize.name} · ${who === 'you' ? 'you!' : who}`;
        },
      };
    },
    close() {
      owner.panelOpen = false;
      ui.close(el);
    },
  };
}
