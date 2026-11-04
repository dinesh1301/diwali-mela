import * as THREE from 'three';
import { stripes, signTexture } from '../stalls.js';
import { setLayer, WARM_PALETTE } from '../utils.js';

export const BOOTH = { W: 7, D: 5, H: 3.6, X: 29 };
let boothCount = 0;

/**
 * A game booth on Khel Gali. Built in local space with its open front facing +z, then turned
 * to face west, so local (x, y, z) maps to world (X - z, y, boothZ + x).
 */
export function buildBooth(ctx, lights, { z, title, sub, c1, c2, sign, rail = true, roof = true }) {
  const { W, D, H, X } = BOOTH;
  const g = new THREE.Group();
  g.position.set(X, 0, z);
  g.rotation.y = -Math.PI / 2;
  ctx.scene.add(g);
  const w = (x, y, zz) => g.localToWorld(new THREE.Vector3(x, y, zz));
  const add = (mesh, x, y, zz) => {
    mesh.position.set(x, y, zz);
    g.add(mesh);
    return mesh;
  };

  const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.8 });
  const fabric = new THREE.MeshStandardMaterial({ map: stripes(c1, c2), side: THREE.DoubleSide, roughness: 0.9 });
  add(new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), wood), 0, 0.05, 0);
  add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), fabric), 0, H / 2, -D / 2);
  for (const s of [-1, 1]) {
    const side = add(new THREE.Mesh(new THREE.PlaneGeometry(D, H), fabric), (s * W) / 2, H / 2, 0);
    side.rotation.y = Math.PI / 2;
    for (const zs of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, H, 8), wood), s * (W / 2 - 0.05), H / 2, zs * (D / 2 - 0.05));
  }
  if (roof) {
    const roofGeo = new THREE.ConeGeometry(1, 1.4, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    const cone = add(new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ map: stripes(c1, c2, 12), side: THREE.DoubleSide, roughness: 0.85 })), 0, H + 0.7, 0);
    cone.scale.set((W / 2 + 0.3) * Math.SQRT2, 1, (D / 2 + 0.3) * Math.SQRT2);
  }

  // an open-top booth (the strongman tower) keeps its sign off to one side so the tower stays in view
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(roof ? 4.4 : 3.0, roof ? 1.15 : 0.8),
    new THREE.MeshBasicMaterial({ map: signTexture(title, sub, sign), color: new THREE.Color(1.2, 1.2, 1.2) })
  );
  add(signMesh, roof ? 0 : -W / 2 + 1.75, roof ? H + 0.62 : H + 0.45, D / 2 + 0.32);
  if (!roof) {
    const beam = add(new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.12, 0.12), wood), 0, H, D / 2 + 0.3); // a lintel across the open front
    beam.position.y = H + 0.02;
  }

  if (rail) {
    add(new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 0.12), wood), 0, 1.0, D / 2);
    for (const x of [-W / 2, -W / 4, 0, W / 4, W / 2]) add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), wood), x, 0.5, D / 2);
  }

  const ex = W / 2 + 0.3;
  const ez = D / 2 + 0.3;
  lights.addStrand(w(-ex, H, ez), w(ex, H, ez), { sag: 0.05, spacing: 0.32, wire: false });
  if (roof) {
    const apex = w(0, H + 1.4, 0);
    for (const [sx, sz] of [[-1, 1], [1, 1]]) lights.addStrand(w(sx * ex, H, sz * ez), apex, { sag: 0, spacing: 0.32, wire: false, palette: WARM_PALETTE });
  } else {
    // bulbs around the rim of the walls instead
    for (const sx of [-1, 1]) lights.addStrand(w(sx * ex, H, ez), w(sx * ex, H, -ez), { sag: 0.05, spacing: 0.32, wire: false, palette: WARM_PALETTE });
    lights.addStrand(w(-ex, H, -ez), w(ex, H, -ez), { sag: 0.05, spacing: 0.32, wire: false, palette: WARM_PALETTE });
  }

  // one warm light for each pair of neighbouring booths (Khel Gali builds them 9 m apart, in order),
  // hung above the walls in front of the gap between them so it shines into both open fronts
  if (boothCount++ % 2 === 0) {
    const light = new THREE.PointLight(0xffc27a, 50, 15, 2);
    light.position.set(4.5, H + 1.0, D / 2 + 0.6);
    g.add(light);
  }

  setLayer(g, 1);
  ctx.world.colliders.push(
    rail
      ? { type: 'box', minX: X - D / 2 - 0.1, maxX: X + D / 2 + 0.1, minZ: z - W / 2 - 0.1, maxZ: z + W / 2 + 0.1 }
      : { type: 'box', minX: X + 0.6, maxX: X + D / 2 + 0.1, minZ: z - W / 2 - 0.1, maxZ: z + W / 2 + 0.1 }
  );
  return { group: g, w, z };
}
