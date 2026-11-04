import * as THREE from 'three';
import { settings } from './settings.js';

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** A colour pushed above 1.0 so it glows through the bloom pass. */
export function hdr(hex, intensity = 1) {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = settings.tier === 'low' ? 2 : 8; // three clamps this to the GPU's maximum
  return tex;
}

/** Points along a sagging wire between a and b (parabolic approximation of a catenary). */
export function catenary(a, b, sag, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Cylinder geometry stretched between two points, already transformed (good for merging). */
export function beamGeometry(a, b, radius, radialSegments = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  const m = new THREE.Matrix4().compose(a.clone().addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}

export function beam(a, b, radius, material, radialSegments = 6) {
  return new THREE.Mesh(beamGeometry(a, b, radius, radialSegments), material);
}

/** Yaw that makes a camera at (x, z) look towards (tx, tz). */
export function lookYaw(x, z, tx, tz) {
  return Math.atan2(-(tx - x), -(tz - z));
}

/**
 * Layer 1 holds small details (people, stall goods, game props). The camera sees both layers,
 * but the river's reflection camera only renders layer 0, which keeps reflections cheap.
 */
export function setLayer(obj, layer) {
  obj.traverse((o) => o.layers.set(layer));
}

/** Shared evening state written by DayNight: lights 0..1 (big rides' bulbs), night 0..1. */
export const DAY = { lights: 1, night: 1 };

/*
  One texel of the sun's shadow map covers about 9 cm, so a caster smaller than ~0.3 m (a laddoo,
  a bulb, a cup) adds a smudge nobody can see but still costs a draw call in the shadow pass.
*/
const MIN_CASTER_RADIUS = 0.3;
const _scale = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Marks the meshes under obj as shadow receivers, and the ones big enough to matter as casters.
 * Skipped as casters: unlit (basic) bulbs and glows, instanced decor, and anything under 0.3 m.
 * A mesh whose castShadow was already set by its builder (people, walls) keeps it.
 */
export function shadowify(obj) {
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || o.isPoints || o.isSprite) return;
    o.receiveShadow = true;
    if (o.castShadow) return;
    if (o.material?.isMeshBasicMaterial || o.isInstancedMesh) return;
    const geo = o.geometry;
    if (!geo) return;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    o.matrixWorld.decompose(_v3, _q, _scale);
    const s = Math.max(Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z));
    o.castShadow = geo.boundingSphere.radius * s >= MIN_CASTER_RADIUS;
  });
  return obj;
}

const TEXTURE_KEYS = ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'lightMap', 'envMap'];

/**
 * Frees the GPU resources under obj (geometries, materials and their textures) and detaches it.
 * `keep` lists shared geometries/materials/textures that other objects still use (they're left
 * alone); `materials: false` frees geometry only, for meshes drawn with a shared material.
 */
export function disposeTree(obj, { keep = null, materials = true, textures = true } = {}) {
  if (!obj) return;
  const kept = (x) => keep && (keep.has ? keep.has(x) : keep.includes(x));
  const done = new Set();
  const free = (x) => {
    if (!x || done.has(x) || kept(x)) return;
    done.add(x);
    x.dispose?.();
  };
  obj.traverse((o) => {
    if (o.geometry) free(o.geometry);
    if (!materials || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || kept(m)) continue;
      if (textures) for (const k of TEXTURE_KEYS) if (m[k]?.isTexture) free(m[k]);
      free(m);
    }
  });
  obj.removeFromParent();
}

export const BULB_PALETTE = [0xffb347, 0xff4f6d, 0x5bd1ff, 0x8cff6b, 0xffe066, 0xc77dff];
export const WARM_PALETTE = [0xffc46b, 0xffe2a0, 0xff9a3c];
