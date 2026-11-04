import * as THREE from 'three';
import { Character, randomLook } from '../character.js';
import { beam, canvasTexture, setLayer, pick, rand, WARM_PALETTE } from '../utils.js';
import { signTexture, stripes } from '../stalls.js';
import { mergeStatic } from '../merge.js';
import { settings } from '../settings.js';

/*
  Tambola (housie) in a tent east of the gate. A caller draws a number every couple of seconds
  (spoken by the browser when it can), your ticket marks itself, and the prizes go to whoever
  gets there first: the other players at the tables claim some too.
*/
const POS = new THREE.Vector3(33, 0, 58);
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
  constructor(ctx, lights) {
    this.ctx = ctx;
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
    g.add(beam(V(0, 0, 0), V(0, 7.2, 0), 0.1, poleMat));
    const rug = new THREE.Mesh(new THREE.CircleGeometry(5.8, 32), std(0x9b2226, 0.95, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.03;
    g.add(rug);
    world.colliders.push({ type: 'circle', x: POS.x, z: POS.z, r: 0.2 });

    // caller's table and the big number board
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.8), std(0x6b3f22, 0.8));
    table.position.set(0, 0.9, -3.8);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.9, 0.9), std(0xffd166, 0.9));
    cloth.position.set(0, 0.45, -3.8);
    g.add(table, cloth);
    world.colliders.push({ type: 'box', minX: POS.x - 1.3, maxX: POS.x + 1.3, minZ: POS.z - 4.3, maxZ: POS.z - 3.3 });
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 1024;
    this.boardCanvas.height = 640;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.25), new THREE.MeshBasicMaterial({ map: this.boardTex, color: new THREE.Color(1.15, 1.15, 1.15) }));
    boardMesh.position.set(0, 2.4, -4.9);
    g.add(boardMesh);
    this.caller = new Character(randomLook());
    this.caller.root.position.set(0, 0, -4.4);
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
    const ticketMat = std(0xfff6e5, 0.9);
    const mine = seatSpots.splice(5, 1)[0];
    this.seat = new THREE.Object3D();
    this.seat.position.set(mine[0], 0, mine[1]);
    this.seat.rotation.y = Math.PI; // face the caller
    g.add(this.seat);
    for (const [sx, sz] of seatSpots.filter(() => Math.random() < 0.6).slice(0, 7)) {
      const ch = new Character(randomLook({ kid: Math.random() < 0.2 }));
      ch.root.position.set(sx, -0.05, sz);
      ch.root.rotation.y = Math.PI;
      ch.setAction('sit');
      g.add(ch.root);
      const tk = new THREE.Mesh(ticketGeo, ticketMat);
      tk.rotation.x = -Math.PI / 2;
      tk.position.set(sx, 0.8, sz - 0.9);
      g.add(tk);
      this.rivals.push(ch);
    }

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.95),
      new THREE.MeshBasicMaterial({ map: signTexture('Tambola Tent', 'Housie · press E to join a round', '#4a0d4a', '#ffe7a3', 1024, 288), color: new THREE.Color(1.2, 1.2, 1.2), side: THREE.DoubleSide })
    );
    sign.position.set(0, 4.2, 5.9);
    g.add(sign);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      pts.push(V(POS.x + Math.cos(a) * 5.7, 3.35, POS.z + Math.sin(a) * 5.7));
    }
    lights.addPolyline(pts, { spacing: 0.35, palette: WARM_PALETTE, mode: 'twinkle' });
    const lamp = new THREE.PointLight(0xffd9a0, 60, 16, 2);
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
    this.drawBoard([]);
  }

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
    c.font = '700 150px Poppins, sans-serif';
    c.fillStyle = '#fff';
    if (current) c.fillText(String(current), w - 40, 160);
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
      const on = called.includes(n);
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
    const called = [];
    const won = {};
    const claimed = {};
    const rivalPlan = { early: rand(9, 16), top: rand(28, 44), middle: rand(30, 48), bottom: rand(26, 46), full: rand(62, 80) };
    const panel = ui.tambola.open({ ticket, onLeave: () => (this.leave = true) });
    this.leave = false;
    passport.stamp('tambola');
    ui.bubble((o) => this.caller.headTop.getWorldPosition(o), 'Eyes down! Pehla number…', 2.5);
    await tasks.wait(1.6);

    const marked = (n) => called.includes(n);
    const rowDone = (r) => ticket[r].every((v) => v === null || marked(v));
    const count = () => ticket.flat().filter((v) => v !== null && marked(v)).length;
    const interval = settings.reduceMotion ? 2.4 : 1.8;
    let result = null;
    while (bag.length && !this.leave && !won.full && !claimed.full) {
      const n = bag.pop();
      called.push(n);
      this.caller.setAction('give');
      this.say(n);
      this.drawBoard(called, n);
      panel.called(n, CALLS[n] || '', called.length);
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
          net?.sendBubble(`${prize.name} in Tambola! 🎉`);
        }
      }
      // the room claims the rest
      for (const [id, at] of Object.entries(rivalPlan)) {
        if (!won[id] && !claimed[id] && called.length >= at) {
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
    if (!this.leave) {
      result = await ui.result({
        icon: mine ? '🎟️' : '🙂',
        title: mine ? `You won ${mine} prize${mine > 1 ? 's' : ''}!` : 'No luck this round',
        text: mine ? `${Object.keys(won).map((id) => PRIZES.find((p) => p.id === id).name).join(', ')}. Here's a gift box 🎁` : `${claimed.full || 'Someone'} got the full house. Another round?`,
        buttons: [{ label: 'Done', value: 'ok', primary: true }],
      });
    }
    ui.tambola.close();
    try {
      speechSynthesis?.cancel();
    } catch {
      // ignore
    }
    player.standUp(POS.x, POS.z + 6.8, 0);
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
}
