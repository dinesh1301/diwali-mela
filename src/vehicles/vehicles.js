import * as THREE from 'three';
import { StringLights } from '../stringLights.js';
import { collide } from '../physics.js';
import { clamp, setLayer } from '../utils.js';
import { linear } from '../tasks.js';
import { settings } from '../settings.js';
import { tk } from '../touch.js';
import { carModel, heliModel, planeModel } from './models.js';
import { buildAirfield, buildCarGround } from './spots.js';
import { track } from '../track.js';
import { WATER_Y } from '../world.js';

/*
  Drivable and flyable vehicles in the spirit of Sketchbook 0.4: walk up, press E, the character
  walks to the door, climbs in and the door shuts; drive or fly; press E to climb back out.
  Physics is arcade and hand-rolled; see each class.
*/

const CAR_BOUNDS = { minX: -69, maxX: 69, minZ: -43, maxZ: 77 }; // stops at the top of the ghat
const FLY_BOUNDS = { minX: -250, maxX: 250, minZ: -230, maxZ: 260, maxY: 140 };
const SEARCH_ON = 110; // heli searchlight: a soft warm pool on the ground, not a stage spot
const ZERO = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

const lerpAngle = (a, b, k) => {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * k;
};
const fmt = (ms) => {
  const s = ms / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

class Vehicle {
  /** climb: local points from the ground beside the vehicle up to (but not including) the seat */
  constructor(ctx, model, spawn, { kind, name, icon, pose, camDist, radius, help, stamp, climb }) {
    this.ctx = ctx;
    this.kind = kind;
    this.name = name;
    this.icon = icon;
    this.pose = pose;
    this.camDist = camDist;
    this.radius = radius;
    this.help = help;
    this.stamp = stamp;
    this.climb = climb;
    this.spawn = spawn;
    this.group = model.group;
    this.group.rotation.order = 'YXZ';
    this.seat = model.seat;
    this.parts = model.parts;
    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.occupied = false;
    this.thud = 0;
    this.crashed = false;
    this.ditched = false; // the crash was into the river (the manager plays the splash-down and respawn)
    this.sinking = false; // the splash-down animation owns the transform; physics is paused
    this.abandonedAt = null; // when the player last left it away from its spawn
    setLayer(this.group, 1);
    ctx.scene.add(this.group);
    this.reset();
  }

  reset() {
    const s = this.spawn;
    this.pos.set(s.x, this.ctx.world.groundHeight(s.x, s.z), s.z);
    this.heading = s.heading;
    this.vel.set(0, 0, 0);
    this.group.rotation.set(0, s.heading, 0);
    this.onReset?.();
  }

  forward(out = _f) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** What's under the vehicle: aircraft settle on the river's surface, cars only ever see land. */
  floor(x = this.pos.x, z = this.pos.z) {
    const w = this.ctx.world;
    return this.kind === 'car' || !w.flyFloor ? w.groundHeight(x, z) : w.flyFloor(x, z);
  }

  overWater() {
    return !!this.ctx.world.overWater?.(this.pos.x, this.pos.z);
  }

  altitude() {
    return this.pos.y - this.floor();
  }

  speed() {
    return this.vel.length();
  }

  awayFromSpawn() {
    return Math.hypot(this.pos.x - this.spawn.x, this.pos.z - this.spawn.z) > 25;
  }

  /** World-space waypoints from the ground beside the vehicle to the seat. */
  climbWorld() {
    this.group.updateMatrixWorld(true);
    const path = this.climb.map((p) => this.group.localToWorld(p.clone()));
    path.push(this.seat.getWorldPosition(new THREE.Vector3()));
    return path;
  }

  /** Reads the shared controls: f/s = forward/strafe axes, up/down = the two extra buttons. */
  controls() {
    const inp = this.ctx.input;
    if (!this.occupied) return { f: 0, s: 0, up: 0, down: 0 };
    const k = (c) => (inp.isDown(c) ? 1 : 0);
    return {
      f: clamp(k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - inp.move.y, -1, 1),
      s: clamp(k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + inp.move.x, -1, 1),
      up: inp.isAction('jump') ? 1 : 0,
      down: inp.isAction('run') ? 1 : 0,
    };
  }

  bump(strength) {
    if (this.thud > 0 || strength < 3) return;
    this.thud = 0.5;
    this.ctx.audio.thud();
  }

  /** A hard hit while flying: the manager notices `crashed` and tows the wreck home. */
  crash() {
    if (this.crashed || !this.occupied) return;
    this.crashed = true;
    this.vel.set(0, 0, 0);
    this.onCrash?.();
  }

  /** The skids or wheels touched the river: the manager plays the splash-down and respawns it. */
  ditch() {
    if (this.crashed || !this.occupied) return;
    this.ditched = true;
    this.pos.y = WATER_Y;
    this.crash();
  }

  /** Called every frame; subclasses implement step(dt, t). */
  update(dt, t) {
    this.thud = Math.max(0, this.thud - dt);
    if (this.sinking) return;
    this.step(dt, t);
    if (this.occupied && this.speed() > 0.5) this.ctx.crowd?.pushAway(this.pos.x, this.pos.z, this.radius + 0.6);
  }
}

// ---------- Chakri Racer ----------

// One headlight for all the cars: only the car being driven has its lights on, so it moves to that
// car instead of every parked car carrying a switched-off spotlight. It starts on the first car,
// off, so the light pool finds it when it gathers the scene's lights.
let headlight = null;
function sharedHeadlight() {
  headlight ??= new THREE.SpotLight(0xfff0c8, 0, 28, 0.55, 0.5, 1.2);
  return headlight;
}

class Car extends Vehicle {
  constructor(ctx, spawn) {
    super(ctx, carModel(spawn.color), spawn, {
      kind: 'car',
      name: 'Chakri Racer',
      icon: '🚗',
      pose: 'drive',
      camDist: 7.5,
      radius: 1.6,
      stamp: 'drive',
      climb: [new THREE.Vector3(1.75, 0, -0.4)],
      help: { key: [['W S', 'Accelerate / reverse'], ['A D', 'Steer'], ['Space', 'Handbrake drift'], ['H', 'Horn'], ['E', 'Get out']], tap: [['🕹️', 'Drive & steer'], ['✋', 'Drift'], ['📯', 'Horn'], ['👆', 'Get out']] },
    });
    this.steer = 0;
    this.lean = new THREE.Vector2();
    this.wheelSpin = 0;
    if (!sharedHeadlight().parent) this.mountHeadlight();
  }

  mountHeadlight() {
    const lamp = sharedHeadlight();
    this.parts.head.add(lamp);
    lamp.target = this.parts.headTarget;
  }

  /** The shared headlight follows whoever is driving and goes dark when they get out. */
  syncHeadlight() {
    const lamp = sharedHeadlight();
    const mine = lamp.parent === this.parts.head;
    if (this.occupied) {
      if (!mine) this.mountHeadlight();
      lamp.intensity = 90;
    } else if (mine) lamp.intensity = 0;
  }

  onReset() {
    this.steer = 0;
  }

  canExit() {
    return this.speed() < 3;
  }

  exitHint() {
    return 'Slow down to get out';
  }

  step(dt) {
    this.syncHeadlight();
    // a parked car that has come to rest: nothing moves, so skip collision, ground and pose work
    if (!this.occupied && this.vel.x * this.vel.x + this.vel.z * this.vel.z < 1e-6 && Math.abs(this.lean.x) + Math.abs(this.lean.y) + Math.abs(this.steer) < 1e-4) {
      this.vel.set(0, 0, 0);
      return;
    }
    const { world, audio, input } = this.ctx;
    const { f: throttle, s: steer, up: brake } = this.controls();
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = -fz; // right-hand side of the car
    const rz = fx;
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vr = this.vel.x * rx + this.vel.z * rz;

    const MAXF = 22;
    const MAXR = 7;
    const reversing = throttle * vf < 0;
    vf += throttle * (reversing ? 16 : 9) * dt;
    vf -= (0.012 * vf * Math.abs(vf) + 1.4 * Math.sign(vf)) * dt;
    if (brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 14 * dt);
    if (Math.abs(vf) < 0.15 && throttle === 0) vf = 0;
    vf = clamp(vf, -MAXR, MAXF);
    const grip = brake ? 1.2 : 7;
    vr *= Math.exp(-grip * dt);
    if (brake && Math.abs(vf) > 6) vr += steer * 3 * dt * Math.sign(vf); // kick the tail out

    // Steering needs motion, but full lock comes in by walking pace, and when the car is pinned
    // against a barrier the throttle you're giving counts as motion, so you can turn away from it.
    const motion = Math.abs(vf) > 0.6 ? vf : throttle * 2.5;
    const steerEff = clamp(motion / 2.5, -1, 1) * (1 - 0.35 * clamp((Math.abs(vf) - 12) / 10, 0, 1)); // a touch calmer at top speed
    this.heading -= steer * 1.8 * steerEff * (brake ? 1.5 : 1) * dt;
    this.steer += (steer * 0.5 - this.steer) * (1 - Math.exp(-dt * 8));

    this.vel.set(fx * vf + rx * vr, 0, fz * vf + rz * vr);
    const px = this.pos.x;
    const pz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collide(world.colliders, CAR_BOUNDS, this.pos, this.radius * 0.8);
    const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
    const expected = this.vel.length() * dt;
    if (expected > 0.01 && moved < expected * 0.75) {
      this.bump(this.speed());
      this.vel.multiplyScalar(Math.max(0, moved / expected) * 0.4);
    }
    this.pos.y = world.groundHeight(this.pos.x, this.pos.z);

    // body lean and wheels
    const sp = Math.abs(vf);
    this.lean.x += (-throttle * 0.03 - (brake ? 0.03 : 0) - this.lean.x) * (1 - Math.exp(-dt * 5));
    this.lean.y += (-steer * (sp / MAXF) * 0.07 - this.lean.y) * (1 - Math.exp(-dt * 5));
    this.group.rotation.set(this.lean.x, this.heading, this.lean.y);
    if (this.occupied && sp > 5 && (brake || Math.abs(vr) > 2)) {
      const smoke = this.ctx.smoke;
      if (smoke) for (const side of [-0.86, 0.86]) smoke.puff(this.pos.x - fx * 1.15 + rx * side, 0.2, this.pos.z - fz * 1.15 + rz * side, { kind: 'dust', count: 1, size: 0.5, grow: 1.4, rise: 0.4, drift: 0.6, life: 1.1, peak: 0.3 });
    }
    this.wheelSpin += (vf / 0.36) * dt;
    for (const w of this.parts.wheels) {
      w.mesh.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = -this.steer;
    }
    if (this.occupied) {
      audio.setEngine(Math.abs(throttle), sp / MAXF);
      if (input.pressedAction('horn')) audio.horn();
    }
  }
}

// ---------- Pushpak Heli ----------

class Heli extends Vehicle {
  constructor(ctx, spawn) {
    super(ctx, heliModel(), spawn, {
      kind: 'heli',
      name: 'Pushpak Heli',
      icon: '🚁',
      pose: 'pilot',
      camDist: 12,
      radius: 2.6,
      stamp: 'fly',
      climb: [new THREE.Vector3(1.9, 0, 0.3), new THREE.Vector3(0.85, 0.2, 0.3)], // ground, then the skid
      help: { key: [['Space', 'Ascend'], ['Shift', 'Descend'], ['W S', 'Forward / back'], ['A D', 'Turn'], ['E', 'Land & get out']], tap: [['▲', 'Hold to go up'], ['▼', 'Hold to go down'], ['🕹️', 'Fly & turn'], ['👆', 'Land, then get out']] },
    });
    this.rotor = 0;
    this.tilt = new THREE.Vector2();
  }

  onReset() {
    this.rotor = 0;
    this.tilt?.set(0, 0); // the base constructor resets before the subclass fields exist
  }

  onCrash() {
    this.tilt.set(0, 0);
  }

  canExit() {
    return this.altitude() < 1.2 && this.speed() < 2 && !this.overWater();
  }

  exitHint() {
    return this.overWater() ? 'Fly back over land to get out' : 'Land to get out';
  }

  step(dt) {
    const { world, audio } = this.ctx;
    const { f, s, up, down } = this.controls();
    this.rotor += ((this.occupied ? 1 : 0) - this.rotor) * (1 - Math.exp(-dt * 0.7));
    const lift = this.rotor > 0.72;
    const alt = this.altitude();
    const grounded = alt < 0.02;

    if (lift) {
      this.forward(_f);
      this.vel.addScaledVector(_f, f * 9 * dt);
      const k = Math.exp(-1.1 * dt);
      this.vel.x *= k;
      this.vel.z *= k;
      const vyTarget = (up - down) * 7;
      if (!(grounded && vyTarget <= 0)) this.vel.y += (vyTarget - this.vel.y) * (1 - Math.exp(-dt * 3));
      else this.vel.y = 0;
      if (!grounded || up) this.heading -= s * 1.5 * dt;
    } else {
      this.vel.multiplyScalar(Math.exp(-4 * dt));
      this.vel.y = Math.min(this.vel.y, 0);
    }
    if (!grounded) this.vel.y -= (lift ? 0 : 9) * dt;

    this.pos.addScaledVector(this.vel, dt);
    if (world.collideFlying(this.pos, this.radius * 0.7, this.pos.y)) {
      if (this.speed() > 10) return this.crash();
      this.bump(this.speed());
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }
    this.pos.x = clamp(this.pos.x, FLY_BOUNDS.minX, FLY_BOUNDS.maxX);
    this.pos.z = clamp(this.pos.z, FLY_BOUNDS.minZ, FLY_BOUNDS.maxZ);
    const g = this.floor();
    // skids on the river (the hover hold settles within 2 cm of a surface, so that counts): no landing on water
    if (this.pos.y - g < 0.03 && this.overWater()) return this.ditch();
    if (this.pos.y <= g) {
      if (this.vel.y < -8) return this.crash();
      if (this.vel.y < -4) this.bump(5);
      this.pos.y = g;
      this.vel.y = 0;
      this.vel.x *= 0.9;
      this.vel.z *= 0.9;
    }
    if (this.pos.y > g + FLY_BOUNDS.maxY) {
      this.pos.y = g + FLY_BOUNDS.maxY;
      this.vel.y = Math.min(this.vel.y, 0);
    }

    this.tilt.x += (f * 0.26 * this.rotor - this.tilt.x) * (1 - Math.exp(-dt * 3));
    this.tilt.y += (s * 0.18 * this.rotor - this.tilt.y) * (1 - Math.exp(-dt * 3));
    this.group.rotation.set(this.tilt.x, this.heading, this.tilt.y);
    this.parts.rotor.rotation.y += this.rotor * 26 * dt;
    this.parts.tailRotor.rotation.x += this.rotor * 55 * dt;
    this.parts.blur.material.opacity = clamp((this.rotor - 0.5) * 0.7, 0, 0.3);
    // the searchlight eases on and off rather than snapping (a hard 0 when idle keeps it out of the LightPool)
    const search = this.parts.search;
    const want = this.occupied && this.rotor > 0.5 ? SEARCH_ON : 0;
    search.intensity += (want - search.intensity) * (1 - Math.exp(-dt * 4));
    if (search.intensity < 0.5 && want === 0) search.intensity = 0;
    if (this.occupied) audio.setEngine(this.rotor * (0.75 + 0.25 * up), this.speed() / 20);
  }
}

// ---------- Pushpak Viman ----------

class Plane extends Vehicle {
  constructor(ctx, spawn) {
    super(ctx, planeModel(), spawn, {
      kind: 'plane',
      name: 'Pushpak Viman',
      icon: '✈️',
      pose: 'pilot',
      camDist: 13,
      radius: 3.2,
      stamp: 'fly',
      climb: [new THREE.Vector3(1.7, 0, -1.3), new THREE.Vector3(0.95, 0.86, -0.15)], // behind the wing, then onto it
      help: { key: [['W S', 'Throttle up / down'], ['A D', 'Bank & turn'], ['Space', 'Pull up'], ['Shift', 'Nose down'], ['E', 'Land & get out']], tap: [['🕹️', 'Throttle & turn'], ['▲', 'Pull up'], ['▼', 'Dive'], ['👆', 'Land, then get out']] },
    });
    this.throttle = 0;
    this.pitch = 0;
    this.roll = 0;
    this.airspeed = 0;
    this.onGround = true;
  }

  onReset() {
    this.throttle = 0;
    this.pitch = 0;
    this.roll = 0;
    this.airspeed = 0;
    this.onGround = true;
  }

  onCrash() {
    this.airspeed = 0;
    this.throttle = 0;
    this.onGround = true;
    this.pitch = 0;
    this.roll = 0;
  }

  canExit() {
    return this.onGround && this.airspeed < 4;
  }

  exitHint() {
    return this.onGround ? 'Slow down to get out' : 'Land to get out';
  }

  speed() {
    return this.airspeed;
  }

  step(dt) {
    const { world, audio, ui } = this.ctx;
    const { f, s, up, down } = this.controls();
    const prevY = this.pos.y;
    const MAX = 42;
    const TAKEOFF = 15;
    const STALL = 11;
    const THRUST = 13;

    if (this.occupied) this.throttle = clamp(this.throttle + f * 0.6 * dt, 0, 1);
    else this.throttle = Math.max(0, this.throttle - dt * 0.5);
    const pitchIn = up - down;

    let a = THRUST * this.throttle - (THRUST / (MAX * MAX)) * this.airspeed * this.airspeed - Math.sin(this.pitch) * 5;
    if (this.onGround) a -= 1.2 + (this.throttle === 0 ? 2.5 : 0);
    this.airspeed = Math.max(0, this.airspeed + a * dt);

    if (this.onGround) {
      this.roll *= Math.exp(-dt * 4);
      this.heading -= s * 1.1 * clamp(this.airspeed / 8, 0, 1) * dt;
      if (this.airspeed >= TAKEOFF && pitchIn > 0) {
        this.pitch = Math.min(0.5, this.pitch + 0.9 * dt);
        if (this.pitch > 0.08) this.onGround = false;
      } else {
        this.pitch *= Math.exp(-dt * 6);
      }
    } else {
      if (s !== 0) this.roll = clamp(this.roll + s * 2.0 * dt, -1.1, 1.1);
      else this.roll *= Math.exp(-dt * 1.4);
      if (pitchIn !== 0) this.pitch = clamp(this.pitch + pitchIn * 1.3 * dt, -0.9, 0.9);
      else this.pitch *= Math.exp(-dt * 0.5);
      this.heading -= Math.sin(this.roll) * 1.1 * clamp(this.airspeed / MAX, 0.3, 1) * dt;
      if (this.airspeed < STALL) this.pitch -= ((STALL - this.airspeed) / STALL) * 1.1 * dt;
    }

    _f.set(Math.sin(this.heading) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.heading) * Math.cos(this.pitch));
    this.vel.copy(_f).multiplyScalar(this.airspeed);
    this.pos.addScaledVector(this.vel, dt);
    if (!this.onGround && this.airspeed < STALL) this.pos.y -= ((STALL - this.airspeed) / STALL) * 7 * dt;

    if (world.collideFlying(this.pos, this.radius * 0.6, this.pos.y)) {
      if (this.airspeed > 16) return this.crash();
      this.bump(this.airspeed);
      this.airspeed *= 0.25;
    }
    const bx = clamp(this.pos.x, FLY_BOUNDS.minX, FLY_BOUNDS.maxX);
    const bz = clamp(this.pos.z, FLY_BOUNDS.minZ, FLY_BOUNDS.maxZ);
    if (bx !== this.pos.x || bz !== this.pos.z) {
      this.pos.x = bx;
      this.pos.z = bz;
      // turn back towards the mela
      const want = Math.atan2(-this.pos.x, -this.pos.z);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * dt * 1.5;
      if (this.occupied && this.thud <= 0) {
        this.thud = 3;
        ui.toast('🧭 The mela is back that way!');
      }
    }
    const g = this.floor();
    if (this.pos.y <= g) {
      if (this.overWater()) return this.ditch(); // wheels in the river: it can't land on water either
      const sink = (prevY - this.pos.y) / Math.max(dt, 1e-3);
      this.pos.y = g;
      if (!this.onGround) {
        this.onGround = true;
        if (this.pitch < -0.35 || this.airspeed > 34 || sink > 9) return this.crash();
        if (this.pitch < -0.2 || this.airspeed > 28) {
          this.bump(8);
          this.airspeed *= 0.45;
        } else {
          this.ctx.audio.thud();
        }
        this.pitch = Math.max(0, this.pitch) * 0.3;
      }
    } else if (this.pos.y > g + FLY_BOUNDS.maxY) {
      this.pos.y = g + FLY_BOUNDS.maxY;
      this.pitch = Math.min(this.pitch, 0);
    }

    this.group.rotation.set(-this.pitch, this.heading, this.roll);
    this.parts.prop.rotation.z += (0.2 + this.throttle * 1.4 + this.airspeed / MAX) * 30 * dt;
    this.parts.blur.material.opacity = this.throttle > 0.15 ? 0.22 : 0;
    if (this.onGround) for (const w of this.parts.wheels) w.rotation.x += (this.airspeed / 0.28) * dt;
    if (this.occupied) audio.setEngine(this.throttle, this.airspeed / MAX);
  }
}

// ---------- lap timing on the kart circuit ----------

class LapTimer {
  constructor(track) {
    this.pts = track.points;
    this.start = track.start;
    this.N = this.pts.length;
    this.best = 0;
    try {
      this.best = Number(localStorage.getItem('melaBestLap')) || 0;
    } catch {
      // ignore
    }
    this.reset();
  }

  reset() {
    this.idx = this.start;
    this.sector = 0;
    this.lapStart = null;
    this.laps = 0;
    this.last = 0;
    this.prev = 0;
    this.event = null;
  }

  /** Returns 'lap' | 'best' | 'start' when something happened this frame, else null. */
  update(pos, now) {
    // track the nearest centreline sample in a window around the last one
    let bi = this.idx;
    let bd = Infinity;
    for (let k = -14; k <= 14; k++) {
      const i = (this.idx + k + this.N) % this.N;
      const d = Math.hypot(pos.x - this.pts[i].x, pos.z - this.pts[i].z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    this.idx = bi;
    this.onTrack = bd < 6;
    const p = ((bi - this.start + this.N) % this.N) / this.N;
    let event = null;
    if (this.onTrack) {
      if (this.sector === 0 && p > 0.3 && p < 0.42) this.sector = 1;
      else if (this.sector === 1 && p > 0.62 && p < 0.74) this.sector = 2;
      if (this.prev > 0.9 && p < 0.1) {
        if (this.sector === 2 && this.lapStart !== null) {
          this.last = now - this.lapStart;
          this.laps++;
          event = 'lap';
          if (!this.best || this.last < this.best) {
            this.best = this.last;
            event = 'best';
            try {
              localStorage.setItem('melaBestLap', String(Math.round(this.best)));
            } catch {
              // ignore
            }
          }
        } else if (this.lapStart === null) {
          event = 'start';
        }
        this.lapStart = now;
        this.sector = 0;
      }
    }
    this.prev = p;
    return event;
  }

  hud(now) {
    const cur = this.lapStart === null ? '--:--.-' : fmt(now - this.lapStart);
    return `Lap <b>${this.laps + 1}</b> · ${cur}${this.last ? ` · Last ${fmt(this.last)}` : ''} · Best <b>${this.best ? fmt(this.best) : '--:--.-'}</b>`;
  }
}

// ---------- manager ----------

export class Vehicles {
  constructor(ctx) {
    this.ctx = ctx;
    this.lights = new StringLights(ctx.scene);
    this.airfield = buildAirfield(ctx, this.lights);
    this.carGround = buildCarGround(ctx, this.lights);
    this.lights.build();
    this.laps = new LapTimer(this.carGround.track);

    this.list = [
      new Plane(ctx, this.airfield.planeSpawn),
      new Heli(ctx, this.airfield.heliSpawn),
      ...this.carGround.spawns.map((s) => new Car(ctx, s)),
    ];
    this.active = null;
    this.busy = false; // an enter/exit sequence is playing
    this.stash = null;
    this.idle = 0;
    this.camTarget = new THREE.Vector3();
    this.shake = 0; // seconds of camera shake left

    const { interactions, player } = ctx;
    for (const v of this.list) {
      interactions.add({
        pos: (o) => o.copy(v.pos),
        radius: v.radius + 2.2,
        markerHeight: v.kind === 'car' ? 2.6 : 3.6,
        label: `${v.kind === 'car' ? 'Drive' : 'Fly'} the ${v.name} ${v.icon}`,
        enabled: () => player.mode === 'walk' && !v.occupied && !this.busy,
        action: () => this.enter(v),
      });
    }
    const callable = (kinds) => this.list.filter((v) => kinds.includes(v.kind) && !v.occupied && v.awayFromSpawn());
    interactions.add({
      pos: this.airfield.callSpot,
      radius: 3,
      label: 'Call the Pushpak Viman back 📻',
      enabled: () => player.mode === 'walk' && callable(['plane', 'heli']).length > 0,
      action: () => {
        callable(['plane', 'heli']).forEach((v) => v.reset());
        ctx.ui.toast('📻 The Pushpak Viman is back at the airfield');
      },
    });
    interactions.add({
      pos: this.carGround.callSpot,
      radius: 3,
      label: 'Bring the cars back 🔧',
      enabled: () => player.mode === 'walk' && callable(['car']).length > 0,
      action: () => {
        callable(['car']).forEach((v) => v.reset());
        ctx.ui.toast('🔧 The Chakri Racers are back in the pit lane');
      },
    });
  }

  // ---------- getting in and out ----------

  /** Walks the character to a point on the ground (used by the enter sequence). */
  async walkTo(target) {
    const { player, tasks } = this.ctx;
    const from = player.pos.clone();
    const d = from.distanceTo(target);
    if (d < 0.25) return;
    player.faceTowards(target.x, target.z);
    player.animSpeed = 2.4;
    await tasks.tween(d / 2.4, (k) => player.pos.lerpVectors(from, target, k), linear);
    player.animSpeed = 0;
  }

  async swingDoor(v, open) {
    const door = v.parts.door;
    if (!door) return;
    const { tasks, audio } = this.ctx;
    if (open) audio.doorClick();
    const from = door.rotation.y;
    const to = open ? 1.3 : 0;
    await tasks.tween(open ? 0.35 : 0.3, (k) => (door.rotation.y = from + (to - from) * k));
    if (!open) audio.doorClick();
  }

  restoreStash() {
    const { player } = this.ctx;
    if (!this.stash) return;
    this.stash.obj.visible = true;
    player.held = this.stash;
    player.char.holdR = this.stash.pose ?? 'hold';
    this.stash = null;
  }

  /** Somewhere a person can stand: inside the walking bounds, off the river. */
  walkable(p) {
    const b = this.ctx.world.bounds;
    return p.x > b.minX + 1 && p.x < b.maxX - 1 && p.z > b.minZ + 1 && p.z < b.maxZ - 1;
  }

  homeSpot(v) {
    return v.kind === 'car' ? this.carGround.callSpot : this.airfield.safeSpot;
  }

  /** The wreck smokes for a moment, the pilot is left standing beside it, and it is towed home. */
  async crash(v) {
    const { player, audio, debris, ui, tasks } = this.ctx;
    this.busy = true;
    this.active = null;
    v.occupied = false;
    audio.stopEngine();
    audio.boom(v.pos, 0.6);
    ui.gameHud.hide();
    const at = v.pos.clone();
    at.y += 1;
    debris.burst(at, { count: 50, colors: [0x2a2a2a, 0x555555, 0xff7a00, 0xffd166], speed: 5, up: 5, size: 0.14, life: 2.5, gravity: 5, floor: v.pos.y });

    const out = v.climbWorld()[0];
    player.scene.attach(player.char.root);
    player.char.clearAction();
    player.mode = 'walk';
    const home = this.homeSpot(v);
    const spot = this.walkable(out) ? out : home;
    player.teleport(spot.x, spot.z, v.heading);
    this.restoreStash();
    player.cam.targetDist = 5;
    player.cam.pitch = 0.22;
    const where = v.kind === 'car' ? 'the pit lane' : 'the airfield';
    ui.toast(`\u{1F4A5} Crash! The ${v.name} is being towed back to ${where}${spot === home ? ', and so are you' : ''}`, 4500, { important: true });
    for (let i = 0; i < 5; i++) {
      debris.burst(at, { count: 10, colors: [0x333333, 0x4a4a4a], speed: 0.6, up: 1.5, size: 0.3, life: 2.5, gravity: -1.2, floor: -100 });
      await tasks.wait(0.5);
    }
    v.reset();
    v.crashed = false;
    this.busy = false;
  }

  /**
   * Into the river: the aircraft lurches over and spins as it settles into the water with a splash,
   * a spray of droplets and a short camera jolt; then it is back on its pad (or the runway) with the
   * pilot still aboard and the controls live again.
   */
  async splashdown(v) {
    const { audio, debris, smoke, ui, tasks, player } = this.ctx;
    this.busy = true;
    v.sinking = true;
    audio.stopEngine();
    audio.splash();
    audio.thud();
    this.shake = 0.6;
    const at = v.pos.clone();
    at.y = WATER_Y + 0.1;
    const low = settings.tier === 'low';
    debris.burst(at, { count: low ? 36 : 60, colors: [0xffffff, 0xdff3ff, 0x9fd3e6, 0x5fa8c0], speed: 4.5, up: 6.5, size: 0.11, life: 1.6, gravity: 9.8, floor: WATER_Y });
    smoke?.puff(at.x, WATER_Y + 0.3, at.z, { kind: 'steam', count: low ? 6 : 12, size: 1.1, grow: 1.4, rise: 0.8, drift: 0.4, life: 1.6, peak: 0.28, spread: 2.2 });
    ui.toast(`\u{1F4A6} Crashed into the river! Respawning\u2026`, 2600, { important: true });

    const g = v.group;
    const r0 = g.rotation.clone();
    const h0 = v.heading;
    const roll = (Math.random() < 0.5 ? -1 : 1) * 1.05;
    const blur = v.parts.blur?.material;
    const blur0 = blur?.opacity ?? 0;
    if (v.parts.search) v.parts.search.intensity = 0;
    await tasks.tween(1.5, (k) => {
      const e = 1 - (1 - k) * (1 - k); // eases out: the lurch is quick, the settle slow
      g.rotation.set(r0.x + 0.35 * e, h0 + 2.4 * e, r0.z + roll * e);
      v.pos.y = WATER_Y - 1.1 * k * k; // floats a beat, then goes under
      if (v.parts.rotor) v.parts.rotor.rotation.y += (1 - k) * 0.35;
      if (blur) blur.opacity = blur0 * (1 - k);
    }, linear);
    debris.burst(at, { count: low ? 10 : 18, colors: [0xffffff, 0x9fd3e6], speed: 1.2, up: 2.2, size: 0.09, life: 1.0, gravity: 9.8, floor: WATER_Y });
    await tasks.wait(0.45);

    v.reset();
    v.sinking = false;
    v.crashed = false;
    v.ditched = false;
    if (v.kind === 'heli') v.rotor = 0.6; // already spooling: lift comes back in about a second
    this.idle = 0;
    this.camTarget.copy(v.pos);
    player.cam.yaw = v.heading + Math.PI;
    player.cam.pitch = 0.3;
    player.cam.targetDist = v.camDist;
    audio.startEngine(v.kind);
    this.busy = false;
  }

  async enter(v) {
    if (this.busy || v.occupied) return;
    const { player, audio, ui, passport, tasks } = this.ctx;
    this.busy = true;
    v.abandonedAt = null;
    this.stash = player.held;
    if (this.stash) {
      player.held = null;
      player.char.holdR = null;
      this.stash.obj.visible = false;
    }
    player.mode = 'anim';
    player.animSpeed = 0;
    player.vel.set(0, 0, 0);

    const path = v.climbWorld();
    await this.walkTo(path[0]);
    player.faceTowards(v.pos.x, v.pos.z);
    await tasks.wait(0.15);
    await this.swingDoor(v, true);

    // climb: hop between the waypoints, folding into the seated pose on the way
    player.char.setAction(v.pose);
    const h0 = player.heading;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const last = i === path.length - 1;
      await tasks.tween(last ? 0.5 : 0.45, (k) => {
        player.pos.lerpVectors(a, b, k);
        player.pos.y += Math.sin(k * Math.PI) * (last ? 0.3 : 0.5);
        if (last) player.heading = player.targetHeading = lerpAngle(h0, v.heading, k);
      });
    }
    player.sitOn(v.seat, ZERO, 0, v.pose);
    await this.swingDoor(v, false);

    v.occupied = true;
    this.active = v;
    this.idle = 0;
    this.camTarget.copy(v.pos);
    player.cam.yaw = v.heading + Math.PI;
    player.cam.pitch = v.kind === 'car' ? 0.22 : 0.3;
    player.cam.targetDist = v.camDist;
    audio.startEngine(v.kind);
    passport.stamp(v.stamp);
    ui.setHelp(v.help);
    const tips = {
      car: tk('🏁 W to go, A/D to steer, Space to drift. Cross the start line to time a lap. E to get out.', '🏁 Push the joystick up to go, sideways to steer, hold ✋ to drift. Cross the start line to time a lap.'),
      heli: tk('🚁 Hold Space to lift off, W to fly forward, A/D to turn. Land and press E to get out.', '🚁 Hold ▲ to lift off, then the joystick to fly and turn. Land, then tap “Get out”.'),
      plane: tk('✈️ Hold W for full throttle down the runway, then Space to pull up. Land and press E to get out.', '✈️ Hold the joystick up for full throttle down the runway, then hold ▲ to pull up. Land, then tap “Get out”.'),
    };
    ui.toast(tips[v.kind], 5000, { important: true });
    if (v.kind === 'car') {
      this.laps.reset();
      ui.gameHud.show({ title: '🏁 Chakri Cars', help: 'Drive through the start line to begin a timed lap', exit: false });
      ui.gameHud.stats(this.laps.hud(performance.now()));
    }
    this.busy = false;
  }

  async exit({ force = false } = {}) {
    const v = this.active;
    if (!v || this.busy) return;
    const { player, audio, ui, tasks } = this.ctx;
    this.busy = true;
    if (force && !v.canExit()) v.reset();
    this.active = null;
    v.occupied = false;
    audio.stopEngine();
    ui.gameHud.hide();

    const path = v.climbWorld().reverse(); // seat first, ground last
    player.scene.attach(player.char.root);
    player.char.root.rotation.set(0, v.heading, 0);
    player.mode = 'anim';
    player.animSpeed = 0;
    player.pos.copy(path[0]);
    player.heading = player.targetHeading = v.heading;

    if (!force) {
      await this.swingDoor(v, true);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (i === 1) player.char.clearAction(); // stand up as you step out
        await tasks.tween(i === 1 ? 0.5 : 0.45, (k) => {
          player.pos.lerpVectors(a, b, k);
          player.pos.y += Math.sin(k * Math.PI) * (i === 1 ? 0.3 : 0.5);
        });
      }
      await this.swingDoor(v, false);
    } else {
      player.char.clearAction();
      if (v.parts.door) v.parts.door.rotation.y = 0;
    }

    const out = path[path.length - 1];
    player.mode = 'walk';
    if (this.walkable(out)) {
      player.teleport(out.x, out.z, v.heading);
    } else {
      const home = this.homeSpot(v);
      player.teleport(home.x, home.z, v.heading);
      ui.toast(`\u{1F9ED} That is a long way from the mela, so back to ${v.kind === 'car' ? 'the pit lane' : 'the airfield'} you go`, 4000, { important: true });
    }
    this.restoreStash();
    v.abandonedAt = v.awayFromSpawn() ? performance.now() : null;
    player.cam.targetDist = 5;
    player.cam.pitch = 0.22;
    this.busy = false;
  }

  promptLabel() {
    const v = this.active;
    if (v.sinking) return 'Respawning\u2026';
    return v.canExit() ? `Get out of the ${v.name}` : v.exitHint();
  }

  update(dt, t) {
    this.lights.update(t);
    this.airfield.update(dt, t);
    for (const o of this.list) o.update(dt, t);
    const { input, ui, audio, player } = this.ctx;

    // anything left far from its spawn (or somewhere you cannot walk to) is quietly brought home
    const now = performance.now();
    for (const o of this.list) {
      if (o.occupied || !o.abandonedAt) continue;
      const age = now - o.abandonedAt;
      const far = Math.hypot(player.pos.x - o.pos.x, player.pos.z - o.pos.z) > 30;
      if ((far && age > 8000) || (!this.walkable(o.pos) && age > 5000) || age > 90000) {
        o.abandonedAt = null;
        o.reset();
        ui.toast(`${o.icon} The ${o.name} has been brought back to ${o.kind === 'car' ? 'the pit lane' : 'the airfield'}`, 3500, { important: true });
      }
    }

    const v = this.active;
    if (!v || this.busy) return;
    if (v.crashed) return v.ditched ? this.splashdown(v) : this.crash(v);
    if (v.kind === 'car') {
      const now = performance.now();
      const ev = this.laps.update(v.pos, now);
      if (ev === 'start') ui.toast('🏁 Lap started! Go go go!');
      else if (ev === 'lap') {
        audio.lapBeep();
        ui.toast(`🏁 Lap ${this.laps.laps}: ${fmt(this.laps.last)}`);
        track('game_score', { game: 'kart_lap', score: Math.round(this.laps.last), lap: this.laps.laps });
      } else if (ev === 'best') {
        audio.lapBeep(true);
        this.ctx.net?.submitScore('lap', Math.round(this.laps.best));
        track('game_score', { game: 'kart_lap', score: Math.round(this.laps.best), lap: this.laps.laps, best: true });
        ui.toast(`🏆 New best lap: ${fmt(this.laps.best)}!`, 3500);
      }
      ui.gameHud.stats(this.laps.hud(now));
    }
    if (input.pressedAction('interact')) {
      input.consumeAction('interact');
      if (v.canExit()) this.exit();
      else ui.toast(v.exitHint());
    }
  }

  /** Orbit camera around the vehicle; swings in behind it while it's moving and you're not dragging. */
  applyCamera(camera, dt) {
    const { input, player, world } = this.ctx;
    const v = this.active;
    const c = player.cam;
    if (input.lookEnabled && (input.look.dx || input.look.dy)) {
      c.yaw -= input.look.dx * 0.0045;
      c.pitch += input.look.dy * 0.0035;
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    if (this.idle > 1.2 && v.speed() > 1.5 && !settings.reduceMotion) {
      const want = v.heading + Math.PI;
      let d = want - c.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      c.yaw += d * (1 - Math.exp(-dt * 1.8));
      const wantPitch = v.kind === 'plane' ? clamp(0.25 - v.pitch * 0.6, -0.3, 0.9) : 0.28;
      c.pitch += (wantPitch - c.pitch) * (1 - Math.exp(-dt * 1.5));
    }
    c.pitch = clamp(c.pitch, -0.6, 1.3);
    if (input.wheel) c.targetDist = clamp(c.targetDist * (1 + input.wheel * 0.0012), 3, 30);
    c.dist += (c.targetDist - c.dist) * (1 - Math.exp(-dt * 8));

    _v.copy(v.pos).y += v.kind === 'car' ? 1.4 : 1.6;
    this.camTarget.lerp(_v, 1 - Math.exp(-dt * 30));
    c.target.copy(this.camTarget);
    const cp = camera.position;
    cp.set(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist).add(c.target);
    cp.y = Math.max(cp.y, (v.kind === 'car' ? world.groundHeight(cp.x, cp.z) : (world.flyFloor ?? world.groundHeight)(cp.x, cp.z)) + 0.5);
    camera.lookAt(c.target);
    if (this.shake > 0) {
      // a short, small jolt (crash into the river); none with reduced motion
      this.shake = Math.max(0, this.shake - dt);
      if (!settings.reduceMotion) {
        const a = this.shake * this.shake * 0.5;
        camera.position.x += (Math.random() - 0.5) * a;
        camera.position.y += (Math.random() - 0.5) * a;
        camera.position.z += (Math.random() - 0.5) * a;
      }
    }
  }
}
