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

/** Marks every mesh under obj as a shadow caster and receiver (bulbs and glow meshes skipped). */
export function shadowify(obj) {
  obj.traverse((o) => {
    if (!o.isMesh || o.isPoints || o.isSprite) return;
    const basic = o.material?.isMeshBasicMaterial;
    o.castShadow = !basic;
    o.receiveShadow = true;
  });
  return obj;
}

export const BULB_PALETTE = [0xffb347, 0xff4f6d, 0x5bd1ff, 0x8cff6b, 0xffe066, 0xc77dff];
export const WARM_PALETTE = [0xffc46b, 0xffe2a0, 0xff9a3c];
