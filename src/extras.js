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
    const bunch = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const b = balloonMesh(pick([0xff006e, 0xffbe0b, 0x3a86ff, 0x06d6a0, 0xfb5607]));
      const a = (i / 9) * Math.PI * 2;
      b.position.set(Math.cos(a) * 0.35, -1.2 - (i % 3) * 0.3, Math.sin(a) * 0.35);
      b.rotation.x = Math.PI;
      bunch.add(b);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), b.position.clone().add(V(0, 0.25, 0))]), new THREE.LineBasicMaterial({ color: 0xdddddd }));
      bunch.add(line);
    }
    this.vendor.handR.add(bunch);
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
}
