import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pick, rand, clamp } from './utils.js';
import { lowDetail } from './lod.js';
import { charAtlas, ROWS } from './charAtlas.js';
import { buildPerson, BONE_COUNT, resolveLook, isGrey } from './charGeo.js';

export { resolveLook };

/*
  A procedural person (charGeo.js): one smooth SkinnedMesh with real blended weights, so elbows,
  knees, the waist, the neck and skirts bend, painted by vertex colours plus one shared atlas
  (charAtlas.js) for faces and zari borders. A whole character is one draw call (two for the
  player, whose face can flush). Locomotion and action poses are computed as joint targets each
  frame and eased towards, which blends them for free. Phones build the crowd with fewer
  segments; the player keeps full detail.
*/

/*
  The people's material. People set cuv.z >= 1: a soft warm rim (the stylised film look), and from
  2 up an atlas cell blended over the vertex colour by the painted alpha. Skin carries `glow`, a
  small light of its own, so under the night lights a dark face keeps its eyes and brows. Props
  (rides, stalls, vehicles) built with shape()/merged() use propMaterial instead, so nothing done
  to the people's shader can leak into them.
*/
function patchCharacter(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.charAtlas = { value: charAtlas() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 cuv;\nattribute float glow;\nvarying vec4 vCuv;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCuv = cuv;\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D charAtlas;\nvarying vec4 vCuv;\nvarying float vGlow;\nconst vec2 CELL_SIZE = vec2(0.25, ${(1 / ROWS).toFixed(6)});`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (vCuv.z > 1.5) {
  float cell = floor(vCuv.z - 1.5);
  vec2 org = vec2(mod(cell, 4.0), floor(cell / 4.0)) * CELL_SIZE;
  vec2 l = vec2(fract(vCuv.x), clamp(vCuv.y, 0.0, 1.0));
  vec2 g = vCuv.xy * 0.976 * CELL_SIZE;
  vec4 tx = textureGrad(charAtlas, org + (0.012 + l * 0.976) * CELL_SIZE, dFdx(g), dFdy(g));
  float m = clamp((vCuv.w - 0.15) / 0.3, 0.0, 1.0);
  diffuseColor.rgb = diffuseColor.rgb * (1.0 - tx.a * m) + tx.rgb * m;
}`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if (vCuv.z > 0.5) {
  float rim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.85, 0.7) * (rim * rim * rim) * 0.22;
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.9, 0.82) * vGlow * 0.06;
}`
      );
  };
  mat.customProgramCacheKey = () => 'mela-char-2';
  return mat;
}

const makeMaterial = () => patchCharacter(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }));
export const charMaterial = makeMaterial();
/** Props built with shape()/merged() (stalls, rides, vehicles, held items): plain vertex colours. */
export const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });

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
const _w = new THREE.Vector3();

const IDENTITY = new THREE.Matrix4();
// joints move inside this sphere (body space), whatever the pose: arms up reach about 2.1 m
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.35);

/*
  Distance rule for NPCs: beyond 60 m a character animates every third frame with the summed dt,
  and beyond the shadow range it stops casting. The viewer is set once a frame by the crowd.
*/
const FAR2 = 60 * 60;
let viewer = null;
/** Where the camera is, for the NPC distance rule (pass camera.position once; it is read live). */
export function setViewer(pos) {
  viewer = pos;
}
let lodSlot = 0;

/** Transforms a geometry in place and paints it one colour, ready for merging. */
export function shape(geo, hex, [px = 0, py = 0, pz = 0] = [], [rx = 0, ry = 0, rz = 0] = [], [sx = 1, sy = 1, sz = 1] = []) {
  _m.compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return paint(geo, hex);
}

export function merged(parts, material = propMaterial) {
  return new THREE.Mesh(mergeGeometries(parts), material);
}

// ---------- looks ----------

const SKIN = [0x8d5524, 0xc68642, 0xe0ac69, 0xa8754a, 0x6f4422, 0xb07a52, 0xd99a6c, 0x5a3820];
const TOPS = [0xffb703, 0xe63946, 0x2a9d8f, 0x8338ec, 0xff006e, 0xfb8500, 0xfff1d0, 0x219ebc, 0x9b2226, 0x06d6a0, 0xf72585, 0xffd166];
const BOTTOMS = [0xfff1d0, 0xf5ebe0, 0x2b2d42, 0xe9d8a6, 0x6c584c];
const HAIR = [0x140c08, 0x2b1a10, 0x3d2817];
const GREY = [0xb9b2a8, 0x9c958c, 0xd8d2c8];
const ACCENTS = [0xff7a00, 0xe0218a, 0xffd166, 0xc1121f, 0x2a9d8f, 0x3a86ff, 0xffffff];
const SHOES = [0x5c2a12, 0x8b1e3f, 0x3b2a1a, 0xd4a017];
const SAREES = [0xc1121f, 0xe0218a, 0x7b2cbf, 0x1f9d55, 0xff7a00, 0x0f4c81, 0xffb703, 0x9b2226, 0x06a77d];
const SHERWANI = [0x7a1f3d, 0x1d3557, 0xf1e3c6, 0x2d6a4f, 0x5e2b7e, 0xc9a227];
const DENIM = [0x2f4a7a, 0x3a5a8c, 0x23324f];

/** Everything the avatar customiser can pick from (Among Us style: palettes + a few toggles). */
export const LOOK_OPTIONS = {
  skin: SKIN,
  top: [...TOPS, 0x3a4fd8, 0x1f9d55, 0xffffff, 0x111111],
  bottom: [...BOTTOMS, 0xffd166, 0xe0218a, 0x1f9d55, 0x3a4fd8],
  accent: ACCENTS,
  hair: HAIR,
  body: [
    { id: 'm', label: 'Him', icon: '🙋‍♂️' },
    { id: 'f', label: 'Her', icon: '🙋‍♀️' },
  ],
  shoes: SHOES,
  style: [
    { id: 'kurta', label: 'Kurta', icon: '👕' },
    { id: 'sherwani', label: 'Sherwani', icon: '🤵' },
    { id: 'long', label: 'Anarkali', icon: '👗' },
    { id: 'saree', label: 'Saree', icon: '🥻' },
    { id: 'lehenga', label: 'Lehenga', icon: '💃' },
    { id: 'salwar', label: 'Salwar', icon: '🧕' },
    { id: 'casual', label: 'Casual', icon: '👟' },
  ],
  hairStyle: [
    { id: 'short', label: 'Short', icon: '💇' },
    { id: 'curly', label: 'Curly', icon: '🌀' },
    { id: 'open', label: 'Open', icon: '💁' },
    { id: 'bun', label: 'Bun', icon: '🎀' },
    { id: 'braid', label: 'Braid', icon: '🧶' },
    { id: 'pony', label: 'Pony', icon: '🎗️' },
    { id: 'turban', label: 'Pagdi', icon: '👳' },
    { id: 'topi', label: 'Topi', icon: '⛵' },
    { id: 'cap', label: 'Cap', icon: '🧢' },
    { id: 'veil', label: 'Veil', icon: '🧕' },
  ],
  extras: [
    { id: 'dupatta', label: 'Dupatta', icon: '🧣' },
    { id: 'bangles', label: 'Bangles', icon: '💍' },
    { id: 'bindi', label: 'Bindi', icon: '🔴' },
    { id: 'moustache', label: 'Moustache', icon: '👨' },
    { id: 'beard', label: 'Beard', icon: '🧔' },
    { id: 'glasses', label: 'Glasses', icon: '👓' },
  ],
};

const chance = (p) => Math.random() < p;

export function randomLook({ kid = false } = {}) {
  const fem = chance(0.5);
  const accent = pick(ACCENTS);
  const age = kid ? 'kid' : chance(0.14) ? 'elder' : chance(0.16) ? 'teen' : 'adult';
  const elder = age === 'elder';
  const teen = age === 'teen';
  let style;
  if (fem) style = kid ? pick(['frock', 'frock', 'lehenga', 'long', 'salwar']) : teen ? pick(['casual', 'salwar', 'lehenga', 'long']) : elder ? pick(['saree', 'saree', 'salwar']) : pick(['saree', 'saree', 'lehenga', 'salwar', 'long']);
  else style = kid ? pick(['kurta', 'kurta', 'casual']) : teen ? pick(['casual', 'casual', 'kurta']) : elder ? 'kurta' : pick(['kurta', 'kurta', 'kurta', 'sherwani', 'casual']);
  let hairStyle;
  if (fem) hairStyle = elder ? pick(['bun', 'bun', 'veil']) : kid ? pick(['braid', 'pony', 'open', 'bun']) : pick(['bun', 'braid', 'braid', 'open', 'pony', 'veil']);
  else hairStyle = elder ? pick(['turban', 'topi', 'short', 'turban']) : style === 'casual' ? pick(['short', 'curly', 'cap']) : pick(['short', 'short', 'curly', 'turban', 'topi']);
  if (hairStyle === 'veil' && style === 'saree') hairStyle = 'bun';
  const top = style === 'saree' || style === 'lehenga' ? pick(SAREES) : style === 'sherwani' ? pick(SHERWANI) : pick(TOPS);
  let bottom = pick(BOTTOMS);
  if (style === 'casual') bottom = pick(DENIM);
  if (style === 'saree') bottom = pick([0xffd166, 0xd4a017, top, 0x2b2d42]);
  if (style === 'lehenga') bottom = pick(SAREES.filter((c) => c !== top));
  return {
    skin: pick(SKIN),
    top,
    bottom,
    shoes: style === 'casual' ? pick([0x2b2d42, 0xe63946, 0x3a86ff, 0xf2f2f2]) : pick(SHOES),
    hair: elder ? pick(GREY) : pick(HAIR),
    style,
    body: fem ? 'f' : 'm',
    age,
    hairStyle,
    accent,
    turban: accent,
    dupatta: fem && style !== 'saree' && style !== 'casual' && style !== 'frock' && (style === 'lehenga' || chance(0.7)) ? pick([...TOPS, 0xffd166]) : hairStyle === 'veil' ? pick(TOPS) : null,
    bindi: fem && !kid && chance(0.7),
    bangles: fem && chance(0.6) ? pick([0xe63946, 0xffd166, 0x2a9d8f, 0xd4a017]) : null,
    moustache: !fem && !kid && !teen && chance(elder ? 0.8 : 0.35),
    beard: !fem && !kid && !teen && chance(elder ? 0.3 : 0.15),
    glasses: !kid && chance(elder ? 0.5 : 0.1),
    scale: kid ? rand(0.6, 0.7) : teen ? rand(0.9, 0.95) : fem ? rand(0.92, 0.98) : rand(0.97, 1.05),
  };
}

/** A fresh look for a new visitor: random, but with the accent colour tying pagdi/dupatta/bangles together. */
export function randomPlayerLook() {
  let look = randomLook();
  while (look.age !== 'adult') look = randomLook();
  look.scale = 1;
  if (look.dupatta) look.dupatta = look.accent;
  if (look.bangles) look.bangles = look.accent;
  return look;
}

export const PLAYER_LOOKS = [
  { name: 'Saffron kurta', skin: 0xc68642, top: 0xff9f1c, bottom: 0xfff1d0, shoes: 0x5c2a12, hair: 0x140c08, style: 'kurta', hairStyle: 'short', dupatta: null, bindi: false, bangles: null },
  { name: 'Pink anarkali', skin: 0xe0ac69, top: 0xf72585, bottom: 0xffd166, shoes: 0xd4a017, hair: 0x140c08, style: 'long', hairStyle: 'braid', dupatta: 0xffd166, bindi: true, bangles: 0xe63946 },
  { name: 'Royal blue & pagdi', skin: 0x8d5524, top: 0x3a4fd8, bottom: 0xf5ebe0, shoes: 0x8b1e3f, hair: 0x140c08, style: 'kurta', hairStyle: 'turban', turban: 0xff7a00, dupatta: null, bindi: false, bangles: null },
  { name: 'Green lehenga', skin: 0xa8754a, top: 0x1f9d55, bottom: 0xe0218a, shoes: 0xd4a017, hair: 0x2b1a10, style: 'lehenga', hairStyle: 'bun', dupatta: 0xff006e, bindi: true, bangles: 0xffd166 },
];

// ---------- poses ----------

const lerp = THREE.MathUtils.lerp;
const DEFAULTS = {
  hipsY: 0.95, hipsX: 0, hipsRY: 0, hipsRZ: 0, torsoX: 0, torsoY: 0, torsoZ: 0, headX: 0, headY: 0,
  armRX: 0, armRZ: -0.07, elbowR: -0.15, elbowRZ: 0,
  armLX: 0, armLZ: 0.07, elbowL: -0.15, elbowLZ: 0,
  legRX: 0, legRZ: 0, kneeR: 0.05, legLX: 0, legLZ: 0, kneeL: 0.05, footR: 0, footL: 0,
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
  constructor(look = randomLook(), { ownMaterial = false, lod = !ownMaterial } = {}) {
    this.look = { ...look };
    // the player and the customiser preview (own materials) stay full detail and full rate
    this.low = !ownMaterial && lowDetail();
    this.lod = lod;
    this._tick = lodSlot++ % 3;
    this._acc = 0;
    this._shadow2 = (this.low ? 25 : 40) ** 2;
    this.material = ownMaterial ? makeMaterial() : charMaterial;
    this.headMaterial = ownMaterial ? makeMaterial() : charMaterial;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.head = new THREE.Group();
    this.torso.add(this.head);
    this.headTop = new THREE.Object3D();
    this.head.add(this.headTop);

    this.arms = [-1, 1].map(() => {
      const shoulder = new THREE.Group();
      this.torso.add(shoulder);
      const elbow = new THREE.Group();
      shoulder.add(elbow);
      const hand = new THREE.Group();
      elbow.add(hand);
      return { shoulder, elbow, hand };
    });
    this.legs = [-1, 1].map(() => {
      const hip = new THREE.Group();
      this.hips.add(hip);
      const knee = new THREE.Group();
      hip.add(knee);
      const ankle = new THREE.Group();
      knee.add(ankle);
      return { hip, knee, ankle };
    });
    this.handR = this.arms[0].hand;
    this.handL = this.arms[1].hand;

    this.mesh = null;
    this.meshes = [];
    this.build();

    this.t = Math.random() * 10;
    this.seed = Math.random() * 100;
    this.phase = 0;
    this.action = null;
    this.actionParam = 0;
    this.snappy = false;
    this.holdR = null; // 'hold' | 'holdUp'
    this.holdL = null; // 'holdUp'
    this.cur = { ...DEFAULTS };
    this._T = { ...DEFAULTS };
    this._gaze = { x: 0, y: 0, t: 0 };
  }

  build() {
    const L = this.look;
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh.skeleton.dispose();
    }
    this.body.scale.setScalar(L.scale ?? 1);
    const split = this.headMaterial !== this.material;
    const { geometry, rig: G, look: R, headTopY } = buildPerson(L, { low: this.low, split });
    this.kind = R;
    // joints at the rig's rest offsets (their rotations are posed every frame)
    this.torso.position.set(0, 0, 0);
    this.head.position.set(0, G.headPivot, 0);
    this.headTop.position.set(0, headTopY, 0);
    this.arms.forEach((a, i) => {
      const s = i === 0 ? -1 : 1;
      a.shoulder.position.set(s * G.shX, G.shY, 0);
      a.elbow.position.set(0, -G.upper, 0);
      a.hand.position.set(0, -G.fore, 0);
    });
    this.legs.forEach((g, i) => {
      const s = i === 0 ? -1 : 1;
      g.hip.position.set(s * G.legX, -0.02, 0);
      g.knee.position.set(0, -G.thigh, 0);
      g.ankle.position.set(0, -G.shin, 0);
    });
    // bones are translations at rest, so each inverse is the negated rest position (body space)
    const rest = [
      [0, G.hy, 0], [0, G.hy, 0], [0, G.hy + G.headPivot, 0],
      [-G.shX, G.hy + G.shY, 0], [-G.shX, G.hy + G.shY - G.upper, 0],
      [G.shX, G.hy + G.shY, 0], [G.shX, G.hy + G.shY - G.upper, 0],
      [-G.legX, G.hy - 0.02, 0], [-G.legX, G.hy - 0.02 - G.thigh, 0],
      [G.legX, G.hy - 0.02, 0], [G.legX, G.hy - 0.02 - G.thigh, 0],
      [-G.legX, G.hy - 0.02 - G.thigh - G.shin, 0], [G.legX, G.hy - 0.02 - G.thigh - G.shin, 0],
    ];
    const inverses = rest.map(([x, y, z]) => new THREE.Matrix4().makeTranslation(-x, -y, -z));
    const bones = [this.hips, this.torso, this.head, this.arms[0].shoulder, this.arms[0].elbow, this.arms[1].shoulder, this.arms[1].elbow, this.legs[0].hip, this.legs[0].knee, this.legs[1].hip, this.legs[1].knee, this.legs[0].ankle, this.legs[1].ankle];
    if (bones.length !== BONE_COUNT) throw new Error('rig mismatch');

    const mesh = new THREE.SkinnedMesh(geometry, split ? [this.material, this.headMaterial] : this.material);
    mesh.bind(new THREE.Skeleton(bones, inverses), IDENTITY);
    mesh.boundingSphere = BOUNDS.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.mask = this.root.layers.mask;
    this.body.add(mesh);
    this.mesh = mesh;
    this.meshes = [mesh];

    // gait character: long skirts take shorter steps, elders walk gently, women sway the hips
    const longSkirt = R.style === 'long' || R.style === 'saree' || R.style === 'lehenga';
    this.gait = {
      stride: longSkirt ? 0.72 : R.age === 'elder' ? 0.8 : 1,
      sway: R.fem ? 1.7 : 1,
      arm: R.fem ? 0.75 : R.kid ? 1.15 : 1,
      stoop: R.age === 'elder' ? 0.09 : 0,
      spread: longSkirt ? 0.12 : R.style === 'sherwani' || R.style === 'kurta' || R.style === 'salwar' ? 0.1 : 0.08,
    };
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
    this.mesh?.skeleton.dispose(); // the bone texture of the skinned body
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

  update(dt, opts) {
    if (this.lod && viewer) {
      const d2 = _w.setFromMatrixPosition(this.root.matrixWorld).distanceToSquared(viewer);
      const cast = d2 < this._shadow2;
      if (this.mesh.castShadow !== cast) this.mesh.castShadow = cast;
      if (d2 > FAR2) {
        // far away: pose every third frame with the time that has passed
        this._acc += dt;
        if (++this._tick % 3) return;
        dt = this._acc;
      } else dt += this._acc;
      this._acc = 0;
    }
    this.animate(dt, opts);
  }

  animate(dt, { speed = 0, grounded = true } = {}) {
    this.t += dt;
    const t = this.t;
    const g = this.gait;
    const walk = Math.min(1, speed / 2.8);
    const still = 1 - walk;
    const run = clamp((speed - 3.2) / 2.8, 0, 1);
    const cycle = (1.5 + run * 1.2) * (g.stride < 1 ? 0.85 : 1);
    if (speed > 0.05) this.phase += (dt * Math.PI * 2 * speed) / cycle;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const amp = (0.45 * walk + 0.35 * run) * g.stride;

    // idle life: breathing, a slow weight shift, and a gaze that wanders now and then
    const breath = Math.sin(t * 1.55 + this.seed);
    const shift = Math.sin(t * 0.37 + this.seed * 1.7);
    const gz = this._gaze;
    gz.t -= dt;
    if (gz.t <= 0) {
      gz.t = 1.8 + Math.random() * 3.5;
      const look = Math.random() < 0.65;
      gz.y = look ? (Math.random() - 0.5) * 1.1 : 0;
      gz.x = look ? (Math.random() - 0.55) * 0.2 : 0; // mostly level, now and then up at the lights
    }

    const T = Object.assign(this._T, DEFAULTS);
    T.hipsY = 0.95 - Math.abs(c) * (0.03 * walk + 0.05 * run) - still * 0.004 * (1 + breath);
    // the pelvis: drops on the swinging side, turns with the leading leg, shifts over the stance foot
    T.hipsRZ = c * 0.045 * walk * g.sway + shift * 0.022 * still;
    T.hipsRY = s * 0.11 * amp;
    T.hipsX = -c * 0.012 * walk * g.sway + shift * 0.012 * still;
    T.torsoZ = -T.hipsRZ * 0.75;
    T.torsoX = g.stoop + 0.04 * walk + 0.18 * run + breath * 0.012 * still;
    T.torsoY = -T.hipsRY * 1.5 - s * 0.05 * amp;
    T.headX = -T.torsoX * 0.6 - g.stoop * 0.6 + gz.x * still;
    T.headY = -T.torsoY * 0.8 + gz.y * (still * 0.85 + 0.15);
    T.legRX = -s * amp;
    T.legLX = s * amp;
    T.kneeR = 0.05 + Math.max(0, c) * amp * 1.6 + still * Math.max(0, shift) * 0.1;
    T.kneeL = 0.05 + Math.max(0, -c) * amp * 1.6 + still * Math.max(0, -shift) * 0.1;
    const arm = amp * 0.85 * g.arm;
    T.armRX = s * arm;
    T.armLX = -s * arm;
    T.armRZ = -g.spread - breath * 0.015 * still;
    T.armLZ = g.spread + breath * 0.015 * still;
    // elbows bend more as the arm swings forward, as they do
    T.elbowR = -(0.18 + walk * 0.12 + Math.max(0, -s) * arm * 0.6 + run * 1.1);
    T.elbowL = -(0.18 + walk * 0.12 + Math.max(0, s) * arm * 0.6 + run * 1.1);

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
    if (this.action && POSES[this.action]) {
      POSES[this.action](T, this.actionParam, t, this);
      // a posed body keeps its pelvis square
      T.hipsRY *= 0.3;
      T.hipsRZ *= 0.3;
    }
    // feet stay level with the ground (against the thigh and knee), and the back foot rolls onto
    // its toes as it leaves the ground (the toe-off)
    T.footR = -(T.legRX + T.kneeR) * 0.9 + Math.max(0, T.legRX) * 0.75 * walk;
    T.footL = -(T.legLX + T.kneeL) * 0.9 + Math.max(0, T.legLX) * 0.75 * walk;

    const k = 1 - Math.exp(-dt * (this.snappy ? 30 : 14));
    const C = this.cur;
    for (const key in T) C[key] += (T[key] - C[key]) * k;

    this.hips.position.set(C.hipsX, C.hipsY, 0);
    this.hips.rotation.set(0, C.hipsRY, C.hipsRZ);
    this.torso.rotation.set(C.torsoX, C.torsoY, C.torsoZ);
    this.head.rotation.set(C.headX, C.headY, 0);
    this.arms[0].shoulder.rotation.set(C.armRX, 0, C.armRZ);
    this.arms[0].elbow.rotation.set(C.elbowR, 0, C.elbowRZ);
    this.arms[1].shoulder.rotation.set(C.armLX, 0, C.armLZ);
    this.arms[1].elbow.rotation.set(C.elbowL, 0, C.elbowLZ);
    // the legs stay planted against the pelvis yaw so the feet keep pointing ahead
    this.legs[0].hip.rotation.set(C.legRX, -C.hipsRY, C.legRZ - C.hipsRZ);
    this.legs[0].knee.rotation.x = C.kneeR;
    this.legs[0].ankle.rotation.x = C.footR;
    this.legs[1].hip.rotation.set(C.legLX, -C.hipsRY, C.legLZ - C.hipsRZ);
    this.legs[1].knee.rotation.x = C.kneeL;
    this.legs[1].ankle.rotation.x = C.footL;
  }
}
