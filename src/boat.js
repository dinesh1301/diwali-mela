import { tk } from './touch.js';
import * as THREE from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { Character, randomLook } from './character.js';
import { diyaMesh, kandeelMesh } from './items.js';
import { collide } from './physics.js';
import { beam, canvasTexture, hdr, pick, clamp } from './utils.js';
import { mergeStatic, mergeAdded } from './merge.js';
import { seg } from './lod.js';
import { signTexture } from './stalls.js';

/*
  Naav ki Sair: a wooden jetty at the ghat and a rowing boat with a boatman. Press E at the end
  of the jetty, climb in, and the boat follows a loop out among the floating diyas and back.
  E during the ride asks the boatman to head back; Q releases a wish lantern from the water.
*/

const WATER_Y = -1.35;
const FLOAT_Y = WATER_Y + 0.42; // the gunwale rides this high; the hull's draft is 0.16 m
const DECK_Y = -0.3;
const PIER = { x: 10.2, w: 2.6, z0: -45.3, z1: -59 }; // runs out from the top step
const DOCK = new THREE.Vector3(PIER.x, FLOAT_Y, -61.2);
const LOOP = [
  [PIER.x, -61.2],
  [20, -62.5],
  [34, -70],
  [42, -86],
  [30, -102],
  [6, -108],
  [-20, -104],
  [-38, -90],
  [-42, -74],
  [-30, -62],
  [-10, -60.2],
];
const SPEED = 2.3;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const ZERO = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

function plankTexture(base = '#6b3f22', along = 'y') {
  const t = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    // grain in two colours, the strength varied with globalAlpha (no per-stroke colour parsing)
    for (const grain of ['rgb(160,110,60)', 'rgb(30,15,5)']) {
      c.fillStyle = grain;
      for (let i = 0; i < 1250; i++) {
        c.globalAlpha = Math.random() * 0.25;
        c.fillRect(Math.random() * w, Math.random() * h, along === 'y' ? 1 : 6, along === 'y' ? 6 : 1);
      }
    }
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(20,10,4,0.75)';
    for (let k = 0; k < 6; k++) {
      if (along === 'y') c.fillRect((k * w) / 6, 0, 3, h);
      else c.fillRect(0, (k * h) / 6, w, 3);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- the boat ----------

function boatModel() {
  const g = new THREE.Group();
  const L = 5.2;
  const halfW = (u) => 0.95 * Math.pow(Math.sin(Math.PI * u), 0.55) + 0.04;
  const bottom = (u) => -0.58 * Math.pow(Math.sin(Math.PI * u), 0.4) - 0.04;
  const hullGeo = new ParametricGeometry(
    (u, v, out) => {
      const s = v * 2 - 1;
      out.set(halfW(u) * s, bottom(u) * Math.sqrt(Math.max(0, 1 - s * s)), (u - 0.5) * L);
    },
    40,
    14
  );
  const wood = plankTexture('#7a4a28', 'x');
  wood.repeat.set(2, 6);
  const hullMat = std(0xffffff, 0.75, { map: wood, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(hullGeo, hullMat));

  // gunwale: a tube around the rim
  const rim = [];
  for (let i = 0; i <= 40; i++) rim.push(V(halfW(i / 40), 0, (i / 40 - 0.5) * L));
  for (let i = 40; i >= 0; i--) rim.push(V(-halfW(i / 40), 0, (i / 40 - 0.5) * L));
  const rimCurve = new THREE.CatmullRomCurve3(rim, true, 'catmullrom', 0.2);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(rimCurve, seg(160, 80), 0.055, seg(8, 5), true), std(0x3d2a1c, 0.6)));

  const inner = plankTexture('#5a3418', 'y');
  inner.repeat.set(2, 4);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.04, 3.6), std(0xffffff, 0.9, { map: inner }));
  floor.position.y = -0.4;
  g.add(floor);
  const thwart = std(0x8a5a2b, 0.7);
  for (const [z, w] of [[0.2, 1.75], [1.6, 1.55], [-1.5, 1.4]]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.34), thwart);
    seat.position.set(0, -0.08, z);
    g.add(seat);
  }

  // canopy over the passenger: bamboo poles, striped cloth, marigolds along the edges
  const bamboo = std(0xc9a46a, 0.7);
  for (const [x, z] of [[-0.72, -0.5], [0.72, -0.5], [-0.72, 0.95], [0.72, 0.95]]) g.add(beam(V(x, -0.05, z), V(x, 1.65, z), 0.025, bamboo));
  const cloth = canvasTexture(256, 256, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#ffd166' : '#c1121f';
      c.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 1.8), std(0xffffff, 0.9, { map: cloth, side: THREE.DoubleSide }));
  top.position.set(0, 1.68, 0.22);
  g.add(top);
  const petals = [0xff7b00, 0xffc300, 0xff9500];
  const flower = new THREE.SphereGeometry(0.045, seg(8, 5), seg(6, 4));
  const edges = [];
  for (let x = -0.9; x <= 0.9; x += 0.09) edges.push([x, -0.68], [x, 1.12]);
  for (let z = -0.6; z <= 1.05; z += 0.09) edges.push([-0.9, z], [0.9, z]);
  const marigolds = new THREE.InstancedMesh(flower, std(0xffffff, 0.85), edges.length);
  const m = new THREE.Matrix4();
  edges.forEach(([x, z], i) => {
    marigolds.setMatrixAt(i, m.makeTranslation(x, 1.62 + Math.sin(i * 1.7) * 0.02, z));
    marigolds.setColorAt(i, new THREE.Color(petals[i % 3]));
  });
  g.add(marigolds);

  const lantern = kandeelMesh(0xff7a00);
  lantern.scale.setScalar(0.55);
  lantern.position.set(0, 1.58, 1.0);
  g.add(lantern);
  const glow = new THREE.PointLight(0xffb060, 10, 7, 2);
  glow.position.set(0, 1.1, 0.9);
  g.add(glow);
  const bowDiya = diyaMesh();
  bowDiya.scale.setScalar(1.4);
  bowDiya.position.set(0, 0.02, 2.3);
  g.add(bowDiya);
  const bulbMat = new THREE.MeshBasicMaterial({ color: hdr(0xffd08a, 3) });
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bulbMat);
    b.position.set(-0.9 + i * 0.2, 1.52, 1.12);
    g.add(b);
  }

  // oars pivot at the oarlocks; the blade points outboard along local +x (mirrored for the left)
  const oars = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.98, 0.06, 1.25);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 2.9, 8), std(0xc9a46a, 0.6));
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = s * 0.95;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.16), std(0x8a5a2b, 0.6));
    blade.position.x = s * 2.3;
    pivot.add(shaft, blade);
    g.add(pivot);
    return { pivot, s };
  });

  const seat = new THREE.Object3D();
  seat.position.set(0, -0.55, 0.2);
  g.add(seat);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshBasicMaterial({ map: signTexture('Ganga Naav', null, '#13306b'), transparent: true, color: new THREE.Color(1.2, 1.2, 1.2) }));
  plate.position.set(0.97, -0.12, -1.2);
  plate.rotation.y = Math.PI / 2;
  g.add(plate);
  // hull, rim, canopy, bulbs and lantern: one mesh per look; oars swing, the diya flickers
  const oarSet = new Set(oars.map((o) => o.pivot));
  mergeStatic(g, { skip: (o) => oarSet.has(o) });
  return { group: g, seat, oars };
}

export class BoatRide {
  constructor(ctx, { wish } = {}) {
    this.ctx = ctx;
    this.wish = wish;
    const { scene, world, interactions, player } = ctx;
    this.state = 'docked'; // docked | boarding | ride | landing
    this.returning = false;
    this.u = 0;
    this.phase = 0;
    this.t = 0;
    this.curve = new THREE.CatmullRomCurve3(LOOP.map(([x, z]) => V(x, WATER_Y, z)), true, 'centripetal');
    this.length = this.curve.getLength();

    this.buildPier();

    const model = boatModel();
    this.group = model.group;
    this.seat = model.seat;
    this.oars = model.oars;
    this.group.rotation.order = 'YXZ';
    this.group.position.copy(DOCK);
    this.heading = Math.PI / 2;
    this.group.rotation.y = this.heading;
    scene.add(this.group);

    this.boatman = new Character(randomLook({}));
    this.boatman.root.position.set(0, -0.55, 1.6);
    this.boatman.root.rotation.y = Math.PI;
    this.boatman.setAction('row', 0);
    this.group.add(this.boatman.root);

    world.colliders.push({ type: 'box', minX: PIER.x - 1.4, maxX: PIER.x + 1.4, minZ: -62.2, maxZ: -60.2 }); // the docked boat, for anyone wading

    interactions.add({
      pos: V(PIER.x, 0, PIER.z1 + 0.6),
      radius: 2.3,
      markAt: V(PIER.x, DECK_Y, DOCK.z),
      markerHeight: 2.0,
      label: 'Take a boat ride 🛶',
      enabled: () => player.mode === 'walk' && this.state === 'docked',
      action: () => this.board(),
    });
  }

  // ---------- jetty ----------

  buildPier() {
    const { scene, world } = this.ctx;
    const { x, w, z0, z1 } = PIER;
    const before = new Set(scene.children);
    const len = z0 - z1;
    const zc = (z0 + z1) / 2;
    const planks = plankTexture('#6b3f22', 'y');
    planks.repeat.set(1, 6);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, len), std(0xffffff, 0.9, { map: planks }));
    deck.position.set(x, DECK_Y - 0.07, zc);
    scene.add(deck);
    const postMat = std(0x3d2a1c, 0.8);
    for (let z = z0 - 0.3; z >= z1 + 0.2; z -= 2.4) {
      for (const s of [-1, 1]) {
        scene.add(beam(V(x + s * (w / 2 - 0.1), -2.2, z), V(x + s * (w / 2 - 0.1), DECK_Y + 1.05, z), 0.07, postMat));
      }
    }
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, len - 0.4), std(0x8a5a2b, 0.6));
      rail.position.set(x + s * (w / 2 - 0.1), DECK_Y + 1.05, zc - 0.1);
      scene.add(rail);
      world.colliders.push({ type: 'box', minX: x + s * (w / 2) - 0.12, maxX: x + s * (w / 2) + 0.12, minZ: z1 - 0.2, maxZ: z0 - 0.6 });
    }
    // lanterns on the end posts
    for (const s of [-1, 1]) {
      const d = diyaMesh();
      d.position.set(x + s * (w / 2 - 0.1), DECK_Y + 1.1, z1 + 0.2);
      d.scale.setScalar(1.3);
      scene.add(d);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.73),
      new THREE.MeshBasicMaterial({ map: signTexture('Naav ki Sair', tk('Boat ride · press E at the jetty', 'Boat ride · tap the button at the jetty'), '#13306b'), color: new THREE.Color(1.2, 1.2, 1.2), side: THREE.DoubleSide })
    );
    sign.position.set(x + 2.6, 2.2, -43.4);
    scene.add(sign);
    scene.add(beam(V(x + 2.6, 0, -43.4), V(x + 2.6, 1.85, -43.4), 0.06, postMat));
    world.colliders.push({ type: 'circle', x: x + 2.6, z: -43.4, r: 0.15 });
    const lamp = new THREE.PointLight(0xffb46b, 30, 14, 2);
    lamp.position.set(x, 1.6, z1 + 2);
    scene.add(lamp);
    mergeAdded(scene, before);

    // the deck is walkable: patch the world's ground height and bounds for anyone on it
    const onPier = (px, pz) => px > x - w / 2 && px < x + w / 2 && pz < z0 + 0.2 && pz > z1;
    const baseGround = world.groundHeight;
    world.groundHeight = (px, pz) => (onPier(px, pz) ? DECK_Y : baseGround(px, pz));
    const pierBounds = { ...world.bounds, minZ: z1 + 0.35 };
    world.collide = (p, r) => collide(world.colliders, onPier(p.x, p.z) ? pierBounds : world.bounds, p, r);
  }

  // ---------- boarding ----------

  async board() {
    if (this.state !== 'docked') return;
    const { player, tasks, ui, passport, audio } = this.ctx;
    this.state = 'boarding';
    this.stash = player.held;
    if (this.stash) {
      player.held = null;
      player.char.holdR = null;
      this.stash.obj.visible = false;
    }
    player.mode = 'anim';
    player.vel.set(0, 0, 0);
    const edge = V(PIER.x, DECK_Y, PIER.z1 + 0.45);
    const from = player.pos.clone();
    const d = from.distanceTo(edge);
    if (d > 0.2) {
      player.faceTowards(edge.x, edge.z);
      player.animSpeed = 2.2;
      await tasks.tween(d / 2.2, (k) => player.pos.lerpVectors(from, edge, k), (k) => k);
      player.animSpeed = 0;
    }
    player.faceTowards(DOCK.x, DOCK.z);
    await tasks.wait(0.2);
    audio.splash();
    this.group.updateMatrixWorld(true);
    const seatW = this.seat.getWorldPosition(new THREE.Vector3());
    const h0 = player.heading;
    player.char.setAction('sit');
    await tasks.tween(0.6, (k) => {
      player.pos.lerpVectors(edge, seatW, k);
      player.pos.y += Math.sin(k * Math.PI) * 0.35;
      player.heading = player.targetHeading = h0 + (this.heading - h0) * k;
    });
    player.sitOn(this.seat, ZERO, 0, 'sit');
    player.cam.yaw = this.heading + Math.PI;
    player.cam.pitch = 0.2;
    player.cam.targetDist = 6;
    this.state = 'ride';
    this.returning = false;
    this.u = 0;
    this.speed = 0;
    this.rideT = 0;
    this.nextLine = 6;
    passport.stamp('boat');
    ui.bubble((o) => this.boatman.headTop.getWorldPosition(o), 'Baithiye! Enjoy the river 🙏', 2.5);
    ui.toast(tk('🛶 Sit back and enjoy the ride. Press E to head back, Q to release a wish lantern.', '🛶 Sit back and enjoy the ride. Tap “Return to the jetty” to head back, or 🏮 to release a wish lantern.'), 5000, { important: true });
  }

  async land() {
    const { player, tasks, audio, ui } = this.ctx;
    this.state = 'landing';
    this.speed = 0;
    const edge = V(PIER.x, DECK_Y, PIER.z1 + 0.45);
    player.scene.attach(player.char.root);
    player.pos.copy(player.char.root.position);
    player.mode = 'anim';
    player.heading = player.targetHeading = this.heading;
    player.char.clearAction();
    const from = player.pos.clone();
    await tasks.tween(0.6, (k) => {
      player.pos.lerpVectors(from, edge, k);
      player.pos.y += Math.sin(k * Math.PI) * 0.35;
    });
    audio.splash();
    player.mode = 'walk';
    player.teleport(edge.x, edge.z, 0);
    if (this.stash) {
      this.stash.obj.visible = true;
      player.held = this.stash;
      player.char.holdR = this.stash.pose ?? 'hold';
      this.stash = null;
    }
    player.cam.targetDist = 5;
    player.cam.pitch = 0.22;
    this.state = 'docked';
    ui.bubble((o) => this.boatman.headTop.getWorldPosition(o), 'Phir aaiyega! 👋', 2.2);
  }

  /** Used by teleports: drop everything and put the boat back (the climb in/out finishes first). */
  abort() {
    if (this.state !== 'ride') return;
    const { player } = this.ctx;
    if (player.char.root.parent !== player.scene) player.scene.attach(player.char.root);
    player.char.clearAction();
    player.mode = 'walk';
    if (this.stash) {
      this.stash.obj.visible = true;
      player.held = this.stash;
      player.char.holdR = this.stash.pose ?? 'hold';
      this.stash = null;
    }
    this.group.position.copy(DOCK);
    this.heading = Math.PI / 2;
    this.group.rotation.set(0, this.heading, 0);
    this.state = 'docked';
  }

  get riding() {
    return this.state === 'ride';
  }

  promptLabel() {
    return this.returning ? 'Heading back to the jetty…' : 'Return to the jetty';
  }

  prompt2Label() {
    return this.wish ? 'Release a wish lantern 🏮' : null;
  }

  get help() {
    return { key: [['E', 'Head back'], ['Q', 'Wish lantern'], ['Drag', 'Look around'], ['Scroll', 'Zoom']], tap: [['👆', 'Head back'], ['🏮', 'Wish lantern'], ['👉', 'Drag to look around']] };
  }

  // ---------- per frame ----------

  update(dt, t) {
    this.t = t;
    const { player, input, ui, audio, world } = this.ctx;
    const bob = Math.sin(t * 1.3) * 0.035;
    let moving = 0;

    if (this.state === 'ride') {
      this.rideT += dt;
      const target = this.returning ? SPEED * 2.1 : SPEED;
      this.speed += (target - this.speed) * (1 - Math.exp(-dt * 0.8));
      this.u += (this.speed * dt) / this.length;
      moving = clamp(this.speed / SPEED, 0, 1);
      if (this.u >= 1) {
        this.u = 0;
        this.land();
      } else {
        const p = this.curve.getPointAt(this.u, _p);
        const tan = this.curve.getTangentAt(this.u, _t);
        const want = Math.atan2(tan.x, tan.z);
        let d = want - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += d * (1 - Math.exp(-dt * 2.5));
        this.group.position.set(p.x, FLOAT_Y + bob, p.z);
        this.group.rotation.set(Math.sin(t * 1.1) * 0.02, this.heading, Math.cos(t * 0.9) * 0.025 - d * 0.12);
        player.heading = player.targetHeading = this.heading;
      }
      if (input.pressedAction('interact') && !this.returning) {
        input.consumeAction('interact');
        this.returning = true;
        ui.bubble((o) => this.boatman.headTop.getWorldPosition(o), 'Theek hai, wapas chalte hain 🙂', 2);
      }
      if (input.pressedAction('use') && this.wish) {
        input.consumeAction('use');
        this.wish();
      }
      if (this.rideT > this.nextLine) {
        this.nextLine += 14;
        ui.bubble((o) => this.boatman.headTop.getWorldPosition(o), pick(['Look at the diyas floating by ✨', 'Make a wish and release a lantern 🏮', 'Shubh Deepavali! 🪔', 'The mela looks lovely from the water 🎡']), 3);
      }
    } else if (this.state === 'docked') {
      this.group.position.y = FLOAT_Y + bob;
      this.group.rotation.set(Math.sin(t * 1.1) * 0.015, this.heading, Math.cos(t * 0.9) * 0.02);
    }

    // rowing: oars sweep when moving, rest in the water when still
    const rate = this.state === 'ride' ? 1.1 + moving * 1.2 : 0;
    const prev = this.phase;
    this.phase += rate * dt * Math.PI * 2;
    if (rate > 0 && Math.floor(this.phase / (Math.PI * 2)) !== Math.floor(prev / (Math.PI * 2))) audio.oar();
    const sweep = Math.sin(this.phase) * 0.5 * (rate > 0 ? 1 : 0);
    // blades reach down into the water on the drive and lift clear on the recovery
    const lift = rate > 0 ? -0.2 + Math.max(0, Math.cos(this.phase)) * 0.36 : -0.06;
    for (const o of this.oars) o.pivot.rotation.set(0, o.s * sweep, o.s * lift);
    this.boatman.actionParam = this.phase;
    this.boatman.update(dt);

    world.water?.setBoat(this.group.position.x, this.group.position.z, moving);
  }
}
