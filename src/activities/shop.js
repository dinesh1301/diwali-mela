import * as THREE from 'three';
import { diyaMesh, kandeelMesh, balloonMesh, teddyMesh, giftMesh, forgetFlames } from '../items.js';
import { rand } from '../utils.js';
import { profile } from '../profile.js';
import { InstanceBatcher } from '../merge.js';
import { KANDEEL_DROP } from '../wall.js';

const _v = new THREE.Vector3();
const PLACED_KEY = 'melaPlaced';
const MAX_PLACED = 60;

const KANDEELS = [
  { color: 0xff3d6e, icon: '🩷', label: 'Rani pink' },
  { color: 0xffb000, icon: '🧡', label: 'Marigold' },
  { color: 0x9d4edd, icon: '💜', label: 'Jamuni purple' },
  { color: 0x00b4d8, icon: '🩵', label: 'Peacock blue' },
];
const GOLD_KANDEEL = { color: 0xffd700, icon: '✨', label: 'Sona · invite bonus', sub: 'Unlocked by bringing a friend' };
const BANGLES = [
  { color: 0xe63946, icon: '❤️', label: 'Lal (red)', sub: 'For good luck' },
  { color: 0x2a9d8f, icon: '💚', label: 'Hara (green)', sub: 'Glass bangles' },
  { color: 0xffd166, icon: '💛', label: 'Sona (gold)', sub: 'Shiny and festive' },
  { color: 0x8338ec, icon: '💜', label: 'Jamuni (purple)', sub: 'Lac bangles' },
];
const BALLOONS = [
  { color: 0xff006e, icon: '🎈', label: 'Pink' },
  { color: 0xffbe0b, icon: '💛', label: 'Yellow' },
  { color: 0x3a86ff, icon: '💙', label: 'Blue' },
  { color: 0x06d6a0, icon: '💚', label: 'Green' },
];
const LABELS = {
  diyas: 'Buy a clay diya 🪔',
  lanterns: 'Buy a kandeel 🏮',
  bangles: 'Try on bangles 💍',
  toys: 'Buy a balloon 🎈',
};
let STRING_MAT = null; // one material for every balloon string

const MAKERS = {
  diya: () => diyaMesh(),
  kandeel: (c) => kandeelMesh(c),
  prize: (c) => (c === 1 ? giftMesh() : teddyMesh()),
};

/** Shopping stalls, and everything you can do with what you carry (Q). */
export class Shops {
  constructor(ctx) {
    this.ctx = ctx;
    this.floaters = [];
    this.flyaways = [];
    this.placed = [];
    // every placed diya / kandeel / prize is drawn through a handful of instanced meshes
    this.batch = new InstanceBatcher(ctx.scene, MAX_PLACED + 4);
    for (const st of ctx.world.stalls) {
      const g = st.def.goods;
      if (!LABELS[g]) continue;
      ctx.interactions.add({
        pos: st.stand,
        markAt: st.center,
        markerHeight: 2.2,
        radius: 2.6,
        label: LABELS[g],
        enabled: () => ctx.player.mode === 'walk',
        action: () => this.visit(st),
      });
    }
    this.loadPlaced();
  }

  async visit(st) {
    const { ui, player, audio, passport, tasks, debris } = this.ctx;
    player.setBusy(true);
    player.faceTowards(st.center.x, st.center.z);
    const keeperHead = (o) => st.keeper.headTop.getWorldPosition(o);
    try {
      switch (st.def.goods) {
        case 'diyas':
          await this.serve(st, diyaMesh(), 'diya', 'hold');
          ui.bubble(keeperHead, 'Shubh Deepavali! 🪔', 2);
          ui.toast('🪔 Press Q to place your diya, or float it on the river at the ghat');
          break;
        case 'lanterns': {
          const opts = profile.golden ? [...KANDEELS, GOLD_KANDEEL] : KANDEELS;
          const i = await ui.menu('Kandeel House', 'Pick a lantern colour', opts);
          if (i === null) break;
          const color = opts[i].color;
          await this.serve(st, kandeelMesh(color), 'kandeel', 'holdUp', [0, -0.05, 0.05], color);
          passport.stamp('kandeel');
          ui.bubble(keeperHead, 'Ghar roshan ho jayega! ✨', 2);
          break;
        }
        case 'bangles': {
          const i = await ui.menu('Choodi Gali', 'Which bangles would you like to try?', BANGLES);
          if (i === null) break;
          st.keeper.setAction('give');
          audio.chaChing();
          await tasks.wait(0.5);
          st.keeper.clearAction();
          player.char.setLook({ bangles: BANGLES[i].color });
          try {
            localStorage.setItem('melaBangles', String(BANGLES[i].color));
          } catch {
            // ignore
          }
          for (const hand of [player.char.handR, player.char.handL]) {
            hand.getWorldPosition(_v);
            debris.burst(_v, { count: 10, colors: [BANGLES[i].color, 0xffd166, 0xffffff], speed: 0.8, up: 1.2, size: 0.025, life: 1, floor: player.pos.y });
          }
          player.char.setAction('cheer');
          ui.bubble(keeperHead, 'Bahut sundar lag rahe hain! ✨', 2.2);
          await tasks.wait(1.4);
          player.char.clearAction();
          passport.stamp('bangles');
          break;
        }
        case 'toys': {
          const i = await ui.menu('Gubbare & Khilone', 'Pick a balloon', BALLOONS);
          if (i === null) break;
          await this.giveBalloon(st, BALLOONS[i].color);
          passport.stamp('balloon');
          break;
        }
      }
    } finally {
      player.setBusy(false);
    }
  }

  async serve(st, item, kind, pose, offset, color) {
    const { scene, player, tasks, audio } = this.ctx;
    audio.chaChing();
    scene.add(item);
    st.keeper.setAction('give');
    await tasks.wait(0.3);
    st.keeper.handR.getWorldPosition(item.position);
    const start = item.position.clone();
    player.char.holdR = pose;
    await tasks.tween(0.45, (k) => {
      player.char.handR.getWorldPosition(_v);
      item.position.lerpVectors(start, _v, k);
      item.position.y += Math.sin(k * Math.PI) * 0.25;
    });
    st.keeper.clearAction();
    this.holdItem(item, kind, pose, offset, color);
  }

  holdItem(item, kind, pose = 'hold', offset, color) {
    const old = this.ctx.player.held;
    if (old) forgetFlames(old.obj);
    this.ctx.player.hold(item, kind, { pose, offset });
    this.ctx.player.held.color = color;
  }

  /** Prizes from the game booths land here. */
  givePrize(type) {
    const item = type === 'gift' ? giftMesh() : teddyMesh();
    this.holdItem(item, 'prize', 'hold', [0, -0.05, 0.08], type === 'gift' ? 1 : 0);
  }

  // ---------- balloon on a string ----------

  async giveBalloon(st, color) {
    const { scene, player, tasks, audio } = this.ctx;
    audio.chaChing();
    st.keeper.setAction('give');
    await tasks.wait(0.5);
    st.keeper.clearAction();
    const balloon = balloonMesh(color);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), (STRING_MAT ??= new THREE.LineBasicMaterial({ color: 0xdddddd })));
    line.frustumCulled = false;
    const obj = new THREE.Group();
    obj.add(balloon, line);
    scene.add(obj);
    st.keeper.handR.getWorldPosition(balloon.position);
    balloon.position.y += 0.6;
    const vel = new THREE.Vector3();
    const target = new THREE.Vector3();
    const old = player.held;
    if (old) forgetFlames(old.obj);
    player.hold(obj, 'balloon', {
      pose: 'holdUp',
      update: (dt, hand) => {
        // a springy follow with a little drift, clamped to the string length
        target.copy(hand).y += 1.05;
        target.x += Math.sin(performance.now() * 0.0013) * 0.15;
        vel.addScaledVector(target.sub(balloon.position), 18 * dt).multiplyScalar(1 - Math.min(1, 4 * dt));
        balloon.position.addScaledVector(vel, dt);
        const d = balloon.position.distanceTo(hand);
        if (d > 1.15) balloon.position.sub(hand).multiplyScalar(1.15 / d).add(hand);
        const p = line.geometry.attributes.position;
        p.setXYZ(0, hand.x, hand.y, hand.z);
        p.setXYZ(1, balloon.position.x, balloon.position.y - 0.25, balloon.position.z);
        p.needsUpdate = true;
      },
    });
    player.held.balloon = balloon;
    player.held.line = line;
  }

  // ---------- Q: use what you're holding ----------

  /** A free niche on the Deepmala wall, if we're standing by it. */
  wallSlot() {
    const w = this.ctx.walls;
    return w && w.nearDeepmala(this.ctx.player.pos) ? w.nextSlot() : null;
  }

  nearWater() {
    return this.ctx.player.pos.z < -48.4;
  }

  heldLabel() {
    const h = this.ctx.player.held;
    if (!h) return null;
    switch (h.kind) {
      case 'diya':
        return this.nearWater() ? 'Float the diya on the river 🌊' : this.wallSlot() ? 'Place the diya on the Deepmala 🪔' : 'Place the diya';
      case 'kandeel':
        return this.wallSlot() ? 'Hang the kandeel on the Deepmala 🏮' : 'Put the kandeel down';
      case 'balloon':
        return 'Let the balloon fly';
      case 'prize':
        return 'Put the prize down';
    }
    return null;
  }

  async useHeld() {
    const { player, tasks, audio, passport, ui, scene } = this.ctx;
    const h = player.held;
    if (!h) return;
    if (h.kind === 'balloon') {
      player.releaseHeld();
      this.flyaways.push({ balloon: h.balloon, line: h.line, obj: h.obj, vel: new THREE.Vector3(rand(-0.3, 0.3), 0.6, rand(-0.3, 0.3)), age: 0 });
      ui.bubble((o) => player.headWorld(o), 'Bye bye balloon! 👋', 1.8);
      return;
    }
    if (h.kind === 'diya' && this.nearWater()) {
      player.setBusy(true);
      player.char.setAction('crouch');
      await tasks.wait(0.45);
      const { obj } = player.releaseHeld();
      const start = obj.position.clone();
      const end = new THREE.Vector3(player.pos.x + Math.sin(player.heading) * 1.2, -1.33, Math.min(player.pos.z - 1.2, -51));
      await tasks.tween(0.5, (k) => {
        obj.position.lerpVectors(start, end, k);
        obj.position.y += Math.sin(k * Math.PI) * 0.3;
      });
      audio.splash();
      this.floaters.push({ obj, age: 0, phase: rand(0, 10), drift: rand(-0.15, 0.15) });
      this.ctx.world.water?.ripple(end.x, end.z);
      player.char.clearAction();
      player.setBusy(false);
      passport.stamp('float');
      ui.bubble((o) => player.headWorld(o), 'Bahta diya, bahti khushiyan 🌊', 2.4);
      return;
    }
    // place on the ground in front
    player.setBusy(true);
    player.char.setAction('crouch');
    await tasks.wait(0.45);
    const { obj, kind, color } = player.releaseHeld();
    const slot = kind === 'diya' || kind === 'kandeel' ? this.wallSlot() : null;
    if (slot) {
      slot.taken = true;
      obj.position.copy(slot.pos);
      if (kind === 'kandeel') obj.position.y += KANDEEL_DROP;
      obj.rotation.set(0, Math.PI / 2, 0);
      if (kind === 'kandeel') this.ctx.passport.stamp('kandeel');
    } else {
      player.forward(_v);
      obj.position.set(player.pos.x + _v.x * 0.8, player.pos.y + (kind === 'kandeel' ? 0.7 : 0.01), player.pos.z + _v.z * 0.8);
      obj.rotation.set(0, player.heading, 0);
    }
    scene.add(obj);
    this.batch.add(obj);
    this.remember(kind, color, obj);
    player.char.clearAction();
    player.setBusy(false);
    if (kind === 'diya') passport.stamp('diya');
  }

  // ---------- persistence of placed things ----------

  remember(kind, color, obj) {
    this.placed.push({ kind, color, obj });
    while (this.placed.length > MAX_PLACED) {
      const old = this.placed.shift();
      const slot = this.ctx.walls?.slotOf(old.kind, old.obj.position);
      if (slot) slot.taken = false;
      forgetFlames(old.obj);
      this.batch.remove(old.obj);
      old.obj.removeFromParent();
    }
    try {
      localStorage.setItem(
        PLACED_KEY,
        JSON.stringify(this.placed.map((p) => ({ k: p.kind, c: p.color, x: +p.obj.position.x.toFixed(2), y: +p.obj.position.y.toFixed(2), z: +p.obj.position.z.toFixed(2), r: +p.obj.rotation.y.toFixed(2) })))
      );
    } catch {
      // ignore
    }
  }

  loadPlaced() {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(PLACED_KEY) || '[]');
    } catch {
      return;
    }
    for (const s of saved) {
      const make = MAKERS[s.k];
      if (!make) continue;
      const obj = make(s.c);
      obj.position.set(s.x, s.y, s.z);
      obj.rotation.y = s.r;
      this.ctx.scene.add(obj);
      this.batch.add(obj);
      this.placed.push({ kind: s.k, color: s.c, obj });
    }
  }

  update(dt, t) {
    this.batch.update();
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      f.obj.position.z -= 0.28 * dt;
      f.obj.position.x += Math.sin(t * 0.3 + f.phase) * 0.05 * dt + f.drift * dt;
      f.obj.position.y = -1.33 + Math.sin(t * 1.3 + f.phase) * 0.025;
      f.obj.rotation.z = Math.sin(t * 0.9 + f.phase) * 0.08;
      if (f.age > 150) {
        forgetFlames(f.obj);
        f.obj.removeFromParent();
        this.floaters.splice(i, 1);
      }
    }
    for (let i = this.flyaways.length - 1; i >= 0; i--) {
      const f = this.flyaways[i];
      f.age += dt;
      f.vel.y = Math.min(2.2, f.vel.y + dt * 0.8);
      f.balloon.position.addScaledVector(f.vel, dt);
      f.balloon.position.x += Math.sin(t * 1.4 + i) * 0.2 * dt;
      const b = f.balloon.position;
      const p = f.line.geometry.attributes.position;
      p.setXYZ(0, b.x + Math.sin(t * 3) * 0.1, b.y - 1.1, b.z);
      p.setXYZ(1, b.x, b.y - 0.25, b.z);
      p.needsUpdate = true;
      if (f.age > 30) {
        f.obj.removeFromParent();
        f.line.geometry.dispose(); // the balloon itself uses shared geometry and materials
        this.flyaways.splice(i, 1);
      }
    }
  }
}

