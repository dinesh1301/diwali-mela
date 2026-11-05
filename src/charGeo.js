import * as THREE from 'three';
import { CELL, FACE_W, FACE_H, FRONT_W, FRONT_Y0, FRONT_H } from './charAtlas.js';

/*
  Procedural people as one skinned surface each. Every part (torso, limbs, head, hair, garments)
  is a swept tube: rings of an ellipse along a path, closed by zero-radius rings, so the whole body
  is smooth and every vertex can carry real blended bone weights (elbows, knees, the waist, the
  neck and the skirts all bend instead of hinging). Vertex colours paint skin and cloth; a `cuv`
  attribute picks a cell of the shared painted atlas (faces, zari borders) per vertex.

  Coordinates are body space in the rest pose (arms hanging straight, legs straight), y up, the
  person facing +z, so their right side is -x. Bones are pure translations at rest, which keeps
  the bind matrices trivial: inverse = translate(-restPosition).
*/

export const BONE = { hips: 0, torso: 1, head: 2, shR: 3, elR: 4, shL: 5, elL: 6, hipR: 7, knR: 8, hipL: 9, knL: 10, anR: 11, anL: 12 };
export const BONE_COUNT = 13;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const _col = new THREE.Color();
const colCache = new Map();
function lin(hex) {
  let c = colCache.get(hex);
  if (!c) {
    _col.setHex(hex);
    c = [_col.r, _col.g, _col.b];
    colCache.set(hex, c);
  }
  return c;
}

/** Accumulates vertices for one person. */
class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.cuv = [];
    this.si = [];
    this.sw = [];
    this.glow = [];
    this.skinHex = -1;
    this.body = [];
    this.headIdx = [];
    this.idx = this.body;
    this.n = 0;
  }

  vert(x, y, z, nx, ny, nz, hex, uv, w) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    const c = lin(hex);
    this.col.push(c[0], c[1], c[2]);
    // skin keeps a little light of its own at night, so dark faces keep their eyes and brows
    this.glow.push(hex === this.skinHex ? 1 : 0);
    if (uv) this.cuv.push(uv[0], uv[1], uv[2], uv[3]);
    else this.cuv.push(0, 0, 1, 0);
    // weights: up to four [bone, weight] pairs, strongest kept, normalised
    let list = w;
    if (list.length > 1) {
      // the same bone named twice is one weight
      const m = new Map();
      for (const [b, v] of list) m.set(b, (m.get(b) ?? 0) + v);
      if (m.size < list.length) list = [...m];
    }
    if (list.length > 4) list = [...list].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0;
    for (const p of list) sum += p[1];
    for (let k = 0; k < 4; k++) {
      const p = list[k];
      this.si.push(p ? p[0] : 0);
      this.sw.push(p && sum > 0 ? p[1] / sum : 0);
    }
    return this.n++;
  }

  geometry(split) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('cuv', new THREE.Float32BufferAttribute(this.cuv, 4));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const all = this.body.concat(this.headIdx);
    g.setIndex(all);
    if (split) {
      g.addGroup(0, this.body.length, 0);
      g.addGroup(this.body.length, this.headIdx.length, 1);
    }
    return g;
  }
}

const _T = new THREE.Vector3();
const _F0 = new THREE.Vector3();
const _S = new THREE.Vector3();
const _F = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

/*
  Sweeps an ellipse along a path. pts: [{p:[x,y,z], a, b, up?}] where a is the half-width along
  the side axis and b along the "front" axis (up, or opts.up, or +z). A ring with a = b = 0 closes
  the tube. opts: seg (radial segments), color(x,y,z,i,j,th) -> hex, weight(x,y,z,i) -> pairs,
  uv(x,y,z,i,j,th,s) -> [u,v,cell,mask], keep(x,y,z) -> bool (drops quads), loop (closed path),
  radius(i,th) -> multiplier, warp(v: Vector3) moves each vertex before the normals are taken.
*/
function sweep(B, pts, o) {
  const n = o.seg;
  const m = pts.length;
  const P = new Float32Array(m * (n + 1) * 3);
  const centres = [];
  const tangents = [];
  let s = 0;
  const arc = [0];
  for (let i = 1; i < m; i++) {
    const p = pts[i].p;
    const q = pts[i - 1].p;
    s += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    arc.push(s);
  }
  for (let i = 0; i < m; i++) {
    const pt = pts[i];
    const prev = pts[o.loop ? (i - 1 + m) % m : Math.max(0, i - 1)].p;
    const next = pts[o.loop ? (i + 1) % m : Math.min(m - 1, i + 1)].p;
    _T.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]).normalize();
    // vertical lofts keep level rings (a leaning path would tilt and fold them)
    if (o.level) _T.set(0, Math.sign(_T.y) || 1, 0);
    const up = pt.up ?? o.up ?? [0, 0, 1];
    _F0.set(up[0], up[1], up[2]);
    _S.crossVectors(_T, _F0);
    if (_S.lengthSq() < 1e-9) _S.set(1, 0, 0);
    _S.normalize();
    _F.crossVectors(_S, _T).normalize();
    centres.push(pt.p);
    tangents.push([_T.x, _T.y, _T.z]);
    for (let j = 0; j <= n; j++) {
      const th = (j / n) * TAU;
      const k = o.radius ? o.radius(i, th) : 1;
      const ca = Math.cos(th) * pt.b * k;
      const sa = Math.sin(th) * pt.a * k;
      const off = (i * (n + 1) + j) * 3;
      P[off] = pt.p[0] + _F.x * ca + _S.x * sa;
      P[off + 1] = pt.p[1] + _F.y * ca + _S.y * sa;
      P[off + 2] = pt.p[2] + _F.z * ca + _S.z * sa;
    }
  }
  if (o.warp) {
    for (let q = 0; q < P.length; q += 3) {
      o.warp(_a.fromArray(P, q));
      _a.toArray(P, q);
    }
  }
  const at = (i, j, v) => v.fromArray(P, (i * (n + 1) + j) * 3);
  const base = B.n;
  for (let i = 0; i < m; i++) {
    const c = centres[i];
    for (let j = 0; j <= n; j++) {
      const jn = j === n ? 1 : j + 1;
      const jp = j === 0 ? n - 1 : j - 1;
      const ip = o.loop ? (i - 1 + m) % m : Math.max(0, i - 1);
      const inx = o.loop ? (i + 1) % m : Math.min(m - 1, i + 1);
      at(i, jn, _a).sub(at(i, jp, _b));
      const da = _a.clone();
      at(inx, j, _a).sub(at(ip, j, _b));
      _n.crossVectors(da, _a);
      const off = (i * (n + 1) + j) * 3;
      const x = P[off];
      const y = P[off + 1];
      const z = P[off + 2];
      const ox = x - c[0];
      const oy = y - c[1];
      const oz = z - c[2];
      if (_n.lengthSq() < 1e-14 || ox * ox + oy * oy + oz * oz < 1e-10) {
        // a closing pole: point along the path, away from the neighbouring ring
        const t = tangents[i];
        const sg = i === 0 ? -1 : 1;
        _n.set(t[0] * sg, t[1] * sg, t[2] * sg);
      } else if (_n.x * ox + _n.y * oy + _n.z * oz < 0) _n.negate();
      // below `levelBelow` the normals lean level, so a cap (the crotch) shades like the legs
      if (o.levelBelow != null && y < o.levelBelow) _n.normalize().y *= 0.25;
      _n.normalize();
      const th = (j / n) * TAU;
      B.vert(x, y, z, _n.x, _n.y, _n.z, o.color(x, y, z, i, j, th, c[1]), o.uv ? o.uv(x, y, z, i, j, th, arc[i]) : o.cuv, o.weight(x, y, z, i));
    }
  }
  // winding: front faces must face the outward normal (a vote over the whole surface, since a
  // single quad between two nearly coincident rings can point either way)
  let vote = 0;
  for (let i = 0; i < m - 1; i++) {
    const c = centres[i];
    for (let j = 0; j < n; j += Math.max(1, n >> 2)) {
      at(i, j + 1, _a).sub(at(i, j, _b));
      const da = _a.clone();
      at(i + 1, j, _a).sub(at(i, j, _b));
      _n.crossVectors(da, _a);
      at(i, j, _a).sub(_b.set(c[0], c[1], c[2]));
      vote += Math.sign(_n.dot(_a));
    }
  }
  const flip = vote < 0;
  const pole = pts.map((q) => q.a < 1e-6 && q.b < 1e-6);
  const rows = o.loop ? m : m - 1;
  for (let i = 0; i < rows; i++) {
    const i2 = (i + 1) % m;
    for (let j = 0; j < n; j++) {
      const a = base + i * (n + 1) + j;
      const b = a + 1;
      const cc = base + i2 * (n + 1) + j;
      const d = cc + 1;
      if (o.keep) {
        const o1 = (i * (n + 1) + j) * 3;
        const o2 = (i2 * (n + 1) + j + 1) * 3;
        if (!o.keep((P[o1] + P[o2]) / 2, (P[o1 + 1] + P[o2 + 1]) / 2, (P[o1 + 2] + P[o2 + 2]) / 2)) continue;
      }
      // a quad against a closing pole is one triangle (the other would be degenerate)
      const pi = pole[i];
      const pi2 = pole[i2];
      if (pi && pi2) continue;
      if (flip) {
        if (!pi) B.idx.push(a, cc, b);
        if (!pi2) B.idx.push(b, cc, d);
      } else {
        if (!pi) B.idx.push(a, b, cc);
        if (!pi2) B.idx.push(b, d, cc);
      }
    }
  }
}

/** A vertical ellipsoid (a loft of rings), for hands, ears, buns and jewels. */
function blob(B, [cx, cy, cz], [rx, ry, rz], o) {
  const rings = o.rings;
  const pts = [];
  for (let k = 0; k <= rings; k++) {
    const ph = -Math.PI / 2 + (k / rings) * Math.PI;
    const r = Math.cos(ph);
    pts.push({ p: [cx, cy + Math.sin(ph) * ry, cz], a: k === 0 || k === rings ? 0 : rx * r, b: k === 0 || k === rings ? 0 : rz * r });
  }
  sweep(B, pts, { up: [0, 0, 1], level: true, ...o });
}

const one = (b) => [[b, 1]];

/** Inserts interpolated rings just either side of each height in `cuts`, so colours change crisply. */
function cutAt(pts, cuts, eps = 0.0035) {
  const out = [...pts];
  for (const c of cuts) {
    for (const y of [c - eps, c + eps]) {
      for (let i = 0; i < out.length - 1; i++) {
        const A = out[i];
        const B = out[i + 1];
        if ((y - A.p[1]) * (y - B.p[1]) < 0) {
          const t = (y - A.p[1]) / (B.p[1] - A.p[1]);
          out.splice(i + 1, 0, { p: A.p.map((v, k) => lerp(v, B.p[k], t)), a: lerp(A.a, B.a, t), b: lerp(A.b, B.b, t), up: A.up });
          break;
        }
      }
    }
  }
  return out;
}

// ---------- looks resolved into a build ----------

export const FEM_STYLES = new Set(['long', 'saree', 'lehenga', 'salwar', 'frock']);
const FEM_HAIR = new Set(['open', 'bun', 'braid', 'pony', 'veil']);
export const STYLES = ['kurta', 'sherwani', 'long', 'saree', 'lehenga', 'salwar', 'casual', 'frock'];

/** Hair light enough to read as grey (an elder's, or a chosen grey). */
export const isGrey = (hex) => ((hex >> 16) & 255) + ((hex >> 8) & 255) + (hex & 255) > 3 * 0x70;

/** What a look means for the body: build, age, garment and face. */
export function resolveLook(L) {
  let style = STYLES.includes(L.style) ? L.style : 'kurta';
  const age = L.age ?? ((L.scale ?? 1) < 0.8 ? 'kid' : 'adult');
  // an explicit body (the customiser's Him / Her, or a random crowd look) decides the build;
  // otherwise the outfit does (saree, lehenga, salwar and anarkali are hers, a sherwani his),
  // else the hair and bindi
  const fem = L.body ? L.body === 'f' : FEM_STYLES.has(style) ? true : style === 'sherwani' ? false : FEM_HAIR.has(L.hairStyle) || !!L.bindi;
  // and the outfit follows a body that cannot wear it
  if (!fem && FEM_STYLES.has(style)) style = 'kurta';
  if (fem && style === 'sherwani') style = 'long';
  const kid = age === 'kid';
  if (kid && fem && style === 'saree') style = 'frock';
  if (!kid && style === 'frock') style = 'long';
  // a beard: dark, or grey with grey hair (or when asked for)
  const beard = !fem && !kid && age !== 'teen' && L.beard ? (L.beard === 'grey' || (L.beard !== 'dark' && isGrey(L.hair ?? 0)) ? 'grey' : 'dark') : null;
  let face = kid ? (fem ? 'girl' : 'boy') : age === 'teen' ? (fem ? 'teenF' : 'teenM') : age === 'elder' ? (fem ? 'elderF' : 'elderM') : fem ? 'woman' : 'man';
  if (beard) face = age === 'elder' ? (beard === 'grey' ? 'elderMBeard' : 'elderMBeardDark') : beard === 'grey' ? 'manBeardGrey' : 'manBeard';
  return { style, age, fem, kid, face, beard };
}

/** Skeleton proportions (body space, before the look's overall scale). */
export function rigFor(R) {
  const kid = R.kid;
  const k = kid ? 0.9 : 1; // kids have a shorter trunk under a bigger head
  return {
    hy: 0.95,
    legX: R.fem ? 0.085 : 0.088,
    thigh: 0.44,
    shin: 0.43,
    shY: 0.43 * k,
    shX: kid ? 0.185 : R.fem ? 0.185 : 0.205,
    upper: 0.29 * (kid ? 0.92 : 1),
    fore: 0.27 * (kid ? 0.92 : 1),
    headPivot: 0.585 * k,
    // adults' heads about 1/7 of their height; kids keep their big heads
    hs: kid ? 1.3 : R.age === 'teen' ? 0.99 : R.fem ? 0.9 : 0.94,
    k,
    ankle: 0.95 - 0.02 - 0.44 - 0.43,
  };
}

// torso rings: [y above the hips joint, half-width, half-depth, depth offset]
const TORSO_M = [
  [-0.205, 0, 0, 0.004], [-0.195, 0.088, 0.05, 0.004], [-0.16, 0.16, 0.086, 0.002], [-0.06, 0.163, 0.106, -0.004], [0.02, 0.165, 0.104, 0],
  [0.12, 0.156, 0.1, 0.006], [0.22, 0.164, 0.108, 0.012], [0.31, 0.175, 0.117, 0.014], [0.39, 0.19, 0.113, 0.006],
  [0.445, 0.196, 0.1, -0.004], [0.488, 0.172, 0.086, -0.008], [0.518, 0.11, 0.07, -0.006], [0.535, 0.068, 0.061, 0],
  [0.58, 0.06, 0.057, 0.004], [0.64, 0.056, 0.053, 0.002], [0.66, 0, 0, 0],
];
const TORSO_F = [
  [-0.2, 0, 0, 0.002], [-0.19, 0.09, 0.05, 0.002], [-0.15, 0.168, 0.092, -0.004], [-0.05, 0.183, 0.114, -0.01], [0.03, 0.17, 0.104, 0],
  [0.12, 0.136, 0.09, 0.004], [0.2, 0.146, 0.098, 0.01], [0.27, 0.16, 0.112, 0.022], [0.33, 0.163, 0.116, 0.022],
  [0.39, 0.166, 0.1, 0.006], [0.44, 0.172, 0.09, -0.004], [0.482, 0.15, 0.076, -0.006], [0.512, 0.092, 0.06, -0.004],
  [0.53, 0.058, 0.053, 0], [0.58, 0.052, 0.05, 0.004], [0.64, 0.049, 0.047, 0.002], [0.66, 0, 0, 0],
];

function torsoProfile(R, G) {
  let rows = (R.fem ? TORSO_F : TORSO_M).map((r) => [...r]);
  if (R.age === 'elder' && !R.fem) {
    // a comfortable paunch
    for (const r of rows) {
      const b = Math.exp(-(((r[0] - 0.14) / 0.12) ** 2));
      r[1] += 0.022 * b;
      r[2] += 0.03 * b;
      r[3] += 0.025 * b;
    }
  }
  const kidW = R.kid ? 0.94 : 1;
  rows = rows.map(([y, a, b, c]) => [y * G.k, a * kidW, b * kidW, c]);
  return rows;
}

function profileAt(rows, y) {
  if (y <= rows[1][0]) return rows[1].slice(1);
  for (let i = 1; i < rows.length - 2; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (y <= b[0]) {
      const t = (y - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  }
  return rows[rows.length - 2].slice(1);
}

/*
  Builds one person's geometry. Returns { geometry, rig } where rig holds the bone rest offsets
  the Character uses to place its joints.
*/
export function buildPerson(L, { low = false, split = false } = {}) {
  const R = resolveLook(L);
  const G = rigFor(R);
  const B = new Builder();
  const S = low ? (h, l) => l : (h) => h;
  const { hy } = G;
  const hs = G.hs;
  const skin = L.skin ?? 0xc68642;
  const top = L.top ?? 0xffb703;
  const bottom = L.bottom ?? 0xfff1d0;
  const hair = L.hair ?? 0x140c08;
  const accent = L.accent ?? L.turban ?? 0xff7a00;
  const shoes = L.shoes ?? 0x5c2a12;
  const style = R.style;
  const casual = style === 'casual';
  const frock = style === 'frock';
  B.skinHex = skin;

  const headY = hy + G.headPivot;
  const cy = headY + 0.118 * hs; // head centre
  const HA = 0.108 * hs;
  const HB = 0.13 * hs;
  const HC = 0.115 * hs;

  const rows = torsoProfile(R, G);
  const at = (yRel) => profileAt(rows, yRel);
  // a point on (or off) the torso surface at height yRel and angle th (0 = front, +pi/2 = left)
  const onTorso = (yRel, th, off = 0) => {
    const [a, b, c] = at(yRel);
    return [Math.sin(th) * (a + off), hy + yRel, c + Math.cos(th) * (b + off)];
  };

  const stats = {};
  let lastN = 0;
  const tally = (k) => {
    const n = (B.body.length + B.headIdx.length) / 3;
    stats[k] = (stats[k] ?? 0) + n - lastN;
    lastN = n;
  };
  // ---------- weights ----------
  const torsoW = (x, y, z) => {
    const yr = y - hy;
    const t = smooth(-0.02 * G.k, 0.24 * G.k, yr);
    const h = smooth(0.565 * G.k, 0.66 * G.k, yr);
    const out = [];
    // the tops of the shoulders ride along with a raised arm a little, so the joint never bulges
    const sk = 0.3 * smooth(0.1, 0.17, Math.abs(x)) * smooth(0.36, 0.42, yr / G.k) * (1 - smooth(0.47, 0.52, yr / G.k));
    if (1 - t > 0) out.push([BONE.hips, 1 - t]);
    if (t * (1 - h) * (1 - sk) > 0) out.push([BONE.torso, t * (1 - h) * (1 - sk)]);
    if (sk > 0) out.push([x < 0 ? BONE.shR : BONE.shL, t * (1 - h) * sk]);
    if (h > 0) out.push([BONE.head, h]);
    // the crotch follows the thighs a little so it never tears open in a stride
    const lg = 0.55 * smooth(-0.05, -0.17, yr);
    if (lg > 0) {
      const sR = smooth(0.06, -0.06, x);
      out.push([BONE.hipR, lg * sR], [BONE.hipL, lg * (1 - sR)]);
    }
    return out.length ? out : one(BONE.torso);
  };
  const ankleY = hy - 0.02 - G.thigh - G.shin;
  const legBones = (y, side) => {
    const kneeY = hy - 0.02 - G.thigh;
    const t = smooth(kneeY + 0.06, kneeY - 0.06, y);
    const a = smooth(ankleY + 0.05, ankleY - 0.01, y);
    return side < 0
      ? [[BONE.hipR, 1 - t], [BONE.knR, t * (1 - a)], [BONE.anR, a]]
      : [[BONE.hipL, 1 - t], [BONE.knL, t * (1 - a)], [BONE.anL, a]];
  };
  // skirts and long hems: the pelvis at the waist, sharing out to both legs towards the hem
  const skirtW = (follow, y0, y1) => (x, y) => {
    const d = smooth(y0, y1, y);
    const f = follow * d;
    const sR = smooth(0.12, -0.12, x);
    const kneeY = hy - 0.02 - G.thigh;
    const kt = smooth(kneeY + 0.16, kneeY - 0.16, y);
    return [
      [BONE.hips, 1 - f],
      [BONE.hipR, f * sR * (1 - kt)], [BONE.knR, f * sR * kt],
      [BONE.hipL, f * (1 - sR) * (1 - kt)], [BONE.knL, f * (1 - sR) * kt],
    ].filter((p) => p[1] > 1e-4);
  };

  // ---------- torso ----------
  const SK0 = { kurta: 0.08, sherwani: 0.08, salwar: 0.08, long: 0.12, saree: 0.075, lehenga: 0.065, frock: 0.15 }[style];
  const fronted = style === 'kurta' ? CELL.kurta : style === 'sherwani' ? CELL.sherwani : casual ? CELL.tee : style === 'salwar' ? CELL.floral : -1;
  const midriff = style === 'saree' || style === 'lehenga';
  const TEE_HEM = -0.085;
  const neckDip = midriff ? 0.07 : style === 'sherwani' ? -0.02 : casual ? 0.025 : 0.035;
  const blouse = style === 'saree' ? bottom : top;
  const skirtC = style === 'lehenga' ? bottom : top;
  // colours go by the ring's height, not the vertex's: rings tilt a little where the body leans
  const torsoColor = (x, y, z, i, j, th, ry) => {
    const yr = (ry - hy) / G.k;
    const front = Math.max(0, Math.cos(th));
    if (yr > 0.535 - neckDip * front * front) return skin;
    if (midriff) {
      if (yr < 0.07) return skirtC;
      if (yr < 0.2) return skin;
      return blouse;
    }
    if (casual && yr < TEE_HEM) return bottom; // an untucked tee over the jeans
    if (frock && yr > 0.13 && yr < 0.175) return accent; // a sash at the waist
    if (style === 'sherwani' && yr > 0.5) return 0xe0b24a; // collar band
    return top;
  };
  const tCuts = midriff ? [0.07, 0.2] : casual ? [TEE_HEM] : style === 'sherwani' ? [0.5] : frock ? [0.13, 0.175] : [];
  // the neckline dips at the front: ring pairs along the dip keep the skin-to-cloth edge crisp all
  // the way round (one pair at the top alone left a soft smear at the sides and the back)
  const dip = Math.max(0, neckDip);
  if (dip > 0) for (const f of low ? [0.5] : [0.33, 0.67]) tCuts.push(0.535 - dip * f);
  tCuts.push(0.535 - dip, 0.535);
  let tRows = rows;
  if (low) tRows = rows.filter((r, i) => ![2, 4, 7, 12].includes(i));
  // under a skirt or a long hem the body below its top shrinks out of the way (no z-fighting)
  const tuck = (y) => (SK0 == null ? 1 : lerp(1, 0.84, smooth(SK0 * G.k + 0.025, SK0 * G.k - 0.05, y)));
  const torsoPts = cutAt(tRows.map(([y, a, b, c]) => ({ p: [0, hy + y, c], a: a * tuck(y), b: b * tuck(y) })), tCuts.map((y) => hy + y * G.k));
  sweep(B, torsoPts, {
    level: true,
    levelBelow: hy - 0.1,
    // the tee hangs a little loose over the jeans, its hem standing proud as a lip
    radius: casual ? (i) => 1 + 0.07 * smooth(hy + 0.06 * G.k, hy + TEE_HEM * G.k + 0.004, torsoPts[i].p[1]) * (torsoPts[i].p[1] > hy + TEE_HEM * G.k ? 1 : 0) : null,
    seg: S(18, 10),
    up: [0, 0, 1],
    color: torsoColor,
    weight: torsoW,
    uv: (x, y, z, i, j, th) => {
      const yr = (y - hy) / G.k;
      if (fronted < 0) return null;
      // skin above the neckline keeps the garment's cell with no mask: a cell id that changed
      // across a triangle would smear other cells into the edge
      const bare = yr > 0.535 - neckDip * Math.max(0, Math.cos(th)) ** 2 || (midriff && yr > 0.07 && yr < 0.2);
      if (fronted === CELL.floral) return [(th / TAU) * 4, (yr + 0.2) / 0.8, fronted + 2, bare ? 0 : 1];
      return [0.5 + x / (2 * FRONT_W), (yr + hy - FRONT_Y0) / FRONT_H, fronted + 2, bare ? 0 : (z - 0.02) / 0.1];
    },
  });

  tally('torso');
  // ---------- skirts, kurta hems ----------
  const SK = {
    kurta: { y0: 0.08, y1: R.kid ? -0.4 : -0.47, hem: [0.205, 0.15], follow: 0.7, color: top, band: accent, bandW: 0.035 },
    sherwani: { y0: 0.08, y1: -0.52, hem: [0.198, 0.142], follow: 0.72, color: top, band: 0xd4a017, bandW: 0.02, front: CELL.sherwani },
    salwar: { y0: 0.08, y1: -0.5, hem: [0.218, 0.16], follow: 0.7, color: top, band: accent, bandW: 0.03, cell: CELL.floral },
    long: { y0: 0.12, y1: -0.885, hem: [0.36, 0.34], follow: 0.85, color: top, cell: CELL.skirt, flare: 1.5 },
    // the saree's pleats fan out at the front (one wrap of the pleats cell round the skirt)
    saree: { y0: 0.075, y1: -0.915, hem: [0.235, 0.205], follow: 0.9, color: skirtC, cell: CELL.pleats, wrap: 1, flare: 1.2, pleats: 0.07 },
    lehenga: { y0: 0.065, y1: R.kid ? -0.84 : -0.9, hem: [0.38, 0.36], follow: 0.8, color: skirtC, cell: CELL.lehenga, flare: 1.4 },
    frock: { y0: 0.15, y1: -0.42, hem: [0.27, 0.24], follow: 0.55, color: top, cell: CELL.frock, flare: 0.75, cover: [0.1, 0.11] },
  }[style];
  if (SK) {
    const K = S(10, 5);
    const pts = [];
    const y0 = SK.y0 * G.k;
    const y1 = SK.y1;
    const tc = at(y0)[2];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const y = lerp(y0, y1, t);
      // follow the hips down, then flare out to the hem
      const [ha, hb, hc] = at(Math.max(y, -0.11));
      const f = Math.pow(t, SK.flare ?? 1.6);
      // just inside the body at the top, easing out to sit on the hips, then the flare
      const ease = lerp(-0.004, SK.ease ?? 0.012, smooth(0, 0.2, t));
      const hipA = Math.max(ha, k ? pts[k - 1].a - 0.012 : 0) + ease;
      const hipB = Math.max(hb, k ? pts[k - 1].b - 0.012 : 0) + ease;
      // and never narrower than the legs inside it (thighs swing, so leave room)
      const legCover = smooth(0.06, -0.06, y);
      const coverA = (G.legX + (SK.cover?.[0] ?? 0.118)) * legCover;
      const coverB = (SK.cover?.[1] ?? 0.122) * legCover;
      pts.push({ p: [0, hy + y, lerp(hc, tc * 0.5, t)], a: Math.max(hipA, coverA, lerp(hipA, SK.hem[0], f)), b: Math.max(hipB, coverB, lerp(hipB, SK.hem[1], f)) });
    }
    // a small inward lip at the hem gives the cloth an edge
    const last = pts[pts.length - 1];
    pts.push({ p: [0, last.p[1] + 0.012, last.p[2]], a: last.a * 0.96, b: last.b * 0.96 });
    const yHem = hy + y1;
    const skPts = cutAt(pts.reverse(), SK.band ? [yHem + SK.bandW] : []);
    sweep(B, skPts, {
      level: true,
      seg: S(20, 10),
      // pleats: a fuller fan of cloth down the front, growing towards the hem
      radius: SK.pleats ? (i, th) => 1 + SK.pleats * smooth(hy + y0, yHem, skPts[i].p[1]) * Math.max(0, Math.cos(th)) ** 3 : null,
      color: (x, y, z, i, j, th, ry) => (SK.band && ry < yHem + SK.bandW ? SK.band : SK.color),
      weight: skirtW(SK.follow, hy + y0, yHem),
      uv:
        SK.cell != null
          ? (x, y, z, i, j, th) => [(th / TAU) * (SK.wrap ?? 4), (y - yHem) / (hy + y0 - yHem), SK.cell + 2, 1]
          : SK.front != null
            ? (x, y, z) => [0.5 + x / (2 * FRONT_W), (y - FRONT_Y0) / FRONT_H, SK.front + 2, (z - 0.03) / 0.1]
            : null,
    });
  }

  // the outside of the body at a height (yRel), skirt included, for drapes that hang over it
  let skirtAt = null;
  if (SK) {
    const yTop = hy + SK.y0 * G.k;
    const yHem = hy + SK.y1;
    const prof = [];
    const K = 12;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const y = lerp(yTop, yHem, t);
      const [ha, hb, hc] = at(Math.max(y - hy, -0.11));
      const f = Math.pow(t, SK.flare ?? 1.6);
      prof.push([y, lerp(ha, SK.hem[0], f) + 0.012, lerp(hb, SK.hem[1], f) + 0.012, lerp(hc, at(SK.y0 * G.k)[2] * 0.5, t)]);
    }
    skirtAt = (y) => {
      for (let k = 0; k < K; k++) {
        if (y >= prof[k + 1][0]) {
          const t = (y - prof[k][0]) / (prof[k + 1][0] - prof[k][0]);
          return [0, 1, 2].map((q) => lerp(prof[k][q + 1], prof[k + 1][q + 1], t));
        }
      }
      return prof[K].slice(1);
    };
  }
  const onBody = (yRel, th, off = 0) => {
    if (!skirtAt || hy + yRel > hy + SK.y0 * G.k) return onTorso(yRel, th, off);
    const [a, b, c] = skirtAt(hy + yRel);
    // a pleated front stands proud of the skirt's ellipse
    const pf = SK.pleats ? 1 + SK.pleats * smooth(hy + SK.y0 * G.k, hy + SK.y1, hy + yRel) * Math.max(0, Math.cos(th)) ** 3 : 1;
    return [Math.sin(th) * (a * pf + off), hy + yRel, c + Math.cos(th) * (b * pf + off)];
  };

  tally('skirt');
  // ---------- arms ----------
  const ARM = low
    ? [[-0.585, 0], [-0.56, 0.03], [-0.42, 0.041], [-0.29, 0.039], [-0.15, 0.049], [0.0, 0.048], [0.035, 0.036], [0.054, 0]]
    : [
      [-0.585, 0], [-0.575, 0.022], [-0.56, 0.03], [-0.5, 0.034], [-0.42, 0.041], [-0.34, 0.04], [-0.29, 0.039],
      [-0.24, 0.044], [-0.15, 0.049], [-0.06, 0.05], [0.0, 0.048], [0.025, 0.042], [0.044, 0.027], [0.054, 0],
    ];
  const armK = R.fem || R.kid ? 0.86 : 1;
  const sleeveEnd = { saree: -0.13, lehenga: -0.13, casual: -0.15, salwar: -0.4, long: -0.42, frock: -0.1 }[style] ?? -0.545;
  const sleeveLoose = frock ? 0.012 : sleeveEnd < -0.5 && style !== 'sherwani' ? 0.006 : 0.003;
  const sleeveC = style === 'saree' ? bottom : top;
  for (const side of [-1, 1]) {
    const sx = side * G.shX;
    const sy = hy + G.shY;
    const ey = sy - G.upper;
    const lenK = (G.upper + G.fore) / 0.56;
    const sh = side < 0 ? BONE.shR : BONE.shL;
    const el = side < 0 ? BONE.elR : BONE.elL;
    const armPts = ARM.map(([y, r]) => {
      const yy = y < 0 ? y * lenK : y;
      const sleeved = y >= sleeveEnd;
      const rr = r * armK + (sleeved && r > 0.02 ? sleeveLoose : 0);
      return { p: [sx, sy + yy, 0], a: rr * 0.95, b: rr };
    });
    sweep(B, cutAt(armPts, [sy + sleeveEnd * lenK]), {
      level: true,
      seg: S(10, 6),
      color: (x, y) => (y >= sy + sleeveEnd * lenK ? sleeveC : skin),
      weight: (x, y) => {
        const t = smooth(ey + 0.05, ey - 0.05, y);
        // the cap above the joint stays mostly with the chest, so raised arms do not bulge there
        const tt = 0.62 * smooth(sy - 0.035, sy + 0.06, y);
        return [[sh, (1 - t) * (1 - tt)], [el, t * (1 - tt)], [BONE.torso, tt]].filter((p) => p[1] > 1e-4);
      },
    });
    // the mitten hand with a thumb, palm towards the thigh, fingers curled a touch inwards
    const wy = sy - (G.upper + G.fore);
    const hk = R.kid ? 1.0 : R.fem ? 0.98 : 1.1;
    const HAND = [[0.006, 0, 0], [-0.004, 0.016, 0.026], [-0.028, 0.02, 0.036], [-0.058, 0.019, 0.036], [-0.082, 0.015, 0.03], [-0.097, 0.008, 0.018], [-0.101, 0, 0]];
    sweep(
      B,
      HAND.map(([y, a, b], k) => ({ p: [sx - side * 0.004 * k * 0.5, wy + y * hk, 0.004], a: a * hk, b: b * hk })),
      { seg: S(8, 4), color: () => skin, weight: () => one(el) }
    );
    // the thumb angles away from the palm, so it reads as a thumb and not part of the mitten
    const TH = [[-0.004, 0.03, 0], [-0.016, 0.041, 0.0092], [-0.031, 0.051, 0.0102], [-0.046, 0.058, 0.0088], [-0.056, 0.061, 0]];
    sweep(
      B,
      TH.map(([y, z, r], k) => ({ p: [sx - side * (0.012 + 0.001 * k) * hk, wy + y * hk, z * hk], a: r * hk, b: r * hk })),
      { seg: S(6, 3), up: [side, 0, 0], color: () => skin, weight: () => one(el) }
    );
    if (L.bangles) {
      for (let k = 0; k < (low ? 1 : 3); k++) {
        const y = wy + 0.03 + k * 0.016;
        const r = 0.031 * armK + 0.006;
        const ring = [];
        const N = S(12, 7);
        for (let q = 0; q < N; q++) {
          const a = (q / N) * TAU;
          ring.push({ p: [sx + Math.sin(a) * r * 0.95, y, Math.cos(a) * r], a: 0.0045, b: 0.0045, up: [Math.sin(a), 0, Math.cos(a)] });
        }
        sweep(B, ring, { seg: low ? 3 : 4, loop: true, color: () => (k === 1 ? 0xd4a017 : L.bangles), weight: () => one(el) });
      }
    }
  }

  tally('arms');
  // ---------- legs and feet ----------
  const LEG = low
    ? [[-0.905, 0, 0], [-0.875, 0.036, 0], [-0.68, 0.055, -0.008], [-0.47, 0.051, 0], [-0.32, 0.068, 0.004], [-0.08, 0.08, 0], [0.0, 0.064, 0], [0.03, 0, 0]]
    : [
      [-0.905, 0, 0], [-0.895, 0.026, 0], [-0.875, 0.036, 0], [-0.8, 0.042, -0.002], [-0.68, 0.055, -0.008], [-0.57, 0.057, -0.006],
      [-0.47, 0.051, 0], [-0.42, 0.054, 0.002], [-0.32, 0.068, 0.004], [-0.18, 0.081, 0.006], [-0.08, 0.08, 0], [-0.02, 0.07, 0], [0.015, 0.05, 0], [0.03, 0, 0],
    ];
  const longSkirt = style === 'long' || style === 'saree' || style === 'lehenga';
  const legK = R.kid ? 0.95 : 1;
  const trouser = (y, r) => {
    if (longSkirt) return r;
    if (style === 'salwar') return r > 0.03 ? Math.max(r, y > -0.8 ? 0.088 : lerp(0.088, 0.046, smooth(-0.8, -0.87, y))) : r;
    // jeans: a little ease on the leg, none at the top where the thigh meets the hip
    if (casual) return r > 0.03 ? Math.max(r + 0.008 * smooth(-0.02, -0.12, y), 0.056) : r;
    if (style === 'sherwani') return r > 0.03 ? r + 0.004 : r; // churidar
    return r > 0.03 ? Math.max(r + 0.012 * smooth(0, -0.1, y), y < -0.8 ? 0.05 : 0.064) : r; // pyjama
  };
  for (const side of [-1, 1]) {
    const lx = side * G.legX;
    const ly = hy - 0.02;
    let pts = LEG.map(([y, r, c]) => ({ y, p: [lx, ly + y, c], a: trouser(y, r) * legK * 0.97, b: trouser(y, r) * legK }));
    if (longSkirt) {
      // under a floor-length skirt only the ankles are ever seen (a longer shin pokes through the
      // skirt at the knee when she sits)
      pts = pts.filter((q) => q.y < -0.76);
      const t = pts[pts.length - 1];
      pts.push({ y: t.y + 0.01, p: [lx, t.p[1] + 0.01, t.p[2]], a: 0, b: 0 });
    }
    const legC = longSkirt || frock ? skin : bottom;
    sweep(B, cutAt(pts, style === 'salwar' ? [ly - 0.84] : []), {
      level: true,
      seg: S(10, 6),
      color: (x, y) => (style === 'salwar' && y < ly - 0.84 ? accent : legC),
      weight: (x, y) => {
        const w = legBones(y, side);
        const tt = 0.45 * smooth(ly - 0.02, ly + 0.08, y);
        return [[w[0][0], w[0][1] * (1 - tt)], [w[1][0], w[1][1] * (1 - tt)], [BONE.hips, tt]].filter((p) => p[1] > 1e-4);
      },
    });
    // shoes: mojari / juttis with a curled toe for festive wear, rounder trainers for casual
    const kn = side < 0 ? BONE.anR : BONE.anL;
    const curl = casual ? 0 : 0.018;
    const FOOT = casual
      ? [[-0.07, 0, 0], [-0.064, 0.03, 0.03], [-0.045, 0.041, 0.044], [0.0, 0.045, 0.045], [0.06, 0.049, 0.04], [0.11, 0.046, 0.034], [0.145, 0.034, 0.024], [0.16, 0, 0]]
      : [[-0.065, 0, 0], [-0.058, 0.028, 0.028], [-0.038, 0.036, 0.036], [0.0, 0.04, 0.035], [0.05, 0.043, 0.028], [0.1, 0.039, 0.021], [0.135, 0.026, 0.014], [0.155, 0, 0]];
    const fk = R.kid ? 0.9 : R.fem ? 0.9 : 1;
    sweep(
      B,
      FOOT.map(([z, a, b], k) => ({ p: [lx, Math.max(b, 0.012) + 0.001 + (k >= FOOT.length - 2 ? curl * (k - FOOT.length + 3) * 0.5 : 0), z * fk + 0.01], a: a * fk, b })),
      {
        seg: S(8, 5),
        up: [0, 1, 0],
        color: (x, y) => (casual ? (y < 0.012 ? 0xf2f2f2 : shoes) : y < 0.006 ? 0x2a1a10 : shoes),
        weight: () => one(kn),
      }
    );
  }

  tally('legs');
  // ---------- head ----------
  B.idx = B.headIdx;
  const headW = () => one(BONE.head);
  const faceUv = (x, y, z) => [0.5 + x / hs / (2 * FACE_W), 0.5 + (y - cy) / hs / (2 * FACE_H), CELL[R.face] + 2, z / HC];
  // the hairline: on the unit head, hair where dy is above a threshold that drops from the
  // forehead to the nape
  // hair pulled back (a bun, braid or pony) sits close over the tops of the ears; open hair and a
  // man's short cut are fuller
  const hairStyle0 = L.hairStyle ?? 'short';
  const pulled = hairStyle0 === 'bun' || hairStyle0 === 'braid' || hairStyle0 === 'pony';
  const hl = R.fem
    ? { front: 0.78, side: pulled ? -0.22 : -0.45, back: -0.82 }
    : R.age === 'elder'
      ? { front: 0.86, side: 0.08, back: -0.5 }
      : { front: 0.8, side: 0.1, back: -0.58 };
  if (R.kid) hl.front -= 0.05;
  // a plateau across the forehead, dropping at the temples to the ears and round to the nape
  const hairThr = (dx, dz) => {
    const ax = Math.abs(dx);
    if (dz <= 0) return lerp(hl.side, hl.back, smooth(0, 0.8, -dz)) - (R.fem ? 0 : 0.2 * Math.exp(-(((dz + 0.05) / 0.2) ** 2)) * smooth(0.7, 0.95, ax));
    let t = lerp(hl.side, hl.front, smooth(0.15, 0.85, dz));
    if (R.fem) return t - 0.35 * dx * dx; // long hair frames the face in a soft arch
    // short hair: a side parting, temples set back a little (an M, not a helmet's straight edge),
    // and sideburns down in front of the ears
    t += 0.14 * dx * smooth(0.3, 0.9, dz);
    t += (R.age === 'elder' ? 0.2 : 0.12) * smooth(0.22, 0.5, ax) * smooth(0.45, 0.8, dz);
    t += 0.3 * Math.exp(-(((dz - 0.42) / 0.16) ** 2)) * smooth(0.55, 0.85, ax); // the temples
    t -= 0.32 * Math.exp(-(((dz - 0.08) / 0.12) ** 2)) * smooth(0.7, 0.95, ax); // sideburns
    return t;
  };
  const dir = (x, y, z) => [x / HA, (y - cy) / HB, z / HC];
  const isHair = (x, y, z) => {
    const [dx, dy, dz] = dir(x, y, z);
    // a centre parting and a soft widow's peak for long hair
    const part = R.fem && dz > 0.5 ? 0.06 * Math.max(0, 1 - Math.abs(dx) * 6) : 0;
    // at the front the face cell paints the hairline; the head's own colour turns to hair behind it
    return dy > hairThr(dx, dz) + part + 0.16 * smooth(0.3, 0.65, dz);
  };
  const hairStyle = L.hairStyle ?? 'short';
  const covered = hairStyle === 'turban';
  const headRings = (K, scale = 1, thick = null) => {
    const pts = [];
    for (let i = 0; i <= K; i++) {
      const ph = -Math.PI / 2 + (i / K) * Math.PI;
      const sy = Math.sin(ph);
      let r = Math.cos(ph);
      if (i === 0 || i === K) r = 0;
      let a = HA * r * scale;
      let b = HC * r * scale;
      let cz = 0;
      if (sy < 0) {
        a *= 1 - 0.2 * sy * sy;
        b *= 1 - 0.1 * sy * sy;
        cz += 0.012 * hs * -sy;
      } else {
        cz -= 0.01 * hs * sy;
        a *= 1 + 0.03 * sy;
      }
      pts.push({ p: [0, cy + sy * HB * (thick ? scale : 1) + (thick ? (scale - 1) * HB * 0.4 : 0), cz], a, b });
    }
    return pts;
  };
  /*
    The skull and face: the egg of rings shaped by a warp in head units, so the head reads as a
    head and not a ball: the jaw narrows to a chin that sits forward and down, the cheekbones carry
    a little width, the forehead slopes back and the occiput is fuller, tucking in above the neck.
    Every shell laid over the head (hair, veil, cap) takes the same warp, so they still fit.
  */
  const headWarp = (v) => {
    const dx = v.x / HA;
    const dy = (v.y - cy) / HB;
    const dz = v.z / HC;
    const l = Math.hypot(dx, dy, dz) || 1;
    const uy = dy / l;
    const uz = dz / l;
    const front = Math.max(0, uz);
    const back = Math.max(0, -uz);
    const jaw = smooth(0.0, -0.8, uy);
    const chin = smooth(-0.4, -0.92, uy) * front * front;
    v.x *= (1 - 0.17 * jaw * (0.55 + 0.45 * front)) * (1 + 0.035 * Math.exp(-(((uy + 0.12) / 0.22) ** 2)) * front);
    v.z += 0.018 * hs * chin * l - 0.01 * hs * smooth(0.3, 0.9, uy) * front * l;
    v.y -= 0.016 * hs * chin * l;
    v.z *= 1 - 0.2 * smooth(-0.15, -0.85, uy) * back + 0.06 * smooth(-0.3, 0.3, uy) * (1 - smooth(0.5, 1, uy)) * back;
  };
  const HK = S(14, 9);
  sweep(B, headRings(HK), {
    level: true,
    seg: S(18, 12),
    up: [0, 0, 1],
    radius: (i, th) => (Math.cos(th) > 0 ? 1 - 0.04 * Math.cos(th) : 1 + 0.04 * -Math.cos(th)),
    warp: headWarp,
    color: (x, y, z) => (!covered && isHair(x, y, z) ? hair : skin),
    weight: headW,
    uv: faceUv,
  });
  // ears, nose
  for (const side of [-1, 1]) {
    blob(B, [side * (HA - 0.006 * hs), cy - 0.01 * hs, -0.01 * hs], [0.013 * hs, 0.026 * hs, 0.019 * hs], { rings: S(5, 3), seg: S(6, 5), color: () => skin, weight: headW });
    if (R.fem && !R.kid) blob(B, [side * (HA - 0.002 * hs), cy - 0.045 * hs, -0.004], [0.009, 0.012, 0.009], { rings: 3, seg: 5, color: () => 0xe3b23c, weight: headW });
  }
  blob(B, [0, cy - 0.024 * hs, HC * 0.9], [0.0125 * hs, 0.022 * hs, 0.016 * hs], { rings: S(5, 3), seg: S(7, 5), color: () => skin, weight: headW, uv: faceUv });

  tally('head');
  // hair volume: a shell over the scalp that pinches to the skin at the hairline
  const curlyHair = hairStyle === 'curly';
  const shell = (thick, color, keepExtra = 0, bump = 0) => {
    const pts = headRings(HK);
    sweep(B, pts, {
      level: true,
      seg: S(18, 12),
      up: [0, 0, 1],
      radius: (i, th) => (Math.cos(th) > 0 ? 1 - 0.04 * Math.cos(th) : 1 + 0.04 * -Math.cos(th)),
      // the hair grows outwards from the head's centre (along its normal), so a fringe lifts off
      // the forehead instead of jutting forwards like a visor
      warp: (v) => {
        const dx0 = v.x / HA;
        const dy0 = (v.y - cy) / HB;
        const dz0 = v.z / HC;
        const l = Math.hypot(dx0, dy0, dz0) || 1;
        const dx = dx0 / l;
        const dy = dy0 / l;
        const dz = dz0 / l;
        const thr = hairThr(dx, dz) + keepExtra;
        // a soft rise from the hairline, slower at the front (a fringe, not a ledge)
        const ramp = smooth(thr - 0.02, thr + 0.3 + 0.25 * Math.max(0, dz), dy);
        const th = Math.atan2(dx, dz);
        const b = bump ? bump * (0.55 + 0.45 * Math.sin(th * 5 + dy * 9)) * Math.abs(Math.sin(dy * 11 + th * 4)) : 0;
        // volume on the crown and at the back, a lift at the front (a quiff for short hair);
        // short hair stays close at the sides, long hair puffs a little over the ears
        const crown = 0.08 * Math.max(0, dy) ** 1.3 + 0.04 * Math.max(0, -dz) * smooth(-0.5, 0.4, dy);
        const lift = (R.fem ? 0.03 : 0.07) * Math.max(0, dz) * Math.max(0, dy) ** 2;
        // (a short cut fades to almost nothing over the ears and at the sideburns)
        const sides = R.fem ? (pulled ? 1 - 0.55 * Math.abs(dx) * smooth(0.4, -0.2, dy) : 1 + 0.45 * Math.abs(dx) * smooth(-0.5, 0.2, dy)) : 1 - 0.93 * smooth(0.45, 0.85, Math.abs(dx)) * smooth(0.65, 0.1, dy);
        const f = 0.004 + ramp * (thick * sides + crown + lift + b);
        headWarp(v);
        v.x *= 1 + f;
        v.y = cy + (v.y - cy) * (1 + f);
        v.z *= 1 + f;
      },
      // strands (or curls) painted over the hair colour
      uv: (x, y, z, i, j, th) => (curlyHair ? [(th / TAU) * 4, (i / HK) * 2.2, CELL.curls + 2, 1] : [(th / TAU) * 3, i / HK, CELL.hair + 2, 1]),
      keep: (x, y, z) => {
        const [dx, dy, dz] = dir(x, y, z);
        const l = Math.hypot(dx, dy, dz) || 1;
        // at the front the shell starts just behind the painted hairline
        return dy / l > hairThr(dx / l, dz / l) + keepExtra - 0.04 + 0.07 * smooth(0.3, 0.65, dz / l);
      },
      color: () => color,
      weight: headW,
    });
  };
  const hangW = (yTop, yBot) => (x, y) => {
    const t = smooth(yTop, yBot, y);
    return [[BONE.head, 1 - t], [BONE.torso, t]].filter((p) => p[1] > 1e-4);
  };
  const curtain = (color, wTop, wBot, yBot, depth = 0.07) => {
    const pts = [];
    const K = S(7, 5);
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const y = lerp(cy + 0.05 * hs, yBot, t);
      const yr = y - hy;
      const back = yr < G.headPivot ? at(yr)[1] : 0;
      const z = Math.min(-0.045 * hs - t * 0.02, -back - 0.02);
      const a = k === 0 || k === K ? 0 : lerp(wTop, wBot, t) * (k === 1 ? 0.8 : 1);
      const b = k === 0 || k === K ? 0 : lerp(depth * hs, 0.03, t);
      pts.push({ p: [0, y, z], a, b });
    }
    sweep(B, pts.reverse(), {
      seg: S(12, 8),
      color: () => color,
      weight: hangW(cy - 0.08, yBot + 0.15),
      uv: (x, y, z, i, j, th) => [(th / TAU) * 3, 0.15 + (0.7 * i) / K, CELL.hair + 2, 1],
    });
  };
  const strands = (k = 1) => (x, y, z, i, j, th) => [(th / TAU) * 2, (i * 0.12) / k, CELL.hair + 2, 1];

  if (hairStyle === 'turban') {
    const N = S(40, 22);
    const turns = 2.35;
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const ang = t * turns * TAU + 0.6;
      const R0 = (0.123 - 0.028 * t * t) * hs;
      const y = cy + (0.0 + 0.085 * t + 0.014 * Math.cos(ang)) * hs;
      const end = k === 0 || k === N;
      pts.push({ p: [Math.sin(ang) * R0, y, Math.cos(ang) * R0 - 0.008], a: end ? 0 : 0.03 * hs, b: end ? 0 : 0.021 * hs, up: [Math.sin(ang), 0, Math.cos(ang)] });
    }
    const tc = L.turban ?? accent;
    sweep(B, pts, { seg: S(6, 4), color: () => tc, weight: headW });
    blob(B, [0, cy + 0.07 * hs, -0.01], [0.088 * hs, 0.05 * hs, 0.095 * hs], { rings: S(6, 4), seg: S(14, 9), color: () => tc, weight: headW });
    // the sarpech: a gold jewel with a ruby at its heart, and the turra fan of pleated cloth
    // standing up behind it, a little to one side
    blob(B, [0, cy + 0.075 * hs, 0.122 * hs], [0.015, 0.019, 0.01], { rings: 3, seg: 6, color: () => 0xd4a017, weight: headW });
    blob(B, [0, cy + 0.076 * hs, 0.131 * hs], [0.006, 0.007, 0.004], { rings: 3, seg: 5, color: () => 0xc1121f, weight: headW });
    const fan = [];
    const FN = S(5, 3);
    for (let k = 0; k <= FN; k++) {
      const t = k / FN;
      const end = k === 0 || k === FN;
      const w = end ? 0 : 0.03 * hs * Math.sin(t * Math.PI) ** 0.6 * (0.7 + 0.6 * t);
      fan.push({ p: [0.022 * hs + 0.01 * t, cy + (0.1 + 0.075 * t) * hs, (0.1 - 0.035 * t) * hs], a: w, b: end ? 0 : 0.006, up: [0, 0.4, 1] });
    }
    sweep(B, fan, { seg: S(6, 4), color: (x, y) => (y > cy + 0.16 * hs ? 0xe8b84a : tc), weight: headW });
  } else if (hairStyle === 'veil') {
    shell(0.05, hair);
    const vc = L.dupatta ?? accent;
    const veil = headRings(HK, 1.12, true);
    sweep(B, veil, {
      seg: S(18, 12),
      warp: headWarp,
      keep: (x, y, z) => {
        const [dx, dy, dz] = dir(x, y, z);
        return dz < 0.55 - dy * 0.2 && dy > -0.25 + (dz > 0 ? 0.6 * dz : 0);
      },
      color: () => vc,
      weight: headW,
    });
    curtain(vc, 0.13 * hs, 0.2, hy + 0.36, 0.085);
  } else {
    const curly = hairStyle === 'curly';
    shell(curly ? 0.13 : hairStyle === 'open' ? 0.11 : R.fem ? 0.05 : 0.07, hair, 0, curly ? 0.08 : 0);
    if (hairStyle === 'open') curtain(hair, 0.112 * hs, 0.13, hy + 0.32);
    if (hairStyle === 'bun') {
      const bc = [0, cy + 0.035 * hs, -HC - 0.03 * hs];
      blob(B, bc, [0.052 * hs, 0.048 * hs, 0.045 * hs], { rings: S(7, 5), seg: S(10, 7), color: () => hair, weight: headW, uv: strands(0.5) });
      // a gajra: a string of jasmine buds round the bun, leaning back over its lower half
      const N = S(14, 8);
      const ring = [];
      for (let q = 0; q < N; q++) {
        const a = (q / N) * TAU;
        const r = 0.054 * hs;
        const bud = q % 2 ? 0.0065 : 0.0095;
        ring.push({ p: [bc[0] + Math.sin(a) * r, bc[1] - 0.012 * hs + Math.cos(a) * 0.012 * hs, bc[2] - 0.006 * hs + Math.cos(a) * r * 0.62], a: bud, b: bud, up: [Math.sin(a), 0, Math.cos(a)] });
      }
      sweep(B, ring, { seg: low ? 3 : 4, loop: true, color: () => 0xfdf6e3, weight: headW });
    }
    if (hairStyle === 'pony') {
      blob(B, [0, cy + 0.05 * hs, -HC - 0.005], [0.024 * hs, 0.024 * hs, 0.02 * hs], { rings: 3, seg: 6, color: () => accent, weight: headW });
      const P = [[0.05, -0.115, 0], [0.045, -0.14, 0.032], [0.0, -0.165, 0.038], [-0.07, -0.17, 0.034], [-0.15, -0.15, 0.026], [-0.22, -0.125, 0.014], [-0.25, -0.115, 0]];
      sweep(B, P.map(([y, z, r]) => ({ p: [0, cy + y * hs, z * hs], a: r * hs, b: r * hs * 0.85, up: [0, 0, -1] })), {
        seg: S(8, 5),
        color: () => hair,
        weight: hangW(cy - 0.05, cy - 0.25),
        uv: strands(0.6),
      });
    }
    if (hairStyle === 'braid') {
      blob(B, [0, cy - 0.05 * hs, -HC - 0.005], [0.04 * hs, 0.035 * hs, 0.03 * hs], { rings: 4, seg: 7, color: () => hair, weight: headW });
      const P = [];
      const N = S(14, 8);
      const yTop = cy - 0.08 * hs;
      const yBot = hy + 0.02;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const y = lerp(yTop, yBot, t);
        const yr = y - hy;
        const back = at(Math.min(yr, 0.6))[1];
        const z = -Math.max(back + 0.022, (0.09 - t * 0.2) * hs);
        const end = k === 0 || k === N;
        const r = end ? 0 : (0.026 - 0.01 * t) * (1 + (low ? 0 : 0.25 * Math.abs(Math.sin(k * 1.9))));
        P.push({ p: [0, y, z], a: r, b: r * 0.8, up: [0, 0, -1] });
      }
      sweep(B, P, { seg: S(7, 5), color: (x, y) => (y < yBot + 0.035 ? accent : hair), weight: hangW(cy - 0.12, hy + 0.45), uv: (x, y, z, i, j, th) => [(th / TAU) * 2, i * 0.5, CELL.hair + 2, y < yBot + 0.035 ? 0 : 1] });
      // a paranda: a gold bead and a tassel in the accent colour hanging from the braid's tie
      const ez = P[P.length - 2].p[2];
      blob(B, [0, yBot - 0.004, ez], [0.011, 0.011, 0.011], { rings: 3, seg: 5, color: () => 0xd4a017, weight: () => one(BONE.torso) });
      const TS = [[-0.01, 0], [-0.016, 0.009], [-0.05, 0.016], [-0.075, 0.019], [-0.082, 0]];
      sweep(B, TS.map(([dy, r]) => ({ p: [0, yBot + dy, ez - 0.004], a: r, b: r * 0.8 })), { seg: S(6, 4), level: true, color: () => accent, weight: () => one(BONE.torso) });
    }
    if (hairStyle === 'topi') {
      blob(B, [0, cy + 0.085 * hs, -0.004], [0.088 * hs, 0.05 * hs, 0.122 * hs], { rings: S(6, 4), seg: S(14, 9), color: (x, y) => (y < cy + 0.06 * hs ? 0xe9dfc9 : 0xf6efe0), weight: headW });
    }
    if (hairStyle === 'cap') {
      const cap = headRings(HK, 1.1, true);
      sweep(B, cap, {
        seg: S(18, 12),
        warp: headWarp,
        keep: (x, y, z) => (y - cy) / HB > 0.32,
        color: () => accent,
        weight: headW,
      });
      blob(B, [0, cy + 0.05 * hs, HC + 0.045 * hs], [0.085 * hs, 0.009, 0.07 * hs], { rings: 3, seg: S(12, 8), color: () => accent, weight: headW });
    }
  }
  if (L.bindi) blob(B, [0, cy + 0.032 * hs, HC * 0.985], [0.006, 0.0065, 0.004], { rings: 3, seg: 6, color: () => 0xc8102e, weight: headW });
  if (L.moustache) {
    const elder = R.age === 'elder';
    const P = [];
    const N = 7;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const x = lerp(-0.036, 0.036, t) * hs;
      const e = Math.abs(t - 0.5) * 2;
      const y = cy - (0.05 + (elder ? 0.014 : 0.006) * e * e) * hs;
      const z = HC * (0.93 - 0.16 * e * e) + 0.006;
      const r = k === 0 || k === N ? 0 : 0.0075 * (1 - 0.6 * e * e) + 0.0025;
      P.push({ p: [x, y, z], a: r, b: r * 0.6, up: [x * 2, 0, 1] });
    }
    const mc = R.beard === 'grey' && !isGrey(hair) ? 0xd6d0c6 : R.beard === 'dark' && isGrey(hair) ? 0x1c110a : hair;
    sweep(B, P, { seg: S(6, 4), color: () => mc, weight: headW });
  }
  if (L.glasses) {
    const rim = 0x2b2118;
    const N = S(14, 8);
    for (const side of [-1, 1]) {
      const ex = side * 0.041 * hs;
      const ring = [];
      for (let q = 0; q < N; q++) {
        const a = (q / N) * TAU;
        ring.push({ p: [ex + Math.cos(a) * 0.026 * hs, cy + 0.002 * hs + Math.sin(a) * 0.022 * hs, HC + 0.01], a: 0.0032, b: 0.0032, up: [Math.cos(a), Math.sin(a), 0] });
      }
      sweep(B, ring, { seg: 4, loop: true, color: () => rim, weight: headW });
      sweep(B, [{ p: [side * 0.067 * hs, cy + 0.006, HC + 0.006], a: 0.003, b: 0.003 }, { p: [side * (HA + 0.004), cy + 0.006, 0.0], a: 0.003, b: 0.003 }], { seg: 4, up: [0, 1, 0], color: () => rim, weight: headW });
    }
    sweep(B, [{ p: [-0.016 * hs, cy + 0.008, HC + 0.012], a: 0.003, b: 0.003 }, { p: [0.016 * hs, cy + 0.008, HC + 0.012], a: 0.003, b: 0.003 }], { seg: 4, up: [0, 1, 0], color: () => rim, weight: headW });
  }
  tally('hair');
  B.idx = B.body;

  // ---------- drapes: pallu, dupatta, stole, necklace ----------
  // below the waist a drape moves as the skirt under it does, so a stride never pokes through
  const hangSkirt = SK ? skirtW(SK.follow, hy + SK.y0 * G.k, hy + SK.y1) : null;
  const drape = (path, color, cell, thickness = 0.008) => {
    const pts = path.map(([yr, th, off, w]) => {
      const p = onBody(yr * G.k, th, off);
      const up = [Math.sin(th), yr > 0.44 ? 0.9 : 0.08, Math.cos(th)];
      return { p, a: w / 2, b: thickness, up };
    });
    sweep(B, pts, {
      seg: S(6, 4),
      color: () => color,
      weight: (x, y) => {
        if (hangSkirt && y < hy - 0.05) {
          const t = smooth(hy - 0.05, hy - 0.2, y);
          const w = hangSkirt(x, y);
          return [[BONE.hips, 1 - t], ...w.map(([b, v]) => [b, v * t])];
        }
        const t = smooth(hy + 0.05, hy - 0.25, y);
        return [[BONE.torso, 1 - t * 0.6], [BONE.hips, t * 0.6]].filter((p) => p[1] > 1e-4);
      },
      uv: cell != null ? (x, y, z, i, j, th, s) => [s / 0.22, 0.5 + 0.5 * Math.sin(th), cell + 2, 1] : null,
    });
  };
  if (style === 'saree') {
    /*
      A nivi drape: the pallu rises from the pleats at the right hip, crosses the chest wide (as
      cloth, not a sash), goes over the left shoulder and falls freely down the back past the hips,
      its zari edges along both sides.
    */
    drape(
      [[0.06, -0.9, 0.026, 0.13], [0.13, -0.6, 0.02, 0.17], [0.21, -0.28, 0.019, 0.2], [0.29, 0.04, 0.02, 0.21], [0.36, 0.34, 0.019, 0.2], [0.425, 0.66, 0.017, 0.18], [0.47, 1.05, 0.018, 0.16], [0.495, 1.55, 0.02, 0.15],
        [0.47, 2.1, 0.022, 0.19], [0.38, 2.45, 0.026, 0.24], [0.22, 2.6, 0.03, 0.27], [0.06, 2.65, 0.034, 0.29], [-0.12, 2.67, 0.03, 0.3], [-0.3, 2.68, 0.03, 0.3], [-0.46, 2.68, 0.032, 0.29]],
      top,
      CELL.pallu
    );
  }
  const dup = L.dupatta;
  if (dup && style !== 'saree') {
    if (style === 'lehenga') {
      drape(
        [[0.04, -1.0, 0.07, 0.12], [0.13, -0.6, 0.04, 0.14], [0.22, -0.25, 0.028, 0.15], [0.3, 0.1, 0.025, 0.15], [0.38, 0.42, 0.022, 0.14], [0.45, 0.85, 0.02, 0.13], [0.49, 1.6, 0.02, 0.12], [0.42, 2.35, 0.022, 0.13], [0.28, 2.7, 0.03, 0.16], [0.05, 2.85, 0.05, 0.18], [-0.25, 2.9, 0.075, 0.2], [-0.55, 2.9, 0.1, 0.2]],
        dup,
        CELL.pallu
      );
    } else if (R.fem) {
      drape(
        [[-0.25, 2.65, 0.06, 0.16], [0.05, 2.55, 0.04, 0.16], [0.3, 2.35, 0.022, 0.15], [0.47, 2.0, 0.018, 0.13], [0.5, 1.55, 0.02, 0.12], [0.46, 1.0, 0.02, 0.12], [0.38, 0.6, 0.024, 0.13], [0.32, 0.25, 0.03, 0.14], [0.3, 0.0, 0.032, 0.14], [0.32, -0.25, 0.03, 0.14], [0.38, -0.6, 0.024, 0.13], [0.46, -1.0, 0.02, 0.12], [0.5, -1.55, 0.02, 0.12], [0.47, -2.0, 0.018, 0.13], [0.3, -2.35, 0.022, 0.15], [0.05, -2.55, 0.04, 0.16], [-0.25, -2.65, 0.06, 0.16]],
        dup,
        CELL.pallu
      );
    } else {
      // a man's stole round the neck, both ends down the front
      drape(
        [[-0.1, 0.42, 0.04, 0.1], [0.12, 0.4, 0.03, 0.1], [0.32, 0.44, 0.02, 0.1], [0.44, 0.66, 0.016, 0.095], [0.49, 1.15, 0.016, 0.09], [0.51, 1.9, 0.016, 0.085], [0.515, Math.PI, 0.016, 0.085], [0.51, -1.9, 0.016, 0.085], [0.49, -1.15, 0.016, 0.09], [0.44, -0.66, 0.016, 0.095], [0.32, -0.44, 0.02, 0.1], [0.12, -0.4, 0.03, 0.1], [-0.1, -0.42, 0.04, 0.1]],
        dup,
        CELL.pallu
      );
    }
  }
  if (R.fem && !R.kid && (style === 'saree' || style === 'lehenga' || style === 'long')) {
    const N = S(16, 8);
    const ring = [];
    for (let q = 0; q < N; q++) {
      const th = (q / N) * TAU;
      const f = Math.max(0, Math.cos(th));
      const yr = 0.53 - 0.075 * f * f;
      const p = onTorso(yr * G.k, th, 0.005);
      ring.push({ p, a: 0.006, b: 0.006, up: [Math.sin(th), 0.3, Math.cos(th)] });
    }
    sweep(B, ring, { seg: low ? 3 : 4, loop: true, color: () => 0xe3b23c, weight: () => one(BONE.torso) });
  }

  tally('drapes');
  const geometry = B.geometry(split);
  return { geometry, stats, rig: G, look: R, headTopY: (0.118 + 0.128) * hs + (hairStyle === 'turban' || hairStyle === 'veil' ? 0.06 : 0.025), cy };
}
