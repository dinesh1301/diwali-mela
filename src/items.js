import * as THREE from 'three';
import { hdr } from './utils.js';
import { shape, merged } from './character.js';

/* Hand-sized props. Each factory returns a Group whose origin sits where the palm holds it. */

const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const flameMat = new THREE.MeshBasicMaterial({ color: hdr(0xffa040, 5) });
const flameGeo = new THREE.SphereGeometry(0.03, 8, 6).scale(1, 2.2, 1);

/** Every live diya flame in the mela, flickered once per frame by updateFlames(). */
const flames = new Set();
export function updateFlames(t) {
  for (const f of flames) {
    const ph = f.userData.phase;
    const n = Math.sin(t * 17 + ph) * Math.sin(t * 7.3 + ph * 1.7);
    f.scale.set(0.95 + 0.1 * n, 0.85 + 0.3 * n, 1);
  }
}
export function forgetFlames(obj) {
  obj.traverse((o) => flames.delete(o));
}

function group(...meshes) {
  const g = new THREE.Group();
  meshes.forEach((m) => g.add(m));
  return g;
}
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// ---------- food ----------

function jalebiGeometry() {
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const a = t * Math.PI * 7;
    const r = 0.012 + t * 0.055;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(t * 40) * 0.004, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.011, 6, false);
}

export const FOOD_COLORS = {
  laddoo: [0xf2a03d, 0xf7c548],
  kaju: [0xf3ead8, 0xd9d4c5],
  jamun: [0x5a2a14, 0x3a1a0c],
  barfi: [0xc8e6a0, 0x9fcf7a],
  jalebi: [0xff8f1f, 0xffb347],
  puri: [0xd9a441, 0x9fd18b],
};

export function foodMesh(kind, color) {
  switch (kind) {
    case 'laddoo':
      return group(mesh(new THREE.IcosahedronGeometry(0.06, 2), std(0xf2a03d, 0.85), 0, 0.06));
    case 'kaju': {
      const m = mesh(new THREE.BoxGeometry(0.08, 0.018, 0.08), std(0xf3ead8, 0.35, { metalness: 0.4 }), 0, 0.02);
      m.rotation.y = Math.PI / 4;
      m.scale.x = 1.5;
      return group(m);
    }
    case 'jamun':
      return group(mesh(new THREE.SphereGeometry(0.055, 14, 10), std(0x5a2a14, 0.2), 0, 0.055));
    case 'barfi':
      return group(mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), std(0xc8e6a0, 0.8), 0, 0.03));
    case 'jalebi':
      return group(mesh(jalebiGeometry(), std(0xff8f1f, 0.3, { emissive: 0x4a1a00 }), 0, 0.03));
    case 'kulfi':
      return group(
        mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 5), std(0xd9b38c), 0, 0.02),
        mesh(new THREE.ConeGeometry(0.035, 0.13, 12), std(color ?? 0xfff1c1, 0.5), 0, 0.14)
      );
    case 'puri': {
      const puri = mesh(new THREE.SphereGeometry(0.045, 12, 10), std(0xd9a441, 0.6), 0, 0.045);
      puri.scale.y = 0.85;
      const pani = mesh(new THREE.CircleGeometry(0.02, 12), std(0x6fbf73, 0.1, { emissive: 0x1a4a1a }), 0, 0.083);
      pani.rotation.x = -Math.PI / 2;
      return group(puri, pani);
    }
  }
  return group();
}

// ---------- shop items ----------

const bowlProfile = [[0, 0], [0.06, 0], [0.1, 0.02], [0.12, 0.05], [0.105, 0.055], [0.08, 0.03], [0, 0.025]].map(([x, y]) => new THREE.Vector2(x, y));
const bowlGeo = new THREE.LatheGeometry(bowlProfile, 14);
const clay = std(0xb5562b, 0.85, { emissive: 0x3a1204 });

export function diyaMesh() {
  const flame = mesh(flameGeo, flameMat, 0, 0.11);
  flame.userData.phase = Math.random() * 100;
  flame.userData.live = true; // flickered by updateFlames: never merged away
  flames.add(flame);
  return group(mesh(bowlGeo, clay), flame);
}

// Shared geometry and materials for the props visitors place around the mela, so the Deepmala
// wall's InstanceBatcher can draw every kandeel / teddy / gift as instances of the same few meshes.
let KG = null;
const kandeelParts = () =>
  (KG ??= {
    string: new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4),
    body: new THREE.OctahedronGeometry(0.18, 0).scale(1, 1.35, 1),
    tassel: new THREE.ConeGeometry(0.03, 0.16, 6).rotateX(Math.PI),
    stringMat: std(0x333333),
    goldMat: std(0xffc94a, 0.4, { metalness: 0.5 }),
  });

export function kandeelMesh(color = 0xff3d6e) {
  const K = kandeelParts();
  return group(
    mesh(K.string, K.stringMat, 0, 0.15),
    mesh(K.body, new THREE.MeshBasicMaterial({ color: hdr(color, 1.8) }), 0, -0.24),
    mesh(K.tassel, K.goldMat, 0, -0.6)
  );
}

export function balloonMesh(color = 0xff006e) {
  const b = mesh(new THREE.SphereGeometry(0.2, 16, 12).scale(1, 1.18, 1), std(color, 0.3, { emissive: new THREE.Color(color).multiplyScalar(0.25) }));
  const knot = mesh(new THREE.ConeGeometry(0.03, 0.05, 8).rotateX(Math.PI), std(color), 0, -0.25);
  return group(b, knot);
}

// a teddy is one vertex-coloured mesh (fur, muzzle, eyes and bow)
let teddy = null;
export function teddyMesh() {
  teddy ??= merged(
    [
      shape(new THREE.SphereGeometry(0.11, 12, 10), 0xa0662e, [0, 0.12, 0], [], [1, 1.15, 0.9]),
      shape(new THREE.SphereGeometry(0.085, 12, 10), 0xa0662e, [0, 0.3, 0]),
      shape(new THREE.SphereGeometry(0.035, 8, 6), 0xa0662e, [-0.065, 0.37, 0]),
      shape(new THREE.SphereGeometry(0.035, 8, 6), 0xa0662e, [0.065, 0.37, 0]),
      shape(new THREE.SphereGeometry(0.035, 8, 6), 0xe0b07a, [0, 0.29, 0.07]),
      shape(new THREE.SphereGeometry(0.012, 6, 4), 0x111111, [-0.03, 0.32, 0.075]),
      shape(new THREE.SphereGeometry(0.012, 6, 4), 0x111111, [0.03, 0.32, 0.075]),
      shape(new THREE.TorusGeometry(0.06, 0.015, 6, 16), 0xe0218a, [0, 0.22, 0], [Math.PI / 2, 0, 0]),
    ],
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })
  );
  return group(new THREE.Mesh(teddy.geometry, teddy.material));
}

// a gift is the box plus one merged mesh for both ribbons and the bow
let gift = null;
export function giftMesh() {
  gift ??= {
    box: new THREE.BoxGeometry(0.2, 0.18, 0.2).translate(0, 0.09, 0),
    boxMat: std(0xe0218a, 0.5),
    ribbon: merged(
      [
        shape(new THREE.BoxGeometry(0.21, 0.19, 0.04), 0xffffff, [0, 0.09, 0]),
        shape(new THREE.BoxGeometry(0.04, 0.19, 0.21), 0xffffff, [0, 0.09, 0]),
        shape(new THREE.TorusGeometry(0.04, 0.012, 6, 12), 0xffffff, [0, 0.2, 0]),
      ],
      std(0xffd166, 0.3, { metalness: 0.5 })
    ),
  };
  return group(new THREE.Mesh(gift.box, gift.boxMat), new THREE.Mesh(gift.ribbon.geometry, gift.ribbon.material));
}

export function thaliMesh() {
  const plate = mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.02, 24), std(0xd4a017, 0.25, { metalness: 0.85 }));
  const diya = diyaMesh();
  diya.scale.setScalar(0.6);
  diya.position.y = 0.01;
  const g = group(plate, diya);
  const petals = [0xff7b00, 0xffc300, 0xe0218a];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    g.add(mesh(new THREE.SphereGeometry(0.022, 6, 4), std(petals[i % 3], 0.8), Math.cos(a) * 0.11, 0.02, Math.sin(a) * 0.11));
  }
  return g;
}

// ---------- game gear ----------

export function toyGunMesh() {
  const wood = std(0x6b3f22, 0.6);
  const metal = std(0x444444, 0.4, { metalness: 0.7 });
  return group(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.32), wood, 0, 0, -0.02), mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4).rotateX(Math.PI / 2), metal, 0, 0.03, 0.3));
}

/** Handle runs down the hand's local -y, so it follows the forearm while swinging. */
export function hammerMesh() {
  return group(
    mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.85, 8), std(0xc8a06a, 0.6), 0, -0.3, 0),
    mesh(new THREE.BoxGeometry(0.3, 0.16, 0.16), std(0xb3122e, 0.4), 0, -0.72, 0)
  );
}

export function ringMesh(color) {
  return mesh(new THREE.TorusGeometry(0.13, 0.018, 8, 28).rotateX(Math.PI / 2), std(color, 0.4));
}

export function ballMesh() {
  return mesh(new THREE.SphereGeometry(0.07, 14, 10), std(0xf1faee, 0.5));
}
