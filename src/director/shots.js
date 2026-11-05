import * as THREE from 'three';
import { Character, randomLook } from '../character.js';
import { stallIndexFor } from '../creatorStage.js';
import { TAMBOLA_SHOT } from './tambolaShot.js';

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

/**
 * Clears the sightline from a camera move to a target rectangle: every prop instance (light poles,
 * bulbs, garland flowers, kandeels...) or loose scene-level mesh whose bounds fall inside the wedge
 * from any of the camera positions to the target (half-width `halfW`, heights `yLo`..`yHi` at the
 * target) is hidden. Subtrees in `keep` (the subject itself, the player) are never touched. Director
 * mode only: the instances are collapsed in place and never restored.
 */
function clearSightline(m, cams, target, { halfW, yLo, yHi, keep = [], nearEnd = 0.6, whole = [] }) {
  const kept = new Set();
  for (const k of keep) k?.traverse((o) => kept.add(o));
  const box = new THREE.Box3();
  const mat = new THREE.Matrix4();
  const ctr = new THREE.Vector3();
  const size = new THREE.Vector3();
  const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
  const blocks = (b) => {
    b.getCenter(ctr);
    b.getSize(size);
    const r = Math.hypot(size.x, size.z) / 2;
    for (const c of cams) {
      const dx = target.x - c.x;
      const dz = target.z - c.z;
      const L = Math.hypot(dx, dz);
      const t = ((ctr.x - c.x) * dx + (ctr.z - c.z) * dz) / L;
      if (t < 0.2 - r || t > L - nearEnd) continue;
      const f = Math.max(0, t / L);
      const lat = Math.abs((ctr.x - c.x) * dz - (ctr.z - c.z) * dx) / L;
      if (lat > halfW * f + r + 0.15) continue;
      const lo = c.y + (yLo - c.y) * f - 0.2;
      const hi = c.y + (yHi - c.y) * f + 0.2;
      if (b.max.y >= lo && b.min.y <= hi) return true;
    }
    return false;
  };
  let hidden = 0;
  // whole structures (one merged mesh each, so not hideable piece by piece): { boxes, hide }
  for (const w of whole) {
    if (w.boxes?.some(blocks)) {
      w.hide();
      hidden++;
    }
  }
  m.scene.updateMatrixWorld(true);
  m.scene.traverse((o) => {
    if (!o.isMesh || kept.has(o) || !o.visible) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (o.isInstancedMesh) {
      let dirty = false;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, mat);
        box.copy(g.boundingBox).applyMatrix4(mat).applyMatrix4(o.matrixWorld);
        if (box.isEmpty() || !blocks(box)) continue;
        o.setMatrixAt(i, ZERO_M);
        dirty = true;
        hidden++;
      }
      if (dirty) {
        o.instanceMatrix.needsUpdate = true;
        o.computeBoundingSphere?.();
      }
    } else if (o.parent === m.scene) {
      // loose static props only (merged world cells and the ground are far bigger than this)
      box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      box.getSize(size);
      if (Math.max(size.x, size.y, size.z) > 6 || !blocks(box)) return;
      o.visible = false;
      hidden++;
    }
  });
  return hidden;
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
  // ---------- 2 · walking in through the gate, up to the Mela Screen ----------
  // Over the shoulder through the arch; from ~1.5 s the camera tilts up onto the Mela Screen hung
  // over the walkway behind it, which fills the top half of the frame for the last ~2.5 s. With a
  // cfg.billboard the screen plays the creator's reels / posts, so the shot is then personal.
  gate: {
    duration: 5,
    warm: 1,
    setup({ m }) {
      m.player.teleport(0.6, 78, Math.PI);
    },
    update({ sec, m }) {
      walk(m, [0.6, 78], [0.2, 57.8], Math.min(1, (sec + 1) / 6), 1.5);
    },
    camera({ u, cam, m, H }) {
      const k = H.easeInOut(u);
      const p = m.player.pos;
      const s = m.billboard?.size;
      cam.pos.set(p.x + H.lerp(0.9, 0.55, k), H.lerp(2.0, 2.25, k), p.z + H.lerp(5.4, 4.3, k));
      // from down the walkway up to the screen's middle (a little above it: the header is in frame)
      const tilt = H.smooth(Math.min(1, Math.max(0, (u - 0.22) / 0.7)));
      const ty = s ? (s.y0 + s.top) / 2 - 0.4 : 7;
      cam.look.set(H.lerp(p.x * 0.5, 0, tilt), H.lerp(3.6, ty, tilt), H.lerp(p.z - 12, 48, tilt));
      cam.fov = 58;
    },
  },

  // ---------- 3 · the creator's own stall (personal) ----------
  // Opens square-on to their Wall of Fame (posters readable for ~2 s), then drifts back and
  // pans down the aisle to finish on the stall board with the themed goods on the counter.
  stall: {
    duration: 6,
    warm: 1,
    setup({ m, H, state }) {
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
      // the third point is already far enough back (and aimed near enough the board's centre) that
      // the whole 4.8 m title board is in a 9:16 frame from there on: the pan never crops the title
      state.camPts = [P(wa + 0.2, wo + 6.3, 2.3), P(wa - 0.6, wo + 6.0, 2.4), P(1.4, 11.4, 2.55), P(0.6, 12.55, 2.6)];
      state.lookPts = [P(wa + 0.15, wo, wy), P(wa - 0.15, wo, wy), P(0.4, 1.95, 2.55), P(0, 2.15, 2.45)];
      // nothing (a lane's light pole and its bulbs, a kandeel, a garland) between the pan and the board
      const board = m.creator?.stallBoard;
      const bc = board ? board.getWorldPosition(new THREE.Vector3()) : g.localToWorld(new THREE.Vector3(0, 3.55, 2.15));
      const cams = [];
      for (let u = 1 / 3; u <= 1.0001; u += 1 / 30) cams.push(H.path(state.camPts, u, new THREE.Vector3()));
      state.cleared = clearSightline(m, cams, bc, { halfW: 2.9, yLo: 0.9, yHi: bc.y + 1.1, keep: [g, m.player.char?.root], whole: m.billboard?.posts ? [{ boxes: m.billboard.posts, hide: () => m.billboard.hide() }] : [] });
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
      // one Catmull-Rom move: the first segment (the wall) at an even drift, then a quick Hermite
      // pan (its opening speed matches that drift, so it never hitches) that lands on the whole
      // title board by ~2.9 s, then a slow ease-out push onto the stall for the rest of the shot
      const T1 = 2.0;
      const T2 = 0.9;
      const T3 = 6 - T1 - T2;
      const herm = (p0, p1, m0, m1, x) => {
        const x2 = x * x;
        const x3 = x2 * x;
        return (2 * x3 - 3 * x2 + 1) * p0 + (x3 - 2 * x2 + x) * m0 + (-2 * x3 + 3 * x2) * p1 + (x3 - x2) * m1;
      };
      const v1 = 1 / (3 * T1); // u per second while drifting past the wall
      const v3 = (1 / 3 / T3) * 1.6; // u per second as the last segment starts (eases out to 0)
      let u;
      if (sec <= T1) u = sec * v1;
      else if (sec <= T1 + T2) u = herm(1 / 3, 2 / 3, v1 * T2, v3 * T2, (sec - T1) / T2);
      else u = herm(2 / 3, 1, v3 * T3, 0, Math.min(1, (sec - T1 - T2) / T3));
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
      // Each booth from out in the lane, square-on and far enough back (>= 7 m from the sign) that
      // the whole 4.4 m personalised sign over the booth stays in a 9:16 frame for the full 5 s:
      // it opens tilted up on the sign (readable from frame 0), then eases down onto the play.
      const half = sec < 5;
      const k = H.smooth(half ? sec / 5 : (sec - 5) / 5);
      const g = half ? state.balloon : state.rings;
      const w = (x, y, z) => g.booth.group.localToWorld(new THREE.Vector3(x, y, z));
      if (half) {
        cam.pos.copy(w(H.lerp(0.1, -0.2, k), H.lerp(2.75, 2.5, k), H.lerp(11.2, 10.2, k)));
        cam.look.copy(w(H.lerp(0, -0.1, k), H.lerp(3.1, 2.25, k), -1.5));
      } else {
        cam.pos.copy(w(H.lerp(-0.15, 0.15, k), H.lerp(2.75, 2.5, k), H.lerp(11.0, 10.0, k)));
        cam.look.copy(w(0, H.lerp(3.0, 2.0, k), -1.0));
      }
      cam.fov = 58;
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

  // ---------- 6b · Tambola Tent (shared; replaces karts in the trailer) ----------
  tambola: TAMBOLA_SHOT,

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
