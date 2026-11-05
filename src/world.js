import * as THREE from 'three';
import { createWater } from './water.js';
import { canvasTexture, hdr, rand, beam, setLayer, WARM_PALETTE } from './utils.js';
import { collide, collideFlying } from './physics.js';
import { StringLights } from './stringLights.js';
import { Garlands } from './garlands.js';
import { Diyas } from './diyas.js';
import { createStall, signTexture, STALL } from './stalls.js';
import { FerrisWheel } from './ferrisWheel.js';
import { mergeStatic, freezeStatic, mergeAdded } from './merge.js';
import { seg } from './lod.js';
import { slot } from './personalSlots.js';
import { themedGoods } from './stallThemes.js';
import { buildFestive } from './festive.js';

/*
  Layout (metres, +z towards the entrance):
    gate z=58 → bazaar z 47..17 → the chowk (deepstambh) at origin → cross path z=-18
    (giant wheel west, fireworks field east) → ghat steps at z=-44 → river.
*/
export const SITES = {
  gate: new THREE.Vector3(0, 0, 58),
  plaza: new THREE.Vector3(0, 0, 0),
  wheel: new THREE.Vector3(-34, 0, -26),
  fireworks: new THREE.Vector3(36, 0, -30),
  ghat: new THREE.Vector3(0, 0, -44),
  games: new THREE.Vector3(29, 0, 0), // booths line x = 29, z 14..41
  carousel: new THREE.Vector3(-26, 0, 30),
  temple: new THREE.Vector3(-18, 0, -37),
  airfield: new THREE.Vector3(52, 0, 22), // runway runs along z, hangar and helipad to the east
  cars: new THREE.Vector3(-50, 0, 22), // Chakri Cars: an oval dirt track west of the carousel
  ramleela: new THREE.Vector3(-30, 0, 64), // open-air screen west of the gate, facing the mela
  selfie: new THREE.Vector3(17, 0, 56), // Selfie Point east of the gate
};

/** Structures tall enough to matter to the Pushpak Viman: {collider, h = height}. */
const TALL = [
  { type: 'circle', x: SITES.wheel.x, z: SITES.wheel.z, r: 15.6, h: 33 },
  { type: 'box', minX: -9.4, maxX: -6.6, minZ: SITES.gate.z - 1.4, maxZ: SITES.gate.z + 1.4, h: 14 },
  { type: 'box', minX: 6.6, maxX: 9.4, minZ: SITES.gate.z - 1.4, maxZ: SITES.gate.z + 1.4, h: 14 },
  { type: 'box', minX: -7, maxX: 7, minZ: SITES.gate.z - 0.8, maxZ: SITES.gate.z + 0.8, h: 10.2 },
  { type: 'box', minX: SITES.temple.x - 2.6, maxX: SITES.temple.x + 3.4, minZ: SITES.temple.z - 2.6, maxZ: SITES.temple.z + 2.6, h: 11 },
  { type: 'circle', x: SITES.carousel.x, z: SITES.carousel.z, r: 7.2, h: 7.6 },
];

const BOUNDS = { minX: -70, maxX: 70, minZ: -50.3, maxZ: 78 };

/** Walkable height: flat ground everywhere except the ghat steps down to the river. */
function groundHeight(x, z) {
  if (z >= -44 || Math.abs(x) > 42) return 0; // past the ends of the steps: the stone quay
  const step = Math.min(6, Math.floor((-44 - z) / 1.3));
  return -0.3 * step;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

const LEFT_STALLS = [
  { name: 'Mithai Mahal', sub: 'Laddoo · Barfi · Kaju Katli', c1: '#e0218a', c2: '#ffd166', trim: '#ffe9a8', goods: 'mithai', sign: '#7a0f45' },
  { name: 'Jalebi Junction', sub: 'Garam garam, fresh!', c1: '#ff7a00', c2: '#fff1d0', trim: '#c1121f', goods: 'jalebi', sign: '#8a2c00' },
  { name: 'Pani Puri Point', sub: 'Teekha · Meetha · Jaljeera', c1: '#1f9d55', c2: '#fff1d0', trim: '#ffd166', goods: 'panipuri', sign: '#0d4f2b' },
  { name: 'Kulfi Corner', sub: 'Malai · Kesar · Pista', c1: '#3a86ff', c2: '#ffffff', trim: '#ffd166', goods: 'kulfi', sign: '#13306b' },
];
const RIGHT_STALLS = [
  { name: 'Diya Bazaar', sub: 'Hand-made clay diyas', c1: '#c1121f', c2: '#ffb703', trim: '#fff1d0', goods: 'diyas', sign: '#5c0a10' },
  { name: 'Kandeel House', sub: 'Lanterns for every home', c1: '#7b2cbf', c2: '#ffd166', trim: '#ff8fab', goods: 'lanterns', sign: '#3c1361' },
  { name: 'Choodi Gali', sub: 'Bangles & bindis', c1: '#ff006e', c2: '#8338ec', trim: '#ffd166', goods: 'bangles', sign: '#5a0a3a' },
  { name: 'Gubbare & Khilone', sub: 'Balloons and toys', c1: '#0f7c8c', c2: '#ffbe0b', trim: '#ffffff', goods: 'toys', sign: '#08414a' },
];

export function buildWorld(scene, { reflectionScale = 0.5 } = {}) {
  const ctx = {
    scene,
    reflectionScale,
    lights: new StringLights(scene),
    garlands: new Garlands(scene),
    diyas: new Diyas(scene),
    floating: new Diyas(scene, { floating: true }),
    poles: [],
    colliders: [],
    updaters: [],
    stalls: [],
    live: new Set(), // world meshes that move or change: kept out of the static merge
  };
  const before = new Set(scene.children);

  buildGround(ctx);
  buildGate(ctx);
  buildBazaar(ctx);
  buildPlaza(ctx);
  buildLanes(ctx);
  buildFireworksField(ctx);
  buildGhat(ctx);
  buildSideAreas(ctx);
  mergeWorld(ctx, before);

  const wheel = new FerrisWheel(scene, SITES.wheel);
  ctx.colliders.push(...wheel.colliders);

  ctx.poleAt = (x, z, h) => pole(ctx, x, z, h);
  const stillDiyas = buildFestive(ctx, { site: SITES });

  buildPoles(ctx);
  ctx.lights.build();
  ctx.garlands.build();
  ctx.diyas.build();
  ctx.floating.build();
  stillDiyas.build();

  return {
    colliders: ctx.colliders,
    stalls: ctx.stalls,
    diyas: ctx.diyas,
    wheel,
    water: ctx.water,
    bounds: BOUNDS,
    tall: TALL,
    groundHeight,
    collide: (p, r) => collide(ctx.colliders, BOUNDS, p, r),
    collideFlying: (p, r, y) => collideFlying(ctx.colliders, TALL, p, r, y),
    update(dt, t) {
      ctx.lights.update(t);
      ctx.diyas.update(t);
      ctx.floating.update(t);
      wheel.update(dt, t);
      for (const s of ctx.stalls) s.keeper.update(dt);
      for (const u of ctx.updaters) u(dt, t);
    },
  };
}

// ---------- helpers ----------

/**
 * Folds the loose static meshes the builders above dropped into the scene (gate boxes, field posts,
 * ghat steps, lamps...) into one mesh per material look per 40 m cell: far fewer draw calls in the
 * main pass, the shadow pass and the river reflection, while regions still get culled.
 */
function mergeWorld(ctx, before) {
  mergeAdded(ctx.scene, before, { live: ctx.live, cell: 40 });
}

/** Registers a decorated light pole (drawn later as one instanced mesh) and returns its top. */
function pole(ctx, x, z, h) {
  ctx.poles.push({ x, z, h });
  ctx.colliders.push({ type: 'circle', x, z, r: 0.15 });
  return V(x, h, z);
}

function buildPoles(ctx) {
  const n = ctx.poles.length;
  const shaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 1, 8).translate(0, 0.5, 0), std(0x5a3b26, 0.8), n);
  const cap = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, seg(10, 8), seg(8, 5)), std(0xd4a017, 0.3, { metalness: 0.7 }), n);
  const m = new THREE.Matrix4();
  ctx.poles.forEach((p, i) => {
    shaft.setMatrixAt(i, m.makeScale(1, p.h, 1).setPosition(p.x, 0, p.z));
    cap.setMatrixAt(i, m.makeTranslation(p.x, p.h + 0.1, p.z));
  });
  shaft.computeBoundingSphere();
  cap.computeBoundingSphere();
  ctx.scene.add(shaft, cap);
}

function warmLight(scene, x, y, z, intensity, distance, color = 0xffb46b) {
  const l = new THREE.PointLight(color, intensity, distance, 2);
  l.position.set(x, y, z);
  scene.add(l);
  return l;
}

// ---------- ground ----------

function buildGround({ scene }) {
  const dirt = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4a3526';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const light = Math.random() > 0.5;
      ctx.fillStyle = light ? `rgba(130,98,66,${Math.random() * 0.35})` : `rgba(25,16,10,${Math.random() * 0.35})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  });
  dirt.wrapS = dirt.wrapT = THREE.RepeatWrapping;
  dirt.repeat.set(60, 34);
  const groundMat = std(0xffffff, 1, { map: dirt });

  const main = new THREE.Mesh(new THREE.PlaneGeometry(600, 344), groundMat);
  main.rotation.x = -Math.PI / 2;
  main.position.z = 128; // covers z 300 → -44, stopping at the ghat steps
  scene.add(main);

  const farBank = new THREE.Mesh(new THREE.PlaneGeometry(600, 300), groundMat);
  farBank.rotation.x = -Math.PI / 2;
  farBank.position.z = -310;
  scene.add(farBank);
  const bankEdge = new THREE.Mesh(new THREE.BoxGeometry(600, 2, 3), groundMat);
  bankEdge.position.set(0, -0.9, -161.5);
  scene.add(bankEdge);

  const sand = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a6a48';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '200,170,130' : '60,40,25'},${Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
  const pathMat = (rx, ry) => {
    const t = sand.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return std(0xffffff, 1, { map: t, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  };
  const walkway = new THREE.Mesh(new THREE.PlaneGeometry(9, 124), pathMat(2, 28));
  walkway.rotation.x = -Math.PI / 2;
  walkway.position.set(0, 0.02, 18);
  scene.add(walkway);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(90, 7), pathMat(20, 2));
  cross.rotation.x = -Math.PI / 2;
  cross.position.set(0, 0.04, -18);
  scene.add(cross);
}

// ---------- entrance gate ----------

function buildGate(ctx) {
  const { scene, lights, garlands, colliders } = ctx;
  const z = SITES.gate.z;
  const maroon = std(0x7a1424, 0.6);
  const gold = std(0xd4a017, 0.3, { metalness: 0.75 });
  const cream = std(0xf3e3c3, 0.7);
  const box = (w, h, d, mat, x, y, zz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, zz);
    scene.add(m);
    return m;
  };

  for (const s of [-1, 1]) {
    const x = s * 8;
    box(1.8, 10, 1.8, maroon, x, 5, z);
    box(2.4, 0.8, 2.4, cream, x, 0.4, z);
    box(2.4, 0.35, 2.4, gold, x, 10.17, z);
    for (const dx of [-0.95, 0.95]) for (const dz of [-0.95, 0.95]) scene.add(beam(V(x + dx, 10.35, z + dz), V(x + dx, 11.8, z + dz), 0.08, cream));
    box(2.5, 0.2, 2.5, gold, x, 11.85, z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), cream);
    dome.position.set(x, 11.95, z);
    scene.add(dome);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 8), gold);
    finial.position.set(x, 13.25, z);
    scene.add(finial);

    for (const dx of [-0.92, 0.92]) lights.addPolyline([V(x + dx, 0.8, z + 0.92), V(x + dx, 10, z + 0.92)], { spacing: 0.4, palette: WARM_PALETTE, mode: 'chase' });
    garlands.addDrop(V(x, 9.7, z + 0.96), 8.6);
    colliders.push({ type: 'box', minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.2, maxZ: z + 1.2 });
  }

  box(14.4, 2.4, 1.3, maroon, 0, 8.6, z);
  box(14.6, 0.18, 1.4, gold, 0, 9.85, z);
  box(14.6, 0.18, 1.4, gold, 0, 7.35, z);

  const gateSign = (title, sub) =>
    canvasTexture(1240, 200, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#9c1a2e');
      g.addColorStop(1, '#5e0d1b');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ffd166';
      c.shadowColor = 'rgba(255,150,40,0.8)';
      c.shadowBlur = 18;
      // personal text can be longer than the stock lines: shrink to fit the arch
      const fit = (text, size, font, y) => {
        do c.font = font(size);
        while (c.measureText(text).width > w - 70 && (size -= 2) > 20);
        c.fillText(text, w / 2, y);
      };
      fit(title, 72, (n) => `${n}px "Yatra One", serif`, h * 0.36);
      fit(sub, 46, (n) => `600 ${n}px Poppins, sans-serif`, h * 0.76);
    });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.1), new THREE.MeshBasicMaterial({ map: gateSign(slot('gate.title'), `✦  ${slot('gate.subtitle')}  ✦`), color: new THREE.Color(1, 1, 1) }));
  front.position.set(0, 8.6, z + 0.66);
  scene.add(front);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.1), new THREE.MeshBasicMaterial({ map: gateSign('फिर मिलेंगे!', slot('gate.back')), color: new THREE.Color(1, 1, 1) }));
  back.position.set(0, 8.6, z - 0.66);
  back.rotation.y = Math.PI;
  scene.add(back);

  const arc = new THREE.Mesh(new THREE.TorusGeometry(7, 0.18, 8, 48, Math.PI), gold);
  arc.scale.y = 0.37;
  arc.position.set(0, 4.6, z + 0.5);
  scene.add(arc);
  const arcPts = [];
  for (let k = 0; k <= 40; k++) {
    const th = (Math.PI * k) / 40;
    arcPts.push(V(7 * Math.cos(th), 4.6 + 2.6 * Math.sin(th), z + 0.7));
  }
  lights.addPolyline(arcPts, { spacing: 0.35, mode: 'chase' });
  lights.addPolyline([V(-7.2, 9.98, z + 0.7), V(7.2, 9.98, z + 0.7)], { spacing: 0.35, palette: WARM_PALETTE, mode: 'twinkle' });
  for (let k = 0; k < 5; k++) garlands.addSwag(V(-7 + 2.8 * k, 7.25, z + 0.72), V(-7 + 2.8 * (k + 1), 7.25, z + 0.72), 0.6);

  warmLight(scene, 0, 6, z + 4, 90, 28);

  // welcome rows of diyas along the entrance path
  for (let zz = z + 4; zz < z + 18; zz += 0.9) for (const x of [-4.4, 4.4]) ctx.diyas.add(x, 0.02, zz);
}

// ---------- bazaar ----------

function buildBazaar(ctx) {
  const { scene, lights, garlands, diyas, colliders } = ctx;
  const { D, W } = STALL;
  for (let k = 0; k < 4; k++) {
    const z = 47 - k * 10;
    for (const side of [-1, 1]) {
      const base = side < 0 ? LEFT_STALLS[k] : RIGHT_STALLS[k];
      // a creator's mela may rename the stall and (shop stalls) stock it for their niche
      const def = { ...base, name: slot(`stall.${base.goods}.title`), sub: slot(`stall.${base.goods}.sub`) };
      const theme = slot(`stall.${base.goods}.theme`);
      const stall = createStall(def, theme ? themedGoods(theme, 0x9e37 + k * 2 + (side > 0)) : null);
      const g = stall.group;
      g.position.set(side * 9.2, 0, z);
      g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      scene.add(g);
      g.updateMatrixWorld(true);
      const w = (v) => g.localToWorld(v.clone());

      stall.diyaSpots.forEach((p) => {
        const q = w(p);
        diyas.add(q.x, q.y, q.z);
      });
      stall.strands.forEach(([a, b, sag]) => lights.addStrand(w(a), w(b), { sag, spacing: 0.32, wire: sag > 0 }));
      garlands.addSwag(w(stall.garland[0]), w(stall.garland[1]), 0.25);
      colliders.push({ type: 'box', minX: side * 9.2 - D / 2, maxX: side * 9.2 + D / 2, minZ: z - W / 2 - 0.3, maxZ: z + W / 2 + 0.3 });
      setLayer(g, 1);
      ctx.stalls.push({
        def,
        group: g,
        keeper: stall.keeper,
        sign: stall.sign,
        diyaSpots: stall.diyaSpots.map(w),
        stand: w(new THREE.Vector3(0, 0, D / 2 + 1.1)), // where a customer stands
        center: w(new THREE.Vector3(0, 0, D / 2 - 0.45)), // the counter
      });
    }
    warmLight(scene, 0, 4.5, z, 80, 18);
  }
}

// ---------- the chowk ----------

function buildPlaza(ctx) {
  const { scene, lights, diyas } = ctx;

  const stone = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#7d6a58';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(40,28,20,0.6)';
    c.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      c.beginPath();
      c.moveTo(0, i * 64);
      c.lineTo(w, i * 64);
      c.stroke();
      c.beginPath();
      c.moveTo(i * 64, 0);
      c.lineTo(i * 64, h);
      c.stroke();
    }
    for (let i = 0; i < 3000; i++) {
      c.fillStyle = `rgba(${Math.random() > 0.5 ? '180,160,140' : '40,30,20'},0.15)`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
  stone.repeat.set(7, 7);
  const paving = new THREE.Mesh(new THREE.CircleGeometry(13.5, 64), std(0xffffff, 0.95, { map: stone, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  paving.rotation.x = -Math.PI / 2;
  paving.position.y = 0.04;
  scene.add(paving);

  // the centrepiece: a two-tier stone chabutra with a deepstambh (a lamp pillar ringed with diya
  // trays). One material, so the whole thing merges into a single draw call with its cell.
  const sand = std(0xcdb08a, 0.85);
  const piece = (geo, y) => {
    const m = new THREE.Mesh(geo, sand);
    m.position.y = y;
    scene.add(m);
  };
  piece(new THREE.CylinderGeometry(2.4, 2.6, 0.36, seg(40, 24)), 0.18);
  piece(new THREE.CylinderGeometry(1.5, 1.6, 0.3, seg(32, 20)), 0.51);
  piece(new THREE.CylinderGeometry(0.16, 0.26, 2.0, seg(14, 10)), 1.66);
  const trays = [[1.05, 0.62], [1.5, 0.46], [1.95, 0.32], [2.45, 0.2]];
  for (const [y, r] of trays) piece(new THREE.CylinderGeometry(r, r * 0.8, 0.07, seg(20, 12)), y);
  for (const [y, r] of trays) {
    const n = Math.round(r * 22);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      diyas.add(Math.cos(a) * (r - 0.06), y + 0.04, Math.sin(a) * (r - 0.06));
    }
  }
  for (let i = 0; i < 28; i++) {
    const a = ((i + 0.5) / 28) * Math.PI * 2;
    diyas.add(Math.cos(a) * 2.3, 0.36, Math.sin(a) * 2.3);
  }
  ctx.colliders.push({ type: 'circle', x: 0, z: 0, r: 2.7 });

  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    diyas.add(Math.cos(a) * 5.4, 0.05, Math.sin(a) * 5.4);
  }
  for (let i = 0; i < 48; i++) {
    const a = ((i + 0.5) / 48) * Math.PI * 2;
    diyas.add(Math.cos(a) * 6.0, 0.05, Math.sin(a) * 6.0);
  }

  // poles around the chowk with a star of light strands overhead
  const N = 10;
  const tops = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2; // no pole lands on the walkway (x = 0)
    tops.push(pole(ctx, Math.cos(a) * 12.8, Math.sin(a) * 12.8, 7));
  }
  for (let i = 0; i < N; i++) {
    lights.addStrand(tops[i], tops[(i + 1) % N], { sag: 0.5 });
    if (i < N / 2) lights.addStrand(tops[i], tops[i + N / 2], { sag: 2.6, spacing: 0.6 });
  }

  // hanging star lantern (akash kandil) above the deepstambh
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 1;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  starGeo.center();
  const star = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: hdr(0xff6a1c, 2.4) }));
  star.position.set(0, 4.0, 0);
  scene.add(star);
  ctx.live.add(star);
  ctx.updaters.push((dt, t) => {
    star.rotation.y = t * 0.4;
    star.position.y = 4.0 + Math.sin(t * 0.8) * 0.05;
  });
  warmLight(scene, 0, 6, 0, 70, 30, 0xffa860);
}

// ---------- lanes of light poles ----------

function buildLanes(ctx) {
  const { lights } = ctx;
  const lane = (zs, open = -1) => {
    const L = zs.map((z) => pole(ctx, -5.6, z, 5.5));
    const R = zs.map((z) => pole(ctx, 5.6, z, 5.5));
    for (let i = 0; i < zs.length; i++) {
      if (i !== open) lights.addStrand(L[i], R[i], { sag: 0.8 }); // (open: nothing across the front of the Mela Screen)
      if (i + 1 < zs.length) {
        lights.addStrand(L[i], L[i + 1], { sag: 0.5 });
        lights.addStrand(R[i], R[i + 1], { sag: 0.5 });
        if (i === open) continue; // no criss-cross here: the Mela Screen hangs in this bay
        lights.addStrand(L[i], R[i + 1], { sag: 1.1 });
        lights.addStrand(R[i], L[i + 1], { sag: 1.1 });
      }
    }
  };
  lane([53, 43, 33, 23, 15], 0);
  lane([-14, -24, -34]);

  // along the cross path to the wheel and the fireworks field
  for (const s of [-1, 1]) {
    for (const zEdge of [-14.2, -21.8]) {
      const tops = [10, 18, 26].map((x) => pole(ctx, s * x, zEdge, 4.5));
      for (let i = 1; i < tops.length; i++) lights.addStrand(tops[i - 1], tops[i], { sag: 0.5 });
    }
  }
}

// ---------- fireworks field ----------

function buildFireworksField(ctx) {
  const { scene, lights, colliders } = ctx;
  const c = SITES.fireworks;
  const half = 8;

  const patch = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), std(0x2a2019, 1, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(c.x, 0.03, c.z);
  scene.add(patch);

  const postMat = std(0xeeeeee, 0.6);
  const corners = [V(c.x - half, 0, c.z - half), V(c.x + half, 0, c.z - half), V(c.x + half, 0, c.z + half), V(c.x - half, 0, c.z + half)];
  const rope = [];
  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    for (let k = 0; k < 8; k++) {
      const p = a.clone().lerp(b, k / 8);
      const q = a.clone().lerp(b, (k + 1) / 8);
      scene.add(beam(V(p.x, 0, p.z), V(p.x, 1, p.z), 0.05, postMat));
      rope.push(V(p.x, 0.9, p.z), V(q.x, 0.9, q.z));
    }
  }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rope), new THREE.LineBasicMaterial({ color: 0xff3b3b })));

  const tubeMat = std(0x2d4a2b, 0.7);
  for (let i = 0; i < 12; i++) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.6, 12, 1, true), tubeMat);
    tube.position.set(c.x + rand(-5, 5), 0.3, c.z + rand(-5, 5));
    tube.rotation.set(rand(-0.15, 0.15), 0, rand(-0.15, 0.15));
    scene.add(tube);
  }

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 1.05),
    new THREE.MeshBasicMaterial({ map: signTexture(slot('sign.fireworks'), slot('sign.fireworks.sub'), '#4a0d0d'), color: new THREE.Color(1, 1, 1) })
  );
  sign.position.set(c.x, 1.9, c.z + half + 0.4);
  scene.add(sign);
  for (const dx of [-1.7, 1.7]) scene.add(beam(V(c.x + dx, 0, c.z + half + 0.38), V(c.x + dx, 2.4, c.z + half + 0.38), 0.05, std(0x3d2a1c)));

  lights.addPolyline([V(c.x - half, 1, c.z + half), V(c.x + half, 1, c.z + half)], { spacing: 0.5, palette: [0xff3030, 0xffffff], mode: 'alternate' });
  colliders.push({ type: 'box', minX: c.x - half, maxX: c.x + half, minZ: c.z - half, maxZ: c.z + half });
}

// ---------- river ghat ----------

function buildGhat(ctx) {
  const { scene, lights, diyas, floating, garlands, colliders } = ctx;
  const stone = std(0x9a8670, 0.95);

  for (let i = 0; i < 7; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(84, 0.3, 1.3), stone);
    step.position.set(0, -0.15 - i * 0.3, -44.65 - i * 1.3);
    scene.add(step);
  }
  // past both ends of the steps the bank is a stone quay down to the water, so the ground doesn't
  // stop in mid-air there and the boat has a real edge to bump into. Walkers stop at its lip and
  // can't step off the end of a step onto it (or into the void).
  for (const s of [-1, 1]) {
    const quay = new THREE.Mesh(new THREE.BoxGeometry(258, 2, 5.4), stone);
    quay.position.set(s * 171, -1, -46.7);
    scene.add(quay);
    colliders.push({ type: 'box', minX: s > 0 ? 42 : -80, maxX: s > 0 ? 80 : -42, minZ: -60, maxZ: -49.4 });
    colliders.push({ type: 'box', minX: s * 42 - 0.15, maxX: s * 42 + 0.15, minZ: -53.2, maxZ: -45.95 });
  }

  const water = createWater(scene, { resolution: ctx.reflectionScale });
  ctx.water = water;
  ctx.updaters.push((dt, t) => water.update(t));

  // the waterline laps against the riser of the fourth step
  const foamTex = canvasTexture(1024, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w;
      const yy = h * 0.5 + (Math.random() - 0.5) * h * 0.6;
      const r = 2 + Math.random() * 7;
      const g = c.createRadialGradient(x, yy, 0, x, yy, r);
      g.addColorStop(0, 'rgba(235,240,255,0.55)');
      g.addColorStop(1, 'rgba(235,240,255,0)');
      c.fillStyle = g;
      c.fillRect(x - r, yy - r, r * 2, r * 2);
    }
  });
  foamTex.wrapS = THREE.RepeatWrapping;
  foamTex.repeat.set(6, 1);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(84, 0.9), new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.35, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, -1.34, -50.95);
  foam.renderOrder = 2;
  scene.add(foam);
  ctx.live.add(foam);
  ctx.updaters.push((dt, t) => {
    foam.position.z = -50.95 + Math.sin(t * 0.9) * 0.12;
    foam.material.opacity = 0.28 + 0.14 * Math.sin(t * 0.9 + 1.2);
    foamTex.offset.x = t * 0.004;
  });

  // lamp posts along the top of the ghat
  const lampMat = new THREE.MeshBasicMaterial({ color: hdr(0xffc46b, 1.6) });
  for (const s of [-1, 1]) {
    const tops = [6, 14, 22, 30].map((x) => {
      const top = pole(ctx, s * x, -42.6, 4);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, seg(12, 8), seg(10, 6)), lampMat);
      lamp.position.set(top.x, top.y + 0.35, top.z);
      scene.add(lamp);
      return top;
    });
    for (let i = 1; i < tops.length; i++) lights.addStrand(tops[i - 1], tops[i], { sag: 0.6, palette: WARM_PALETTE, mode: 'twinkle' });
  }
  lights.addStrand(V(-6, 4, -42.6), V(6, 4, -42.6), { sag: 0.9, palette: WARM_PALETTE, mode: 'chase' });
  warmLight(scene, -14, 4, -41, 60, 25);
  warmLight(scene, 14, 4, -41, 60, 25);

  for (let x = -38; x <= 38; x += 1.2) diyas.add(x, 0, -44.2);
  for (let i = 0; i < 160; i++) floating.add(rand(-50, 50), -1.33, rand(-53, -95));

  // the ghat's own signboard at the top of the steps, west of the walkway (the boat jetty's is east)
  const gs = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.9), new THREE.MeshBasicMaterial({ map: signTexture(slot('sign.ghat'), slot('sign.ghat.sub'), '#13306b'), color: new THREE.Color(1, 1, 1), side: THREE.DoubleSide }));
  gs.position.set(-10, 2.3, -43.3);
  scene.add(gs);
  for (const dx of [-1.45, 1.45]) {
    scene.add(beam(V(-10 + dx, 0, -43.32), V(-10 + dx, 2.75, -43.32), 0.05, std(0x3d2a1c)));
    colliders.push({ type: 'circle', x: -10 + dx, z: -43.32, r: 0.12 });
  }

  buildTemple(ctx, -18, -37);
}

function buildTemple(ctx, x, z) {
  const { scene, lights, garlands, diyas, colliders } = ctx;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.PI / 2; // faces the walkway (+x)
  scene.add(g);
  const cream = std(0xf1e2c4, 0.75);
  const sandstone = std(0xe8d0a8, 0.8);
  const gold = std(0xd4a017, 0.3, { metalness: 0.8 });
  const add = (geo, mat, px, py, pz) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    g.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(5, 0.8, 5), sandstone, 0, 0.4, 0);
  add(new THREE.BoxGeometry(2, 0.4, 0.8), sandstone, 0, 0.2, 2.9);
  add(new THREE.BoxGeometry(3.2, 3, 3.2), cream, 0, 2.3, 0);
  add(new THREE.PlaneGeometry(1.2, 1.9), new THREE.MeshBasicMaterial({ color: hdr(0xffa040, 1.6) }), 0, 1.75, 1.61);
  for (const px of [-1.9, 1.9]) add(new THREE.CylinderGeometry(0.14, 0.16, 3, 12), cream, px, 2.3, 2.1);
  add(new THREE.BoxGeometry(4.2, 0.3, 1.2), cream, 0, 3.9, 2.0);

  const shikhara = add(new THREE.ConeGeometry(2.1, 4.2, 8), std(0xf0d9a8, 0.8), 0, 5.9, 0);
  shikhara.rotation.y = Math.PI / 8;
  for (const [y, r] of [[4.6, 1.75], [5.6, 1.25], [6.6, 0.78]]) {
    const band = add(new THREE.TorusGeometry(r, 0.07, 6, 24), gold, 0, y, 0);
    band.rotation.x = Math.PI / 2;
  }
  const amalaka = add(new THREE.SphereGeometry(0.42, 16, 10), sandstone, 0, 8.05, 0);
  amalaka.scale.y = 0.5;
  add(new THREE.SphereGeometry(0.2, 12, 10), gold, 0, 8.4, 0);
  add(new THREE.ConeGeometry(0.1, 0.35, 8), gold, 0, 8.7, 0);

  add(new THREE.CylinderGeometry(0.025, 0.025, 1.8, 6), gold, 0, 9.3, 0);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(1.1, -0.3);
  flagShape.lineTo(0, -0.6);
  const flag = add(new THREE.ShapeGeometry(flagShape), new THREE.MeshStandardMaterial({ color: 0xff7a00, side: THREE.DoubleSide, emissive: 0x4a1a00 }), 0, 10.15, 0);
  ctx.updaters.push((dt, t) => {
    flag.rotation.y = Math.sin(t * 1.3) * 0.35;
  });

  g.updateMatrixWorld(true);
  const w = (v) => g.localToWorld(v.clone());
  const apex = w(V(0, 8.0, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    lights.addPolyline([w(V(Math.sin(a) * 2.1, 3.8, Math.cos(a) * 2.1)), apex], { spacing: 0.3, palette: WARM_PALETTE, mode: 'chase' });
  }
  garlands.addSwag(w(V(-0.7, 2.75, 1.65)), w(V(0.7, 2.75, 1.65)), 0.3);
  for (let i = 0; i < 9; i++) {
    const p = w(V(-2.2 + i * 0.55, 0.8, 2.35));
    diyas.add(p.x, p.y, p.z);
  }
  colliders.push({ type: 'box', minX: x - 2.6, maxX: x + 3.4, minZ: z - 2.6, maxZ: z + 2.6 });
  mergeStatic(g, { skip: (o) => o === flag });
  freezeStatic(g, (o) => o === flag);
}

// ---------- side areas: games lane (east) and carousel ground (west) ----------

function buildSideAreas(ctx) {
  const { scene } = ctx;
  const sand = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#7a5c40';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      c.fillStyle = `rgba(${Math.random() > 0.5 ? '190,160,120' : '50,35,22'},${Math.random() * 0.3})`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
  const flat = (geo, x, z, rx, ry) => {
    const t = sand.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    const m = new THREE.Mesh(geo, std(0xffffff, 1, { map: t, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.025, z);
    scene.add(m);
  };
  flat(new THREE.PlaneGeometry(18, 40), 24, 27, 4, 9); // Khel Gali (games lane)
  flat(new THREE.CircleGeometry(10.5, 48), SITES.carousel.x, SITES.carousel.z, 5, 5);

}
