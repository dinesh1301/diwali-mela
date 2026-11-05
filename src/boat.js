import { tk } from './touch.js';
import * as THREE from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { diyaMesh, kandeelMesh } from './items.js';
import { collide } from './physics.js';
import { beam, canvasTexture, hdr, clamp } from './utils.js';
import { mergeStatic, mergeAdded } from './merge.js';
import { seg, lowDetail } from './lod.js';
import { settings } from './settings.js';
import { signTexture } from './stalls.js';
import { slot } from './personalSlots.js';

/*
  Naav ki Sair: a wooden jetty at the ghat and a rowing boat you take out yourself. Climb in at the
  jetty, then row: W/S (or the stick forward/back) pulls or backs the oars, A/D turns by pulling
  one oar harder. The hull has momentum, a keel (little sideways slip) and water drag, rocks with
  the waves and leans into turns. It stays on the river: banks, the ghat steps and the jetty push
  it back softly. You can only climb out where there is somewhere to stand (the jetty or the ghat
  steps); the boat stays moored where you left it until you take it out again.
*/

const WATER_Y = -1.35;
const FLOAT_Y = WATER_Y + 0.42; // the gunwale rides this high; the hull's draft is 0.16 m
const DECK_Y = -0.3;
const PIER = { x: 10.2, w: 2.6, z0: -45.3, z1: -59 }; // runs out from the top step
const DOCK = new THREE.Vector3(PIER.x, FLOAT_Y, -61.2);
// where the boat may go: the quay face (world.js) and soft limits up/down river, out of the ghat
// steps (their submerged front edge) and the jetty
const RIVER = { minX: -68, maxX: 68, minZ: -138, maxZ: -49.4 };
const STEPS = { minX: -42, maxX: 42, minZ: -53.1, maxZ: -44 };
const JETTY = { minX: PIER.x - PIER.w / 2, maxX: PIER.x + PIER.w / 2, minZ: PIER.z1 - 0.2, maxZ: -44 };
const GHAT_X = 40; // the steps run x = -42..42; you can climb out along most of them
const HULL = [[-1.85, 0.75], [0, 1.0], [1.85, 0.75]]; // circles along the keel: [offset, radius]
const THRUST = 2.0; // m/s² with both oars pulling
const MAX_FWD = 4.2;
const MAX_BACK = 1.6;
const DRAG = 0.42; // along the keel, per second
const SLIP = 2.6; // sideways: the keel resists it
const TURN = 0.75; // rad/s at full stick
const LAND_REACH = 1.4; // how close a hull circle must be to the steps or jetty to climb out
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const ZERO = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = { x: 0, z: 0, d: 0 };
const _q = new THREE.Vector3();

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
  const glow = new THREE.PointLight(0xffb060, 6, 7, 2); // soft: the rower's face and shirt must not blow out
  glow.position.set(0, 1.1, 0.9);
  g.add(glow);
  const bowDiya = diyaMesh();
  bowDiya.scale.setScalar(1.4);
  bowDiya.position.set(0, 0.02, 2.3);
  g.add(bowDiya);
  const bulbMat = new THREE.MeshBasicMaterial({ color: hdr(0xffd08a, 2) });
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

  // the rower's thwart, facing the stern like a real rower (the oarlocks are just behind it)
  const seat = new THREE.Object3D();
  seat.position.set(0, -0.55, 1.6);
  seat.rotation.y = Math.PI;
  g.add(seat);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshBasicMaterial({ map: signTexture(slot('ride.boat.name'), null, '#13306b'), transparent: true, color: new THREE.Color(1, 1, 1) }));
  plate.position.set(0.97, -0.12, -1.2);
  plate.rotation.y = Math.PI / 2;
  g.add(plate);
  // hull, rim, canopy, bulbs and lantern: one mesh per look; oars swing, the diya flickers
  const oarSet = new Set(oars.map((o) => o.pivot));
  mergeStatic(g, { skip: (o) => oarSet.has(o) });
  return { group: g, seat, oars };
}

/** Pushes circle (x, z, r) out of box b; returns the push normal and depth in _n (d = 0: clear). */
function outOfBox(x, z, r, b) {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  let dx = x - cx;
  let dz = z - cz;
  let d = Math.hypot(dx, dz);
  _n.d = 0;
  if (d >= r) return _n;
  if (d < 1e-4) {
    // centre inside the box: leave through the nearest face
    const faces = [[x - b.minX, -1, 0], [b.maxX - x, 1, 0], [z - b.minZ, 0, -1], [b.maxZ - z, 0, 1]].sort((p, q) => p[0] - q[0]);
    [d, dx, dz] = faces[0];
    _n.x = dx;
    _n.z = dz;
    _n.d = r + d;
    return _n;
  }
  _n.x = dx / d;
  _n.z = dz / d;
  _n.d = r - d;
  return _n;
}

/** Keeps circle (x, z, r) inside box b; the push normal points back in. */
function intoBox(x, z, r, b) {
  _n.d = 0;
  const over = [[b.minX + r - x, 1, 0], [x + r - b.maxX, -1, 0], [b.minZ + r - z, 0, 1], [z + r - b.maxZ, 0, -1]];
  for (const [d, nx, nz] of over) {
    if (d > _n.d) {
      _n.d = d;
      _n.x = nx;
      _n.z = nz;
    }
  }
  return _n;
}

export class BoatRide {
  constructor(ctx, { wish } = {}) {
    this.ctx = ctx;
    this.wish = wish;
    const { scene, world, interactions, player } = ctx;
    this.state = 'docked'; // docked (moored) | boarding | ride | landing
    this.phase = [0, 0]; // per oar
    this.t = 0;
    this.vel = new THREE.Vector2(); // world x/z, m/s
    this.yawVel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.thud = 0;
    this.spray = 0;
    this.idle = 0;
    this.camTarget = new THREE.Vector3();

    this.buildPier();

    const model = boatModel();
    this.group = model.group;
    this.seat = model.seat;
    this.oars = model.oars;
    this.group.rotation.order = 'YXZ';
    // a clean copy (nobody aboard, no lights) for other visitors' rowers; meshes share geometry
    this.template = this.group.clone(true);
    const lights = [];
    this.template.traverse((o) => o.isLight && lights.push(o));
    for (const o of lights) o.removeFromParent();
    scene.add(this.group);
    this.pos = this.group.position;
    this.moorAtDock();

    // the moored boat, for anyone on the jetty (moves with the boat)
    this.collider = { type: 'box', minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    world.colliders.push(this.collider);
    this.updateCollider();

    interactions.add({
      pos: (out) => out.copy(this.boardFrom),
      radius: 2.3,
      markAt: (out) => out.set(this.pos.x, DECK_Y, this.pos.z),
      markerHeight: 2.0,
      label: 'Take the boat out 🛶',
      enabled: () => player.mode === 'walk' && this.state === 'docked',
      action: () => this.board(),
    });
  }

  moorAtDock() {
    this.pos.copy(DOCK);
    this.heading = Math.PI / 2;
    this.group.rotation.set(0, this.heading, 0);
    this.boardFrom = V(PIER.x, DECK_Y, PIER.z1 + 0.45);
    this.vel.set(0, 0);
    this.yawVel = 0;
  }

  updateCollider() {
    const c = this.collider;
    const ext = Math.abs(Math.sin(this.heading)) * 2.6 + Math.abs(Math.cos(this.heading)) * 1.0;
    const exz = Math.abs(Math.cos(this.heading)) * 2.6 + Math.abs(Math.sin(this.heading)) * 1.0;
    c.minX = this.pos.x - ext;
    c.maxX = this.pos.x + ext;
    c.minZ = this.pos.z - exz;
    c.maxZ = this.pos.z + exz;
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
      new THREE.MeshBasicMaterial({ map: signTexture(slot('ride.boat.sign'), tk('Row a boat · press E at the jetty', 'Row a boat · tap the button at the jetty', 'Row a boat on the river'), '#13306b'), color: new THREE.Color(1, 1, 1) })
    );
    sign.position.set(x + 2.6, 2.2, -43.4);
    scene.add(sign);
    // two faces, so the sign reads (not mirrored) from the river side too
    const back = new THREE.Mesh(sign.geometry, sign.material);
    back.position.copy(sign.position);
    back.position.z -= 0.01;
    back.rotation.y = Math.PI;
    scene.add(back);
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

  // ---------- getting in and out ----------

  stashHeld() {
    const { player } = this.ctx;
    this.stash = player.held;
    if (this.stash) {
      player.held = null;
      player.char.holdR = null;
      this.stash.obj.visible = false;
    }
  }

  restoreHeld() {
    const { player } = this.ctx;
    if (!this.stash) return;
    this.stash.obj.visible = true;
    player.held = this.stash;
    player.char.holdR = this.stash.pose ?? 'hold';
    this.stash = null;
  }

  async board() {
    if (this.state !== 'docked') return;
    const { player, tasks, ui, passport, audio } = this.ctx;
    this.state = 'boarding';
    this.stashHeld();
    player.mode = 'anim';
    player.vel.set(0, 0, 0);
    const edge = this.boardFrom.clone();
    const from = player.pos.clone();
    const d = Math.hypot(from.x - edge.x, from.z - edge.z);
    if (d > 0.2) {
      player.faceTowards(edge.x, edge.z);
      player.animSpeed = 2.2;
      await tasks.tween(d / 2.2, (k) => player.pos.lerpVectors(from, edge, k), (k) => k);
      player.animSpeed = 0;
    }
    player.faceTowards(this.pos.x, this.pos.z);
    await tasks.wait(0.2);
    audio.splash();
    this.group.updateMatrixWorld(true);
    const seatW = this.seat.getWorldPosition(new THREE.Vector3());
    const h0 = player.heading;
    const h1 = this.heading + Math.PI;
    player.char.setAction('sit');
    await tasks.tween(0.6, (k) => {
      player.pos.lerpVectors(edge, seatW, k);
      player.pos.y += Math.sin(k * Math.PI) * 0.35;
      player.heading = player.targetHeading = h0 + Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) * k;
    });
    player.sitOn(this.seat, ZERO, 0, 'row');
    player.cam.yaw = this.heading + Math.PI;
    player.cam.pitch = 0.32;
    player.cam.targetDist = 7.5;
    this.camTarget.set(this.pos.x, this.pos.y + 1.6, this.pos.z);
    this.idle = 0;
    this.state = 'ride';
    passport.stamp('boat');
    ui.toast(
      tk('🛶 You have the oars! W / S to row and back, A / D to turn. Pull up to the ghat steps or the jetty and press E to get off.', '🛶 You have the oars! Push the stick to row and steer. Pull up to the ghat steps or the jetty and tap “Get off”.'),
      6000,
      { important: true }
    );
  }

  /** Where you could step out right now: the jetty deck or a ghat step next to the hull, or null. */
  landing(out = _q) {
    let best = null;
    let bestD = LAND_REACH;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    for (const [off, r] of HULL) {
      const x = this.pos.x + fx * off;
      const z = this.pos.z + fz * off;
      // jetty: the gap between this hull circle and the deck
      const jx = clamp(x, JETTY.minX, JETTY.maxX);
      const jz = clamp(z, JETTY.minZ, PIER.z0);
      const dj = Math.hypot(x - jx, z - jz) - r;
      if (dj < bestD) {
        bestD = dj;
        best = 'jetty';
        out.set(clamp(x, PIER.x - 0.9, PIER.x + 0.9), DECK_Y, clamp(z, PIER.z1 + 0.45, PIER.z0 - 1));
      }
      // ghat: the steps' front edge
      const dg = STEPS.minZ - (z + r);
      if (Math.abs(x) < GHAT_X && dg < bestD) {
        bestD = dg;
        best = 'ghat';
        out.set(x, 0, -50.0);
        out.y = this.ctx.world.groundHeight(out.x, out.z);
      }
    }
    return best;
  }

  async land(where) {
    const { player, tasks, audio, ui } = this.ctx;
    this.state = 'landing';
    const edge = where.clone();
    player.scene.attach(player.char.root);
    player.pos.copy(player.char.root.position);
    player.mode = 'anim';
    player.char.clearAction();
    player.heading = player.targetHeading = Math.atan2(edge.x - player.pos.x, edge.z - player.pos.z);
    const from = player.pos.clone();
    await tasks.tween(0.6, (k) => {
      player.pos.lerpVectors(from, edge, k);
      player.pos.y += Math.sin(k * Math.PI) * 0.35;
    });
    audio.splash();
    player.mode = 'walk';
    player.teleport(edge.x, edge.z, player.heading);
    this.restoreHeld();
    player.cam.targetDist = 5;
    player.cam.pitch = 0.22;
    this.boardFrom.copy(edge);
    this.vel.set(0, 0);
    this.yawVel = 0;
    this.updateCollider();
    this.state = 'docked';
    ui.toast('🛶 The boat is moored here. Walk up to it to take it out again.', 3000);
  }

  /** Used by teleports: drop everything and put the boat back at the jetty (a climb in/out finishes first). */
  abort() {
    if (this.state !== 'ride') return;
    const { player } = this.ctx;
    if (player.char.root.parent !== player.scene) player.scene.attach(player.char.root);
    player.char.clearAction();
    player.mode = 'walk';
    this.restoreHeld();
    this.moorAtDock();
    this.updateCollider();
    this.state = 'docked';
  }

  /** A boat for another visitor who is rowing (see Net): placed under their seat each frame. */
  remoteHull() {
    return this.template.clone(true);
  }

  get riding() {
    return this.state === 'ride';
  }

  promptLabel() {
    const where = this.landing();
    if (where === 'jetty') return 'Get off onto the jetty';
    if (where === 'ghat') return 'Get off onto the ghat';
    return tk('Row to the ghat steps or the jetty to get off', 'Steer to the ghat to get off');
  }

  prompt2Label() {
    return this.wish ? 'Release a wish lantern 🏮' : null;
  }

  get help() {
    return {
      key: [['W S', 'Row / back water'], ['A D', 'Turn'], ['interact', 'Get off (at the ghat or jetty)'], ['use', 'Wish lantern'], ['Drag', 'Look around'], ['Scroll', 'Zoom']],
      tap: [['🕹️', 'Stick: row and steer'], ['👆', 'Get off at the ghat or jetty'], ['🏮', 'Wish lantern'], ['👉', 'Drag to look around']],
    };
  }

  // ---------- per frame ----------

  controls() {
    const inp = this.ctx.input;
    const k = (c) => (inp.isDown(c) ? 1 : 0);
    return {
      f: clamp(k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - inp.move.y, -1, 1),
      s: clamp(k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + inp.move.x, -1, 1),
    };
  }

  /** Soft collisions: hull circles against the river's edges, the jetty and the ghat steps. */
  collide(dt) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    let hit = 0;
    for (const [off, r] of HULL) {
      for (let pass = 0; pass < 3; pass++) {
        const x = this.pos.x + fx * off;
        const z = this.pos.z + fz * off;
        const n = pass === 0 ? intoBox(x, z, r, RIVER) : outOfBox(x, z, r, pass === 1 ? JETTY : STEPS);
        if (n.d <= 0) continue;
        // ease out of the overlap (not a hard snap), and lose the speed going into the obstacle
        const push = Math.min(n.d, n.d * 0.5 + 2.5 * dt);
        this.pos.x += n.x * push;
        this.pos.z += n.z * push;
        const vn = this.vel.x * n.x + this.vel.y * n.z;
        if (vn < 0) {
          this.vel.x -= 1.25 * vn * n.x;
          this.vel.y -= 1.25 * vn * n.z;
          // a square knock loses a lot of way, a glancing scrape only a little (so it slides along)
          this.vel.multiplyScalar(1 - clamp(-vn * 0.2, 0, 0.4));
          // a knock off-centre swings the bow away
          this.yawVel = clamp(this.yawVel + off * (fx * n.z - fz * n.x) * vn * 0.2, -1.2, 1.2);
          hit = Math.max(hit, -vn);
        }
      }
    }
    if (hit > 0.6 && this.thud <= 0) {
      this.thud = 0.6;
      this.ctx.audio.thud();
      this.roll += clamp(hit * 0.05, 0, 0.12) * (Math.random() < 0.5 ? -1 : 1);
    }
  }

  update(dt, t) {
    this.t = t;
    const { player, input, ui, world, smoke } = this.ctx;
    const calm = settings.reduceMotion ? 0.5 : 1;
    const bob = Math.sin(t * 1.3) * 0.035 * calm;
    this.thud -= dt;
    const power = [0, 0]; // starboard (-x) and port (+x) oar effort, -1..1

    if (this.state === 'ride') {
      const { f, s } = this.controls();
      // one oar pulls harder to turn; both back water to reverse
      power[0] = clamp(f - s * 0.8, -1, 1);
      power[1] = clamp(f + s * 0.8, -1, 1);
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      let vf = this.vel.x * fx + this.vel.y * fz;
      let vs = this.vel.x * fz - this.vel.y * fx;
      vf += f * THRUST * (f < 0 ? 0.7 : 1) * dt;
      vf -= vf * DRAG * dt;
      vf = clamp(vf, -MAX_BACK, MAX_FWD);
      vs -= vs * Math.min(1, SLIP * dt);
      this.vel.set(fx * vf + fz * vs, fz * vf - fx * vs);
      // turning: possible from rest (one oar), sharper with way on; reversed when backing
      const way = clamp(Math.abs(vf) / 2.5, 0, 1);
      const want = -s * TURN * (0.55 + 0.45 * way) * (vf < -0.3 ? -1 : 1);
      this.yawVel += (want - this.yawVel) * (1 - Math.exp(-dt * 2.2));
      this.heading += this.yawVel * dt;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.y * dt;
      this.collide(dt);
      // the hull settles bow-up as it surges, leans out of turns, and rocks on the waves
      const accel = f * (vf < MAX_FWD - 0.1 ? 1 : 0);
      this.pitch += (-accel * 0.035 * calm - this.pitch) * (1 - Math.exp(-dt * 2));
      this.roll += (this.yawVel * vf * 0.03 * calm - this.roll) * (1 - Math.exp(-dt * 2.5));
      this.group.position.y = FLOAT_Y + bob;
      this.group.rotation.set(this.pitch + Math.sin(t * 1.1) * 0.02 * calm, this.heading, this.roll + Math.cos(t * 0.9) * 0.025 * calm);
      this.group.updateMatrixWorld(true);
      // the light pool, voice chat and the network follow the rower
      this.seat.getWorldPosition(player.pos);
      player.heading = player.targetHeading = this.heading + Math.PI;

      // bow spray and a wash at speed (not on phones: the wake rings are enough there)
      if (smoke && !lowDetail() && Math.abs(vf) > 1.6) {
        this.spray -= dt * Math.abs(vf);
        if (this.spray <= 0) {
          this.spray = 1.2;
          smoke.puff(this.pos.x + fx * 2.5, WATER_Y + 0.15, this.pos.z + fz * 2.5, { kind: 'steam', count: 2, size: 0.25, grow: 0.4, rise: 0.25, drift: 0.2, life: 0.9, peak: 0.18, spread: 0.4 });
        }
      }

      if (input.pressedAction('interact')) {
        input.consumeAction('interact');
        const where = this.landing();
        if (where) this.land(_q.clone());
        else ui.toast(tk('🛶 You can only get off at the ghat steps or the jetty: row up close to them.', '🛶 You can only get off at the ghat steps or the jetty: steer up close to them.'), 3000, { important: true });
      }
      if (input.pressedAction('use') && this.wish) {
        input.consumeAction('use');
        this.wish();
      }
    } else {
      // moored: the way comes off and it rides the swell where it was left
      this.vel.multiplyScalar(Math.exp(-dt * 2));
      this.pitch *= Math.exp(-dt * 2);
      this.roll *= Math.exp(-dt * 2);
      this.group.position.y = FLOAT_Y + bob;
      this.group.rotation.set(this.pitch + Math.sin(t * 1.1) * 0.015 * calm, this.heading, this.roll + Math.cos(t * 0.9) * 0.02 * calm);
    }

    // rowing: each oar sweeps at its own effort (backwards when backing water), rests when idle
    let strokes = 0;
    for (const o of this.oars) {
      const i = o.s < 0 ? 0 : 1;
      const p = power[i];
      const rate = Math.abs(p) > 0.08 ? 0.55 + Math.abs(p) * 0.6 : 0;
      const prev = this.phase[i];
      this.phase[i] += rate * dt * Math.PI * 2 * Math.sign(p || 1);
      if (rate > 0 && Math.floor(this.phase[i] / (Math.PI * 2)) !== Math.floor(prev / (Math.PI * 2))) {
        strokes++;
        // a little splash where the blade bites
        if (smoke && !lowDetail()) {
          o.pivot.localToWorld(_p.set(o.s * 2.3, 0, 0));
          smoke.puff(_p.x, WATER_Y + 0.1, _p.z, { kind: 'steam', count: 2, size: 0.18, grow: 0.3, rise: 0.3, drift: 0.1, life: 0.7, peak: 0.16, spread: 0.2 });
        }
      }
      const on = rate > 0 ? 1 : 0;
      const sweep = Math.sin(this.phase[i]) * 0.5 * on;
      // blades reach down into the water on the drive and lift clear on the recovery
      const lift = on ? -0.2 + Math.max(0, Math.cos(this.phase[i])) * 0.36 : -0.06;
      o.pivot.rotation.set(0, o.s * sweep, o.s * lift);
    }
    if (strokes) this.ctx.audio.oar();
    if (this.state === 'ride') player.char.actionParam = (this.phase[0] + this.phase[1]) / 2;

    const speed = this.vel.length();
    world.water?.setBoat(this.pos.x, this.pos.z, clamp(speed / 3, 0, 1));
  }

  /** Chase camera, like the vehicles: drag to look, it swings back behind the boat when let go. */
  applyCamera(camera, dt) {
    const { input, player, world } = this.ctx;
    const c = player.cam;
    if (input.lookEnabled && (input.look.dx || input.look.dy)) {
      c.yaw -= input.look.dx * 0.0045;
      c.pitch += input.look.dy * 0.0035;
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    if (this.idle > 1.2 && this.vel.length() > 0.6 && !settings.reduceMotion) {
      // behind the direction of travel (backing up looks forward over the bow)
      const back = this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading) < -0.3;
      const want = this.heading + (back ? 0 : Math.PI);
      let d = want - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.yaw += d * (1 - Math.exp(-dt * 1.5));
      c.pitch += (0.3 - c.pitch) * (1 - Math.exp(-dt * 1.2));
    }
    c.pitch = clamp(c.pitch, -0.2, 1.3);
    if (input.wheel) c.targetDist = clamp(c.targetDist * (1 + input.wheel * 0.0012), 3, 20);
    c.dist += (c.targetDist - c.dist) * (1 - Math.exp(-dt * 8));
    _v.set(this.pos.x, FLOAT_Y + 1.2, this.pos.z);
    this.camTarget.lerp(_v, 1 - Math.exp(-dt * 20));
    c.target.copy(this.camTarget);
    const cp = camera.position;
    cp.set(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist).add(c.target);
    // over the steps, the quay or the jetty the ground is higher than the water
    cp.y = Math.max(cp.y, Math.max(WATER_Y, cp.z > -53.2 ? world.groundHeight(cp.x, cp.z) : WATER_Y) + 0.5);
    camera.lookAt(c.target);
  }
}
