import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pick, rand, clamp } from './utils.js';

/*
  A procedural low-poly person. Every body part is one merged, vertex-coloured mesh hung on a
  joint, so a whole character is 11 draw calls sharing a single material. Locomotion and action
  poses are computed as joint targets each frame and eased towards, which blends them for free.
*/

export const charMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });

export function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Transforms a geometry in place and paints it one colour, ready for merging. */
export function shape(geo, hex, [px = 0, py = 0, pz = 0] = [], [rx = 0, ry = 0, rz = 0] = [], [sx = 1, sy = 1, sz = 1] = []) {
  _m.compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return paint(geo, hex);
}

export function merged(parts, material = charMaterial) {
  return new THREE.Mesh(mergeGeometries(parts), material);
}

// ---------- looks ----------

const SKIN = [0x8d5524, 0xc68642, 0xe0ac69, 0xa8754a, 0x6f4422, 0xb07a52];
const TOPS = [0xffb703, 0xe63946, 0x2a9d8f, 0x8338ec, 0xff006e, 0xfb8500, 0xfff1d0, 0x219ebc, 0x9b2226, 0x06d6a0, 0xf72585, 0xffd166];
const BOTTOMS = [0xfff1d0, 0xf5ebe0, 0x2b2d42, 0xe9d8a6, 0x6c584c];
const HAIR = [0x140c08, 0x2b1a10, 0x3d2817];
const ACCENTS = [0xff7a00, 0xe0218a, 0xffd166, 0xc1121f, 0x2a9d8f, 0x3a86ff, 0xffffff];
const SHOES = [0x5c2a12, 0x8b1e3f, 0x3b2a1a, 0xd4a017];

/** Everything the avatar customiser can pick from (Among Us style: palettes + a few toggles). */
export const LOOK_OPTIONS = {
  skin: SKIN,
  top: [...TOPS, 0x3a4fd8, 0x1f9d55, 0xffffff, 0x111111],
  bottom: [...BOTTOMS, 0xffd166, 0xe0218a, 0x1f9d55, 0x3a4fd8],
  accent: ACCENTS,
  hair: HAIR,
  shoes: SHOES,
  style: [
    { id: 'kurta', label: 'Kurta', icon: '👕' },
    { id: 'long', label: 'Anarkali', icon: '👗' },
  ],
  hairStyle: [
    { id: 'short', label: 'Short', icon: '💇' },
    { id: 'open', label: 'Open', icon: '💁' },
    { id: 'bun', label: 'Bun', icon: '🎀' },
    { id: 'braid', label: 'Braid', icon: '🧶' },
    { id: 'turban', label: 'Pagdi', icon: '👳' },
    { id: 'topi', label: 'Topi', icon: '🧢' },
  ],
  extras: [
    { id: 'dupatta', label: 'Dupatta', icon: '🧣' },
    { id: 'bangles', label: 'Bangles', icon: '💍' },
    { id: 'bindi', label: 'Bindi', icon: '🔴' },
    { id: 'moustache', label: 'Moustache', icon: '👨' },
    { id: 'glasses', label: 'Glasses', icon: '👓' },
  ],
};

export function randomLook({ kid = false } = {}) {
  const fem = Math.random() < 0.5;
  const accent = pick(ACCENTS);
  return {
    skin: pick(SKIN),
    top: pick(TOPS),
    bottom: pick(BOTTOMS),
    shoes: pick(SHOES),
    hair: pick(HAIR),
    style: fem && Math.random() < 0.6 ? 'long' : 'kurta',
    hairStyle: fem ? pick(['bun', 'braid', 'braid', 'open']) : pick(['short', 'short', 'short', 'turban', 'topi']),
    accent,
    turban: accent,
    dupatta: fem && Math.random() < 0.7 ? pick(TOPS) : null,
    bindi: fem && Math.random() < 0.6,
    bangles: fem && Math.random() < 0.5 ? pick([0xe63946, 0xffd166, 0x2a9d8f]) : null,
    moustache: !fem && !kid && Math.random() < 0.3,
    glasses: !kid && Math.random() < 0.15,
    scale: kid ? rand(0.6, 0.7) : rand(0.95, 1.05),
  };
}

/** A fresh look for a new visitor: random, but with the accent colour tying pagdi/dupatta/bangles together. */
export function randomPlayerLook() {
  const look = randomLook();
  look.scale = 1;
  if (look.dupatta) look.dupatta = look.accent;
  if (look.bangles) look.bangles = look.accent;
  return look;
}

export const PLAYER_LOOKS = [
  { name: 'Saffron kurta', skin: 0xc68642, top: 0xff9f1c, bottom: 0xfff1d0, shoes: 0x5c2a12, hair: 0x140c08, style: 'kurta', hairStyle: 'short', dupatta: null, bindi: false, bangles: null },
  { name: 'Pink anarkali', skin: 0xe0ac69, top: 0xf72585, bottom: 0xffd166, shoes: 0xd4a017, hair: 0x140c08, style: 'long', hairStyle: 'braid', dupatta: 0xffd166, bindi: true, bangles: 0xe63946 },
  { name: 'Royal blue & pagdi', skin: 0x8d5524, top: 0x3a4fd8, bottom: 0xf5ebe0, shoes: 0x8b1e3f, hair: 0x140c08, style: 'kurta', hairStyle: 'turban', turban: 0xff7a00, dupatta: null, bindi: false, bangles: null },
  { name: 'Green lehenga', skin: 0xa8754a, top: 0x1f9d55, bottom: 0xe0218a, shoes: 0xd4a017, hair: 0x2b1a10, style: 'long', hairStyle: 'bun', dupatta: 0xff006e, bindi: true, bangles: 0xffd166 },
];

// ---------- poses ----------

const lerp = THREE.MathUtils.lerp;
const DEFAULTS = {
  hipsY: 0.95, torsoX: 0, torsoY: 0, headX: 0, headY: 0,
  armRX: 0, armRZ: -0.07, elbowR: -0.15, elbowRZ: 0,
  armLX: 0, armLZ: 0.07, elbowL: -0.15, elbowLZ: 0,
  legRX: 0, legRZ: 0, kneeR: 0.05, legLX: 0, legLZ: 0, kneeL: 0.05,
};

// Arm sign notes: the right arm hangs on -x, so a negative z rotation swings it outwards.
// A negative x rotation swings any limb forwards (the character faces +z).
const POSES = {
  give(T) {
    T.armRX = -1.25;
    T.armRZ = 0.05;
    T.elbowR = -0.25;
  },
  eat(T, p) {
    T.armRX = lerp(-0.5, -0.95, p);
    T.armRZ = lerp(0.12, 0.55, p);
    T.elbowR = lerp(-1.15, -2.25, p);
    T.headX = 0.1 * p;
  },
  throw(T, p) {
    T.armRX = lerp(2.5, -1.3, p);
    T.armRZ = -0.3;
    T.elbowR = lerp(-0.9, -0.1, p);
    T.torsoY = lerp(-0.45, 0.35, p);
    T.armLX = lerp(-0.9, 0.3, p);
  },
  aim(T, p) {
    T.armRX = -1.45;
    T.armRZ = 0.2;
    T.elbowR = -0.15 - p * 0.5;
    T.armLX = -1.4;
    T.armLZ = -0.45;
    T.elbowL = -0.5;
  },
  hammer(T, p) {
    T.armRX = T.armLX = lerp(2.9, -1.0, p);
    T.armRZ = 0.25;
    T.armLZ = -0.25;
    T.elbowR = T.elbowL = lerp(-0.4, -0.1, p);
    T.torsoX = lerp(-0.1, 0.45, p);
    T.hipsY = lerp(0.95, 0.86, p);
  },
  wave(T, p, t) {
    T.armRZ = -2.6;
    T.armRX = -0.2;
    T.elbowR = 0;
    T.elbowRZ = Math.sin(t * 10) * 0.45;
  },
  namaste(T) {
    T.armRX = T.armLX = -0.55;
    T.armRZ = 0.62;
    T.armLZ = -0.62;
    T.elbowR = T.elbowL = -1.75;
    T.headX = 0.18;
    T.torsoX = 0.12;
  },
  sit(T) {
    T.hipsY = 0.5;
    T.legRX = T.legLX = -1.45;
    T.kneeR = T.kneeL = 1.45;
    T.legRZ = -0.1;
    T.legLZ = 0.1;
    T.armRX = T.armLX = -0.5;
    T.elbowR = T.elbowL = -0.6;
  },
  drive(T) {
    POSES.sit(T);
    T.armRX = T.armLX = -1.15;
    T.armRZ = 0.12;
    T.armLZ = -0.12;
    T.elbowR = T.elbowL = -0.5;
    T.headX = -0.05;
  },
  pilot(T) {
    POSES.sit(T);
    T.armRX = -0.95;
    T.armRZ = 0.1;
    T.elbowR = -0.95;
    T.armLX = -0.65;
    T.armLZ = -0.1;
    T.elbowL = -0.9;
  },
  row(T, p) {
    POSES.sit(T);
    const s = Math.sin(p);
    T.armRX = T.armLX = -0.8 + s * 0.45;
    T.armRZ = 0.3;
    T.armLZ = -0.3;
    T.elbowR = T.elbowL = -0.35 - Math.max(0, s) * 0.9;
    T.torsoX = 0.12 + s * 0.16;
    T.headX = 0.05;
  },
  garba(T, p, t) {
    const a = t * 3.6;
    T.armRX = -1.2 + Math.sin(a) * 0.5;
    T.armLX = -1.2 - Math.sin(a) * 0.5;
    T.armRZ = -1.2 + Math.cos(a) * 0.4;
    T.armLZ = 1.2 - Math.cos(a) * 0.4;
    T.elbowR = T.elbowL = -0.6;
    T.torsoY = Math.sin(a) * 0.3;
    T.torsoX = 0.08;
    T.hipsY = 0.95 - Math.abs(Math.sin(a)) * 0.05;
  },
  straddle(T) {
    T.hipsY = 0.55;
    T.legRX = T.legLX = -0.3;
    T.legRZ = -0.55;
    T.legLZ = 0.55;
    T.kneeR = T.kneeL = 0.9;
    T.armRX = T.armLX = -0.9;
    T.elbowR = T.elbowL = -0.5;
    T.armRZ = 0.25;
    T.armLZ = -0.25;
  },
  crouch(T) {
    T.hipsY = 0.62;
    T.legRX = -1.3;
    T.kneeR = 2.1;
    T.legLX = -0.6;
    T.kneeL = 1.4;
    T.torsoX = 0.45;
    T.armRX = -1.0;
    T.elbowR = -0.2;
  },
  aarti(T, p, t) {
    const a = t * 3.2;
    T.armRX = T.armLX = -0.9 + Math.sin(a) * 0.22;
    T.armRZ = 0.45 + Math.cos(a) * 0.15;
    T.armLZ = -(0.45 + Math.cos(a) * 0.15);
    T.elbowR = T.elbowL = -1.0;
  },
  fan(T, p, t) {
    T.armRX = -1.0;
    T.armRZ = 0.5;
    T.elbowR = -1.9 + Math.sin(t * 20) * 0.35;
    T.armLX = -0.4;
    T.headX = -0.15;
  },
  cheer(T, p, t) {
    T.armRZ = -2.75;
    T.armLZ = 2.75;
    T.armRX = T.armLX = -0.2;
    T.elbowR = T.elbowL = Math.sin(t * 8) * 0.2;
    T.hipsY = 0.95 + Math.abs(Math.sin(t * 8)) * 0.05;
  },
  clap(T, p, t) {
    const c = Math.max(0, Math.sin(t * 12)) * 0.25;
    T.armRX = T.armLX = -1.1;
    T.armRZ = 0.35 + c;
    T.armLZ = -(0.35 + c);
    T.elbowR = T.elbowL = -0.5;
  },
  lookUp(T) {
    T.headX = -0.5;
  },
};

export class Character {
  constructor(look = randomLook(), { ownMaterial = false } = {}) {
    this.look = { ...look };
    this.material = ownMaterial ? charMaterial.clone() : charMaterial;
    this.headMaterial = ownMaterial ? charMaterial.clone() : charMaterial;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(look.scale ?? 1);
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.head = new THREE.Group();
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    this.headTop = new THREE.Object3D();
    this.headTop.position.y = 0.32;
    this.head.add(this.headTop);

    this.arms = [-1, 1].map((s) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.215, 0.47, 0);
      this.torso.add(shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -0.29;
      shoulder.add(elbow);
      const hand = new THREE.Group();
      hand.position.y = -0.27;
      elbow.add(hand);
      return { shoulder, elbow, hand };
    });
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(s * 0.1, -0.02, 0);
      this.hips.add(hip);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      return { hip, knee };
    });
    this.handR = this.arms[0].hand;
    this.handL = this.arms[1].hand;

    this.meshes = [];
    this.build();

    this.t = Math.random() * 10;
    this.phase = 0;
    this.action = null;
    this.actionParam = 0;
    this.snappy = false;
    this.holdR = null; // 'hold' | 'holdUp'
    this.holdL = null; // 'holdUp'
    this.cur = { ...DEFAULTS };
  }

  build() {
    const L = this.look;
    for (const m of this.meshes) {
      m.parent.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    const add = (parent, parts, material = this.material) => {
      const mesh = merged(parts, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.layers.mask = this.root.layers.mask;
      parent.add(mesh);
      this.meshes.push(mesh);
    };

    const long = L.style === 'long';
    const profile = long
      ? [[0.34, -0.82], [0.27, -0.45], [0.19, -0.05], [0.2, 0.18], [0.215, 0.32], [0.2, 0.44], [0.15, 0.52], [0.07, 0.56]]
      : [[0.25, -0.36], [0.21, -0.18], [0.19, 0], [0.2, 0.18], [0.215, 0.32], [0.2, 0.44], [0.15, 0.52], [0.07, 0.56]];
    const torso = [
      shape(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 16), L.top, [], [], [1, 1, 0.78]),
      shape(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 8), L.skin, [0, 0.6, 0]),
      shape(new THREE.BoxGeometry(0.03, 0.3, 0.02), 0xd4a017, [0, 0.33, 0.165]),
    ];
    if (long) torso.push(shape(new THREE.TorusGeometry(0.335, 0.016, 4, 24), 0xd4a017, [0, -0.8, 0], [Math.PI / 2, 0, 0], [1, 1, 0.78]));
    if (L.dupatta) torso.push(shape(new THREE.TorusGeometry(0.21, 0.032, 6, 18, Math.PI * 1.15), L.dupatta, [0, 0.3, 0], [Math.PI / 2, 0, 0.65], [1, 0.8, 1]));
    add(this.torso, torso);

    const head = [
      shape(new THREE.SphereGeometry(0.12, 16, 12), L.skin, [0, 0.1, 0], [], [0.92, 1.08, 0.98]),
      shape(new THREE.SphereGeometry(0.017, 6, 5), 0x1a1110, [-0.04, 0.12, 0.105]),
      shape(new THREE.SphereGeometry(0.017, 6, 5), 0x1a1110, [0.04, 0.12, 0.105]),
      shape(new THREE.SphereGeometry(0.02, 6, 5), L.skin, [0, 0.085, 0.118]),
    ];
    const accent = L.accent ?? L.turban ?? 0xff7a00;
    if (L.hairStyle === 'turban') {
      head.push(
        shape(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), L.turban ?? accent, [0, 0.12, -0.005], [], [1, 0.95, 1.05]),
        shape(new THREE.TorusGeometry(0.118, 0.04, 6, 18), L.turban ?? accent, [0, 0.135, 0], [Math.PI / 2, 0, 0], [1, 1.08, 1]),
        shape(new THREE.SphereGeometry(0.02, 6, 5), 0xd4a017, [0, 0.16, 0.14])
      );
    } else {
      head.push(shape(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), L.hair, [0, 0.11, -0.008], [-0.35, 0, 0], [0.95, 1.08, 1.02]));
      if (L.hairStyle === 'bun') head.push(shape(new THREE.SphereGeometry(0.06, 10, 8), L.hair, [0, 0.17, -0.1]));
      if (L.hairStyle === 'braid') head.push(shape(new THREE.CylinderGeometry(0.035, 0.02, 0.45, 6), L.hair, [0, -0.12, -0.12], [0.15, 0, 0]));
      if (L.hairStyle === 'open') {
        head.push(
          shape(new THREE.SphereGeometry(0.13, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), L.hair, [0, 0.09, -0.03], [Math.PI * 0.5, 0, 0], [0.98, 1.05, 1.5]),
          shape(new THREE.BoxGeometry(0.22, 0.3, 0.07), L.hair, [0, -0.08, -0.1], [0.12, 0, 0])
        );
      }
      if (L.hairStyle === 'topi') {
        // a Gandhi-style cap: a folded cream band with a boat-shaped crown
        head.push(
          shape(new THREE.CylinderGeometry(0.115, 0.125, 0.07, 16), 0xf6efe0, [0, 0.19, -0.005], [], [1, 1, 0.92]),
          shape(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xf6efe0, [0, 0.2, -0.005], [], [0.72, 0.5, 1.05])
        );
      }
    }
    if (L.bindi) head.push(shape(new THREE.SphereGeometry(0.009, 6, 4), 0xd00000, [0, 0.155, 0.112]));
    if (L.moustache) head.push(shape(new THREE.CapsuleGeometry(0.011, 0.05, 3, 6), L.hair, [0, 0.06, 0.112], [0, 0, Math.PI / 2], [1, 1, 0.6]));
    if (L.glasses) {
      const rim = 0x2b2118;
      head.push(
        shape(new THREE.TorusGeometry(0.03, 0.0045, 6, 14), rim, [-0.042, 0.118, 0.112]),
        shape(new THREE.TorusGeometry(0.03, 0.0045, 6, 14), rim, [0.042, 0.118, 0.112]),
        shape(new THREE.BoxGeometry(0.026, 0.006, 0.006), rim, [0, 0.122, 0.114]),
        shape(new THREE.BoxGeometry(0.006, 0.006, 0.1), rim, [-0.075, 0.12, 0.06]),
        shape(new THREE.BoxGeometry(0.006, 0.006, 0.1), rim, [0.075, 0.12, 0.06])
      );
    }
    add(this.head, head, this.headMaterial);

    for (const a of this.arms) {
      add(a.shoulder, [shape(new THREE.CapsuleGeometry(0.052, 0.2, 3, 8), L.top, [0, -0.14, 0])]);
      const lower = [
        shape(new THREE.CapsuleGeometry(0.045, 0.18, 3, 8), L.top, [0, -0.12, 0]),
        shape(new THREE.SphereGeometry(0.048, 8, 6), L.skin, [0, -0.27, 0], [], [0.9, 1.1, 0.8]),
      ];
      if (L.bangles) {
        for (let k = 0; k < 3; k++) lower.push(shape(new THREE.TorusGeometry(0.047, 0.01, 5, 14), L.bangles, [0, -0.2 - k * 0.022, 0], [Math.PI / 2, 0, 0]));
      }
      add(a.elbow, lower);
    }
    for (const g of this.legs) {
      add(g.hip, [shape(new THREE.CylinderGeometry(0.078, 0.066, 0.44, 8), L.bottom, [0, -0.22, 0])]);
      add(g.knee, [
        shape(new THREE.CylinderGeometry(0.064, 0.05, 0.43, 8), L.bottom, [0, -0.215, 0]),
        shape(new THREE.BoxGeometry(0.1, 0.06, 0.24), L.shoes, [0, -0.45, 0.05]),
      ]);
    }
  }

  /**
   * Frees this character's GPU resources and detaches it (remote visitors who leave). Shared
   * materials stay; per-character ones (ownMaterial) are disposed. Props parented to the rig are
   * the caller's to free: dispose before attaching anything you still need, or detach it first.
   */
  dispose() {
    this.root.removeFromParent();
    const geos = new Set();
    // sprites share one module-level quad in three.js: never free that
    this.root.traverse((o) => o.geometry && !o.isSprite && geos.add(o.geometry));
    for (const g of geos) g.dispose();
    if (this.material !== charMaterial) this.material.dispose();
    if (this.headMaterial !== charMaterial) this.headMaterial.dispose();
    this.meshes = [];
    this.disposed = true;
  }

  setLook(partial) {
    Object.assign(this.look, partial);
    this.build();
  }

  /** Flushes the face red (for the pani puri challenge). */
  setTint(k) {
    if (this.headMaterial === charMaterial) return;
    this.headMaterial.emissive.setRGB(0.55 * k, 0.02 * k, 0);
  }

  setAction(name, param = 0, { snappy = false } = {}) {
    this.action = name;
    this.actionParam = param;
    this.snappy = snappy;
  }

  clearAction() {
    this.action = null;
    this.snappy = false;
  }

  update(dt, { speed = 0, grounded = true } = {}) {
    this.t += dt;
    const t = this.t;
    const walk = Math.min(1, speed / 2.8);
    const run = clamp((speed - 3.2) / 2.8, 0, 1);
    const cycle = 1.5 + run * 1.2;
    if (speed > 0.05) this.phase += (dt * Math.PI * 2 * speed) / cycle;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const amp = 0.45 * walk + 0.35 * run;

    const T = { ...DEFAULTS };
    T.hipsY = 0.95 - Math.abs(c) * (0.03 * walk + 0.05 * run);
    T.torsoX = 0.04 * walk + 0.18 * run + Math.sin(t * 1.7) * 0.012 * (1 - walk);
    T.torsoY = s * 0.1 * amp;
    T.headX = -T.torsoX * 0.6;
    T.legRX = -s * amp;
    T.legLX = s * amp;
    T.kneeR = 0.05 + Math.max(0, c) * amp * 1.6;
    T.kneeL = 0.05 + Math.max(0, -c) * amp * 1.6;
    T.armRX = s * amp * 0.85;
    T.armLX = -s * amp * 0.85;
    T.armRZ = -0.07 - Math.sin(t * 1.7) * 0.02 * (1 - walk);
    T.armLZ = 0.07 + Math.sin(t * 1.7) * 0.02 * (1 - walk);
    T.elbowR = T.elbowL = -(0.15 + walk * 0.1 + run * 1.1);

    if (!grounded) {
      T.legRX = -0.55;
      T.kneeR = 1.0;
      T.legLX = 0.25;
      T.kneeL = 0.35;
      T.armRZ = -0.7;
      T.armLZ = 0.7;
      T.armRX = T.armLX = -0.3;
    }
    if (this.holdR === 'hold') {
      T.armRX = -0.5;
      T.armRZ = 0.12;
      T.elbowR = -1.15;
    } else if (this.holdR === 'holdUp') {
      T.armRX = -1.1;
      T.armRZ = -0.15;
      T.elbowR = -0.7;
    }
    if (this.holdL === 'holdUp') {
      T.armLX = -1.1;
      T.armLZ = 0.15;
      T.elbowL = -0.7;
    }
    if (this.action && POSES[this.action]) POSES[this.action](T, this.actionParam, t, this);

    const k = 1 - Math.exp(-dt * (this.snappy ? 30 : 14));
    const C = this.cur;
    for (const key in T) C[key] += (T[key] - C[key]) * k;

    this.hips.position.y = C.hipsY;
    this.torso.rotation.set(C.torsoX, C.torsoY, 0);
    this.head.rotation.set(C.headX, C.headY, 0);
    this.arms[0].shoulder.rotation.set(C.armRX, 0, C.armRZ);
    this.arms[0].elbow.rotation.set(C.elbowR, 0, C.elbowRZ);
    this.arms[1].shoulder.rotation.set(C.armLX, 0, C.armLZ);
    this.arms[1].elbow.rotation.set(C.elbowL, 0, C.elbowLZ);
    this.legs[0].hip.rotation.set(C.legRX, 0, C.legRZ);
    this.legs[0].knee.rotation.x = C.kneeR;
    this.legs[1].hip.rotation.set(C.legLX, 0, C.legLZ);
    this.legs[1].knee.rotation.x = C.kneeL;
  }
}
