import * as THREE from 'three';
import { rand, pick, hdr } from './utils.js';
import { settings } from './settings.js';

// Phones get sparser bursts and a smaller pool: every particle is a CPU update, an upload and a
// blended point sprite. `n(k)` scales a particle count by the tier's density. Set by the
// constructor, since the tier is known only once main.js has run settings.detect().
let LOW = false;
let DENSITY = 1;
let MAX = 40000;
const n = (k) => Math.max(1, Math.round(k * DENSITY));
const G = 9.8;
const STROBE = 1;
const TRAIL = 2;
const CRACKLE = 4;
const BURST = 0.5; // shell brightness; many bursts overlap additively in the finale

const C = {
  red: [1, 0.1, 0.06],
  gold: [1, 0.58, 0.16],
  green: [0.2, 1, 0.28],
  blue: [0.22, 0.42, 1],
  purple: [0.72, 0.26, 1],
  white: [1, 0.92, 0.8],
  pink: [1, 0.28, 0.62],
  cyan: [0.18, 0.88, 1],
  orange: [1, 0.36, 0.04],
};
const SHELL_COLORS = Object.keys(C);
const TYPES = ['peony', 'peony', 'chrysanthemum', 'ring', 'willow', 'heart', 'crackle', 'palm', 'double'];

const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = [0, 0, 0];

function randomUnit(out) {
  const z = rand(-1, 1);
  const a = rand(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

// One set of sparkler meshes' geometry and materials for every sparkler ever lit: a burnt-out
// sparkler is just removed from the scene, with nothing of its own left to dispose.
let kit = null;
function sparklerKit() {
  kit ??= {
    wireGeo: new THREE.CylinderGeometry(0.004, 0.004, 0.42, 6),
    wireMat: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 }),
    coatGeo: new THREE.CylinderGeometry(0.009, 0.009, 1, 8),
    coatMat: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 }),
    tipGeo: new THREE.SphereGeometry(0.012, 8, 6),
    tipMat: new THREE.MeshBasicMaterial({ color: hdr(0xfff2c0, 8) }),
  };
  return kit;
}

function randomColors() {
  const a = pick(SHELL_COLORS);
  return [a, Math.random() < 0.5 ? a : pick(SHELL_COLORS)];
}

/**
 * CPU particle system for every cracker in the mela. Particles live in flat typed arrays,
 * dead ones are swap-removed, and everything draws as a single additive Points mesh.
 */
export class Fireworks {
  constructor(scene, camera, audio, site) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.site = site.clone();
    LOW = settings.tier === 'low';
    DENSITY = LOW ? 0.4 : 1;
    MAX = LOW ? 12000 : 40000;
    const maxPointPx = LOW ? 48 : 96;

    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.base = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.flags = new Uint8Array(MAX);
    this.count = 0;

    const geo = new THREE.BufferGeometry();
    this.attrs = [
      new THREE.BufferAttribute(this.pos, 3),
      new THREE.BufferAttribute(this.col, 3),
      new THREE.BufferAttribute(this.size, 1),
    ];
    this.attrs.forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('position', this.attrs[0]);
    geo.setAttribute('aColor', this.attrs[1]);
    geo.setAttribute('aSize', this.attrs[2]);
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, ${maxPointPx.toFixed(1)});
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = exp(-dot(c, c) * 14.0);
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.layers.set(1); // the river reflection skips layer 1: no second draw of every spark
    scene.add(this.points);

    // Lights are created once and only dimmed, so shaders never recompile mid-show. Each has a finite
    // range so the light pool can drop it when the player is out of reach.
    const mkLight = (distance) => {
      const l = new THREE.PointLight(0xffffff, 0, distance, 2);
      scene.add(l);
      return l;
    };
    this.flashLights = [mkLight(160), mkLight(160)];
    this.flashIdx = 0;
    this.groundLights = [mkLight(25), mkLight(25)].map((light) => ({ light, busy: false }));
    this.sparkLight = mkLight(10);

    this.rockets = [];
    this.emitters = [];
    this.show = null;
    this.autoTimer = 2.5;
    this.sparklers = [];

    this.anaarGeo = new THREE.ConeGeometry(0.16, 0.34, 14);
    this.anaarMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 });
    this.chakriGeo = new THREE.TorusGeometry(0.14, 0.035, 8, 20);
    this.chakriMat = new THREE.MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.6 });
  }

  setViewportHeight(px) {
    this.material.uniforms.uScale.value = px / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  spawn(x, y, z, vx, vy, vz, c, bright, life, size, grav, drag, flags) {
    if (this.count >= MAX) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.base[i3] = this.col[i3] = c[0] * bright;
    this.base[i3 + 1] = this.col[i3 + 1] = c[1] * bright;
    this.base[i3 + 2] = this.col[i3 + 2] = c[2] * bright;
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.baseSize[i] = this.size[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.flags[i] = flags;
  }

  kill(i) {
    const j = --this.count;
    if (i === j) return;
    const i3 = i * 3;
    const j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[j3 + k];
      this.vel[i3 + k] = this.vel[j3 + k];
      this.base[i3 + k] = this.base[j3 + k];
      this.col[i3 + k] = this.col[j3 + k];
    }
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.baseSize[i] = this.baseSize[j];
    this.size[i] = this.size[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
    this.flags[i] = this.flags[j];
  }

  crackleSpark(x, y, z, size) {
    const sp = Math.min(3, size * 60);
    for (let k = 0, m = LOW ? 2 : 4; k < m; k++) {
      randomUnit(_v);
      this.spawn(x, y, z, _v.x * sp, _v.y * sp, _v.z * sp, C.white, 3.5, rand(0.1, 0.22), size * 0.8, 2, 3, 0);
    }
  }

  // ---------- rockets ----------

  /** A rocket from an arbitrary point (the Ravan effigy, a boat…). */
  launchRocketFrom(from, opts = {}) {
    const o = from.clone();
    const h = opts.height ?? rand(40, 62);
    this.rockets.push({ p: o, v: new THREE.Vector3(rand(-1.2, 1.2), Math.sqrt(2 * G * h), rand(-1.2, 1.2)), type: opts.type ?? pick(TYPES), colors: opts.colors ?? randomColors() });
    this.audio.whistle(o);
  }

  /** Glowing embers drifting up from a fire. */
  embers(x, y, z, count = 10) {
    for (let i = 0, m = n(count); i < m; i++) {
      this.spawn(x + rand(-0.5, 0.5), y, z + rand(-0.5, 0.5), rand(-1.5, 1.5), rand(2, 6), rand(-1.5, 1.5), Math.random() < 0.5 ? C.gold : C.orange, 2.4, rand(0.8, 2.0), 0.12, 1.5, 1.2, Math.random() < 0.3 ? STROBE : 0);
    }
  }

  launchRocket(opts = {}) {
    const o = this.site.clone();
    o.x += rand(-5, 5);
    o.z += rand(-5, 5);
    o.y = 0.5;
    const h = opts.height ?? rand(34, 52);
    this.rockets.push({
      p: o,
      v: new THREE.Vector3(rand(-1.2, 1.2), Math.sqrt(2 * G * h), rand(-1.2, 1.2)),
      type: opts.type ?? pick(TYPES),
      colors: opts.colors ?? randomColors(),
    });
    this.audio.whistle(o);
  }

  burst(p, type, colors) {
    const c1 = C[colors[0]];
    const c2 = C[colors[1]];
    let power = 1;
    switch (type) {
      case 'peony': {
        const s = rand(15, 20);
        for (let i = 0, m = n(280); i < m; i++) {
          randomUnit(_v).multiplyScalar(s * rand(0.88, 1.04));
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, i % 3 === 0 ? c2 : c1, 3.2 * BURST, rand(1.7, 2.4), 0.5, 3.2, 1.25, Math.random() < 0.12 ? STROBE : 0);
        }
        break;
      }
      case 'chrysanthemum': {
        const s = rand(13, 17);
        for (let i = 0, m = n(220); i < m; i++) {
          randomUnit(_v).multiplyScalar(s * rand(0.9, 1.03));
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, c1, 2.8 * BURST, rand(1.6, 2.1), 0.42, 3.5, 1.3, TRAIL);
        }
        break;
      }
      case 'double': {
        for (let i = 0, m = n(200); i < m; i++) {
          randomUnit(_v).multiplyScalar(18 * rand(0.92, 1.03));
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, c1, 3 * BURST, rand(1.8, 2.3), 0.48, 3, 1.2, 0);
        }
        for (let i = 0, m = n(120); i < m; i++) {
          randomUnit(_v).multiplyScalar(8 * rand(0.9, 1.05));
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, c1 === c2 ? C.white : c2, 3.4 * BURST, rand(1.3, 1.6), 0.42, 3, 1.2, STROBE);
        }
        power = 1.2;
        break;
      }
      case 'ring': {
        // ring plane roughly faces the viewer so it reads as a circle
        _w.subVectors(p, this.camera.position).normalize();
        _w.x += rand(-0.4, 0.4);
        _w.y += rand(-0.4, 0.4);
        _w.normalize();
        _u.set(0, 1, 0).cross(_w).normalize();
        const v2 = new THREE.Vector3().crossVectors(_w, _u);
        const s = rand(15, 18);
        for (let i = 0, m = n(150); i < m; i++) {
          const a = (i / m) * Math.PI * 2;
          _v.copy(_u).multiplyScalar(Math.cos(a)).addScaledVector(v2, Math.sin(a)).multiplyScalar(s * rand(0.97, 1.02));
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, c1, 3.4 * BURST, rand(1.8, 2.2), 0.5, 2.5, 1.2, 0);
        }
        for (let i = 0, m = n(60); i < m; i++) {
          randomUnit(_v).multiplyScalar(5);
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, c2 === c1 ? C.white : c2, 3 * BURST, rand(1.2, 1.5), 0.4, 2.5, 1.2, 0);
        }
        break;
      }
      case 'willow': {
        for (let i = 0, m = n(200); i < m; i++) {
          randomUnit(_v).multiplyScalar(rand(8, 11));
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, C.gold, 2.4 * BURST, rand(3.2, 4.4), 0.4, 2.4, 1.6, TRAIL);
        }
        power = 1.2;
        break;
      }
      case 'heart': {
        _u.setFromMatrixColumn(this.camera.matrixWorld, 0);
        _w.setFromMatrixColumn(this.camera.matrixWorld, 1);
        const col = Math.random() < 0.5 ? C.pink : C.red;
        for (let i = 0, m = n(180); i < m; i++) {
          const t = (i / m) * Math.PI * 2;
          const hx = 16 * Math.pow(Math.sin(t), 3);
          const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          _v.copy(_u).multiplyScalar(hx).addScaledVector(_w, hy).multiplyScalar(15 / 16);
          this.spawn(p.x, p.y, p.z, _v.x + rand(-0.3, 0.3), _v.y + rand(-0.3, 0.3), _v.z + rand(-0.3, 0.3), col, 3.4 * BURST, rand(1.8, 2.2), 0.5, 1.5, 1.3, 0);
        }
        break;
      }
      case 'crackle': {
        for (let i = 0, m = n(200); i < m; i++) {
          randomUnit(_v).multiplyScalar(rand(12, 15));
          this.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, C.gold, 2.6 * BURST, rand(1.1, 1.6), 0.38, 3, 1.4, CRACKLE);
        }
        this.audio.crackle(p, 50, 0.9, 1.15);
        break;
      }
      case 'palm': {
        for (let arm = 0; arm < 9; arm++) {
          _w.set(rand(-1, 1), rand(0.1, 0.8), rand(-1, 1)).normalize();
          for (let j = 0, m = n(35); j < m; j++) {
            const sp = rand(6, 17);
            this.spawn(p.x, p.y, p.z, _w.x * sp + rand(-0.4, 0.4), _w.y * sp + rand(-0.4, 0.4), _w.z * sp + rand(-0.4, 0.4), C.gold, 2.6 * BURST, rand(2, 2.8), 0.42, 3.5, 1.1, TRAIL);
          }
        }
        break;
      }
    }
    this.onBurst?.(p, power);
    this.flash(p, c1, power);
    this.audio.boom(p, power);
  }

  flash(p, c, power) {
    const l = this.flashLights[this.flashIdx++ % this.flashLights.length];
    l.position.copy(p);
    l.color.setRGB(c[0], c[1], c[2]);
    l.intensity = 3500 * power;
  }

  // ---------- ground crackers ----------

  takeGroundLight() {
    const slot = this.groundLights.find((g) => !g.busy);
    if (slot) slot.busy = true;
    return slot;
  }

  releaseGroundLight(slot) {
    if (!slot) return;
    slot.busy = false;
    slot.light.intensity = 0;
  }

  anaar(at) {
    if (this.emitters.length >= 6) return false;
    const p = at.clone();
    const body = new THREE.Mesh(this.anaarGeo, this.anaarMat);
    body.position.set(p.x, 0.17, p.z);
    this.scene.add(body);
    const gl = this.takeGroundLight();
    const dur = 7.5;
    let t = 0;
    this.audio.hiss(p, dur, { freq: 2600, level: 0.22 });
    this.onGround?.('anaar', p, dur);
    this.emitters.push({
      update: (dt) => {
        t += dt;
        if (t >= dur) {
          this.scene.remove(body);
          this.releaseGroundLight(gl);
          return false;
        }
        const env = Math.min(1, t / 1.0) * Math.min(1, (dur - t) / 1.5);
        const count = Math.floor(600 * DENSITY * env * dt + Math.random());
        for (let i = 0; i < count; i++) {
          const a = rand(0, Math.PI * 2);
          const r = rand(0, 1.6) * env;
          const vy = rand(7, 12.5) * (0.55 + 0.45 * env);
          this.spawn(p.x, 0.36, p.z, Math.cos(a) * r, vy, Math.sin(a) * r, Math.random() < 0.7 ? C.gold : C.white, 1.7, rand(0.8, 1.5), 0.075, G, 0.3, Math.random() < 0.08 ? STROBE : 0);
        }
        if (gl) {
          gl.light.position.set(p.x, 1.6, p.z);
          gl.light.color.setRGB(1, 0.6, 0.2);
          gl.light.intensity = 30 * env * rand(0.75, 1.15);
        }
        return true;
      },
    });
    return true;
  }

  chakri(at) {
    if (this.emitters.length >= 6) return false;
    const p = at.clone();
    const body = new THREE.Mesh(this.chakriGeo, this.chakriMat);
    body.position.set(p.x, 0.05, p.z);
    this.scene.add(body);
    const gl = this.takeGroundLight();
    const dur = 6;
    const palette = [C.gold, C.green, C.red];
    let t = 0;
    let angle = 0;
    this.audio.hiss(p, dur, { freq: 3800, level: 0.18 });
    this.onGround?.('chakri', p, dur);
    this.emitters.push({
      update: (dt) => {
        t += dt;
        if (t >= dur) {
          this.scene.remove(body);
          this.releaseGroundLight(gl);
          return false;
        }
        const env = Math.min(1, t / 0.5) * Math.min(1, (dur - t) / 1.0);
        angle += (6 + 30 * env) * dt;
        body.rotation.set(-Math.PI / 2, 0, angle);
        const col = palette[Math.floor(t / 1.5) % palette.length];
        const count = Math.floor(450 * DENSITY * env * dt + Math.random());
        for (let i = 0; i < count; i++) {
          const a = angle + (i % 2) * Math.PI + rand(-0.2, 0.2);
          const sp = rand(3.5, 7) * env + 1;
          this.spawn(p.x + Math.cos(a) * 0.16, 0.08, p.z + Math.sin(a) * 0.16, -Math.sin(a) * sp, rand(0.3, 2.2), Math.cos(a) * sp, col, 2, rand(0.35, 0.75), 0.07, G, 1.0, 0);
        }
        if (gl) {
          gl.light.position.set(p.x, 0.8, p.z);
          gl.light.color.setRGB(col[0], col[1], col[2]);
          gl.light.intensity = 18 * env * rand(0.8, 1.1);
        }
        return true;
      },
    });
    return true;
  }

  /**
   * A hand-held sparkler. `anchor(outPos)` writes the hand position and returns the holder's
   * heading; `onEnd` runs when it burns out. One per owner: relighting the same owner's resets it.
   */
  phuljhadi(anchor, onEnd, { duration = 18, light = true, rate = 900, owner = 'player' } = {}) {
    if (light) this.audio.hiss(null, duration, { freq: 5200, level: 0.06 });
    const existing = owner ? this.sparklers.find((s) => s.owner === owner) : null;
    if (existing) {
      existing.t = 0;
      return existing;
    }
    const group = new THREE.Group();
    const k = sparklerKit();
    const wire = new THREE.Mesh(k.wireGeo, k.wireMat);
    wire.position.y = 0.21;
    const coat = new THREE.Mesh(k.coatGeo, k.coatMat);
    const tip = new THREE.Mesh(k.tipGeo, k.tipMat);
    group.add(wire, coat, tip);
    group.rotation.order = 'YXZ';
    this.scene.add(group);
    const s = { group, coat, tip, t: 0, dur: duration, anchor, onEnd, light, rate, owner };
    this.sparklers.push(s);
    return s;
  }

  updateSparklers(dt) {
    let lit = false;
    for (let i = this.sparklers.length - 1; i >= 0; i--) {
      const s = this.sparklers[i];
      s.t += dt;
      if (s.t >= s.dur) {
        s.group.removeFromParent();
        this.sparklers.splice(i, 1);
        s.onEnd?.();
        continue;
      }
      const heading = s.anchor(s.group.position);
      s.group.rotation.set(0.6, heading, 0);
      s.group.updateMatrixWorld(true);
      const frac = s.dur === Infinity ? 0.5 : s.t / s.dur;
      const burnY = 0.42 - 0.3 * frac;
      const coatH = burnY - 0.12;
      s.coat.scale.y = coatH;
      s.coat.position.y = 0.12 + coatH / 2;
      s.tip.position.y = burnY;
      s.tip.getWorldPosition(_v);
      const count = Math.floor(s.rate * DENSITY * dt + Math.random());
      for (let k = 0; k < count; k++) {
        randomUnit(_u).multiplyScalar(rand(0.6, 2.8));
        this.spawn(_v.x, _v.y, _v.z, _u.x, _u.y, _u.z, Math.random() < 0.6 ? C.white : C.gold, 2.2, rand(0.12, 0.4), 0.016, 2.5, 2.5, Math.random() < 0.25 ? CRACKLE : 0);
      }
      if (s.light) {
        this.sparkLight.position.copy(_v);
        this.sparkLight.color.setRGB(1, 0.75, 0.45);
        this.sparkLight.intensity = 6 * rand(0.7, 1.2);
        lit = true;
      }
    }
    if (!lit) this.sparkLight.intensity = 0;
  }

  // ---------- shows ----------

  grandShow() {
    if (this.show) return false;
    const seq = [];
    let t = 0.5;
    for (let i = 0; i < 28; i++) {
      t += rand(0.35, 1.0);
      seq.push({ t, n: Math.random() < 0.3 ? 2 : 1 });
    }
    t += 1.5;
    for (let i = 0; i < 20; i++) {
      t += rand(0.18, 0.35);
      seq.push({ t, n: 1, finale: true });
    }
    this.show = { t: 0, seq, i: 0 };
    this.onShow?.(seq[seq.length - 1].t + 4);
    for (let k = -1; k <= 1; k++) this.anaar(new THREE.Vector3(this.site.x + k * 4, 0, this.site.z + 9.5));
    return true;
  }

  // ---------- simulation ----------

  update(dt) {
    if (this.show) {
      const s = this.show;
      s.t += dt;
      while (s.i < s.seq.length && s.seq[s.i].t <= s.t) {
        const e = s.seq[s.i++];
        for (let k = 0; k < e.n; k++) {
          this.launchRocket(e.finale ? { type: pick(['peony', 'chrysanthemum', 'crackle', 'willow', 'double']), height: rand(40, 60) } : {});
        }
      }
      if (s.i >= s.seq.length && this.rockets.length === 0) this.show = null;
    } else {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.launchRocket();
        if (Math.random() < 0.35) this.launchRocket();
        this.autoTimer = rand(3, 7);
      }
    }

    for (let r = this.rockets.length - 1; r >= 0; r--) {
      const k = this.rockets[r];
      k.v.y -= G * dt;
      k.p.addScaledVector(k.v, dt);
      this.spawn(k.p.x, k.p.y, k.p.z, 0, 0, 0, C.gold, 1.4, 0.05, 0.3, 0, 0, 0);
      // tail sparks by time (180/s), not per frame, so a 120 Hz screen doesn't spawn twice as many
      const sparks = Math.floor(180 * DENSITY * dt + Math.random());
      for (let j = 0; j < sparks; j++) {
        this.spawn(k.p.x + rand(-0.05, 0.05), k.p.y - (j * k.v.y * dt) / sparks, k.p.z, rand(-0.6, 0.6), rand(-2, 0), rand(-0.6, 0.6), C.gold, 0.6, rand(0.3, 0.7), 0.2, 3, 2, 0);
      }
      if (k.v.y < 2) {
        this.burst(k.p, k.type, k.colors);
        this.rockets.splice(r, 1);
      }
    }

    for (let e = this.emitters.length - 1; e >= 0; e--) {
      if (!this.emitters[e].update(dt)) this.emitters.splice(e, 1);
    }
    this.updateSparklers(dt);

    const { pos, vel, base, col, life, maxLife, baseSize, size, grav, drag, flags } = this;
    for (let i = this.count - 1; i >= 0; i--) {
      life[i] += dt;
      const L = life[i];
      const M = maxLife[i];
      const i3 = i * 3;
      if (L >= M) {
        if (flags[i] & CRACKLE) this.crackleSpark(pos[i3], pos[i3 + 1], pos[i3 + 2], baseSize[i]);
        this.kill(i);
        continue;
      }
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - grav[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      const k = L / M;
      let f = 1 - k;
      f *= Math.sqrt(f);
      // shell stars start stacked on one point; fading them in avoids a blinding bloom spike
      if (L < 0.12 && baseSize[i] > 0.33) f *= L / 0.12;
      const fl = flags[i];
      if (fl & STROBE && k > 0.4) f *= Math.sin(L * 50 + i) > 0 ? 1.4 : 0.05;
      if (fl & TRAIL && Math.random() < 18 * DENSITY * dt) {
        _c[0] = base[i3];
        _c[1] = base[i3 + 1];
        _c[2] = base[i3 + 2];
        this.spawn(pos[i3], pos[i3 + 1], pos[i3 + 2], rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3), _c, 0.4, rand(0.35, 0.6), baseSize[i] * 0.6, 2, 2, 0);
      }
      col[i3] = base[i3] * f;
      col[i3 + 1] = base[i3 + 1] * f;
      col[i3 + 2] = base[i3 + 2] * f;
      size[i] = baseSize[i] * (0.55 + 0.45 * (1 - k));
    }

    for (const l of this.flashLights) {
      l.intensity *= Math.exp(-dt * 4.5);
      if (l.intensity < 1) l.intensity = 0;
    }

    const live = this.count;
    if (live === 0 && this.geometry.drawRange.count === 0) return; // nothing to upload or draw
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, live * a.itemSize);
      a.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, live);
  }
}
