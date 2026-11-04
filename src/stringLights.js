import * as THREE from 'three';
import { catenary, BULB_PALETTE } from './utils.js';
import { lowDetail } from './lod.js';

const MODES = ['chase', 'twinkle', 'steady', 'alternate'];
// Bulb colours are recomputed and re-uploaded at this rate, not every frame: thousands of bulbs,
// and chase/twinkle patterns read the same at 20-30 Hz.
const CELL = 48; // metres: the bulbs' culling cells
const colorHz = () => (lowDetail() ? 20 : 30); // read at run time: the tier is known only after detect()

/** Every fairy-light bulb in the mela, drawn as one instanced mesh and animated per strand. */
/** Seconds into the evening at which the lights around a point come on (gate first, river last). */
function switchOnDelay(p) {
  if (p.z > 52) return p.x > 10 ? 6 : p.x < -14 ? 10 : 3; // gate, then Selfie Point / creators, then Ramleela
  if (p.z > 12) return p.x > 14 ? 16 : p.x < -14 ? 20 : 9; // bazaar, then games, then carousel / cars
  if (p.z > -12) return 13; // rangoli chowk
  if (p.z > -40) return p.x < -14 ? 24 : p.x > 14 ? 28 : 18; // wheel, fireworks lane, cross path
  return 22; // ghat and temple
}

// Per scene: the reflection-only bulb copies. Scene.onBeforeRender runs at the start of every
// renderer.render(scene, camera), including the Reflector's nested one, before its render list is
// built, so the copies join the reflection's list and never the main view's.
const copies = new WeakMap();
function reflectOnly(scene) {
  let list = copies.get(scene);
  if (!list) {
    list = [];
    copies.set(scene, list);
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, sc, camera, ...rest) {
      const show = !camera.layers.isEnabled(1);
      for (const m of list) m.visible = show;
      prev.call(this, renderer, sc, camera, ...rest);
    };
  }
  return list;
}

export class StringLights {
  constructor(scene) {
    this.scene = scene;
    this.bulbs = [];
    this.wirePoints = [];
    this.strands = 0;
    this.tmp = new THREE.Color();
    this.dayT = null; // null = always on
    this.lastT = -Infinity;
    this.dark = false; // every bulb was off at the last update, so the colours are already final
  }

  setDay(T) {
    this.dayT = T;
  }

  addStrand(a, b, { sag = 0.6, spacing = 0.55, palette = BULB_PALETTE, mode, wire = true } = {}) {
    const n = Math.max(2, Math.round(a.distanceTo(b) / spacing));
    const pts = catenary(a, b, sag, n);
    const m = mode ?? MODES[this.strands % MODES.length];
    this.strands++;
    const onAt = switchOnDelay(a) + Math.random() * 1.5;
    pts.forEach((p, i) => {
      if (wire && i > 0) this.wirePoints.push(pts[i - 1], p);
      this.bulbs.push({
        pos: p.clone().setY(p.y - (wire ? 0.07 : 0)),
        color: new THREE.Color(palette[i % palette.length]),
        mode: m,
        i,
        phase: Math.random() * 6.28,
        onAt,
      });
    });
  }

  addPolyline(points, opts = {}) {
    for (let i = 1; i < points.length; i++) {
      this.addStrand(points[i - 1], points[i], { sag: 0, wire: false, ...opts });
    }
  }

  build() {
    // 4,000+ bulbs drawn twice (scene and river): phones get 48 triangles instead of 80. Eight
    // segments keep the outline an octagon from below and from the side; a 20-triangle icosahedron
    // showed as hard hexagons on the bulbs right over the walkway.
    const geo = lowDetail() ? new THREE.SphereGeometry(0.075, 8, 4) : new THREE.SphereGeometry(0.075, 8, 6);
    // The river reflection draws at a quarter (phones) or half resolution and smears it with waves,
    // so it gets its own copy of the bulbs as 8-20 triangle blobs sharing the same instance buffers.
    // The real bulbs sit on layer 1, which the reflection skips; the copies stay on layer 0 and are
    // shown only while a camera that cannot see layer 1 (the reflection's) renders the scene.
    const blob = lowDetail() ? new THREE.OctahedronGeometry(0.075, 0) : new THREE.IcosahedronGeometry(0.075, 0);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Bulbs are grouped into ~48 m cells, one instanced mesh per cell, so the cells behind the
    // camera are frustum-culled instead of drawing every bulb in the mela every frame. The colours
    // live in one array in bulb order; each cell's colour attribute is a view of its slice.
    const cell = (b) => `${Math.floor(b.pos.x / CELL)},${Math.floor(b.pos.z / CELL)}`;
    for (const b of this.bulbs) b.cell = cell(b);
    this.bulbs.sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0));
    const n = this.bulbs.length;
    this.colors = new Float32Array(n * 3);
    const matrices = new Float32Array(n * 16);
    const m4 = new THREE.Matrix4();
    this.bulbs.forEach((b, k) => {
      m4.makeTranslation(b.pos.x, b.pos.y, b.pos.z).toArray(matrices, k * 16);
      b.color.toArray(this.colors, k * 3);
    });
    this.chunks = [];
    const list = reflectOnly(this.scene);
    for (let a = 0; a < n; ) {
      let z = a + 1;
      while (z < n && this.bulbs[z].cell === this.bulbs[a].cell) z++;
      const color = new THREE.InstancedBufferAttribute(this.colors.subarray(a * 3, z * 3), 3);
      const matrix = new THREE.InstancedBufferAttribute(matrices.subarray(a * 16, z * 16), 16);
      const mk = (g) => {
        const m = new THREE.InstancedMesh(g, material, z - a);
        m.instanceMatrix = matrix;
        m.instanceColor = color;
        return m;
      };
      const mesh = mk(geo);
      mesh.computeBoundingSphere();
      mesh.layers.set(1);
      this.scene.add(mesh);
      const copy = mk(blob);
      copy.boundingSphere = mesh.boundingSphere;
      copy.visible = false;
      this.scene.add(copy);
      list.push(copy);
      this.chunks.push({ mesh, copy, color });
      a = z;
    }
    this.mesh = this.chunks[0]?.mesh ?? null;

    if (this.wirePoints.length) {
      const wires = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(this.wirePoints),
        new THREE.LineBasicMaterial({ color: 0x1a120c })
      );
      this.scene.add(wires);
    }
  }

  update(t) {
    if (!this.mesh || t - this.lastT < 1 / colorHz()) return;
    this.lastT = t;
    const c = this.tmp;
    const colors = this.colors;
    let lit = false;
    const alt = Math.floor(t * 1.5);
    const T = this.dayT;
    for (let k = 0; k < this.bulbs.length; k++) {
      const b = this.bulbs[k];
      let on = 1;
      if (T !== null) {
        const since = T - b.onAt;
        if (since < 0) on = 0;
        else if (since < 1.4) on = Math.random() < 0.6 ? 1 : 0.15; // a flicker as the circuit wakes up
      }
      if (on === 0) {
        if (!this.dark) c.copy(b.color).multiplyScalar(0.06).toArray(colors, k * 3);
        continue;
      }
      lit = true;
      let s;
      switch (b.mode) {
        case 'chase':
          s = 0.2 + 0.8 * Math.max(0, Math.sin(t * 4 - b.i * 0.7));
          break;
        case 'twinkle': {
          const w = 0.5 + 0.5 * Math.sin(t * (2 + (b.phase % 1) * 3) + b.phase);
          s = w * w * 0.9 + 0.1;
          break;
        }
        case 'alternate':
          s = (alt + b.i) % 2 ? 1 : 0.2;
          break;
        default:
          s = 0.85 + 0.15 * Math.sin(t * 1.3 + b.phase);
      }
      c.copy(b.color).multiplyScalar((0.5 + s * 3.2) * on).toArray(colors, k * 3);
    }
    if (!lit && this.dark) return; // still all off: nothing changed since the last upload
    this.dark = !lit;
    for (const ch of this.chunks) ch.color.needsUpdate = true;
  }
}
