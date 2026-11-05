import { tk } from './touch.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Character, randomLook } from './character.js';
import { shape, merged } from './character.js';
import { canvasTexture, hdr, setLayer, WARM_PALETTE } from './utils.js';
import { signTexture } from './stalls.js';
import { slot } from './personalSlots.js';
import { mergeStatic, mergeAdded } from './merge.js';
import { seg } from './lod.js';

/*
  The toy train: a narrow-gauge loop east of the bazaar with two stations. It runs on its own
  with a few passengers; board at a station while it's stopped and ride a lap, getting off at
  the next stop you ask for. It also doubles as transport between the bazaar and Khel Gali.
*/
// The loop is a rounded rectangle of real straights and arcs (a spline through the corners bowed
// the long straights into the stalls). West straight at x=16 keeps the platform clear of the
// right-hand bazaar stalls (x ≤ 11) and their generators (x ≤ 13); east straight at x=36 is
// behind the game booths (x ≤ 31.5).
const RECT = { x0: 16, x1: 36, z0: 8, z1: 49, r: 6 };
const STATIONS = [
  { slot: 'ride.train.station1', near: [16, 36], side: -1 }, // platform on the west, by the bazaar (name: a personal slot)
  { slot: 'ride.train.station2', near: [36, 27], side: 1 }, // platform on the west of the east straight, by the booths
];

/** A quarter (or any) arc on the ground plane, usable inside a CurvePath. */
class Arc3 extends THREE.Curve {
  constructor(cx, cz, r, a0, a1) {
    super();
    Object.assign(this, { cx, cz, r, a0, a1 });
  }

  getPoint(t, target = new THREE.Vector3()) {
    const a = this.a0 + (this.a1 - this.a0) * t;
    return target.set(this.cx + Math.cos(a) * this.r, 0, this.cz + Math.sin(a) * this.r);
  }
}

/** The track centreline, running west straight southbound → south → east northbound → north. */
function trackLoop({ x0, x1, z0, z1, r }) {
  const P = (x, z) => new THREE.Vector3(x, 0, z);
  const path = new THREE.CurvePath();
  path.add(new THREE.LineCurve3(P(x0, z1 - r), P(x0, z0 + r)));
  path.add(new Arc3(x0 + r, z0 + r, r, Math.PI, Math.PI * 1.5));
  path.add(new THREE.LineCurve3(P(x0 + r, z0), P(x1 - r, z0)));
  path.add(new Arc3(x1 - r, z0 + r, r, Math.PI * 1.5, Math.PI * 2));
  path.add(new THREE.LineCurve3(P(x1, z0 + r), P(x1, z1 - r)));
  path.add(new Arc3(x1 - r, z1 - r, r, 0, Math.PI * 0.5));
  path.add(new THREE.LineCurve3(P(x1 - r, z1), P(x0 + r, z1)));
  path.add(new Arc3(x0 + r, z1 - r, r, Math.PI * 0.5, Math.PI));
  return path;
}
const CRUISE = 3.4;
const DWELL = 7;
const CAR_GAP = 3.3;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const ZERO = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Train {
  constructor(ctx, lights) {
    this.ctx = ctx;
    const { scene, world, interactions, player, smoke } = ctx;
    this.curve = trackLoop(RECT);
    this.length = this.curve.getLength();
    this.s = 0;
    this.speed = 0;
    this.state = 'run'; // run | stopping | dwell
    this.dwell = 0;
    this.riding = false;
    this.wantOff = false;

    // ---- track ----
    const before = new Set(scene.children);
    const N = 480;
    const pts = this.curve.getSpacedPoints(N);
    pts.pop();
    const railMat = std(0x8a8f99, 0.35, { metalness: 0.8 });
    for (const side of [-0.42, 0.42]) {
      const rail = [];
      for (let i = 0; i < N; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % N];
        const t = V(b.x - a.x, 0, b.z - a.z).normalize();
        rail.push(V(a.x - t.z * side, 0.09, a.z + t.x * side));
      }
      const rc = new THREE.CatmullRomCurve3(rail, true, 'catmullrom', 0.5);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(rc, seg(600, 300), 0.045, seg(6, 4), true), railMat);
      tube.castShadow = true;
      scene.add(tube);
    }
    const every = Math.max(1, Math.round(0.8 / (this.length / N)));
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.07, 0.22), std(0x4a3222, 0.9), Math.ceil(N / every));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    for (let i = 0; i < N; i += every) {
      const a = pts[i];
      const b = pts[(i + 1) % N];
      q.setFromEuler(new THREE.Euler(0, Math.atan2(b.x - a.x, b.z - a.z), 0));
      sleepers.setMatrixAt(k++, m4.compose(V(a.x, 0.035, a.z), q, V(1, 1, 1)));
    }
    sleepers.count = k;
    sleepers.receiveShadow = true;
    scene.add(sleepers);

    // ---- stations ----
    this.stations = STATIONS.map((st) => {
      let best = 0;
      let bd = Infinity;
      pts.forEach((p, i) => {
        const d = Math.hypot(p.x - st.near[0], p.z - st.near[1]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      const s = (best / N) * this.length;
      const p = pts[best];
      const n = pts[(best + 1) % N];
      const t = V(n.x - p.x, 0, n.z - p.z).normalize();
      const right = V(-t.z, 0, t.x);
      const off = right.clone().multiplyScalar(st.side * 1.6);
      const centre = p.clone().add(off);
      const plat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 7), std(0x9a8670, 0.9));
      plat.position.set(centre.x, 0.15, centre.z);
      plat.rotation.y = Math.atan2(t.x, t.z);
      plat.receiveShadow = plat.castShadow = true;
      scene.add(plat);
      const signPos = centre.clone().add(right.clone().multiplyScalar(st.side * 1.0));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.75), new THREE.MeshBasicMaterial({ map: signTexture(slot(st.slot), tk('Toy train · press E when it stops', 'Toy train · tap the button when it stops', 'Toy train · all aboard!'), '#13306b', '#ffe7a3', 1024, 288), color: new THREE.Color(1, 1, 1), side: THREE.DoubleSide }));
      sign.position.set(signPos.x, 2.4, signPos.z);
      sign.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
      scene.add(sign);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8), std(0x3d2a1c));
      post.position.set(signPos.x, 1.0, signPos.z);
      scene.add(post);
      const lamp = new THREE.PointLight(0xffb46b, 25, 10, 2);
      lamp.position.set(centre.x, 3, centre.z);
      scene.add(lamp);
      lights.addStrand(signPos.clone().setY(2.9).addScaledVector(t, -3), signPos.clone().setY(2.9).addScaledVector(t, 3), { sag: 0.3, palette: WARM_PALETTE });
      world.colliders.push({ type: 'circle', x: signPos.x, z: signPos.z, r: 0.15 });
      const station = { ...st, s, centre, heading: Math.atan2(t.x, t.z), stand: centre.clone().addScaledVector(right, st.side * 0.2) };
      interactions.add({
        pos: station.stand,
        radius: 3.6,
        markerHeight: 2.6,
        markAt: () => this.cars[1].getWorldPosition(new THREE.Vector3()),
        label: 'Board the toy train 🚂',
        enabled: () => player.mode === 'walk' && this.state === 'dwell' && this.at === station && !this.riding,
        action: () => this.board(station),
      });
      return station;
    });

    mergeAdded(scene, before, { cell: 40 }); // rails, platforms, posts

    // ---- rolling stock ----
    this.cars = [this.engine(), this.carriage(0x2a9d8f), this.carriage(0xe63946)];
    this.cars.forEach((c) => {
      c.rotation.order = 'YXZ';
      setLayer(c, 1);
      scene.add(c);
    });
    this.seat = this.cars[1].userData.seats[0];
    this.passengers = [];
    const spots = [this.cars[1].userData.seats[1], this.cars[2].userData.seats[0], this.cars[2].userData.seats[1], this.cars[1].userData.seats[2]];
    for (const seat of spots) {
      const ch = new Character(randomLook({ kid: Math.random() < 0.4 }));
      ch.setAction('sit');
      ch.root.position.set(0, 0, 0);
      seat.add(ch.root);
      this.passengers.push(ch);
    }
    this.smoke = smoke?.emitter((out) => this.cars[0].userData.funnel.getWorldPosition(out), { kind: 'smoke', rate: 0, size: 0.35, grow: 0.6, rise: 1.3, drift: 0.2, life: 2.4, peak: 0.28 });
    this.chuff = 0;
    this.place();
  }

  engine() {
    const g = new THREE.Group();
    const red = 0xb3122e;
    const body = merged(
      [
        shape(new THREE.BoxGeometry(1.4, 0.3, 3.2), 0x222222, [0, 0.45, 0]),
        shape(new THREE.CylinderGeometry(0.5, 0.5, 1.9, 16), red, [0, 1.05, 0.5], [Math.PI / 2, 0, 0]),
        shape(new THREE.BoxGeometry(1.3, 1.5, 1.2), red, [0, 1.35, -0.9]),
        shape(new THREE.BoxGeometry(1.5, 0.08, 1.4), 0x3a1a1a, [0, 2.14, -0.9]),
        shape(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 10), 0x222222, [0, 1.95, 1.1]),
        shape(new THREE.CylinderGeometry(0.22, 0.12, 0.25, 10), 0xd4a017, [0, 2.4, 1.1]),
        shape(new THREE.BoxGeometry(0.4, 0.3, 0.3), 0xd4a017, [0, 1.75, 0.4]),
        shape(new THREE.BoxGeometry(1.5, 0.5, 0.5), 0xd4a017, [0, 0.35, 1.7], [-0.6, 0, 0]),
        shape(new THREE.BoxGeometry(0.9, 0.7, 0.04), 0x8fbcd4, [0, 1.5, -0.29]),
      ],
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 })
    );
    g.add(body);
    const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.12, 14).rotateZ(Math.PI / 2);
    for (const [x, z] of [[-0.72, 0.9], [0.72, 0.9], [-0.72, -0.4], [0.72, -0.4], [-0.72, -1.3], [0.72, -1.3]]) {
      const w = new THREE.Mesh(wheel, std(0xd4a017, 0.4, { metalness: 0.6 }));
      w.position.set(x, 0.32, z);
      g.add(w);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: hdr(0xfff0c0, 5) }));
    lamp.position.set(0, 1.25, 1.5);
    g.add(lamp);
    const spot = new THREE.SpotLight(0xfff0c8, 60, 18, 0.5, 0.5, 1.2);
    spot.position.set(0, 1.25, 1.4);
    spot.target.position.set(0, 0.5, 10);
    g.add(spot, spot.target);
    const funnel = new THREE.Object3D();
    funnel.position.set(0, 2.55, 1.1);
    g.add(funnel);
    g.userData.funnel = funnel;
    g.userData.seats = [];
    mergeStatic(g); // body, wheels and lamp move together: one mesh per look
    return g;
  }

  carriage(color) {
    const g = new THREE.Group();
    const parts = [
      shape(new THREE.BoxGeometry(1.5, 0.12, 2.8), 0x6b3f22, [0, 0.5, 0]),
      shape(new THREE.BoxGeometry(1.5, 0.5, 0.08), color, [0, 0.8, 1.36]),
      shape(new THREE.BoxGeometry(1.5, 0.5, 0.08), color, [0, 0.8, -1.36]),
      shape(new THREE.BoxGeometry(0.08, 0.5, 2.8), color, [-0.71, 0.8, 0]),
      shape(new THREE.BoxGeometry(0.08, 0.5, 2.8), color, [0.71, 0.8, 0]),
      shape(new THREE.BoxGeometry(1.7, 0.06, 3.0), color, [0, 2.1, 0]),
      shape(new THREE.BoxGeometry(1.3, 0.08, 0.4), 0x8a5a2b, [0, 0.95, 0.5]),
      shape(new THREE.BoxGeometry(1.3, 0.08, 0.4), 0x8a5a2b, [0, 0.95, -0.5]),
    ];
    for (const [x, z] of [[-0.65, 1.3], [0.65, 1.3], [-0.65, -1.3], [0.65, -1.3]]) parts.push(shape(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), 0xd4a017, [x, 1.3, z]));
    g.add(merged(parts, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
    const wheel = new THREE.CylinderGeometry(0.26, 0.26, 0.1, 12).rotateZ(Math.PI / 2);
    for (const [x, z] of [[-0.72, 0.9], [0.72, 0.9], [-0.72, -0.9], [0.72, -0.9]]) {
      const w = new THREE.Mesh(wheel, std(0x222222, 0.5));
      w.position.set(x, 0.26, z);
      g.add(w);
    }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: hdr(0xffd08a, 3) }));
    for (let i = 0; i < 6; i++) {
      const b = bulb.clone();
      b.position.set(i % 2 ? 0.8 : -0.8, 2.05, -1.2 + Math.floor(i / 2) * 1.2);
      g.add(b);
    }
    // seats: root positions for seated characters, facing forward (+z)
    g.userData.seats = [[-0.35, 0.5, 0.5], [0.35, 0.5, -0.5], [-0.35, 0.5, -0.5], [0.35, 0.5, 0.5]].map(([x, y, z]) => {
      const seat = new THREE.Object3D();
      seat.position.set(x, y, z);
      g.add(seat);
      return seat;
    });
    mergeStatic(g);
    return g;
  }

  // ---------- running ----------

  place() {
    if (this.s === this.placedS) return; // standing at a station: the cars are already there
    this.placedS = this.s;
    for (let i = 0; i < this.cars.length; i++) {
      let s = this.s - i * CAR_GAP;
      s = ((s % this.length) + this.length) % this.length;
      const u = s / this.length;
      const p = this.curve.getPointAt(u, _p);
      const t = this.curve.getTangentAt(u, _t);
      const c = this.cars[i];
      c.position.set(p.x, 0.02, p.z);
      c.rotation.set(0, Math.atan2(t.x, t.z), 0);
    }
  }

  nextStation() {
    let best = null;
    let bd = Infinity;
    for (const st of this.stations) {
      let d = st.s - this.s;
      if (d < -1) d += this.length; // a station just passed counts as a lap away
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return { st: best, dist: bd };
  }

  async board(station) {
    const { player, tasks, ui, passport, audio } = this.ctx;
    if (this.riding) return;
    this.riding = true;
    this.wantOff = false;
    player.mode = 'anim';
    player.vel.set(0, 0, 0);
    const seatW = this.seat.getWorldPosition(new THREE.Vector3());
    const from = player.pos.clone();
    player.faceTowards(seatW.x, seatW.z);
    player.animSpeed = 2;
    await tasks.tween(Math.max(0.3, from.distanceTo(seatW) / 2.4), (k) => {
      player.pos.lerpVectors(from, seatW, k);
      player.pos.y += Math.sin(k * Math.PI) * 0.4;
    }, (k) => k);
    player.animSpeed = 0;
    player.sitOn(this.seat, ZERO, 0, 'sit');
    player.cam.targetDist = 6;
    player.cam.pitch = 0.25;
    passport.stamp('train');
    audio.ding(0.2);
    ui.toast(tk('🚂 All aboard! Press E to get off at the next station.', '🚂 All aboard! Tap “Get off” to step down at the next station.'), 4000, { important: true });
    this.dwell = Math.min(this.dwell, 1.2);
  }

  alight() {
    const { player } = this.ctx;
    const st = this.at;
    player.standUp(st.stand.x, st.stand.z, st.heading + Math.PI / 2 * st.side);
    player.cam.targetDist = 5;
    this.riding = false;
    this.wantOff = false;
  }

  abort() {
    if (!this.riding) return;
    const { player } = this.ctx;
    player.scene.attach(player.char.root);
    player.char.clearAction();
    player.mode = 'walk';
    this.riding = false;
  }

  promptLabel() {
    return this.wantOff ? 'Getting off at the next stop…' : 'Get off at the next station';
  }

  get help() {
    return { key: [['E', 'Get off next stop'], ['Drag', 'Look around'], ['Scroll', 'Zoom']], tap: [['👆', 'Get off next stop'], ['👉', 'Drag to look around']] };
  }

  update(dt, t) {
    const { audio, crowd, player, input } = this.ctx;
    const { st, dist } = this.nextStation();
    const stopping = dist < 12;
    if (this.state === 'dwell') {
      this.dwell -= dt;
      this.speed = 0;
      if (this.dwell <= 0) {
        this.state = 'run';
        this.departed = this.at;
        audio.ding(0.25);
      }
    } else {
      const target = stopping && st !== this.departed ? Math.max(0.6, CRUISE * (dist / 12)) : CRUISE;
      this.speed += (target - this.speed) * (1 - Math.exp(-dt * 1.5));
      if (st !== this.departed && dist < 0.3) {
        this.state = 'dwell';
        this.dwell = DWELL;
        this.at = st;
        this.speed = 0;
        audio.ding(0.25);
        if (this.riding && this.wantOff) this.alight();
      }
      if (dist > 14) this.departed = null;
    }
    this.s = (this.s + this.speed * dt) % this.length;
    this.place();

    // smoke and chuffing follow the speed
    if (this.smoke) this.smoke.rate = 1 + this.speed * 2.2;
    this.chuff += this.speed * dt;
    if (this.chuff > 1.6) {
      this.chuff = 0;
      const d = this.cars[0].position.distanceTo(player.pos);
      if (d < 40) audio.noiseHit({ type: 'lowpass', freq: 900, level: 0.12 * Math.min(1, 12 / (d + 4)), dur: 0.12 });
    }

    // people (and the player) step off the track
    for (const c of this.cars) {
      crowd?.pushAway(c.position.x, c.position.z, 1.9);
      if (player.mode === 'walk') {
        const dx = player.pos.x - c.position.x;
        const dz = player.pos.z - c.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.7 && d > 1e-4) {
          player.pos.x = c.position.x + (dx / d) * 1.7;
          player.pos.z = c.position.z + (dz / d) * 1.7;
        }
      }
    }
    for (const p of this.passengers) p.update(dt);

    if (this.riding) {
      player.heading = player.targetHeading = this.cars[1].rotation.y;
      if (input.pressedAction('interact')) {
        input.consumeAction('interact');
        if (this.state === 'dwell') this.alight();
        else {
          this.wantOff = true;
          this.ctx.ui.toast('🚉 Getting off at the next station');
        }
      }
    }
  }
}

export { mergeGeometries, canvasTexture };
