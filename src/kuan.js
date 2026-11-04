import { tk } from './touch.js';
import * as THREE from 'three';
import { Character, randomLook, shape, merged } from './character.js';
import { beam, canvasTexture, hdr, setLayer, rand, WARM_PALETTE } from './utils.js';
import { signTexture } from './stalls.js';
import { mergeStatic } from './merge.js';

/*
  Maut ka Kuan, the well of death: a wooden drum with two motorbikes riding its wall. Press E at
  the stairs to take a place on the gallery around the top and look down; E again to climb down.
*/
const POS = new THREE.Vector3(-24, 0, 6);
const R = 6;
const H = 5.6;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const ZERO = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _p = new THREE.Vector3();

/** A stunt bike: local +z is forward, local +y is up, the origin sits at the wheels' contact line. */
function bikeModel(color) {
  const g = new THREE.Group();
  const parts = new THREE.Group();
  parts.scale.setScalar(1.4);
  g.add(parts);
  const body = merged(
    [
      shape(new THREE.BoxGeometry(0.3, 0.3, 0.9), color, [0, 0.55, 0]),
      shape(new THREE.BoxGeometry(0.34, 0.22, 0.5), 0x1a1a1a, [0, 0.74, -0.25]),
      shape(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8), 0x2a2a2a, [0, 0.4, 0.1], [0.3, 0, 0]),
      shape(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), 0xcfcfcf, [0, 0.85, 0.5], [0, 0, Math.PI / 2]),
      shape(new THREE.BoxGeometry(0.08, 0.5, 0.08), 0x555555, [0, 0.5, 0.55], [0.4, 0, 0]),
      shape(new THREE.CylinderGeometry(0.05, 0.08, 0.9, 8), 0x888888, [0.14, 0.3, -0.3], [1.3, 0, 0]),
      shape(new THREE.BoxGeometry(0.12, 0.04, 0.3), 0xd4a017, [0, 0.72, 0.05]), // tank stripe
    ],
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 })
  );
  parts.add(body);
  const wheel = new THREE.TorusGeometry(0.26, 0.07, 8, 18).rotateY(Math.PI / 2);
  for (const z of [0.62, -0.62]) {
    const w = new THREE.Mesh(wheel, std(0x151515, 0.9));
    w.position.set(0, 0.33, z);
    parts.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10).rotateZ(Math.PI / 2), std(0xcfcfcf, 0.3, { metalness: 0.7 }));
    hub.position.set(0, 0.33, z);
    parts.add(hub);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: hdr(0xfff0c0, 4) }));
  lamp.position.set(0, 0.7, 0.72);
  parts.add(lamp);
  const head = new THREE.SpotLight(0xfff0c8, 45, 13, 0.6, 0.5, 1.2);
  head.position.set(0, 0.98, 1.0);
  head.target.position.set(0, 0.7, 8);
  g.add(head, head.target);
  const seat = new THREE.Object3D();
  seat.position.set(0, 0.86, -0.2);
  g.add(seat);
  return { group: g, seat };
}

export class Kuan {
  constructor(ctx, lights) {
    this.ctx = ctx;
    const { scene, world, interactions, player } = ctx;
    this.watching = false;
    const g = new THREE.Group();
    g.position.copy(POS);
    scene.add(g);

    const planks = canvasTexture(512, 256, (c, w, h) => {
      c.fillStyle = '#6b4a2a';
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 24; i++) {
        c.fillStyle = `rgba(${i % 2 ? '40,22,8' : '120,85,50'},0.5)`;
        c.fillRect((i * w) / 24, 0, 3, h);
      }
      // grain: one fill colour, the strength varied with globalAlpha (no per-stroke colour parsing)
      c.fillStyle = '#000';
      for (let i = 0; i < 3000; i++) {
        c.globalAlpha = Math.random() * 0.2;
        c.fillRect(Math.random() * w, Math.random() * h, 1, 5);
      }
      c.globalAlpha = 1;
    });
    planks.wrapS = planks.wrapT = THREE.RepeatWrapping;
    planks.repeat.set(6, 1);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 40, 1, true), std(0xffffff, 0.9, { map: planks, side: THREE.DoubleSide }));
    drum.position.y = H / 2;
    drum.castShadow = drum.receiveShadow = true;
    g.add(drum);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 40), std(0x4a3a2a, 0.95));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.04;
    g.add(floor);
    const ramp = new THREE.Mesh(new THREE.TorusGeometry(R - 0.5, 0.5, 8, 40, Math.PI * 2), std(0x6b4a2a, 0.9));
    ramp.rotation.x = Math.PI / 2;
    ramp.position.y = 0.25;
    g.add(ramp);
    // the inside: painted, faintly glowing bands and a bulb ring just under the gallery. The lamp
    // over the well (below) lights the drum; the bands' emissive carries the rest, so the well
    // needs no lights of its own at riding height.
    const bandMat = (c) => std(c, 0.8, { emissive: new THREE.Color(c).multiplyScalar(0.22), side: THREE.DoubleSide });
    for (const [y, c] of [[1.2, 0xc1121f], [1.55, 0xffd166], [4.5, 0xc1121f], [4.85, 0xffd166]]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.03, R - 0.03, 0.28, 40, 1, true), bandMat(c));
      band.position.y = y;
      g.add(band);
    }
    const innerRing = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      innerRing.push(V(POS.x + Math.cos(a) * (R - 0.15), H - 0.25, POS.z + Math.sin(a) * (R - 0.15)));
    }
    lights.addPolyline(innerRing, { spacing: 0.5, palette: WARM_PALETTE, mode: 'twinkle' });
    // gallery ring on top with a railing
    const gallery = new THREE.Mesh(new THREE.RingGeometry(R - 0.1, R + 1.5, 40), std(0x8a5a2b, 0.85, { side: THREE.DoubleSide }));
    gallery.rotation.x = -Math.PI / 2;
    gallery.position.y = H;
    g.add(gallery);
    const railMat = std(0xd4a017, 0.4, { metalness: 0.5 });
    const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 1.5, 0.04, 6, 60), railMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = H + 1.0;
    g.add(rail);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(R + 0.05, 0.04, 6, 60), railMat);
    inner.rotation.x = Math.PI / 2;
    inner.position.y = H + 0.9;
    g.add(inner);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      g.add(beam(V(Math.cos(a) * (R + 1.5), H, Math.sin(a) * (R + 1.5)), V(Math.cos(a) * (R + 1.5), H + 1, Math.sin(a) * (R + 1.5)), 0.03, railMat));
      g.add(beam(V(Math.cos(a) * (R + 1.5), 0, Math.sin(a) * (R + 1.5)), V(Math.cos(a) * (R + 1.5), H, Math.sin(a) * (R + 1.5)), 0.08, std(0x3d2a1c)));
    }
    // stairs up the east side
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.4), std(0x6b3f22, 0.8));
      s.position.set(R + 2.4, 0.2 + i * 0.4, 2.8 - i * 0.4);
      s.castShadow = true;
      g.add(s);
    }
    const bulbPts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      bulbPts.push(V(POS.x + Math.cos(a) * (R + 1.55), H + 1.05, POS.z + Math.sin(a) * (R + 1.55)));
    }
    lights.addPolyline(bulbPts, { spacing: 0.45, mode: 'chase' });
    const lamp = new THREE.PointLight(0xffb46b, 100, 16, 2); // a little brighter: it now lights the whole well
    lamp.position.set(0, H + 0.5, 0);
    g.add(lamp);
    world.colliders.push({ type: 'circle', x: POS.x, z: POS.z, r: R + 1.7 });
    world.tall.push({ type: 'circle', x: POS.x, z: POS.z, r: R + 2, h: H + 1.5 });

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 1.05),
      new THREE.MeshBasicMaterial({ map: signTexture('Maut ka Kuan', tk('Well of death · press E at the stairs to watch', 'Well of death · tap the button at the stairs to watch'), '#4a0d0d', '#ffe7a3', 1024, 288), color: new THREE.Color(1.2, 1.2, 1.2), side: THREE.DoubleSide })
    );
    sign.position.set(R + 3.4, 2.8, 4.6);
    sign.rotation.y = -Math.PI / 2;
    g.add(sign);

    // drum, bands, gallery, posts and stairs: one mesh per material look (riders and spectators are added after)
    mergeStatic(g);

    // the riders
    this.bikes = [bikeModel(0xe63946), bikeModel(0x3a86ff)].map((b, i) => {
      g.add(b.group);
      const rider = new Character({ ...randomLook(), style: 'kurta', hairStyle: 'turban', dupatta: null, scale: 0.95 });
      rider.setAction('drive');
      rider.root.position.set(0, -0.45, 0);
      b.seat.add(rider.root);
      return { ...b, rider, phase: i * Math.PI, hPhase: i * 1.7, speed: 1.7 + i * 0.25, stunt: rand(3, 9), dust: 0 };
    });
    // spectators on the gallery
    this.spectators = [];
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * 0.4 + i * 0.5;
      const ch = new Character(randomLook({ kid: i === 2 }));
      ch.root.position.set(Math.cos(a) * (R + 0.75), H, Math.sin(a) * (R + 0.75));
      ch.root.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
      g.add(ch.root);
      this.spectators.push(ch);
    }
    this.seat = new THREE.Object3D();
    this.seat.position.set(R + 0.75, H, -0.4);
    this.seat.rotation.y = -Math.PI / 2; // facing the drum
    g.add(this.seat);
    setLayer(g, 1);
    this.group = g;

    interactions.add({
      pos: V(POS.x + R + 2.4, 0, POS.z + 3.6),
      radius: 2.8,
      markerHeight: 2.4,
      markAt: V(POS.x + R + 2.4, 0.5, POS.z + 2.8),
      label: 'Watch the Maut ka Kuan 🏍️',
      enabled: () => player.mode === 'walk' && !this.watching,
      action: () => this.watch(),
    });
  }

  async watch() {
    const { player, tasks, ui, passport } = this.ctx;
    this.watching = true;
    player.mode = 'anim';
    player.vel.set(0, 0, 0);
    const base = V(POS.x + R + 2.4, 0, POS.z + 3.0);
    const from = player.pos.clone();
    player.faceTowards(base.x, base.z);
    player.animSpeed = 2;
    await tasks.tween(Math.max(0.3, from.distanceTo(base) / 2.2), (k) => player.pos.lerpVectors(from, base, k), (k) => k);
    // climb the stairs
    const top = V(POS.x + R + 2.4, H, POS.z - 2.6);
    player.faceTowards(top.x, top.z);
    await tasks.tween(2.4, (k) => player.pos.lerpVectors(base, top, k), (k) => k);
    player.animSpeed = 0;
    const seatW = this.seat.getWorldPosition(new THREE.Vector3());
    player.faceTowards(seatW.x, seatW.z);
    await tasks.tween(0.8, (k) => player.pos.lerpVectors(top, seatW, k), (k) => k);
    player.sitOn(this.seat, ZERO, 0, null);
    player.char.clearAction();
    player.cam.yaw = Math.PI / 2;
    player.cam.pitch = 0.85; // look down into the well
    player.cam.targetDist = 5;
    passport.stamp('kuan');
    ui.toast(tk('🏍️ Hold on to the railing! Press E to climb down.', '🏍️ Hold on to the railing! Tap “Climb down” to leave.'), 4000, { important: true });
  }

  leaveGallery() {
    const { player } = this.ctx;
    player.standUp(POS.x + R + 2.4, POS.z + 3.6, Math.PI);
    player.cam.targetDist = 5;
    this.watching = false;
  }

  abort() {
    if (!this.watching) return;
    const { player } = this.ctx;
    if (player.char.root.parent !== player.scene) player.scene.attach(player.char.root);
    player.char.clearAction();
    player.mode = 'walk';
    this.watching = false;
  }

  promptLabel() {
    return 'Climb down';
  }

  get help() {
    return { key: [['E', 'Climb down'], ['Drag', 'Look around']], tap: [['👆', 'Climb down'], ['👉', 'Drag to look around']] };
  }

  update(dt, t) {
    const { input, ambience, audio } = this.ctx;
    const { smoke } = this.ctx;
    for (const b of this.bikes) {
      b.phase += b.speed * dt;
      const h = 2.5 + 1.9 * Math.sin(t * 0.33 + b.hPhase);
      const a = b.phase;
      const r = R - 0.04; // wheels on the planks
      const p = _p.set(Math.cos(a) * r, h, Math.sin(a) * r);
      _f.set(-Math.sin(a), 0, Math.cos(a)); // direction of travel
      _u.set(-Math.cos(a), 0.06, -Math.sin(a)).normalize(); // bike "up" points to the centre
      _r.crossVectors(_u, _f).normalize(); // right-handed: x = y × z (the other order mirrors the bike)
      _m.makeBasis(_r, _u, _f);
      b.group.quaternion.setFromRotationMatrix(_m);
      b.group.position.copy(p);
      // stunts: arms out for a couple of seconds now and then
      b.stunt -= dt;
      if (b.stunt <= 0) {
        b.stunt = rand(6, 14);
        b.rider.setAction('cheer');
        setTimeout(() => b.rider.setAction('drive'), 2200);
      }
      b.rider.update(dt);
      if (smoke) {
        b.dust += dt * 9;
        if (b.dust >= 1) {
          b.dust = 0;
          smoke.puff(POS.x + p.x - _f.x * 0.9, p.y, POS.z + p.z - _f.z * 0.9, { kind: 'dust', count: 1, size: 0.25, grow: 0.9, rise: 0.15, drift: 0.4, life: 0.8, peak: 0.22, vx: -_f.x * 1.2, vz: -_f.z * 1.2 });
        }
      }
    }
    if (ambience?.started && !this.engineSrc) {
      this.engineSrc = ambience.addSource('kuan', POS.x, POS.z, 10, 42, 0.14, (out) => {
        const ctx = audio.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const o2 = ctx.createOscillator();
        o2.type = 'square';
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700;
        const g2 = ctx.createGain();
        g2.gain.value = 0.4;
        o.connect(lp);
        o2.connect(g2).connect(lp);
        lp.connect(out);
        o.start();
        o2.start();
        return (d, tt) => {
          const rev = 95 + 25 * Math.sin(tt * 1.9) + 10 * Math.sin(tt * 5.3);
          o.frequency.value = rev;
          o2.frequency.value = rev / 2;
        };
      });
    }
    for (const s of this.spectators) {
      if (Math.random() < dt * 0.08) {
        s.setAction('cheer');
        setTimeout(() => s.clearAction(), 1800);
      }
      s.update(dt);
    }
    if (this.watching && input.pressedAction('interact')) {
      input.consumeAction('interact');
      this.leaveGallery();
    }
  }
}
