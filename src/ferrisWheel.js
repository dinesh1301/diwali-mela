import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beamGeometry, canvasTexture, hdr, DAY } from './utils.js';
import { signTexture } from './stalls.js';
import { lowDetail } from './lod.js';
import { mergeStatic, freezeStatic, tintEmissive } from './merge.js';

const R = 14; // wheel radius
const H = 17.5; // hub height
const HALF = 1.15; // half the distance between the two rims
const SPOKES = 16;
const GONDOLA_COLORS = [0xe63946, 0xffb703, 0x2a9d8f, 0x8338ec, 0xfb5607, 0x3a86ff, 0xff006e, 0x06d6a0];
const TWO_PI = Math.PI * 2;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class FerrisWheel {
  constructor(scene, position) {
    this.speed = 0.085; // rad/s, about 74 s per turn
    this.ride = null;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);

    const steel = new THREE.MeshStandardMaterial({ color: 0xe8e4f0, metalness: 0.6, roughness: 0.35 });
    const red = new THREE.MeshStandardMaterial({ color: 0xa4161a, metalness: 0.35, roughness: 0.5 });

    // A-frame supports and axle
    const frame = [];
    for (const s of [-1, 1]) {
      const hub = V(0, H, s * (HALF + 0.55));
      const fl = V(-8, 0, s * 2.9);
      const fr = V(8, 0, s * 2.9);
      frame.push(beamGeometry(fl, hub, 0.24, 8), beamGeometry(fr, hub, 0.24, 8));
      for (const t of [0.35, 0.7]) frame.push(beamGeometry(fl.clone().lerp(hub, t), fr.clone().lerp(hub, t), 0.13));
    }
    const axle = new THREE.CylinderGeometry(0.45, 0.45, 2 * (HALF + 0.8), 16);
    axle.rotateX(Math.PI / 2);
    axle.translate(0, H, 0);
    frame.push(axle);
    this.group.add(new THREE.Mesh(mergeGeometries(frame), red));

    // the rotating wheel
    this.wheel = new THREE.Group();
    this.wheel.position.y = H;
    this.group.add(this.wheel);

    const parts = [];
    for (const z of [-HALF, HALF]) {
      const rim = new THREE.TorusGeometry(R, 0.17, 8, 120);
      rim.translate(0, 0, z);
      const inner = new THREE.TorusGeometry(R * 0.45, 0.1, 6, 60);
      inner.translate(0, 0, z);
      parts.push(rim, inner);
      for (let i = 0; i < SPOKES; i++) {
        const a = (i / SPOKES) * TWO_PI;
        const a2 = ((i + 0.5) / SPOKES) * TWO_PI;
        parts.push(beamGeometry(V(0, 0, z), V(Math.cos(a) * R, Math.sin(a) * R, z), 0.07));
        parts.push(beamGeometry(V(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45, z), V(Math.cos(a2) * R, Math.sin(a2) * R, z), 0.05));
      }
    }
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * TWO_PI;
      parts.push(beamGeometry(V(Math.cos(a) * R, Math.sin(a) * R, -HALF), V(Math.cos(a) * R, Math.sin(a) * R, HALF), 0.08));
    }
    const hubGeo = new THREE.CylinderGeometry(1.4, 1.4, 2 * HALF + 0.3, 24);
    hubGeo.rotateX(Math.PI / 2);
    parts.push(hubGeo);
    this.wheel.add(new THREE.Mesh(mergeGeometries(parts), steel));

    // glowing hub medallions
    const sunTex = canvasTexture(256, 256, (ctx, w) => {
      ctx.translate(w / 2, w / 2);
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.arc(0, 0, 124, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      for (let i = 0; i < 16; i++) {
        ctx.rotate(TWO_PI / 16);
        ctx.beginPath();
        ctx.ellipse(70, 0, 46, 14, 0, 0, TWO_PI);
        ctx.fill();
      }
      ctx.fillStyle = '#e0218a';
      ctx.beginPath();
      ctx.arc(0, 0, 34, 0, TWO_PI);
      ctx.fill();
    });
    for (const s of [-1, 1]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32), new THREE.MeshBasicMaterial({ map: sunTex, color: new THREE.Color(1.6, 1.6, 1.6) }));
      disc.position.z = s * (HALF + 0.16);
      if (s < 0) disc.rotation.y = Math.PI;
      this.wheel.add(disc);
    }

    // bulbs riding on the wheel
    this.bulbData = [];
    const pts = [];
    for (const z of [-HALF - 0.18, HALF + 0.18]) {
      for (let i = 0; i < 128; i++) {
        const a = (i / 128) * TWO_PI;
        pts.push(V(Math.cos(a) * R, Math.sin(a) * R, z));
        this.bulbData.push({ a, r: R });
      }
      for (let s = 0; s < SPOKES; s++) {
        const a = (s / SPOKES) * TWO_PI;
        for (let k = 2; k <= 9; k++) {
          const r = (R * k) / 10;
          pts.push(V(Math.cos(a) * r, Math.sin(a) * r, z));
          this.bulbData.push({ a, r });
        }
      }
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TWO_PI;
        pts.push(V(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45, z));
        this.bulbData.push({ a, r: R * 0.45 });
      }
    }
    this.bulbs = new THREE.InstancedMesh(lowDetail() ? new THREE.IcosahedronGeometry(0.11, 0) : new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial(), pts.length);
    const m4 = new THREE.Matrix4();
    pts.forEach((p, i) => {
      this.bulbs.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
      this.bulbs.setColorAt(i, new THREE.Color(1, 1, 1));
    });
    this.bulbs.computeBoundingSphere();
    this.wheel.add(this.bulbs);

    // gondolas: shared geometry, coloured materials
    const cabin = [
      new THREE.BoxGeometry(1.9, 0.12, 1.5).translate(0, -2.15, 0),
      new THREE.BoxGeometry(1.9, 0.55, 0.07).translate(0, -1.82, 0.72),
      new THREE.BoxGeometry(1.9, 0.55, 0.07).translate(0, -1.82, -0.72),
      new THREE.BoxGeometry(0.07, 0.55, 1.5).translate(0.95, -1.82, 0),
      new THREE.BoxGeometry(0.07, 0.55, 1.5).translate(-0.95, -1.82, 0),
      new THREE.BoxGeometry(1.6, 0.08, 0.42).translate(0, -1.66, -0.45), // bench
    ];
    const posts = [];
    for (const x of [-0.9, 0.9]) for (const z of [-0.68, 0.68]) posts.push(beamGeometry(V(x, -2.1, z), V(x, -0.55, z), 0.035));
    posts.push(beamGeometry(V(0, 0, -0.95), V(0, -0.3, -0.6), 0.04), beamGeometry(V(0, 0, 0.95), V(0, -0.3, 0.6), 0.04));
    const cabinGeo = mergeGeometries(cabin);
    const postGeo = mergeGeometries(posts);
    const roofGeo = new THREE.ConeGeometry(1.35, 0.6, 6).translate(0, -0.3, 0);
    const lampGeo = new THREE.SphereGeometry(0.1, 10, 8).translate(0, -0.75, 0);
    const lampMat = new THREE.MeshBasicMaterial({ color: hdr(0xffd08a, 3.5) });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.3 });

    // The 16 gondolas are drawn as 4 instanced meshes (cabins, posts, roofs, lamps) whose instance
    // matrices follow the gondola Groups; the Groups stay as the swinging seat anchors.
    this.gondolas = [];
    this.gondolaParts = [
      new THREE.InstancedMesh(cabinGeo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2 }), SPOKES),
      new THREE.InstancedMesh(postGeo, gold, SPOKES),
      // a roof glows faintly in its own colour: emissive (0.12) times the instance colour
      new THREE.InstancedMesh(roofGeo, tintEmissive(new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: new THREE.Color(0.12, 0.12, 0.12) })), SPOKES),
      new THREE.InstancedMesh(lampGeo, lampMat, SPOKES),
    ];
    const [cabins, , roofs] = this.gondolaParts;
    cabins.castShadow = roofs.castShadow = true;
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * TWO_PI;
      const color = new THREE.Color(GONDOLA_COLORS[i % GONDOLA_COLORS.length]);
      const g = new THREE.Group();
      g.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      g.userData = { angle: a, phase: Math.random() * 10 };
      cabins.setColorAt(i, color);
      roofs.setColorAt(i, color);
      this.wheel.add(g);
      this.gondolas.push(g);
    }
    this.syncGondolas();
    for (const m of this.gondolaParts) {
      // the gondolas only ever swing around their place on the rim, so one sphere covers them all
      m.computeBoundingSphere();
      m.boundingSphere.radius += 3;
      this.wheel.add(m);
    }

    // boarding platform, steps and ticket booth
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.8 });
    const platform = new THREE.Mesh(new THREE.BoxGeometry(5, 1.25, 4.4), wood);
    platform.position.set(0, 0.625, 0);
    this.group.add(platform);
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.31 * (i + 1), 0.5), wood);
      step.position.set(0, 0.155 * (i + 1), 2.2 + 0.5 * (4 - i) - 0.25);
      this.group.add(step);
    }
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 1.8), new THREE.MeshStandardMaterial({ color: 0xffb703, roughness: 0.6 }));
    booth.position.set(5.5, 1.2, 5);
    this.group.add(booth);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.95),
      new THREE.MeshBasicMaterial({ map: signTexture('Giant Wheel', 'Press R or tap Ride Wheel', '#6a0d2b'), color: new THREE.Color(1.2, 1.2, 1.2) })
    );
    sign.position.set(5.5, 2.95, 5.92);
    this.group.add(sign);

    this.light = new THREE.PointLight(0xff66aa, 140, 45, 2);
    this.light.position.set(0, H * 0.55, 7);
    this.group.add(this.light);

    this.colliders = [
      { type: 'box', minX: position.x - 8.6, maxX: position.x + 8.6, minZ: position.z - 3.3, maxZ: position.z + 3.3 },
      { type: 'box', minX: position.x + 4.4, maxX: position.x + 6.6, minZ: position.z + 4.1, maxZ: position.z + 5.9 },
    ];
    this.tmp = new THREE.Color();
    this.gold = new THREE.Color(0xffb347);
    this.magenta = new THREE.Color(0xff2d95);
    this.cyan = new THREE.Color(0x35d6ff);

    // platform, steps and booth: one mesh per material; the turning wheel stays live
    mergeStatic(this.group, { skip: (o) => o === this.wheel });
    freezeStatic(this.group, (o) => o === this.wheel || o === this.group);
  }

  syncGondolas() {
    for (let i = 0; i < this.gondolas.length; i++) {
      const g = this.gondolas[i];
      g.updateMatrix();
      for (const m of this.gondolaParts) m.setMatrixAt(i, g.matrix);
    }
    for (const m of this.gondolaParts) m.instanceMatrix.needsUpdate = true;
  }

  update(dt, t) {
    this.wheel.rotation.z += this.speed * dt;
    const rz = this.wheel.rotation.z;
    for (const g of this.gondolas) g.rotation.z = -rz + Math.sin(t * 1.1 + g.userData.phase) * 0.035;
    this.syncGondolas();

    const mode = Math.floor(t / 9) % 3;
    const c = this.tmp;
    for (let i = 0; i < this.bulbData.length; i++) {
      const b = this.bulbData[i];
      if (mode === 0) {
        c.setHSL((b.a / TWO_PI + t * 0.08) % 1, 1, 0.55).multiplyScalar(2.8);
      } else if (mode === 1) {
        const s = 0.5 + 0.5 * Math.sin(b.r * 0.7 - t * 6);
        c.copy(this.gold).multiplyScalar(0.3 + 3 * s * s);
      } else {
        const on = Math.floor(b.a / (Math.PI / 4) + t * 2) % 2;
        c.copy(on ? this.magenta : this.cyan).multiplyScalar(2.6);
      }
      this.bulbs.setColorAt(i, c.multiplyScalar(0.03 + 0.97 * DAY.lights));
    }
    this.bulbs.instanceColor.needsUpdate = true;
    this.light.color.setHSL((t * 0.05) % 1, 0.8, 0.6);
    this.light.intensity = 140 * DAY.lights;

    if (this.ride) {
      this.ride.angle += this.speed * dt;
      if (this.ride.angle >= TWO_PI) this.ride.done = true;
    }
  }

  /** Boards the gondola currently nearest the platform. */
  startRide() {
    const rz = this.wheel.rotation.z;
    let best = 0;
    let bestD = Infinity;
    this.gondolas.forEach((g, i) => {
      const diff = (((g.userData.angle + rz - 1.5 * Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
      const d = Math.min(diff, TWO_PI - diff);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.ride = { index: best, angle: 0, done: false };
  }

  stopRide() {
    this.ride = null;
  }

  /** World position of a seated rider's eyes. */
  ridePosition(out) {
    const g = this.gondolas[this.ride.index];
    this.group.updateMatrixWorld(true);
    return g.localToWorld(out.set(0, -1.3, 0));
  }
}
