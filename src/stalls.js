import * as THREE from 'three';
import { canvasTexture, hdr, rand, pick } from './utils.js';
import { Character, randomLook } from './character.js';
import { mergeStatic } from './merge.js';
import { seg } from './lod.js';

export const STALL = { W: 5.2, D: 3.6, H: 2.9 };
const TOP = 1.22; // counter surface height

const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

const MAT = {
  wood: std(0x6b3f22, 0.8),
  pole: std(0x3d2a1c),
  plate: std(0xc9a34a, 0.3, { metalness: 0.8 }),
  clay: std(0xa8532a, 0.9),
  bulb: new THREE.MeshBasicMaterial({ color: hdr(0xffd08a, 4) }),
};
// built on first use: the segment counts depend on the tier, known only after detection
let GEO = null;
const geo = () =>
  (GEO ??= {
    plate: new THREE.CylinderGeometry(0.3, 0.26, 0.03, seg(24, 14)),
    pole: new THREE.CylinderGeometry(0.06, 0.06, STALL.H, 8),
    bulb: new THREE.SphereGeometry(0.09, seg(10, 6), seg(8, 5)),
  });

// ---------- textures ----------

const stripeCache = new Map();
export function stripes(c1, c2, n = 8) {
  const key = `${c1}${c2}${n}`;
  if (!stripeCache.has(key)) {
    stripeCache.set(
      key,
      canvasTexture(256, 256, (ctx, w, h) => {
        const s = w / n;
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = i % 2 ? c2 : c1;
          ctx.fillRect(i * s, 0, s + 1, h);
        }
        ctx.globalAlpha = 0.07;
        for (let i = 0; i < 3000; i++) {
          ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
          ctx.fillRect(Math.random() * w, Math.random() * h, 1, 2);
        }
      })
    );
  }
  return stripeCache.get(key);
}

function valanceTexture(c1, c2, trim) {
  return canvasTexture(512, 96, (ctx, w, h) => {
    const n = 8;
    const sw = w / n;
    const band = h * 0.42;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? c2 : c1;
      ctx.beginPath();
      ctx.moveTo(i * sw, 0);
      ctx.lineTo((i + 1) * sw, 0);
      ctx.lineTo((i + 1) * sw, band);
      ctx.arc((i + 0.5) * sw, band, sw / 2, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = trim;
      for (let k = 0; k < 7; k++) {
        const a = (Math.PI * (k + 0.5)) / 7;
        ctx.beginPath();
        ctx.arc((i + 0.5) * sw + Math.cos(a) * (sw / 2 - 7), band + Math.sin(a) * (sw / 2 - 7), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = trim;
    ctx.fillRect(0, 0, w, 8);
  });
}

export function signTexture(title, sub, bg, fg = '#ffe7a3', width = 512, height = 144) {
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, h - 12, 22);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffd166';
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = Math.round(h * 0.38);
    ctx.font = `${size}px "Yatra One", "Poppins", sans-serif`;
    while (ctx.measureText(title).width > w - 50 && size > 20) {
      size -= 2;
      ctx.font = `${size}px "Yatra One", "Poppins", sans-serif`;
    }
    ctx.fillText(title, w / 2, sub ? h * 0.42 : h / 2);
    if (sub) {
      let s2 = Math.round(h * 0.15);
      ctx.font = `600 ${s2}px Poppins, sans-serif`;
      while (ctx.measureText(sub).width > w - 44 && s2 > 10) {
        s2 -= 1;
        ctx.font = `600 ${s2}px Poppins, sans-serif`;
      }
      ctx.globalAlpha = 0.85;
      ctx.fillText(sub, w / 2, h * 0.76);
    }
  });
}

// ---------- goods on the counter ----------

function addGoods(g, type, diyaSpots) {
  const { W, D, H } = STALL;
  const GEO = geo();
  const cz = D / 2 - 0.45;
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  const shelf = (y) => add(new THREE.BoxGeometry(W - 0.6, 0.05, 0.4), MAT.wood, 0, y, -D / 2 + 0.3);

  switch (type) {
    case 'mithai': {
      const laddoo = new THREE.SphereGeometry(0.065, seg(10, 6), seg(8, 5));
      const mats = [0xf2a03d, 0xf7c548, 0xe8e0c8].map((c) => std(c, 0.8));
      [[-1.6, 0], [-0.55, 1], [1.6, 2]].forEach(([px, mi]) => {
        add(GEO.plate, MAT.plate, px, TOP + 0.015, cz);
        [[3, 0], [2, 1], [1, 2]].forEach(([n, layer]) => {
          for (let a = 0; a < n; a++)
            for (let b = 0; b < n; b++)
              add(laddoo, mats[mi], px + (a - (n - 1) / 2) * 0.13, TOP + 0.09 + layer * 0.105, cz + (b - (n - 1) / 2) * 0.13);
        });
      });
      const barfi = new THREE.BoxGeometry(0.12, 0.04, 0.12);
      const pista = std(0xc8e6a0, 0.8);
      const kaju = std(0xf3ead8, 0.4, { metalness: 0.3 });
      add(GEO.plate, MAT.plate, 0.55, TOP + 0.015, cz);
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) add(barfi, (a + b) % 2 ? pista : kaju, 0.55 + (a - 1) * 0.15, TOP + 0.05, cz + (b - 1) * 0.15, 0, Math.PI / 4);
      const box = new THREE.BoxGeometry(0.5, 0.22, 0.32);
      const boxMats = [std(0xe0218a, 0.5), std(0xffd166, 0.4, { metalness: 0.5 }), std(0xc1121f, 0.5)];
      for (const y of [1.6, 2.15]) {
        shelf(y);
        for (let i = 0; i < 6; i++) add(box, boxMats[i % 3], -1.75 + i * 0.7, y + 0.135, -D / 2 + 0.3);
      }
      break;
    }
    case 'jalebi': {
      const kadhai = new THREE.SphereGeometry(0.42, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      add(kadhai, std(0x2a2a2a, 0.35, { metalness: 0.8, side: THREE.DoubleSide }), -1.3, TOP + 0.42, cz - 0.05);
      add(new THREE.CircleGeometry(0.4, 24), std(0x8a5a10, 0.2, { emissive: 0x3a1a00 }), -1.3, TOP + 0.36, cz - 0.05, -Math.PI / 2);
      const jalebi = new THREE.TorusGeometry(0.07, 0.02, seg(6, 4), seg(18, 10));
      const syrup = std(0xff8f1f, 0.3, { emissive: 0x4a1a00 });
      for (let i = 0; i < 5; i++) add(jalebi, syrup, -1.3 + rand(-0.2, 0.2), TOP + 0.37, cz - 0.05 + rand(-0.2, 0.2), Math.PI / 2);
      for (const px of [0.3, 1.4]) {
        add(GEO.plate, MAT.plate, px, TOP + 0.015, cz);
        for (let i = 0; i < 14; i++) {
          const r = rand(0, 0.18);
          const a = rand(0, Math.PI * 2);
          add(jalebi, syrup, px + Math.cos(a) * r, TOP + 0.05 + Math.floor(i / 6) * 0.04, cz + Math.sin(a) * r, Math.PI / 2 + rand(-0.3, 0.3), 0, rand(0, 3));
        }
      }
      break;
    }
    case 'panipuri': {
      add(new THREE.CylinderGeometry(0.42, 0.32, 0.25, 20, 1, true), std(0x9c6b30, 0.9, { side: THREE.DoubleSide }), -1.2, TOP + 0.125, cz);
      const puri = new THREE.SphereGeometry(0.055, seg(10, 6), seg(8, 5));
      puri.scale(1, 0.75, 1);
      const golden = std(0xd9a441, 0.6);
      for (let i = 0; i < 45; i++) {
        const r = Math.sqrt(Math.random()) * 0.32;
        const a = rand(0, Math.PI * 2);
        add(puri, golden, -1.2 + Math.cos(a) * r, TOP + 0.2 + (0.32 - r) * 0.35 + rand(0, 0.04), cz + Math.sin(a) * r, rand(0, 3), rand(0, 3));
      }
      const matka = new THREE.SphereGeometry(0.24, 16, 12);
      for (const px of [0.3, 0.95]) add(matka, MAT.clay, px, TOP + 0.22, cz);
      const cup = new THREE.CylinderGeometry(0.07, 0.05, 0.05, 12);
      const leaf = std(0x3f7d3a, 0.8);
      for (let i = 0; i < 6; i++) add(cup, leaf, 1.5 + (i % 2) * 0.2, TOP + 0.025 + Math.floor(i / 2) * 0.05, cz + rand(-0.1, 0.1));
      break;
    }
    case 'kulfi': {
      add(new THREE.SphereGeometry(0.42, 16, 12), MAT.clay, -1.3, TOP + 0.4, cz - 0.05);
      add(new THREE.CylinderGeometry(0.43, 0.43, 0.25, 20), std(0xc1121f, 0.8), -1.3, TOP + 0.48, cz - 0.05);
      add(new THREE.BoxGeometry(1.8, 0.1, 0.35), MAT.wood, 0.7, TOP + 0.05, cz);
      const cone = new THREE.ConeGeometry(0.045, 0.16, 10);
      const stick = new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5);
      const flavours = [0xfff1c1, 0xf7a6c1, 0xb8e0a0, 0xffc04d].map((c) => std(c, 0.6));
      const wood = std(0xd9b38c);
      for (let r = 0; r < 2; r++)
        for (let i = 0; i < 8; i++) {
          const x = 0.0 + i * 0.2;
          const z = cz - 0.08 + r * 0.16;
          add(stick, wood, x, TOP + 0.16, z);
          add(cone, flavours[(i + r) % 4], x, TOP + 0.3, z);
        }
      break;
    }
    case 'diyas': {
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < 9; i++) diyaSpots.push(new THREE.Vector3(-1.9 + i * 0.475, TOP, cz - 0.2 + r * 0.2));
      for (const y of [1.6, 2.15]) {
        shelf(y);
        for (let i = 0; i < 11; i++) diyaSpots.push(new THREE.Vector3(-2.1 + i * 0.42, y + 0.025, -D / 2 + 0.3));
      }
      break;
    }
    case 'lanterns': {
      const kandeel = new THREE.OctahedronGeometry(0.24, 0);
      kandeel.scale(1, 1.35, 1);
      const tassel = new THREE.ConeGeometry(0.04, 0.18, 6);
      const gold = std(0xffc94a, 0.4, { metalness: 0.5 });
      const colors = [0xff3d6e, 0xffb000, 0x9d4edd, 0x00b4d8, 0xff6d00, 0x70e000, 0xf72585];
      colors.forEach((c, i) => {
        const x = -2.1 + i * 0.7;
        const y = H - 0.55 - (i % 2) * 0.3;
        const z = 0.6 + (i % 3) * 0.25;
        add(kandeel, new THREE.MeshBasicMaterial({ color: hdr(c, 1.7) }), x, y, z, 0, i);
        add(tassel, gold, x, y - 0.42, z, Math.PI);
        add(new THREE.CylinderGeometry(0.006, 0.006, H - y - 0.32, 4), MAT.pole, x, (H + y + 0.32) / 2, z);
      });
      const paper = new THREE.SphereGeometry(0.18, 14, 10);
      paper.scale(1, 1.2, 1);
      [0xff5d8f, 0xffd166, 0x06d6a0, 0xff9f1c, 0xc77dff].forEach((c, i) =>
        add(paper, new THREE.MeshBasicMaterial({ color: hdr(c, 1.3) }), -1.6 + i * 0.8, TOP + 0.22, cz)
      );
      break;
    }
    case 'bangles': {
      const bangle = new THREE.TorusGeometry(0.075, 0.012, seg(6, 4), seg(20, 12));
      const rod = new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6);
      const base = new THREE.CylinderGeometry(0.12, 0.14, 0.04, 14);
      const palette = [0xff006e, 0xffbe0b, 0x3a86ff, 0x8338ec, 0x06d6a0, 0xfb5607, 0xe5e5e5];
      for (let s = 0; s < 6; s++) {
        const x = -1.9 + s * 0.76;
        add(base, MAT.wood, x, TOP + 0.02, cz);
        add(rod, MAT.wood, x, TOP + 0.32, cz);
        const pair = [pick(palette), pick(palette)];
        for (let k = 0; k < 14; k++) {
          const c = pair[Math.floor(k / 3) % 2];
          add(bangle, std(c, 0.25, { metalness: 0.7, emissive: new THREE.Color(c).multiplyScalar(0.15) }), x, TOP + 0.07 + k * 0.035, cz, Math.PI / 2);
        }
      }
      add(new THREE.PlaneGeometry(1.2, 1.6), std(0xdde6f0, 0.05, { metalness: 1 }), 0, 1.9, -D / 2 + 0.05);
      break;
    }
    case 'toys': {
      const balloon = new THREE.SphereGeometry(0.22, seg(14, 10), seg(10, 7));
      balloon.scale(1, 1.18, 1);
      const palette = [0xff006e, 0xffbe0b, 0x3a86ff, 0x8338ec, 0x06d6a0, 0xfb5607, 0xff5d8f];
      const strings = [];
      for (const sx of [-1, 1]) {
        const ax = sx * (W / 2 + 0.45);
        const az = D / 2 + 0.45;
        for (let i = 0; i < 9; i++) {
          const c = pick(palette);
          const bx = ax + rand(-0.4, 0.4);
          const by = H - 0.2 + rand(0, 1.3);
          const bz = az + rand(-0.3, 0.3);
          add(balloon, std(c, 0.3, { emissive: new THREE.Color(c).multiplyScalar(0.25) }), bx, by, bz);
          strings.push(new THREE.Vector3(bx, by - 0.25, bz), new THREE.Vector3(ax, 1.3, az));
        }
      }
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(strings), new THREE.LineBasicMaterial({ color: 0xdddddd })));
      const drum = new THREE.CylinderGeometry(0.12, 0.12, 0.16, 16);
      const top = new THREE.ConeGeometry(0.09, 0.16, 12);
      for (let i = 0; i < 5; i++) {
        add(drum, std(pick(palette), 0.5), -1.8 + i * 0.5, TOP + 0.08, cz - 0.1, Math.PI / 2, 0, 0);
        add(top, std(pick(palette), 0.4), -1.6 + i * 0.5, TOP + 0.08, cz + 0.15, Math.PI);
      }
      break;
    }
  }
}

// ---------- the stall ----------

/** The stall itself (platform, cloth walls, poles, roof, valance, counter, inside bulb), without sign, keeper or goods. */
function buildShell(g, def) {
  const { W, D, H } = STALL;
  const GEO = geo();
  const fabric = std(0xffffff, 0.9, { map: stripes(def.c1, def.c2), side: THREE.DoubleSide });
  const add = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };

  add(new THREE.Mesh(new THREE.BoxGeometry(W, 0.18, D), MAT.wood), 0, 0.09, 0);
  add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), fabric), 0, H / 2, -D / 2 + 0.02);
  for (const s of [-1, 1]) {
    const side = add(new THREE.Mesh(new THREE.PlaneGeometry(D, H), fabric), s * (W / 2 - 0.02), H / 2, 0);
    side.rotation.y = Math.PI / 2;
    for (const zs of [-1, 1]) add(new THREE.Mesh(GEO.pole, MAT.pole), s * (W / 2 - 0.05), H / 2, zs * (D / 2 - 0.05));
  }

  const roofGeo = new THREE.ConeGeometry(1, 1.3, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  const roof = add(new THREE.Mesh(roofGeo, std(0xffffff, 0.85, { map: stripes(def.c1, def.c2, 12), side: THREE.DoubleSide })), 0, H + 0.65, 0);
  roof.scale.set((W / 2 + 0.25) * Math.SQRT2, 1, (D / 2 + 0.25) * Math.SQRT2);

  const valance = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 0.5, 0.5),
    std(0xffffff, 0.9, { map: valanceTexture(def.c1, def.c2, def.trim), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
  );
  add(valance, 0, H - 0.25, D / 2 + 0.25);

  const cz = D / 2 - 0.45;
  add(new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 1.0, 0.7), MAT.wood), 0, 0.68, cz);
  add(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.4, 0.9), std(0xffffff, 0.9, { map: stripes(def.c2, def.trim, 16) })), 0, 0.68, cz + 0.355);
  add(new THREE.Mesh(new THREE.BoxGeometry(W - 0.3, 0.04, 0.8), std(def.c2, 0.9)), 0, 1.2, cz);

  add(new THREE.Mesh(GEO.bulb, MAT.bulb), 0, H - 0.6, 0.4);
}

/**
 * Builds one stall in local space with its front (counter) facing +z.
 * Returns local positions for diyas and bulb strands so the world can add them to shared systems.
 */
export function createStall(def) {
  const { D, H } = STALL;
  const g = new THREE.Group();
  buildShell(g, def);
  const cz = D / 2 - 0.45;

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.0),
    new THREE.MeshBasicMaterial({ map: signTexture(def.name, def.sub, def.sign), color: new THREE.Color(1.2, 1.2, 1.2) })
  );
  sign.position.set(0, H + 0.55, D / 2 + 0.3);
  g.add(sign);

  const keeper = new Character(randomLook());
  keeper.root.position.set(rand(-0.6, 0.6), 0.18, cz - 0.85);
  g.add(keeper.root);

  const diyaSpots = [];
  addGoods(g, def.goods, diyaSpots);
  // ~70-200 little meshes become one per material look (keeper and sign stay their own)
  mergeStatic(g, { skip: (o) => o === keeper.root || o === sign });

  const { W } = STALL;
const ex = W / 2 + 0.25;
  const ez = D / 2 + 0.25;
  const apex = new THREE.Vector3(0, H + 1.3, 0);
  const strands = [[new THREE.Vector3(-ex, H, ez), new THREE.Vector3(ex, H, ez), 0.05]];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) strands.push([new THREE.Vector3(sx * ex, H, sz * ez), apex, 0]);

  return {
    group: g,
    keeper,
    sign,
    diyaSpots,
    strands,
    garland: [new THREE.Vector3(-ex, H - 0.02, ez + 0.02), new THREE.Vector3(ex, H - 0.02, ez + 0.02)],
  };
}

/**
 * Re-stocks a built stall with different goods (a creator's stall themed to their niche): the merged
 * shell + goods are rebuilt with `addGoodsFn(group)` in place of the original goods. The keeper, the
 * sign and anything named "creator*" stay. Returns the local diya spots of the old goods (if it was
 * the diya stall) so the caller can hide those diyas.
 */
export function restockStall(stall, addGoodsFn) {
  const g = stall.group;
  const keep = (o) => o === stall.keeper?.root || o === stall.sign || o.name?.startsWith('creator');
  const shared = new Set(Object.values(geo()));
  for (const o of g.children.slice()) {
    if (keep(o)) continue;
    g.remove(o);
    o.traverse((x) => {
      if (x.geometry && !shared.has(x.geometry)) x.geometry.dispose();
    });
  }
  const before = new Set(g.children);
  buildShell(g, stall.def);
  addGoodsFn(g);
  const mask = g.layers.mask;
  for (const o of g.children) if (!before.has(o)) o.traverse((x) => (x.layers.mask = mask));
  mergeStatic(g, { skip: keep });
  g.updateMatrixWorld(true);
}

export { TOP as STALL_TOP };
