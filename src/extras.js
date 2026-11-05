import * as THREE from 'three';
import { Character, randomLook } from './character.js';
import { balloonMesh } from './items.js';
import { setLayer, rand, pick } from './utils.js';

/*
  Scripted crowd scenes layered over the wandering NPCs: kids running with sparklers round the
  chowk, a queue at the giant wheel, families on the ghat steps, a balloon
  seller doing his rounds and a cotton-candy cart.
*/
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const std = (color, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });

export class CrowdScenes {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene, fireworks, world } = ctx;
    this.all = [];

    const person = (look, x, z, heading = 0, action = null) => {
      const ch = new Character(look);
      ch.root.position.set(x, 0, z);
      ch.root.rotation.y = heading;
      if (action) ch.setAction(action);
      setLayer(ch.root, 1);
      scene.add(ch.root);
      this.all.push(ch);
      return ch;
    };

    // ---- kids with sparklers racing around the chowk ----
    this.kids = [];
    for (let i = 0; i < 3; i++) {
      const ch = person(randomLook({ kid: true }), 0, 0);
      ch.holdL = 'holdUp';
      const kid = { ch, a: (i / 3) * Math.PI * 2 + 1, r: 8.6 + i * 0.5, speed: 0.28 + i * 0.03 };
      this.kids.push(kid);
      fireworks.phuljhadi?.(
        (out) => {
          ch.handL.getWorldPosition(out);
          return ch.root.rotation.y;
        },
        null,
        { duration: Infinity, light: false, rate: 420 }
      );
    }
    const parent = person(randomLook(), 10.5, 3, Math.atan2(-10.5, -3));
    parent.setAction('clap');
    this.parent = parent;

    // ---- queue at the giant wheel ----
    this.queue = [];
    for (let i = 0; i < 4; i++) {
      const ch = person(randomLook({ kid: i === 1 }), -34.2 + (i % 2) * 0.5, -19.6 + i * 0.95, Math.PI);
      this.queue.push({ ch, next: rand(2, 8) });
    }

    // ---- families on the ghat steps, watching the river ----
    for (const [x, kid] of [[-30, false], [-28.9, true], [-16, false], [-9, false], [9, false], [10.1, true], [20, false], [27, false]]) {
      const ch = person(randomLook({ kid }), x, -46.0, Math.PI, 'sit');
      ch.root.position.y = -0.62;
    }

    // ---- balloon seller on his rounds ----
    this.vendor = person(randomLook(), 3, 52, Math.PI);
    this.vendor.holdR = 'holdUp';
    // the bunch floats above his raised hand: balloons up, knots down, every string gathered in
    // his fist. It hangs off the hand but is turned upright in world space each frame (update),
    // so however the arm swings the balloons never tip over or point at the ground.
    const bunch = new THREE.Group();
    this.bunchBalloons = [];
    for (let i = 0; i < 9; i++) {
      const b = balloonMesh(pick([0xff006e, 0xffbe0b, 0x3a86ff, 0x06d6a0, 0xfb5607]));
      const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.35;
      const ring = i % 3; // three tiers, the higher ones spread wider like a real bunch
      const r = 0.2 + ring * 0.09;
      b.position.set(Math.cos(a) * r, 1.0 + ring * 0.24 + (i % 2) * 0.06, Math.sin(a) * r);
      b.userData.home = b.position.clone();
      b.userData.phase = i * 1.7;
      bunch.add(b);
      this.bunchBalloons.push(b);
    }
    // all nine strings are one line-segments draw: hand (origin) to each knot
    this.bunchStrings = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(new Array(18).fill(0).map(() => V(0, 0, 0))), new THREE.LineBasicMaterial({ color: 0xdddddd }));
    this.bunchStrings.frustumCulled = false;
    bunch.add(this.bunchStrings);
    this.bunch = bunch;
    this.vendor.handR.add(bunch);
    this.placeBunch(0);
    this.vendorPath = [V(3, 0, 52), V(3.5, 0, 36), V(-3.2, 0, 24), V(-3.5, 0, 12), V(3.2, 0, 20), V(-3, 0, 44)];
    this.vendorI = 0;
    this.vendorPos = V(3, 0, 52);

    // ---- cotton candy cart ----
    const cart = new THREE.Group();
    cart.position.set(7.2, 0, 54);
    cart.rotation.y = -Math.PI / 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.7), std(0x3a86ff, 0.6));
    box.position.set(0, 0.75, 0);
    cart.add(box);
    for (const x of [-0.45, 0.45]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14).rotateX(Math.PI / 2), std(0x222222));
      w.position.set(x, 0.3, 0.42);
      cart.add(w);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), std(0xc9a46a));
    pole.position.set(0.4, 1.9, -0.2);
    cart.add(pole);
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), std(pick([0xffb3d9, 0xff8fc8, 0xfff0a0]), 0.95));
      c.position.set(0.4 + Math.cos(i * 1.3) * 0.28, 1.6 + i * 0.16, -0.2 + Math.sin(i * 1.3) * 0.28);
      cart.add(c);
    }
    setLayer(cart, 1);
    scene.add(cart);
    world.colliders.push({ type: 'box', minX: 6.8, maxX: 7.6, minZ: 53.3, maxZ: 54.7 });
    this.candyMan = person(randomLook(), 8.3, 54, -Math.PI / 2);
    this.candyNext = 3;
    // everyone not animated by a scene above (the families on the ghat) just idles
    const busy = new Set([...this.kids.map((k) => k.ch), parent, ...this.queue.map((q) => q.ch), this.vendor, this.candyMan]);
    this.idle = this.all.filter((ch) => !busy.has(ch));
  }

  update(dt, t) {
    const { world } = this.ctx;
    for (const k of this.kids) {
      k.a += dt * k.speed;
      const wob = Math.sin(t * 1.3 + k.a) * 0.6;
      const r = k.r + wob;
      k.ch.root.position.set(Math.cos(k.a) * r, 0, Math.sin(k.a) * r);
      k.ch.root.rotation.y = Math.atan2(-Math.sin(k.a), Math.cos(k.a));
      k.ch.update(dt, { speed: 2.6 });
    }
    this.parent.update(dt);
    for (const q of this.queue) {
      q.next -= dt;
      if (q.next <= 0) {
        q.next = rand(3, 9);
        q.ch.setAction(pick(['lookUp', null, 'clap']));
        setTimeout(() => q.ch.clearAction(), 1800);
      }
      q.ch.update(dt);
    }
    // vendor walks his loop
    const target = this.vendorPath[this.vendorI];
    const dx = target.x - this.vendorPos.x;
    const dz = target.z - this.vendorPos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) this.vendorI = (this.vendorI + 1) % this.vendorPath.length;
    else {
      this.vendorPos.x += (dx / d) * 0.9 * dt;
      this.vendorPos.z += (dz / d) * 0.9 * dt;
      world.collide(this.vendorPos, 0.3);
      const want = Math.atan2(dx, dz);
      let dh = want - this.vendor.root.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.vendor.root.rotation.y += dh * (1 - Math.exp(-dt * 6));
    }
    this.vendor.root.position.copy(this.vendorPos);
    this.vendor.update(dt, { speed: d < 0.4 ? 0 : 0.9 });
    this.placeBunch(t);
    this.candyNext -= dt;
    if (this.candyNext <= 0) {
      this.candyNext = rand(4, 10);
      this.candyMan.setAction(pick(['give', 'wave']));
      setTimeout(() => this.candyMan.clearAction(), 1600);
    }
    this.candyMan.update(dt);
    // the rest just idle (the scene members above were already posed once this frame)
    for (const ch of this.idle) ch.update(dt);
  }

  /** Keeps the balloon bunch upright over the vendor's hand, swaying and bobbing a little. */
  placeBunch(t) {
    const { bunch, bunchBalloons: bs } = this;
    // undo the hand's world rotation, then add a slow sway: the bunch stays upright whatever the arm does
    bunch.parent?.getWorldQuaternion(_q).invert();
    _e.set(Math.sin(t * 0.9) * 0.07, 0, Math.sin(t * 0.7 + 1.3) * 0.08);
    bunch.quaternion.copy(_q).multiply(_q2.setFromEuler(_e));
    const p = this.bunchStrings.geometry.attributes.position;
    bs.forEach((b, i) => {
      const h = b.userData.home;
      const ph = b.userData.phase;
      b.position.set(h.x + Math.sin(t * 1.1 + ph) * 0.03, h.y + Math.sin(t * 1.6 + ph) * 0.035, h.z + Math.cos(t * 1.3 + ph) * 0.03);
      b.rotation.set(Math.sin(t * 1.2 + ph) * 0.12, 0, Math.cos(t * 1.0 + ph) * 0.12);
      p.setXYZ(i * 2 + 1, b.position.x, b.position.y - 0.25, b.position.z);
    });
    p.needsUpdate = true;
  }
}
