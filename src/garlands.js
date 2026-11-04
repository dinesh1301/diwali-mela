import * as THREE from 'three';
import { catenary } from './utils.js';
import { lowDetail } from './lod.js';

const ORANGE = new THREE.Color(0xff7b00);
const YELLOW = new THREE.Color(0xffc300);

/** Marigold (genda phool) garlands: swags between two points and straight drops. */
export class Garlands {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  addSwag(a, b, sag = 0.35, spacing = 0.1) {
    const n = Math.max(2, Math.round(a.distanceTo(b) / spacing));
    catenary(a, b, sag, n).forEach((p, i) => this.items.push({ p, c: Math.floor(i / 4) % 2 ? YELLOW : ORANGE }));
  }

  addDrop(top, length, spacing = 0.1) {
    const n = Math.round(length / spacing);
    for (let i = 0; i <= n; i++) {
      this.items.push({
        p: new THREE.Vector3(top.x, top.y - i * spacing, top.z),
        c: Math.floor(i / 4) % 2 ? YELLOW : ORANGE,
      });
    }
  }

  build() {
    if (!this.items.length) return;
    const mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.07, lowDetail() ? 0 : 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, emissive: 0x3a1600 }),
      this.items.length
    );
    const d = new THREE.Object3D();
    this.items.forEach((it, i) => {
      d.position.copy(it.p);
      d.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      d.scale.setScalar(0.85 + Math.random() * 0.35);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i, it.c);
    });
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
  }
}
