import { tk } from '../touch.js';
import * as THREE from 'three';
import { canvasTexture, beam, WARM_PALETTE } from '../utils.js';
import { signTexture } from '../stalls.js';
import { slot } from '../personalSlots.js';
import { SITES } from '../world.js';

const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function sign(scene, title, sub, bg, x, y, z, ry, w = 4.2) {
  const wide = sub && sub.length > 34;
  const tex = signTexture(title, sub, bg, '#ffe7a3', wide ? 1024 : 512, wide ? 288 : 144);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.28), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1), side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  scene.add(m);
  return m;
}

function warm(scene, x, y, z, i = 60, d = 24) {
  const l = new THREE.PointLight(0xffb46b, i, d, 2);
  l.position.set(x, y, z);
  scene.add(l);
}

/** Pushpak Viman Airfield: a runway along z, a helipad and a striped hangar tent to the east. */
export function buildAirfield(ctx, lights) {
  const { scene, world } = ctx;
  const a = SITES.airfield;
  const RUN_W = 10;
  const RUN_L = 64;

  const asphalt = canvasTexture(256, 1024, (c, w, h) => {
    c.fillStyle = '#3a3a40';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      c.fillStyle = `rgba(${Math.random() > 0.5 ? '120,120,130' : '15,15,20'},${Math.random() * 0.25})`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    c.fillStyle = '#f1e9c8';
    for (let y = 40; y < h - 40; y += 96) c.fillRect(w / 2 - 5, y, 10, 48);
    for (const y of [8, h - 40]) for (let x = 20; x < w - 20; x += 36) c.fillRect(x, y, 18, 32);
    c.fillStyle = '#ffd166';
    c.fillRect(0, 0, 6, h);
    c.fillRect(w - 6, 0, 6, h);
  });
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(RUN_W, RUN_L), std(0xffffff, 0.95, { map: asphalt, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(a.x, 0.03, a.z);
  scene.add(runway);

  for (const s of [-1, 1]) {
    const pts = [];
    for (let z = a.z - RUN_L / 2; z <= a.z + RUN_L / 2; z += 4) pts.push(V(a.x + s * (RUN_W / 2 + 0.6), 0.35, z));
    lights.addPolyline(pts, { spacing: 4, palette: [0xffffff, 0xffffff, 0x3a86ff], mode: 'chase' });
  }
  lights.addPolyline([V(a.x - RUN_W / 2, 0.35, a.z - RUN_L / 2 - 1), V(a.x + RUN_W / 2, 0.35, a.z - RUN_L / 2 - 1)], { spacing: 1, palette: [0x20ff40], mode: 'twinkle' });
  lights.addPolyline([V(a.x - RUN_W / 2, 0.35, a.z + RUN_L / 2 + 1), V(a.x + RUN_W / 2, 0.35, a.z + RUN_L / 2 + 1)], { spacing: 1, palette: [0xff3030], mode: 'twinkle' });

  // helipad
  const pad = canvasTexture(512, 512, (c, w) => {
    c.fillStyle = '#2f2f36';
    c.beginPath();
    c.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ffd166';
    c.lineWidth = 22;
    c.beginPath();
    c.arc(w / 2, w / 2, w / 2 - 30, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#ffd166';
    c.font = '700 300px Poppins, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('H', w / 2, w / 2 + 14);
  });
  const helipad = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40), std(0xffffff, 0.95, { map: pad, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  helipad.rotation.x = -Math.PI / 2;
  helipad.position.set(a.x + 12, 0.03, a.z + 16);
  scene.add(helipad);
  const padLights = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    padLights.push(V(a.x + 12 + Math.cos(t) * 5.6, 0.3, a.z + 16 + Math.sin(t) * 5.6));
  }
  padLights.push(padLights[0].clone());
  lights.addPolyline(padLights, { spacing: 2.2, palette: [0xffd166], mode: 'chase' });

  // hangar tent
  const hx = a.x + 12;
  const hz = a.z - 12;
  const stripes = canvasTexture(256, 256, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#ffd166' : '#b3122e';
      c.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
  });
  const tentMat = std(0xffffff, 0.9, { map: stripes, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 11, 16, 1, true, 0, Math.PI), tentMat);
  roof.rotation.set(0, 0, Math.PI / 2);
  roof.position.set(hx, 1.6, hz);
  scene.add(roof);
  const back = new THREE.Mesh(new THREE.CircleGeometry(5, 16, 0, Math.PI), tentMat);
  back.position.set(hx + 5.5, 1.6, hz);
  back.rotation.y = -Math.PI / 2;
  scene.add(back);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.2, 10), std(0x3a2a1c, 0.9));
  floor.position.set(hx, 0.1, hz);
  scene.add(floor);
  world.colliders.push({ type: 'box', minX: hx - 5.5, maxX: hx + 5.5, minZ: hz - 5.2, maxZ: hz + 5.2 });
  world.tall.push({ type: 'box', minX: hx - 5.5, maxX: hx + 5.5, minZ: hz - 5.2, maxZ: hz + 5.2, h: 7 });
  sign(scene, slot('ride.airfield.sign'), tk('Walk up to a plane or heli and press E to fly', 'Walk up to a plane or heli and tap the button to fly', 'Planes and helis · take to the sky'), '#13306b', hx - 5.9, 5.2, hz, -Math.PI / 2, 6);
  warm(scene, hx - 3, 4.5, hz, 60, 20);
  warm(scene, a.x, 6, a.z - 20, 90, 26); // over the plane's parking spot
  warm(scene, a.x + 12, 9, a.z + 16, 26, 24); // over the helipad

  // windsock
  const wx = a.x - 8;
  const wz = a.z + 28;
  scene.add(beam(V(wx, 0, wz), V(wx, 5, wz), 0.06, std(0xcccccc, 0.5, { metalness: 0.6 })));
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 10, 1, true), std(0xff7a00, 0.8, { side: THREE.DoubleSide }));
  sock.position.set(wx, 4.9, wz - 1.0);
  sock.rotation.x = -Math.PI / 2;
  scene.add(sock);
  world.colliders.push({ type: 'circle', x: wx, z: wz, r: 0.15 });

  return {
    planeSpawn: { x: a.x, z: a.z - 20, heading: 0 }, // nose pointing down the runway (+z)
    heliSpawn: { x: a.x + 12, z: a.z + 16, heading: -Math.PI / 2 },
    callSpot: V(hx - 7, 0, hz),
    safeSpot: V(a.x - 8, 0, a.z - 4), // where you land on foot after a crash somewhere unreachable
    update(dt, t) {
      sock.rotation.z = Math.sin(t * 1.7) * 0.12;
    },
  };
}

/*
  Chakri Cars: a go-kart circuit. The centreline is a closed Catmull-Rom loop; the road is a
  ribbon extruded along it with kerbs painted into the texture, tyre-stack barriers follow both
  edges, and the start/finish gantry sits on the long east straight next to the pit canopy.
*/
const TRACK_W = 7;
const CONTROL = [
  [-44, 12],
  [-44, 30],
  [-48, 40],
  [-56, 43.5],
  [-63, 38],
  [-59, 30],
  [-63, 22],
  [-63, 12],
  [-56, 5],
  [-47, 7],
];
const PIT_Z = 21; // the pit exit and pedestrian crossing cut the barriers around here on the east straight

export function buildCarGround(ctx, lights) {
  const { scene, world } = ctx;
  const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => V(x, 0, z)), true, 'centripetal');
  const N = 260;
  const pts = curve.getSpacedPoints(N);
  pts.pop();
  const segLen = curve.getLength() / N;
  const centroid = pts.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / N);

  const left = [];
  const right = [];
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % N];
    const c = pts[(i - 1 + N) % N];
    const tx = b.x - c.x;
    const tz = b.z - c.z;
    const l = Math.hypot(tx, tz);
    const nx = -tz / l;
    const nz = tx / l;
    left.push(V(a.x + (nx * TRACK_W) / 2, 0, a.z + (nz * TRACK_W) / 2));
    right.push(V(a.x - (nx * TRACK_W) / 2, 0, a.z - (nz * TRACK_W) / 2));
  }

  // ---- road ribbon with painted kerbs and a dashed centre line ----
  const road = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#3b3b42';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      c.fillStyle = `rgba(${Math.random() > 0.5 ? '110,110,120' : '15,15,20'},${Math.random() * 0.25})`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    c.fillStyle = '#f1e9c8';
    c.fillRect(w / 2 - 4, 0, 8, h / 2);
    for (const x0 of [0, w - 18]) {
      for (let k = 0; k < 4; k++) {
        c.fillStyle = k % 2 ? '#f1e9c8' : '#c1121f';
        c.fillRect(x0, (k * h) / 4, 18, h / 4);
      }
    }
  });
  road.wrapS = road.wrapT = THREE.RepeatWrapping;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const l = left[i % N];
    const r = right[i % N];
    pos.push(l.x, 0.03, l.z, r.x, 0.03, r.z);
    const v = (i * segLen) / 4;
    uv.push(0, v, 1, v);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, std(0xffffff, 0.95, { map: road, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));

  // ---- start/finish on the east straight ----
  let i0 = 0;
  let best = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x + 44, p.z - 18);
    if (d < best) {
      best = d;
      i0 = i;
    }
  });
  const S = pts[i0];
  const checker = canvasTexture(256, 64, (c, w, h) => {
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
      c.fillStyle = (i + j) % 2 ? '#111' : '#f5f5f5';
      c.fillRect((i * w) / 16, (j * h) / 4, w / 16, h / 4);
    }
  });
  const dir = Math.atan2(pts[(i0 + 1) % N].x - S.x, pts[(i0 + 1) % N].z - S.z);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 1.2), std(0xffffff, 0.9, { map: checker, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  line.rotation.set(-Math.PI / 2, 0, dir);
  line.position.set(S.x, 0.04, S.z);
  scene.add(line);
  const post = std(0xb3122e, 0.6);
  const outL = left[i0].clone().sub(S).normalize();
  const gL = left[i0].clone().addScaledVector(outL, 1.2);
  const gR = right[i0].clone().addScaledVector(outL, -1.2);
  scene.add(beam(V(gL.x, 0, gL.z), V(gL.x, 5.2, gL.z), 0.12, post), beam(V(gR.x, 0, gR.z), V(gR.x, 5.2, gR.z), 0.12, post));
  world.colliders.push({ type: 'circle', x: gL.x, z: gL.z, r: 0.2 }, { type: 'circle', x: gR.x, z: gR.z, r: 0.2 });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(gL.distanceTo(gR) + 0.3, 0.3, 0.3), post);
  banner.position.set(S.x, 5.2, S.z);
  banner.rotation.y = dir;
  scene.add(banner);
  sign(scene, slot('ride.cars.sign'), tk('Go-kart circuit · W A S D drive · Space drift · beat your best lap', 'Go-kart circuit · joystick to drive · ✋ to drift · beat your best lap'), '#5c0a10', S.x, 4.3, S.z, dir + Math.PI, 6.4);
  lights.addStrand(V(gL.x, 5.2, gL.z), V(gR.x, 5.2, gR.z), { sag: 0.5, mode: 'chase' });
  const flagTex = canvasTexture(128, 96, (f, w, h) => {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) {
      f.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      f.fillRect((i * w) / 8, (j * h) / 6, w / 8, h / 6);
    }
  });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
  flag.position.set(gL.x - 0.7, 5.5, gL.z);
  flag.rotation.y = dir + Math.PI;
  scene.add(flag);

  // ---- tyre-stack barriers along both edges (one instanced mesh) ----
  const inner = left[i0].distanceTo(centroid) < right[i0].distanceTo(centroid) ? left : right;
  const stride = Math.max(1, Math.round(1.9 / segLen));
  const stacks = [];
  for (const edge of [left, right]) {
    for (let i = 0; i < N; i += stride) {
      const p = edge[i];
      const d = p.clone().sub(pts[i]).normalize();
      const q = p.clone().addScaledVector(d, 0.75);
      const onEastStraight = q.x > -49 && Math.abs(q.z - PIT_Z) < 4.2;
      if (onEastStraight) continue; // pit exit (inner) and pedestrian crossing (outer)
      if (q.distanceTo(gL) < 1.1 || q.distanceTo(gR) < 1.1) continue;
      stacks.push(q);
    }
  }
  const tyreGeo = new THREE.TorusGeometry(0.42, 0.17, 8, 16).rotateX(Math.PI / 2);
  const tyres = new THREE.InstancedMesh(tyreGeo, std(0xffffff, 0.9), stacks.length * 3);
  const m = new THREE.Matrix4();
  const black = new THREE.Color(0x161616);
  const bands = [new THREE.Color(0xf1e9c8), new THREE.Color(0xc1121f)];
  stacks.forEach((q, k) => {
    for (let s = 0; s < 3; s++) {
      const n = k * 3 + s;
      tyres.setMatrixAt(n, m.makeTranslation(q.x, 0.17 + s * 0.34, q.z));
      tyres.setColorAt(n, s === 1 ? bands[k % 2] : black);
    }
    world.colliders.push({ type: 'circle', x: q.x, z: q.z, r: 0.55 });
  });
  tyres.computeBoundingSphere();
  scene.add(tyres);

  // ---- lights around the circuit: posts on the outer edge joined by bulb strands ----
  const outer = inner === left ? right : left;
  const postMat = std(0x3d2a1c);
  const tops = [];
  const every = Math.round(12 / segLen);
  for (let i = 0; i < N; i += every) {
    const p = outer[i].clone().addScaledVector(outer[i].clone().sub(pts[i]).normalize(), 1.9);
    if (p.x > -49 && Math.abs(p.z - PIT_Z) < 4.5) continue;
    scene.add(beam(V(p.x, 0, p.z), V(p.x, 4.2, p.z), 0.07, postMat));
    world.colliders.push({ type: 'circle', x: p.x, z: p.z, r: 0.15 });
    tops.push(V(p.x, 4.2, p.z));
  }
  for (let i = 0; i < tops.length; i++) lights.addStrand(tops[i], tops[(i + 1) % tops.length], { sag: 0.7, palette: i % 2 ? WARM_PALETTE : undefined });
  warm(scene, S.x, 4.5, S.z, 60, 22);
  warm(scene, -61, 4.5, 26, 50, 22);
  warm(scene, -56, 4.5, 42, 50, 22);
  warm(scene, -56, 4.5, 6, 50, 22);

  // ---- pit canopy in the infield, open towards the east straight ----
  const cx = -52.5;
  const cz = PIT_Z;
  const sand = canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#6b5240';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      c.fillStyle = `rgba(${Math.random() > 0.5 ? '170,140,100' : '40,28,18'},${Math.random() * 0.3})`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
  sand.repeat.set(3, 3);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(10, 11), std(0xffffff, 1, { map: sand, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(cx + 1.5, 0.02, cz);
  scene.add(apron);
  for (const [dx, dz] of [[-3.5, -4.5], [3.5, -4.5], [-3.5, 4.5], [3.5, 4.5]]) {
    scene.add(beam(V(cx + dx, 0, cz + dz), V(cx + dx, 3.4, cz + dz), 0.08, postMat));
    world.colliders.push({ type: 'circle', x: cx + dx, z: cz + dz, r: 0.15 });
  }
  const bunting = canvasTexture(512, 64, (b, w, h) => {
    const cols = ['#ff006e', '#ffbe0b', '#3a86ff', '#06d6a0', '#fb5607'];
    for (let i = 0; i < 12; i++) {
      b.fillStyle = cols[i % 5];
      b.beginPath();
      b.moveTo((i * w) / 12, 0);
      b.lineTo(((i + 1) * w) / 12, 0);
      b.lineTo(((i + 0.5) * w) / 12, h);
      b.fill();
    }
  });
  const canopy = new THREE.Mesh(new THREE.PlaneGeometry(8, 10), std(0xffffff, 0.9, { map: bunting, side: THREE.DoubleSide, transparent: true }));
  canopy.rotation.x = Math.PI / 2;
  canopy.position.set(cx, 3.45, cz);
  scene.add(canopy);
  lights.addStrand(V(cx - 3.5, 3.4, cz - 4.5), V(cx + 3.5, 3.4, cz - 4.5), { sag: 0.3 });
  lights.addStrand(V(cx - 3.5, 3.4, cz + 4.5), V(cx + 3.5, 3.4, cz + 4.5), { sag: 0.3 });
  lights.addStrand(V(cx - 3.5, 3.4, cz - 4.5), V(cx - 3.5, 3.4, cz + 4.5), { sag: 0.4, palette: WARM_PALETTE });
  lights.addStrand(V(cx + 3.5, 3.4, cz - 4.5), V(cx + 3.5, 3.4, cz + 4.5), { sag: 0.4, palette: WARM_PALETTE });
  warm(scene, cx, 3, cz, 60, 18);
  sign(scene, 'Pit Lane', tk('Press E at a car', 'Walk to a car and tap the button'), '#13306b', cx - 3.9, 2.6, cz, Math.PI / 2, 3);

  return {
    spawns: [
      { x: cx - 1.2, z: cz - 3.2, heading: Math.PI / 2, color: 0xe63946 },
      { x: cx - 1.2, z: cz, heading: Math.PI / 2, color: 0x3a86ff },
      { x: cx - 1.2, z: cz + 3.2, heading: Math.PI / 2, color: 0x06d6a0 },
    ],
    callSpot: V(cx - 5.2, 0, cz + 3),
    track: { points: pts, start: i0, length: curve.getLength() },
  };
}
