import * as THREE from 'three';
import { Character, randomLook } from '../character.js';
import { stallIndexFor } from '../creatorStage.js';

/*
  Trailer shots. Each: { duration (s), warm (s simulated before frame 0), night | dayT,
  setup({ m, H, state }), update({ sec, u, dt, m, H, state }) before each step, and
  camera({ sec, u, t, cam, m, H, state }) which fills cam.pos / cam.look / cam.fov (/ cam.roll).
  `m` is window.__mela; `H` has V, path (Catmull-Rom), smooth, easeInOut, lerp.
  Personal shots (stall, ravan) read the creator from m.creator.
*/

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const ZERO = new THREE.Vector3();

/** Walks the player kinematically between two ground points (walk animation, no physics). */
function walk(m, from, to, k, speed = 1.5) {
  const p = m.player;
  p.mode = 'anim';
  p.animSpeed = speed;
  p.pos.set(from[0] + (to[0] - from[0]) * k, 0, from[1] + (to[1] - from[1]) * k);
  p.pos.y = m.world.groundHeight(p.pos.x, p.pos.z);
  p.heading = p.targetHeading = Math.atan2(to[0] - from[0], to[1] - from[1]);
}

/** A soft, warm fill light for subjects the night leaves too dark (kept to director shots). */
function fill(parent, [x, y, z], intensity = 40, distance = 12, color = 0xffd9a8) {
  const l = new THREE.PointLight(color, intensity, distance, 1.6);
  l.position.set(x, y, z);
  parent.add(l);
  return l;
}

function creatorStall(m) {
  const cfg = m.creator?.cfg;
  const stalls = m.world.stalls;
  return stalls[stallIndexFor(cfg?.stallNo ?? 1, stalls.length)];
}

/** A seated driver for a parked car or plane (the player drives one, extras drive the rest). */
function seatDriver(m, v, pose) {
  const ch = new Character(randomLook());
  v.seat.add(ch.root);
  ch.root.position.set(0, 0, 0);
  ch.setAction(pose);
  return ch;
}

export const SHOTS = {
  // ---------- 2 · walking in through the gate ----------
  gate: {
    duration: 5,
    warm: 1,
    setup({ m }) {
      m.player.teleport(0.6, 80, Math.PI);
    },
    update({ sec, m }) {
      walk(m, [0.6, 80], [0.2, 61], Math.min(1, (sec + 1) / 6), 1.5);
    },
    camera({ u, cam, m, H }) {
      const k = H.easeInOut(u);
      const p = m.player.pos;
      // over the shoulder, then rising as the arch passes overhead to reveal the bazaar
      cam.pos.set(p.x + H.lerp(0.9, 0.5, k), H.lerp(2.0, 2.9, k), p.z + H.lerp(5.4, 4.6, k));
      cam.look.set(p.x * 0.5, H.lerp(3.6, 2.5, k), p.z - 12);
      cam.fov = 58;
    },
  },

  // ---------- 3 · the creator's own stall (personal) ----------
  // Opens square-on to their Wall of Fame (posters readable for ~2.2 s), then drifts back and
  // pans down the aisle to finish on the stall board with the themed goods on the counter.
  stall: {
    duration: 6,
    warm: 1,
    setup({ m, state }) {
      const s = creatorStall(m);
      const g = s.group;
      g.updateMatrixWorld(true);
      const out = g.localToWorld(new THREE.Vector3(0, 0, 1)).sub(g.localToWorld(new THREE.Vector3())).setY(0).normalize(); // towards the aisle
      const along = new THREE.Vector3(0, 0, 1); // towards the entrance
      const base = g.position.clone().setY(0);
      // (along, out, y) relative to the stall's centre on the ground
      const P = (a, o, y) => base.clone().addScaledVector(along, a).addScaledVector(out, o).setY(y);
      const wall = m.creator?.wall?.center ?? P(4.4, 0.7, 2.35);
      const wa = wall.clone().sub(base).dot(along);
      const wo = wall.clone().sub(base).dot(out);
      const wy = wall.y + 0.3;
      state.camPts = [P(wa + 0.2, wo + 6.3, 2.3), P(wa - 0.6, wo + 6.0, 2.4), P(2.4, 9.6, 2.5), P(0.6, 12.55, 2.6)];
      state.lookPts = [P(wa + 0.15, wo, wy), P(wa - 0.15, wo, wy), P(2.0, 1.9, 2.55), P(0, 2.15, 2.45)];
      state.stand = s.stand.clone();
      state.out = out;
      state.keeper = s.keeper;
      // the visitor walks in from behind the camera on the stall side of the wall, never across the posters
      state.from = s.stand.clone().addScaledVector(out, 6.2).addScaledVector(along, 2.4);
      m.player.teleport(state.from.x, state.from.z);
    },
    update({ sec, m, state }) {
      const k = Math.min(1, (sec + 1) / 5.6);
      const to = state.stand.clone().addScaledVector(state.out, 0.6);
      if (k < 1) walk(m, [state.from.x, state.from.z], [to.x, to.z], k, 1.3);
      else {
        m.player.animSpeed = 0;
        m.player.targetHeading = Math.atan2(-state.out.x, -state.out.z);
      }
      if (Math.abs(sec - 3.6) < 1e-3) {
        state.keeper.setAction('namaste');
      }
    },
    camera({ sec, cam, H, state }) {
      // one Catmull-Rom move: the first segment (the wall) at an even drift, then a Hermite ease
      // whose opening speed matches that drift, so the pan never hitches
      const T1 = 2.2;
      let u;
      if (sec <= T1) u = sec / T1 / 3;
      else {
        const x = Math.min(1, (sec - T1) / (6 - T1));
        const m0 = (1 / (3 * T1)) * (6 - T1) * 1.5; // matching slope, in the eased segment's units
        u = 1 / 3 + (2 / 3) * (3 * x * x - 2 * x * x * x + m0 * (x * x * x - 2 * x * x + x));
      }
      H.path(state.camPts, u, cam.pos);
      H.path(state.lookPts, u, cam.look);
      cam.fov = 52;
    },
  },

  // ---------- 4 · Khel Gali: balloon shooting, then ring toss ----------
  games: {
    duration: 10,
    warm: 0.5,
    setup({ m, state }) {
      const [balloon, rings] = m.games.games;
      state.balloon = balloon;
      state.rings = rings;
      fill(rings.booth.group, [0, 3.0, 1.6], 6, 9);
      m.games.play(balloon);
      // which balloons get popped, and when (one honest miss)
      state.plan = [[0.5, 8], [1.15, 15], [1.8, 3], [2.5, -1], [3.1, 20], [3.75, 10], [4.35, 17]];
      state.tosses = [[5.5, 5, 0], [6.6, 2, 0.11], [7.6, 6, 0], [8.6, 9, 0]];
    },
    update({ sec, m, state }) {
      const near = (x) => Math.abs(sec - x) < 1 / 60;
      if (sec < 4.95) {
        for (const [at, idx] of state.plan) {
          if (!near(at)) continue;
          const g = state.balloon;
          const origin = m.player.headWorld(_a);
          const target = idx >= 0 ? g.booth.group.localToWorld(_b.copy(g.balloons[idx].home)) : g.booth.group.localToWorld(_b.set(1.9, 2.95, -2.2));
          g.ray.set(origin, target.sub(origin).normalize());
          g.shoot();
        }
      }
      if (near(5)) m.games.play(state.rings); // the cut
      for (const [at, bi, off] of state.tosses) {
        if (!near(at) || !state.rings.inHand) continue;
        const b = state.rings.bottles[bi];
        state.rings.toss(new THREE.Vector3(b.x + off, 1.275, b.z + off * 0.4));
      }
    },
    camera({ sec, cam, m, H, state }) {
      if (sec < 5) {
        const k = H.smooth(sec / 5);
        const g = state.balloon;
        const w = (x, y, z) => g.booth.group.localToWorld(new THREE.Vector3(x, y, z));
        cam.pos.copy(w(H.lerp(-1.1, -0.8, k), H.lerp(2.35, 2.15, k), H.lerp(9.2, 8.2, k)));
        cam.look.copy(w(-0.1, 1.65, -2.2));
        cam.fov = 50;
      } else {
        const k = H.smooth((sec - 5) / 5);
        const g = state.rings;
        const w = (x, y, z) => g.booth.group.localToWorld(new THREE.Vector3(x, y, z));
        cam.pos.copy(w(H.lerp(-1.0, -0.8, k), H.lerp(2.5, 2.3, k), H.lerp(7.4, 6.8, k)));
        cam.look.copy(w(0, 0.95, -1.0));
        cam.fov = 48;
      }
      void m;
    },
  },

  // ---------- 5 · Pushpak Viman over the mela ----------
  viman: {
    duration: 4,
    warm: 0.5,
    setup({ m, state, H }) {
      const plane = m.vehicles.list.find((v) => v.kind === 'plane');
      state.plane = plane;
      m.player.sitOn(plane.seat, ZERO, 0, 'pilot');
      // a banking pass from the airfield over Khel Gali towards the bazaar lights
      state.route = [[78, 26, -8], [58, 24, 6], [38, 22, 22], [18, 21, 36], [-2, 22, 50]];
      state.T = 4.5; // route time incl. warm
      plane.onGround = false;
      fill(plane.group, [0, 3, -2.5], 20, 10);
      plane.throttle = 1;
      plane.step = function (dt) {
        state.time = (state.time ?? 0) + dt;
        const u = Math.min(1, state.time / state.T);
        H.path(state.route, u, this.pos);
        H.path(state.route, Math.min(1, u + 0.01), _a);
        const d = _a.sub(this.pos);
        this.heading = Math.atan2(d.x, d.z);
        this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        this.roll = 0.32 * Math.sin(u * Math.PI);
        this.group.rotation.set(-this.pitch, this.heading, this.roll);
        this.parts.prop.rotation.z += 50 * dt;
        this.parts.blur.material.opacity = 0.22;
        this.vel.set(0, 0, 0);
      };
    },
    camera({ cam, m, H, u, state }) {
      const p = state.plane;
      const f = _a.set(Math.sin(p.heading), 0, Math.cos(p.heading));
      const r = _b.set(Math.cos(p.heading), 0, -Math.sin(p.heading)); // to the plane's left
      // chase from behind and below-left: the plane against the sky, the lit mela beneath
      const k = H.smooth(u);
      cam.pos.copy(p.pos).addScaledVector(f, H.lerp(-10.5, -8.5, k)).addScaledVector(r, H.lerp(4, 3, k));
      cam.pos.y += H.lerp(2.6, 3.2, k);
      cam.look.copy(p.pos).addScaledVector(f, 4);
      cam.look.y -= 2.2;
      cam.fov = 62;
      void m;
    },
  },

  // ---------- 6 · Chakri Cars ----------
  karts: {
    duration: 3,
    warm: 1,
    setup({ m, state }) {
      const cars = m.vehicles.list.filter((v) => v.kind === 'car');
      const track = m.vehicles.carGround.track;
      state.curve = new THREE.CatmullRomCurve3(track.points.map((p) => new THREE.Vector3(p.x, 0, p.z)), true, 'centripetal');
      state.len = state.curve.getLength();
      state.cars = cars;
      m.player.sitOn(cars[0].seat, ZERO, 0, 'drive');
      for (const c of cars.slice(1)) seatDriver(m, c, 'drive');
      for (const c of cars) fill(c.group, [0, 3.2, 0.5], 9, 8);
      const s0 = 0.08;
      cars.forEach((car, i) => {
        car.s = (s0 + [0, 0.045, 0.085][i]) * state.len; // the player chases the other two
        car.speedK = [15.0, 14.6, 14.4][i];
        car.lane = [0, 1.0, -0.9][i];
        car.step = function (dt) {
          this.s = (this.s + this.speedK * dt) % state.len;
          const u = this.s / state.len;
          const p = state.curve.getPointAt(u);
          const tan = state.curve.getTangentAt(u);
          const nx = -tan.z;
          const nz = tan.x;
          this.pos.set(p.x + nx * this.lane, m.world.groundHeight(p.x, p.z), p.z + nz * this.lane);
          const h = Math.atan2(tan.x, tan.z);
          const tan2 = state.curve.getTangentAt((u + 0.01) % 1);
          const turn = Math.atan2(Math.sin(Math.atan2(tan2.x, tan2.z) - h), Math.cos(Math.atan2(tan2.x, tan2.z) - h));
          this.heading = h + turn * 0.6; // a little drift into the corners
          this.group.rotation.set(0, this.heading, -turn * 0.5);
          this.vel.set(tan.x, 0, tan.z).multiplyScalar(this.speedK);
          for (const w of this.parts.wheels ?? []) if (w.mesh) w.mesh.rotation.x += (this.speedK / 0.36) * dt;
        };
      });
    },
    camera({ cam, H, u, state }) {
      // low, beside the player's kart, the other two just ahead
      const c = state.cars[0];
      const f = _a.set(Math.sin(c.heading), 0, Math.cos(c.heading));
      const r = _b.set(Math.cos(c.heading), 0, -Math.sin(c.heading));
      const k = H.smooth(u);
      cam.pos.copy(c.pos).addScaledVector(f, H.lerp(-5.2, -4.4, k)).addScaledVector(r, H.lerp(-1.9, -1.4, k));
      cam.pos.y += 1.7;
      cam.look.copy(c.pos).addScaledVector(f, 10);
      cam.look.y += 0.3;
      cam.fov = 64;
    },
  },

  // ---------- 7 · quick cuts: giant wheel, toy train, boat ----------
  wheel: {
    duration: 1.4,
    warm: 1,
    setup({ m }) {
      m.world.wheel.speed = 0.22;
      m.player.teleport(-30.5, -9.5, Math.PI * 1.08);
      m.player.char.setAction('lookUp');
    },
    camera({ u, cam, H }) {
      const k = H.smooth(u);
      cam.pos.set(H.lerp(-28.5, -29.3, k), H.lerp(1.2, 1.6, k), H.lerp(-5.5, -6.5, k));
      cam.look.set(-34, H.lerp(13, 15.5, k), -26);
      cam.fov = 62;
    },
  },

  train: {
    duration: 1.3,
    warm: 2,
    setup({ m, state }) {
      const tr = m.train;
      // on the long west straight, running at cruise
      tr.s = tr.length * 0.08;
      tr.state = 'run';
      tr.departed = null;
      tr.speed = 4;
      tr.nextStation = () => ({ st: null, dist: Infinity }); // no stops during the shot
      state.tr = tr;
      fill(tr.cars[0], [0, 3, 0], 14, 9);
    },
    camera({ u, cam, H, state }) {
      const e = state.tr.cars[0];
      const yaw = e.rotation.y;
      const f = _a.set(Math.sin(yaw), 0, Math.cos(yaw));
      const r = _b.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const k = H.smooth(u);
      const side = r.x * (e.position.x < 26 ? 1 : -1) > 0 ? 1 : -1; // the bazaar behind the train
      cam.pos.copy(e.position).addScaledVector(f, H.lerp(4.5, 3.2, k)).addScaledVector(r, side * 4.2);
      cam.pos.y = 0.8;
      cam.look.copy(e.position).addScaledVector(f, -2.5).addScaledVector(r, -side * 1.5);
      cam.look.y = 1.6;
      cam.fov = 60;
    },
  },

  boat: {
    duration: 1.3,
    warm: 3,
    setup({ m, state, H }) {
      // the visitor rows out from the jetty and along the ghat: the boat's own physics (momentum,
      // keel, oar strokes) with a scripted stick that steers after a point ahead on this route
      const b = m.boat;
      const route = [[6, 0, -63.5], [16, 0, -65], [26, 0, -68.5], [35, 0, -75], [41, 0, -86]];
      const pts = Array.from({ length: 121 }, (_, i) => H.path(route, i / 120));
      b.pos.set(route[0][0], b.pos.y, route[0][2]);
      b.heading = Math.atan2(route[1][0] - route[0][0], route[1][2] - route[0][2]);
      b.vel.set(Math.sin(b.heading) * 2, Math.cos(b.heading) * 2);
      b.yawVel = 0;
      b.state = 'ride';
      m.player.sitOn(b.seat, ZERO, 0, 'row');
      b.controls = function () {
        let best = 0;
        let bestD = Infinity;
        pts.forEach((p, i) => {
          const d = (p.x - this.pos.x) ** 2 + (p.z - this.pos.z) ** 2;
          if (d < bestD) (bestD = d), (best = i);
        });
        const aim = pts[Math.min(pts.length - 1, best + 8)];
        const want = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
        const off = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
        return { f: 0.85, s: Math.max(-1, Math.min(1, -off * 2.5)) };
      };
      state.b = b;
      fill(b.group, [0, 2.4, 0], 9, 7);
      // a few wish lanterns already drifting up over the water
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Vector3(10 + i * 4 - 6, 1, -64 - (i % 3) * 3);
        m.lanterns.releaseAt(p.x, p.y, p.z, 0.2, 0.3, 'Shubh Deepavali');
      }
    },
    camera({ u, cam, H, state }) {
      const g = state.b.group;
      const k = H.smooth(u);
      cam.pos.set(g.position.x + H.lerp(3.6, 3.0, k), -0.3, g.position.z - H.lerp(4.8, 4.2, k));
      cam.look.set(g.position.x - 2.5, 2.4, g.position.z + 7);
      cam.fov = 58;
    },
  },

  // ---------- 8 · Ramleela at dusk ----------
  ramleela: {
    duration: 6,
    warm: 1,
    night: false,
    dayT: 26,
    setup({ m }) {
      const benches = m.ramayan.benches ?? [];
      void benches;
      m.player.teleport(-20, 50, 0);
      for (let i = 0; i < 4; i++) m.lanterns.releaseAt(-36 + i * 4, 1, 60 + (i % 2) * 4, 0.1, -0.2, 'Diwali');
    },
    camera({ u, cam, H }) {
      const k = H.easeInOut(u);
      cam.pos.set(H.lerp(-31.2, -30.6, k), H.lerp(1.15, 2.1, k), H.lerp(53.5, 59.5, k));
      cam.look.set(-30, H.lerp(3.4, 4.6, k), 74);
      cam.fov = 56;
    },
  },

  // ---------- 9 · Ravan Dahan with the creator's banner (personal) ----------
  ravan: {
    duration: 4,
    warm: 9,
    setup({ m }) {
      m.ravan.burn();
      m.player.teleport(-49.8, 80.8, Math.PI * 1.1); // silhouetted against the fire, clear of the banner text
      m.player.char.setAction('cheer');
    },
    update({ sec, m }) {
      // a few extra shells over the effigy for the camera
      if ([0.3, 1.4, 2.5, 3.3].some((x) => Math.abs(sec - x) < 1 / 60)) m.fireworks.launchRocketFrom?.(new THREE.Vector3(-56 + Math.random() * 4 - 2, 9, 64), { height: 26 + Math.random() * 8 });
    },
    camera({ u, cam, H }) {
      const k = H.easeInOut(u);
      cam.pos.set(H.lerp(-43.4, -43.6, k), H.lerp(1.7, 2.3, k), H.lerp(92.5, 90, k));
      cam.look.set(-51, H.lerp(6.4, 7.2, k), 68);
      cam.fov = 60;
    },
  },

  // ---------- 9b · the grand fireworks show ----------
  fireworks: {
    duration: 4,
    warm: 7,
    setup({ m }) {
      m.fireworks.grandShow();
      m.player.teleport(14.5, -10.5, Math.atan2(36 - 14.5, -30 + 10.5));
      m.player.char.setAction('lookUp');
    },
    camera({ u, cam, H }) {
      const k = H.smooth(u);
      cam.pos.set(H.lerp(11.5, 11.8, k), H.lerp(1.3, 1.6, k), H.lerp(-6.5, -7.2, k));
      cam.look.set(36, H.lerp(20, 24, k), -32);
      cam.fov = 64;
    },
  },
};
