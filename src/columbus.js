import * as THREE from 'three';
import { shape, merged } from './character.js';
import { beam, hdr, setLayer, WARM_PALETTE } from './utils.js';
import { mergeStatic } from './merge.js';
import { signTexture } from './stalls.js';
import { settings } from './settings.js';

/*
  The Columbus: a swinging boat ride north of the carousel. Board at rest, it swings higher and
  higher for half a minute, then eases down. E asks it to stop early.
*/
const POS = new THREE.Vector3(-26, 0, 49);
const PIVOT_H = 7;
const ARM = 6.2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const ZERO = new THREE.Vector3();

export class Columbus {
  constructor(ctx, lights) {
    this.ctx = ctx;
    const { scene, world, interactions, player } = ctx;
    this.group = new THREE.Group();
    this.group.position.copy(POS);
    scene.add(this.group);
    this.state = 'idle'; // idle | ride | stopping
    this.amp = 0;
    this.phase = 0;
    this.rideT = 0;

    const steel = std(0xe8e4f0, 0.35, { metalness: 0.6 });
    const red = std(0xa4161a, 0.5, { metalness: 0.3 });
    for (const z of [-1.8, 1.8]) {
      for (const x of [-3.4, 3.4]) this.group.add(beam(V(x, 0, z), V(0, PIVOT_H, z), 0.16, red));
      this.group.add(beam(V(-3.4, 2.6, z), V(3.4, 2.6, z), 0.08, red));
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4.2, 12), steel);
    axle.rotation.x = Math.PI / 2;
    axle.position.y = PIVOT_H;
    this.group.add(axle);

    this.pivot = new THREE.Group();
    this.pivot.position.y = PIVOT_H;
    this.group.add(this.pivot);
    for (const z of [-1.2, 1.2]) this.pivot.add(beam(V(0, 0, z), V(0, -ARM + 0.4, z), 0.07, steel));

    // the gondola: a shallow boat with two benches facing each other
    const gondola = new THREE.Group();
    gondola.position.y = -ARM;
    const hull = merged(
      [
        shape(new THREE.BoxGeometry(4.2, 0.12, 2.2), 0x6b3f22, [0, -0.2, 0]),
        shape(new THREE.BoxGeometry(4.2, 0.9, 0.08), 0xc1121f, [0, 0.25, 1.1]),
        shape(new THREE.BoxGeometry(4.2, 0.9, 0.08), 0xc1121f, [0, 0.25, -1.1]),
        shape(new THREE.BoxGeometry(0.08, 0.9, 2.2), 0xffd166, [-2.1, 0.25, 0]),
        shape(new THREE.BoxGeometry(0.08, 0.9, 2.2), 0xffd166, [2.1, 0.25, 0]),
        shape(new THREE.ConeGeometry(0.9, 1.2, 4), 0xc1121f, [-2.6, 0.2, 0], [0, Math.PI / 4, Math.PI / 2]),
        shape(new THREE.ConeGeometry(0.9, 1.2, 4), 0xc1121f, [2.6, 0.2, 0], [0, Math.PI / 4, -Math.PI / 2]),
        shape(new THREE.BoxGeometry(3.6, 0.08, 0.4), 0x8a5a2b, [0, 0.2, 0.6]),
        shape(new THREE.BoxGeometry(3.6, 0.08, 0.4), 0x8a5a2b, [0, 0.2, -0.6]),
        shape(new THREE.BoxGeometry(3.6, 0.06, 0.12), 0xd4a017, [0, 0.6, 0]),
      ],
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })
    );
    gondola.add(hull);
    const bulbMat = new THREE.MeshBasicMaterial({ color: hdr(0xffd08a, 3) });
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bulbMat);
      b.position.set(-2 + i * 0.44, 0.72, i % 2 ? 1.1 : -1.1);
      gondola.add(b);
    }
    this.seat = new THREE.Object3D();
    this.seat.position.set(0, -0.25, 0.6);
    this.seat.rotation.y = Math.PI; // face across the boat
    gondola.add(this.seat);
    this.pivot.add(gondola);
    this.gondola = gondola;

    // boarding platform and steps on the +z side
    const plat = new THREE.Mesh(new THREE.BoxGeometry(5, 0.9, 1.6), std(0x6b3f22, 0.8));
    plat.position.set(0, 0.45, 2.3);
    this.group.add(plat);
    for (let i = 0; i < 3; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3 * (i + 1), 0.4), std(0x6b3f22, 0.8));
      step.position.set(0, 0.15 * (i + 1), 3.1 + 0.4 * (2 - i));
      this.group.add(step);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 0.9),
      new THREE.MeshBasicMaterial({ map: signTexture('Columbus', 'Swinging boat · press E to ride', '#6a0d2b', '#ffe7a3', 1024, 288), color: new THREE.Color(1.2, 1.2, 1.2), side: THREE.DoubleSide })
    );
    sign.position.set(0, PIVOT_H + 0.9, 1.9);
    this.group.add(sign);
    lights.addStrand(V(POS.x - 3.4, 2.6, POS.z + 1.8), V(POS.x + 3.4, 2.6, POS.z + 1.8), { sag: 0.4, palette: WARM_PALETTE });
    for (const z of [-1.8, 1.8]) lights.addPolyline([V(POS.x - 3.4, 0.3, POS.z + z), V(POS.x, PIVOT_H, POS.z + z), V(POS.x + 3.4, 0.3, POS.z + z)], { spacing: 0.4, mode: 'chase' });
    const light = new THREE.PointLight(0xff9f6b, 60, 20, 2);
    light.position.set(0, 5, 3);
    this.group.add(light);

    // frame and platform as one mesh per look; the swinging pivot (arms, boat, bulbs) as another set
    mergeStatic(this.group, { skip: (o) => o === this.pivot });
    mergeStatic(this.pivot);
    setLayer(this.group, 1);
    world.colliders.push({ type: 'box', minX: POS.x - 3.7, maxX: POS.x + 3.7, minZ: POS.z - 2.2, maxZ: POS.z + 3.2 });
    world.tall.push({ type: 'box', minX: POS.x - 7, maxX: POS.x + 7, minZ: POS.z - 2.4, maxZ: POS.z + 2.4, h: PIVOT_H + 1.5 });

    interactions.add({
      pos: V(POS.x, 0, POS.z + 4.4),
      radius: 2.8,
      markerHeight: 2.6,
      markAt: V(POS.x, 0.9, POS.z + 2.3),
      label: 'Ride the Columbus 🚢',
      enabled: () => player.mode === 'walk' && this.state === 'idle' && Math.abs(this.pivot.rotation.z) < 0.03,
      action: () => this.board(),
    });
  }

  async board() {
    const { player, tasks, ui, passport } = this.ctx;
    this.state = 'boarding';
    player.mode = 'anim';
    player.vel.set(0, 0, 0);
    const top = V(POS.x, 0.9, POS.z + 2.3);
    const from = player.pos.clone();
    player.faceTowards(top.x, top.z);
    player.animSpeed = 2;
    await tasks.tween(Math.max(0.3, from.distanceTo(top) / 2.2), (k) => player.pos.lerpVectors(from, top, k), (k) => k);
    player.animSpeed = 0;
    const seatW = this.seat.getWorldPosition(new THREE.Vector3());
    player.char.setAction('sit');
    await tasks.tween(0.5, (k) => {
      player.pos.lerpVectors(top, seatW, k);
      player.pos.y += Math.sin(k * Math.PI) * 0.4;
    });
    player.sitOn(this.seat, ZERO, 0, 'sit');
    player.cam.targetDist = 7;
    player.cam.pitch = 0.3;
    this.state = 'ride';
    this.rideT = 0;
    passport.stamp('columbus');
    ui.toast('🚢 Hold tight! Press E when you want it to stop.', 4000, { important: true });
  }

  alight() {
    const { player } = this.ctx;
    player.standUp(POS.x, POS.z + 4.6, 0);
    player.cam.targetDist = 5;
    this.state = 'idle';
    this.amp = 0;
  }

  abort() {
    if (this.state === 'idle') return;
    const { player } = this.ctx;
    if (player.char.root.parent !== player.scene) player.scene.attach(player.char.root);
    player.char.clearAction();
    player.mode = 'walk';
    this.state = 'idle';
    this.amp = 0;
  }

  promptLabel() {
    return this.state === 'stopping' ? 'Slowing down…' : 'Stop the ride';
  }

  get help() {
    return [['E', 'Stop the ride'], ['Drag', 'Look around']];
  }

  update(dt, t) {
    const { input, player } = this.ctx;
    const maxAmp = settings.reduceMotion ? 0.55 : 1.05;
    if (this.state === 'ride') {
      this.rideT += dt;
      const target = this.rideT < 32 ? maxAmp : 0;
      if (this.rideT >= 32) this.state = 'stopping';
      this.amp += (target - this.amp) * (1 - Math.exp(-dt * 0.18));
      if (input.pressedAction('interact')) {
        input.consumeAction('interact');
        this.state = 'stopping';
      }
    } else if (this.state === 'stopping') {
      this.amp += (0 - this.amp) * (1 - Math.exp(-dt * 0.35));
      if (this.amp < 0.03 && Math.abs(this.pivot.rotation.z) < 0.05) this.alight();
    }
    if (this.state === 'ride' || this.state === 'stopping') {
      this.phase += dt * Math.sqrt(9.8 / ARM);
      player.heading = player.targetHeading = Math.PI;
    } else {
      this.phase = 0;
    }
    this.pivot.rotation.z = this.amp * Math.sin(this.phase);
  }
}
