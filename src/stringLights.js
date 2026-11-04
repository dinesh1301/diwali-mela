import * as THREE from 'three';
import { catenary, BULB_PALETTE } from './utils.js';
import { lowDetail } from './lod.js';

const MODES = ['chase', 'twinkle', 'steady', 'alternate'];

/** Every fairy-light bulb in the mela, drawn as one instanced mesh and animated per strand. */
/** Seconds into the evening at which the lights around a point come on (gate first, river last). */
function switchOnDelay(p) {
  if (p.z > 52) return p.x > 10 ? 6 : p.x < -14 ? 10 : 3; // gate, then Selfie Point / creators, then Ramleela
  if (p.z > 12) return p.x > 14 ? 16 : p.x < -14 ? 20 : 9; // bazaar, then games, then carousel / cars
  if (p.z > -12) return 13; // rangoli chowk
  if (p.z > -40) return p.x < -14 ? 24 : p.x > 14 ? 28 : 18; // wheel, fireworks lane, cross path
  return 22; // ghat and temple
}

export class StringLights {
  constructor(scene) {
    this.scene = scene;
    this.bulbs = [];
    this.wirePoints = [];
    this.strands = 0;
    this.tmp = new THREE.Color();
    this.dayT = null; // null = always on
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
    this.mesh = new THREE.InstancedMesh(
      // 4,000+ bulbs drawn twice (scene and river): phones get a 20-triangle icosahedron
      lowDetail() ? new THREE.IcosahedronGeometry(0.075, 0) : new THREE.SphereGeometry(0.075, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      this.bulbs.length
    );
    const m4 = new THREE.Matrix4();
    this.bulbs.forEach((b, k) => {
      this.mesh.setMatrixAt(k, m4.makeTranslation(b.pos.x, b.pos.y, b.pos.z));
      this.mesh.setColorAt(k, b.color);
    });
    this.mesh.computeBoundingSphere();
    this.scene.add(this.mesh);

    if (this.wirePoints.length) {
      const wires = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(this.wirePoints),
        new THREE.LineBasicMaterial({ color: 0x1a120c })
      );
      this.scene.add(wires);
    }
  }

  update(t) {
    const c = this.tmp;
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
        this.mesh.setColorAt(k, c.copy(b.color).multiplyScalar(0.06));
        continue;
      }
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
      this.mesh.setColorAt(k, c.copy(b.color).multiplyScalar((0.5 + s * 3.2) * on));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}
