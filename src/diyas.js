import * as THREE from 'three';
import { hdr, rand } from './utils.js';
import { seg } from './lod.js';

const BOWL_PROFILE = [
  [0, 0],
  [0.07, 0],
  [0.12, 0.025],
  [0.15, 0.06],
  [0.13, 0.065],
  [0.1, 0.035],
  [0, 0.03],
].map(([x, y]) => new THREE.Vector2(x, y));

/** Clay diyas with flickering flames. `floating` ones bob on the river. */
export class Diyas {
  constructor(scene, { floating = false, still = false } = {}) {
    this.scene = scene;
    this.floating = floating;
    this.still = still; // set once at build and never animated: long rows that only need to glow
    this.items = [];
    this.dummy = new THREE.Object3D();
  }

  add(x, y, z) {
    this.items.push({ x, y, z, phase: Math.random() * 100, s: rand(0.9, 1.15), rot: Math.random() * 6.28 });
  }

  build() {
    const n = this.items.length;
    if (!n) return;
    this.bowls = new THREE.InstancedMesh(
      new THREE.LatheGeometry(BOWL_PROFILE, seg(14, 8)),
      new THREE.MeshStandardMaterial({ color: 0xb5562b, roughness: 0.85, emissive: 0x3a1204 }),
      n
    );
    const flameGeo = new THREE.SphereGeometry(0.035, seg(8, 6), seg(6, 4));
    flameGeo.scale(1, 2.2, 1);
    flameGeo.translate(0, 0.075, 0);
    this.flames = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: hdr(0xffa040, 5) }), n);
    this.update(0);
    if (this.still) {
      // vary the frozen flames a little so a long row doesn't look stamped
      const d = this.dummy;
      this.items.forEach((it, i) => {
        d.position.set(it.x, it.y, it.z);
        d.rotation.set(0, 0, (Math.random() - 0.5) * 0.12);
        d.scale.set(it.s, it.s * (0.85 + Math.random() * 0.35), it.s);
        d.updateMatrix();
        this.flames.setMatrixAt(i, d.matrix);
      });
    }
    this.bowls.computeBoundingSphere();
    this.flames.computeBoundingSphere();
    this.scene.add(this.bowls, this.flames);
  }

  /** Hides the diyas standing at these points (e.g. a re-stocked stall's old shelf of diyas). */
  hideAt(points, eps = 0.02) {
    if (!points?.length) return;
    const d = this.dummy;
    this.items.forEach((it, i) => {
      if (!points.some((p) => Math.abs(p.x - it.x) < eps && Math.abs(p.y - it.y) < eps && Math.abs(p.z - it.z) < eps)) return;
      it.y = -50;
      if (!this.bowls) return;
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(0, it.rot, 0);
      d.scale.setScalar(it.s);
      d.updateMatrix();
      this.bowls.setMatrixAt(i, d.matrix);
      this.bowls.instanceMatrix.needsUpdate = true;
    });
  }

  update(t) {
    if (!this.bowls || (this.still && t !== 0)) return;
    const d = this.dummy;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      let y = it.y;
      if (this.floating) {
        y += Math.sin(t * 1.2 + it.phase) * 0.03;
        d.position.set(it.x, y, it.z);
        d.rotation.set(Math.sin(t * 0.9 + it.phase) * 0.08, it.rot, Math.cos(t * 1.1 + it.phase) * 0.08);
        d.scale.setScalar(it.s);
        d.updateMatrix();
        this.bowls.setMatrixAt(i, d.matrix);
      } else if (t === 0) {
        d.position.set(it.x, y, it.z);
        d.rotation.set(0, it.rot, 0);
        d.scale.setScalar(it.s);
        d.updateMatrix();
        this.bowls.setMatrixAt(i, d.matrix);
      }
      const f = Math.sin(t * 17 + it.phase) * Math.sin(t * 7.3 + it.phase * 1.7);
      d.position.set(it.x, y, it.z);
      d.rotation.set(0, 0, Math.sin(t * 5 + it.phase) * 0.08);
      d.scale.set(it.s * (0.95 + 0.1 * f), it.s * (0.85 + 0.3 * f + 0.1 * Math.sin(t * 31 + it.phase)), it.s);
      d.updateMatrix();
      this.flames.setMatrixAt(i, d.matrix);
    }
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.floating || t === 0) this.bowls.instanceMatrix.needsUpdate = true;
  }
}
