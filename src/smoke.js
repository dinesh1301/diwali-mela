import * as THREE from 'three';
import { rand } from './utils.js';
import { settings } from './settings.js';

// Phones: emitters run at half rate, puffs grow less and point sprites are capped smaller, which
// is most of smoke's cost (large alpha-blended quads overdrawing each other).
// (set by the constructor: the tier is known only once main.js has run settings.detect())
let RATE = 1;
let GROW = 1;

/*
  Soft billowing particles for everything the hard little Debris cubes can't do: kitchen steam,
  agarbatti smoke, cracker smoke, kart dust, river mist, the Ravan burning. One Points mesh,
  alpha-blended, sorted roughly back-to-front by spawning order being good enough at night.
*/

const COLORS = {
  smoke: [0.32, 0.3, 0.34],
  steam: [0.9, 0.88, 0.86],
  dust: [0.55, 0.45, 0.33],
  mist: [0.55, 0.6, 0.72],
  fire: [1.0, 0.45, 0.12],
  ember: [1.0, 0.7, 0.3],
};

export class Smoke {
  constructor(scene, max = 1500) {
    const low = settings.tier === 'low';
    RATE = low ? 0.5 : 1;
    GROW = low ? 0.75 : 1;
    const maxPointPx = low ? 110 : 220;
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.peak = new Float32Array(max);
    this.additive = new Uint8Array(max);
    this.emitters = [];

    const geo = new THREE.BufferGeometry();
    this.attrs = {
      position: new THREE.BufferAttribute(this.pos, 3),
      aColor: new THREE.BufferAttribute(this.col, 3),
      aSize: new THREE.BufferAttribute(this.size, 1),
      aAlpha: new THREE.BufferAttribute(this.alpha, 1),
      aSeed: new THREE.BufferAttribute(this.seed, 1),
    };
    for (const [k, a] of Object.entries(this.attrs)) {
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(k, a);
    }
    this.attrList = Object.values(this.attrs);
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSeed;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying vec3 vRot; // cos, sin of the puff's rotation and its squash, per puff not per pixel
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vSeed = aSeed;
          float a = aSeed * 6.2831;
          vRot = vec3(cos(a), sin(a), 1.15 + 0.3 * sin(aSeed * 40.0));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, ${maxPointPx.toFixed(1)});
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying vec3 vRot;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          // rotate each puff a little so they don't all look identical
          vec2 r = vec2(c.x * vRot.x - c.y * vRot.y, c.x * vRot.y + c.y * vRot.x);
          float d = length(r * vec2(1.0, vRot.z));
          float soft = smoothstep(0.5, 0.05, d);
          soft *= 0.75 + 0.25 * sin((r.x + r.y) * 18.0 + vSeed * 30.0);
          float al = soft * vAlpha;
          if (al < 0.01) discard;
          gl_FragColor = vec4(vColor, al);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    if (low) this.points.layers.set(1); // phones: the river reflection skips the smoke
    scene.add(this.points);
  }

  setViewportHeight(px, fov) {
    this.material.uniforms.uScale.value = px / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  /**
   * Spawns `count` puffs at (x, y, z).
   * kind: smoke | steam | dust | mist | fire | ember · spread: start radius · rise: m/s up
   * life: seconds · size: start diameter · grow: diameter growth per second · peak: max alpha
   */
  puff(x, y, z, opts = {}, n = opts.count ?? 6) {
    const { kind = 'smoke', spread = 0.2, rise = 0.8, drift = 0.3, life = 2.5, size = 0.6, peak = 0.35, vx = 0, vz = 0 } = opts;
    const grow = (opts.grow ?? 0.5) * GROW;
    const count = n;
    const c = COLORS[kind] ?? COLORS.smoke;
    for (let k = 0; k < count; k++) {
      if (this.count >= this.max) return;
      const i = this.count++;
      const i3 = i * 3;
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * spread;
      this.pos[i3] = x + Math.cos(a) * r;
      this.pos[i3 + 1] = y + rand(-spread * 0.3, spread * 0.3);
      this.pos[i3 + 2] = z + Math.sin(a) * r;
      this.vel[i3] = vx + rand(-drift, drift);
      this.vel[i3 + 1] = rise * rand(0.7, 1.3);
      this.vel[i3 + 2] = vz + rand(-drift, drift);
      const tint = rand(0.85, 1.15);
      this.col[i3] = c[0] * tint;
      this.col[i3 + 1] = c[1] * tint;
      this.col[i3 + 2] = c[2] * tint;
      this.size[i] = size * rand(0.8, 1.2);
      this.grow[i] = grow;
      this.alpha[i] = 0;
      this.peak[i] = peak * rand(0.8, 1.1);
      this.seed[i] = Math.random();
      this.life[i] = 0;
      this.maxLife[i] = life * rand(0.8, 1.25);
    }
  }

  /** A steady source. `pos` is a Vector3 or a function(out). Returns a handle with stop(). */
  emitter(pos, opts = {}) {
    const e = { pos, opts, rate: opts.rate ?? 6, acc: 0, on: true, tmp: new THREE.Vector3(), stop() {
      this.on = false;
    } };
    this.emitters.push(e);
    return e;
  }

  kill(i) {
    const j = --this.count;
    if (i === j) return;
    const i3 = i * 3;
    const j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[j3 + k];
      this.vel[i3 + k] = this.vel[j3 + k];
      this.col[i3 + k] = this.col[j3 + k];
    }
    this.size[i] = this.size[j];
    this.alpha[i] = this.alpha[j];
    this.seed[i] = this.seed[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.grow[i] = this.grow[j];
    this.peak[i] = this.peak[j];
  }

  update(dt, t) {
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      if (!e.on) {
        this.emitters.splice(k, 1);
        continue;
      }
      e.acc += e.rate * RATE * dt;
      const n = Math.floor(e.acc);
      if (n > 0) {
        e.acc -= n;
        const p = typeof e.pos === 'function' ? e.pos(e.tmp) : e.pos;
        this.puff(p.x, p.y, p.z, e.opts, n); // no per-emit options copy
      }
    }
    const wind = Math.sin(t * 0.3) * 0.15;
    const { pos, vel, size, alpha, life, maxLife, grow, peak } = this;
    for (let i = this.count - 1; i >= 0; i--) {
      life[i] += dt;
      const L = life[i];
      const M = maxLife[i];
      if (L >= M) {
        this.kill(i);
        continue;
      }
      const i3 = i * 3;
      vel[i3] += wind * dt;
      vel[i3 + 1] *= 1 - 0.25 * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      size[i] += grow[i] * dt;
      const k = L / M;
      alpha[i] = peak[i] * Math.min(1, k * 6) * (1 - k) * (1 - k);
    }
    const n = this.count;
    if (n === 0 && this.geometry.drawRange.count === 0) return; // nothing to upload or draw
    for (const a of this.attrList) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, n);
  }
}
