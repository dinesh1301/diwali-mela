import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hdr, setLayer, WARM_PALETTE, BULB_PALETTE } from './utils.js';
import { Diyas } from './diyas.js';

/*
  The extra festive light layer: every lane, stall row, ride, the gate and the ghat get more bulbs,
  hanging kandeels and rows of diyas. None of it is a real light. The bulbs join the shared
  instanced string lights (one draw call per 48 m cell, already there), the kandeels are one
  instanced mesh, and the new diya rows are one "still" Diyas pair (no per-frame flicker work);
  bloom turns all of it into glow. The few real lights the LightPool keeps near the player do the
  actual lighting.
*/
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const KANDEEL_COLORS = [0xff5a00, 0xe8104a, 0xff9a00, 0x9a1cff, 0xff3a10, 0x00a8e8];
// a warm, steady fairy light: canopies read as a soft glowing ceiling, not a disco
const FAIRY = [0xffd38a, 0xffe7b8, 0xffb35c];

/** A paper kandeel (hexagonal lantern with dark caps and a tassel), vertex-coloured for one draw call. */
function kandeelGeometry() {
  const body = new THREE.CylinderGeometry(0.26, 0.26, 0.42, 6, 1, true);
  const top = new THREE.ConeGeometry(0.27, 0.2, 6, 1, true).translate(0, 0.31, 0);
  const bottom = new THREE.ConeGeometry(0.27, 0.2, 6, 1, true).rotateX(Math.PI).translate(0, -0.31, 0);
  const tassel = new THREE.CylinderGeometry(0.02, 0.05, 0.35, 4, 1, true).translate(0, -0.58, 0);
  const shade = (g, k) => {
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3).fill(k);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    return g;
  };
  return mergeGeometries([shade(body, 1), shade(top, 0.28), shade(bottom, 0.28), shade(tassel, 0.55)]);
}

export function buildFestive(ctx, { site }) {
  const { scene, lights } = ctx;
  const still = new Diyas(scene, { still: true });
  const kandeels = [];
  const kandeel = (x, y, z) => kandeels.push(V(x, y, z));
  const fairy = { palette: FAIRY, mode: 'fixed', wire: false, spacing: 0.6 };

  // ---- bazaar: a fairy-light canopy over the walkway and kandeels under the lane strands ----
  for (let z = 50.5; z >= 16; z -= 5) lights.addStrand(V(-5.5, 5.35, z), V(5.5, 5.35, z), { ...fairy, sag: 0.45 });
  for (const z of [53, 43, 33, 23]) {
    for (const x of [-3.4, 0, 3.4]) kandeel(x, 4.15 - (x === 0 ? 0.25 : 0), z);
    for (const x of [-2, 2]) kandeel(x, 4.3, z - 5);
  }
  // diyas along both edges of the walkway, entrance to chowk, and on to the ghat
  for (let z = 52.5; z > 14; z -= 1.1) for (const x of [-4.55, 4.55]) still.add(x, 0.03, z);
  for (let z = -13.5; z > -42; z -= 1.2) for (const x of [-4.55, 4.55]) still.add(x, 0.03, z);
  // and along the cross path to the wheel and the fireworks field
  for (let x = 6; x <= 30; x += 1.3) for (const s of [-1, 1]) for (const z of [-14.7, -21.3]) still.add(s * x, 0.05, z);

  // ---- gate: bulb rings round the domes, a row under the lintel, kandeels in the arch ----
  const gz = site.gate.z;
  for (const s of [-1, 1]) {
    const ring = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ring.push(V(s * 8 + Math.cos(a) * 1.12, 11.98, gz + Math.sin(a) * 1.12));
    }
    lights.addPolyline(ring, { spacing: 0.3, palette: WARM_PALETTE, mode: 'twinkle' });
    lights.addPolyline([V(s * 8 - 1.25, 10.36, gz + 1.25), V(s * 8 + 1.25, 10.36, gz + 1.25)], { spacing: 0.3, palette: WARM_PALETTE, mode: 'chase' });
  }
  lights.addPolyline([V(-7.2, 7.24, gz + 0.72), V(7.2, 7.24, gz + 0.72)], { spacing: 0.3, mode: 'alternate' });
  for (const x of [-4.6, 0, 4.6]) kandeel(x, 6.1, gz);
  // fairy curtain draped from the gate to the first lane poles
  for (const x of [-4.2, -1.4, 1.4, 4.2]) lights.addStrand(V(x, 7.3, gz - 0.7), V(x * 1.2, 5.4, 53), { ...fairy, sag: 0.8 });

  // ---- Khel Gali: a pole row across the lane from the booths, canopy strands to the booth roofs ----
  const KX = 20.2;
  const ktops = [12, 20, 28.5, 37, 45].map((z) => V(KX, 5.2, z));
  for (const t of ktops) ctx.poleAt(t.x, t.z, t.y);
  for (let i = 1; i < ktops.length; i++) {
    lights.addStrand(ktops[i - 1], ktops[i], { sag: 0.5, mode: 'chase' });
    kandeel(KX + 0.1, 4.2, (ktops[i - 1].z + ktops[i].z) / 2);
  }
  for (const bz of [14, 23, 32, 41]) {
    for (const dz of [-3.6, 0, 3.6]) lights.addStrand(V(KX, 5.2, bz + dz * 0.6), V(26.3, 3.75, bz + dz), { ...fairy, sag: 0.35, mode: dz ? 'fixed' : 'twinkle', palette: dz ? FAIRY : BULB_PALETTE });
    kandeel(23.6, 3.9, bz - 2);
    kandeel(23.6, 3.9, bz + 2);
  }
  for (let z = 10.5; z < 46; z += 1.2) still.add(KX + 1.1, 0.04, z);

  // ---- the giant wheel's A-frame legs outlined in bulbs ----
  const w = site.wheel;
  for (const s of [-1, 1]) {
    for (const sx of [-1, 1]) {
      lights.addPolyline([V(w.x + sx * 8, 0.3, w.z + s * 3.05), V(w.x, 17.0, w.z + s * 1.85)], { spacing: 0.45, palette: s > 0 ? WARM_PALETTE : BULB_PALETTE, mode: 'chase' });
    }
  }

  // ---- Ramleela Maidan: strands over the benches between two pole rows ----
  const R = site.ramleela;
  const left = [59, 64.5, 70].map((z) => V(R.x - 9.2, 5, z));
  const right = [59, 64.5, 70].map((z) => V(R.x + 9.2, 5, z));
  for (const t of [...left, ...right]) ctx.poleAt(t.x, t.z, t.y);
  // (only along the sides: strands across would hang in front of the screen from the benches)
  for (let i = 0; i < 3; i++) {
    if (i) {
      lights.addStrand(left[i - 1], left[i], { sag: 0.4, palette: WARM_PALETTE, mode: 'chase' });
      lights.addStrand(right[i - 1], right[i], { sag: 0.4, palette: WARM_PALETTE, mode: 'chase' });
    }
    // a short fairy swag from each pole in towards the benches
    for (const [t, s] of [[left[i], 1], [right[i], -1]]) lights.addStrand(t, V(t.x + s * 3.2, 3.6, t.z), { ...fairy, sag: 0.3 });
    for (const t of [left[i], right[i]]) kandeel(t.x + (t.x < R.x ? 1 : -1) * 2.2, 3.6, t.z);
  }

  // ---- the ghat: diyas along the lips of the dry steps, kandeels along the lamp-post strands ----
  for (let i = 1; i <= 3; i++) {
    const y = -0.3 * i + 0.01; // step i's tread (the river laps at the 4th)
    const z = -44.65 - i * 1.3 - 0.42; // near its lip
    for (let x = -40; x <= 40; x += 1.6) still.add(x + (i % 2 ? 0.8 : 0), y, z);
  }
  for (const s of [-1, 1]) for (const x of [10, 18, 26]) kandeel(s * x, 3.25, -42.6);
  // the cross-path pole strands get kandeels too
  for (const s of [-1, 1]) for (const z of [-14.2, -21.8]) for (const x of [14, 22]) kandeel(s * x, 3.55, z);
  // the chowk: a ring of kandeels under the star of strands
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * Math.PI * 2; // under the middle of each perimeter strand
    kandeel(Math.cos(a) * 12.1, 5.95, Math.sin(a) * 12.1);
  }

  // ---- kandeels: one instanced mesh, a slow sway in the vertex shader (no per-frame CPU) ----
  const geo = kandeelGeometry();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const uTime = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        float sw = sin(uTime * 1.1 + ph) * 0.07;
        transformed.x += sw * (0.45 - position.y);
        transformed.z += cos(uTime * 0.9 + ph) * 0.04 * (0.45 - position.y);`
      );
  };
  mat.customProgramCacheKey = () => 'kandeel-sway';
  const mesh = new THREE.InstancedMesh(geo, mat, kandeels.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  kandeels.forEach((p, i) => {
    q.setFromAxisAngle(V(0, 1, 0), (i * 1.7) % Math.PI);
    mesh.setMatrixAt(i, m4.compose(p, q, V(0.8, 0.8, 0.8)));
    mesh.setColorAt(i, c.copy(hdr(KANDEEL_COLORS[i % KANDEEL_COLORS.length], 0.9)));
  });
  mesh.computeBoundingSphere();
  setLayer(mesh, 1); // not in the river reflection
  scene.add(mesh);
  ctx.live.add(mesh);
  ctx.updaters.push((dt, t) => (uTime.value = t));

  return still;
}
