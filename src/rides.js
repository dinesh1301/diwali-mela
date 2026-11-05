import { tk } from './touch.js';
import * as THREE from 'three';
import { shape, merged } from './character.js';
import { canvasTexture, setLayer, DAY } from './utils.js';
import { signTexture } from './stalls.js';
import { slot } from './personalSlots.js';
import { SITES } from './world.js';

const TWO_PI = Math.PI * 2;
const N_ANIMALS = 10;
const RING = 4.4;

// ---------- carousel animals (vertex-coloured, one mesh each) ----------

function horse(body, mane, saddle) {
  const parts = [
    shape(new THREE.CapsuleGeometry(0.2, 0.7, 4, 10), body, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1.05]),
    shape(new THREE.CylinderGeometry(0.1, 0.13, 0.55, 8), body, [0, 0.3, 0.42], [0.6, 0, 0]),
    shape(new THREE.BoxGeometry(0.16, 0.18, 0.4), body, [0, 0.56, 0.64], [0.35, 0, 0]),
    shape(new THREE.ConeGeometry(0.03, 0.1, 5), body, [-0.05, 0.7, 0.52]),
    shape(new THREE.ConeGeometry(0.03, 0.1, 5), body, [0.05, 0.7, 0.52]),
    shape(new THREE.BoxGeometry(0.04, 0.4, 0.12), mane, [0, 0.42, 0.33], [0.6, 0, 0]),
    shape(new THREE.ConeGeometry(0.07, 0.5, 6), mane, [0, -0.05, -0.62], [-2.2, 0, 0]),
    shape(new THREE.BoxGeometry(0.36, 0.06, 0.42), saddle, [0, 0.21, -0.02]),
    shape(new THREE.BoxGeometry(0.42, 0.22, 0.3), saddle, [0, 0.1, -0.02]),
  ];
  for (const [x, z, rx] of [[-0.11, 0.3, -0.6], [0.11, 0.3, -0.4], [-0.11, -0.3, 0.35], [0.11, -0.3, 0.2]]) {
    parts.push(shape(new THREE.CylinderGeometry(0.045, 0.035, 0.6, 6), body, [x, -0.38, z], [rx, 0, 0]));
    parts.push(shape(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 6), 0xd4a017, [x, -0.66, z + rx * -0.25], [rx, 0, 0]));
  }
  return merged(parts);
}

function elephant(body, blanket) {
  const parts = [
    shape(new THREE.SphereGeometry(0.3, 14, 10), body, [0, 0, -0.05], [], [1.05, 0.95, 1.35]),
    shape(new THREE.SphereGeometry(0.22, 12, 10), body, [0, 0.15, 0.42]),
    shape(new THREE.CylinderGeometry(0.06, 0.035, 0.45, 8), body, [0, -0.08, 0.6], [0.35, 0, 0]),
    shape(new THREE.SphereGeometry(0.16, 10, 8), body, [-0.2, 0.15, 0.36], [], [0.3, 1, 0.8]),
    shape(new THREE.SphereGeometry(0.16, 10, 8), body, [0.2, 0.15, 0.36], [], [0.3, 1, 0.8]),
    shape(new THREE.ConeGeometry(0.025, 0.18, 5), 0xfff8e7, [-0.09, -0.02, 0.58], [1.9, 0, 0]),
    shape(new THREE.ConeGeometry(0.025, 0.18, 5), 0xfff8e7, [0.09, -0.02, 0.58], [1.9, 0, 0]),
    shape(new THREE.BoxGeometry(0.5, 0.06, 0.5), blanket, [0, 0.28, -0.05]),
    shape(new THREE.BoxGeometry(0.62, 0.3, 0.5), blanket, [0, 0.12, -0.05]),
    shape(new THREE.SphereGeometry(0.05, 8, 6), 0xd4a017, [0, 0.33, 0.55]),
  ];
  for (const [x, z] of [[-0.16, 0.2], [0.16, 0.2], [-0.16, -0.3], [0.16, -0.3]]) parts.push(shape(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8), body, [x, -0.38, z]));
  return merged(parts);
}

/** A spinning carousel with bobbing horses and elephants. */
export class Carousel {
  constructor(scene, pos) {
    this.pos = pos.clone();
    this.speed = 0.35;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);

    const red = new THREE.MeshStandardMaterial({ color: 0x9b1d2a, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.3, metalness: 0.75 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(6.3, 6.6, 0.45, 48), red);
    base.position.y = 0.225;
    this.group.add(base);

    this.spin = new THREE.Group();
    this.spin.position.y = 0.45;
    this.group.add(this.spin);

    const floorTex = canvasTexture(512, 512, (c, w) => {
      c.translate(w / 2, w / 2);
      for (let i = 0; i < 24; i++) {
        c.fillStyle = i % 2 ? '#f3e3c3' : '#c1121f';
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, w / 2, (i / 24) * TWO_PI, ((i + 1) / 24) * TWO_PI);
        c.fill();
      }
    });
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.06, 48), [new THREE.MeshStandardMaterial({ color: 0x7a1424 }), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }), red]);
    this.spin.add(floor);

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 4.1, 24), new THREE.MeshStandardMaterial({ color: 0xe8d8b8, roughness: 0.3, metalness: 0.5 }));
    column.position.y = 2.05;
    this.spin.add(column);

    const canopyTex = canvasTexture(512, 128, (c, w, h) => {
      for (let i = 0; i < 16; i++) {
        c.fillStyle = i % 2 ? '#ffd166' : '#e0218a';
        c.fillRect((i * w) / 16, 0, w / 16 + 1, h);
      }
    });
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(6.9, 2, 32, 1, true), new THREE.MeshStandardMaterial({ map: canopyTex, side: THREE.DoubleSide, roughness: 0.8 }));
    canopy.position.y = 5.1;
    this.spin.add(canopy);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(6.9, 6.9, 0.5, 48, 1, true), new THREE.MeshStandardMaterial({ map: canopyTex, side: THREE.DoubleSide }));
    rim.position.y = 3.85;
    this.spin.add(rim);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 10), gold);
    finial.position.y = 6.5;
    this.spin.add(finial);

    // bulbs along the canopy rim and up the column
    const pts = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TWO_PI;
      pts.push(new THREE.Vector3(Math.cos(a) * 6.95, 3.6, Math.sin(a) * 6.95));
    }
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TWO_PI;
      pts.push(new THREE.Vector3(Math.cos(a) * 3.5, 5.6, Math.sin(a) * 3.5));
    }
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial(), pts.length);
    pts.forEach((p, i) => {
      this.bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      this.bulbs.setColorAt(i, new THREE.Color(1, 1, 1));
    });
    this.bulbs.computeBoundingSphere();
    this.spin.add(this.bulbs);

    // animals on brass poles
    const pole = new THREE.CylinderGeometry(0.035, 0.035, 3.5, 8);
    const bodies = [0xfff8e7, 0x6b3f22, 0xf3e3c3, 0x2b2d42, 0xffffff];
    const accents = [0xe0218a, 0x3a86ff, 0x06d6a0, 0xffbe0b, 0x8338ec];
    this.animals = [];
    for (let i = 0; i < N_ANIMALS; i++) {
      const a = (i / N_ANIMALS) * TWO_PI;
      const holder = new THREE.Group();
      holder.position.set(Math.cos(a) * RING, 0, Math.sin(a) * RING);
      holder.rotation.y = -a; // face along the direction of travel
      this.spin.add(holder);
      const p = new THREE.Mesh(pole, gold);
      p.position.y = 1.75;
      holder.add(p);
      const mount = new THREE.Group();
      holder.add(mount);
      const isElephant = i % 3 === 2;
      mount.add(isElephant ? elephant(0x9aa0a6, accents[i % accents.length]) : horse(bodies[i % bodies.length], accents[(i + 2) % accents.length], accents[i % accents.length]));
      const seat = new THREE.Group();
      seat.position.set(0, isElephant ? 0.31 : 0.24, -0.02);
      mount.add(seat);
      this.animals.push({ holder, mount, seat, phase: i * 1.3, angle: a });
    }

    // a sign out front
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.85),
      new THREE.MeshBasicMaterial({ map: signTexture(slot('ride.carousel.sign'), tk('Press E to ride', 'Tap the button to ride', 'Round and round we go'), '#6a0d2b'), color: new THREE.Color(1, 1, 1) })
    );
    sign.position.set(7.6, 2.2, 2.6);
    sign.rotation.y = Math.PI / 2;
    this.group.add(sign);

    this.light = new THREE.PointLight(0xffb46b, 60, 20, 2);
    this.light.position.set(0, 3, 0);
    this.group.add(this.light);

    setLayer(this.group, 1);
    this.collider = { type: 'circle', x: pos.x, z: pos.z, r: 6.7 };
    this.tmp = new THREE.Color();
  }

  update(dt, t) {
    this.spin.rotation.y -= this.speed * dt;
    for (const a of this.animals) a.mount.position.y = 1.15 + Math.sin(t * 1.6 + a.phase) * 0.3;
    const c = this.tmp;
    const n = this.bulbs.count;
    for (let i = 0; i < n; i++) {
      const on = (Math.floor(t * 6) + i) % 3 === 0;
      c.setHSL(i < 72 ? 0.11 : 0.92, 1, 0.6).multiplyScalar((on ? 3 : 0.8) * (0.03 + 0.97 * DAY.lights));
      this.bulbs.setColorAt(i, c);
    }
    this.bulbs.instanceColor.needsUpdate = true;
  }

  /** The animal currently nearest the entrance (east side, facing the bazaar). */
  nearestToEntrance() {
    let best = this.animals[0];
    let bestD = Infinity;
    const v = new THREE.Vector3();
    for (const a of this.animals) {
      a.holder.getWorldPosition(v);
      const d = Math.hypot(v.x - (this.pos.x + 7), v.z - this.pos.z);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }
}

/** Boarding the giant wheel and the carousel: walk up, press E, press E again to get off. */
export class Rides {
  constructor(ctx, wheel) {
    this.ctx = ctx;
    this.wheel = wheel;
    this.carousel = new Carousel(ctx.scene, SITES.carousel);
    ctx.world.colliders.push(this.carousel.collider);
    this.active = null;
    const { interactions, player } = ctx;
    const w = SITES.wheel;
    interactions.add({
      pos: new THREE.Vector3(w.x, 0, w.z + 4.9),
      radius: 3,
      markerHeight: 3.2,
      label: 'Ride the Giant Wheel 🎡',
      enabled: () => player.mode === 'walk',
      action: () => this.boardWheel(),
    });
    const c = SITES.carousel;
    interactions.add({
      pos: new THREE.Vector3(c.x + 7.4, 0, c.z),
      radius: 3,
      markerHeight: 3.2,
      label: 'Ride the carousel 🎠',
      enabled: () => player.mode === 'walk',
      action: () => this.boardCarousel(),
    });
  }

  boardWheel() {
    const { player, ui, passport } = this.ctx;
    this.wheel.startRide();
    const g = this.wheel.gondolas[this.wheel.ride.index];
    player.sitOn(g, new THREE.Vector3(0, -2.09, -0.4), 0, 'sit');
    player.cam.yaw = Math.PI * 0.85;
    player.cam.pitch = 0.15;
    player.cam.targetDist = 3.5;
    this.active = 'wheel';
    ui.toast(`${slot('toast.wheel.on')} ${tk('Press E to get off.', 'Tap “Get off” when you are done.')}`);
    passport.stamp('wheel');
  }

  boardCarousel() {
    const { player, ui, passport } = this.ctx;
    const animal = this.carousel.nearestToEntrance();
    player.sitOn(animal.seat, new THREE.Vector3(0, -0.5, 0), 0, 'straddle');
    player.cam.targetDist = 4;
    this.active = 'carousel';
    this.rideTime = 0;
    ui.toast(`${slot('toast.carousel.on')} ${tk('Press E to get off.', 'Tap “Get off” when you are done.')}`);
    passport.stamp('carousel');
  }

  getOff() {
    const { player } = this.ctx;
    if (this.active === 'wheel') {
      this.wheel.stopRide();
      const w = SITES.wheel;
      player.standUp(w.x, w.z + 6.2, 0);
    } else {
      const c = SITES.carousel;
      player.standUp(c.x + 8, c.z, Math.PI / 2);
    }
    player.cam.targetDist = 5;
    this.active = null;
  }

  update(dt, t) {
    this.carousel.update(dt, t);
    if (!this.active) return;
    const { input, ui } = this.ctx;
    if (this.active === 'carousel') {
      this.rideTime += dt;
      if (this.rideTime > 45) {
        this.getOff();
        ui.toast(slot('toast.carousel.off'));
        return;
      }
    }
    if (this.active === 'wheel' && this.wheel.ride?.done) {
      this.getOff();
      ui.toast(slot('toast.wheel.off'));
      return;
    }
    if (input.pressedAction('interact')) {
      input.consumeAction('interact'); // otherwise the same press re-boards you from the exit spot
      this.getOff();
    }
  }
}

