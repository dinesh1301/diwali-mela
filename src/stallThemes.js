import * as THREE from 'three';
import { canvasTexture, hdr, beam } from './utils.js';
import { STALL, STALL_TOP as TOP } from './stalls.js';

/*
  A creator's stall stocked for their niche. Every theme is built from boxes, cylinders, spheres
  and a few small painted canvases in stall-local space (counter facing +z), then the stall's
  mergeStatic folds it all into a handful of draw calls, the same as the ordinary goods.

  Themes: books · tech · fitness · food · finance · fashion · art · music · travel · career ·
  general (general keeps the stall's own goods).
*/

export { THEMES as STALL_THEMES } from './personalSlots.js';

const { W, D } = STALL;
const CZ = D / 2 - 0.45; // counter centre (z)
const BACK = -D / 2 + 0.04; // just in front of the back cloth
const SHELF_Z = -D / 2 + 0.3;

const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const metal = (color, roughness = 0.3) => std(color, roughness, { metalness: 0.8 });

const M = {
  wood: std(0x6b3f22, 0.8),
  darkWood: std(0x3e220e, 0.8),
  gold: metal(0xe0b04a, 0.3),
  brass: metal(0xc9973a, 0.35),
  steel: std(0xe2e4e8, 0.3, { metalness: 0.55 }),
  cream: std(0xf1e6cc, 0.9),
  black: std(0x1b1b1f, 0.6),
};

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- small painted canvases (built once, shared) ----------

const TEX = {};
const tex = (key, w, h, draw) => (TEX[key] ??= canvasTexture(w, h, draw));

/** A laptop screen: a dark dashboard with a rising chart. */
const screenTex = () =>
  tex('screen', 256, 160, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0f1b3d');
    g.addColorStop(1, '#2a0f45');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff9f1c';
    c.fillRect(0, 0, w, 14);
    const cols = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585'];
    for (let i = 0; i < 6; i++) {
      const bh = 22 + i * 15;
      c.fillStyle = cols[i];
      c.fillRect(20 + i * 26, h - 18 - bh, 18, bh);
    }
    c.strokeStyle = '#ffffff';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(18, h - 40);
    c.bezierCurveTo(80, h - 60, 120, h - 90, 170, h - 130);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 4; i++) c.fillRect(186, 30 + i * 24, 54, 10);
  });

/** A phone screen: a vertical reel with a play button and a heart. */
const phoneTex = () =>
  tex('phone', 96, 192, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ff6d00');
    g.addColorStop(0.5, '#f72585');
    g.addColorStop(1, '#7209b7');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.moveTo(38, 78);
    c.lineTo(38, 114);
    c.lineTo(66, 96);
    c.closePath();
    c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(76, 150, 6, 0, Math.PI * 2);
    c.arc(84, 150, 6, 0, Math.PI * 2);
    c.fill();
    c.fillRect(10, h - 22, 50, 6);
  });

/** A painterly little landscape: mela lights over a river at dusk. */
const artTex = () =>
  tex('art', 256, 200, (c, w, h) => {
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2b1055');
    sky.addColorStop(0.55, '#d1495b');
    sky.addColorStop(1, '#ffb000');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffe066';
    c.beginPath();
    c.arc(w * 0.7, h * 0.42, 26, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#3d1a5b';
    c.beginPath();
    c.moveTo(0, h * 0.72);
    for (let x = 0; x <= w; x += 16) c.lineTo(x, h * 0.66 - Math.sin(x * 0.05) * 14);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.fill();
    const rnd = prng(7);
    for (let i = 0; i < 160; i++) {
      c.fillStyle = ['#ffd166', '#ff8fab', '#ffffff', '#ff9f1c'][i % 4];
      c.globalAlpha = 0.5 + rnd() * 0.5;
      c.fillRect(rnd() * w, h * 0.74 + rnd() * h * 0.26, 3 + rnd() * 6, 2);
    }
    c.globalAlpha = 1;
  });

/** A globe: deep blue sea with soft painted land. */
const globeTex = () =>
  tex('globe', 256, 128, (c, w, h) => {
    c.fillStyle = '#1d5fa8';
    c.fillRect(0, 0, w, h);
    const rnd = prng(11);
    for (let i = 0; i < 14; i++) {
      c.fillStyle = ['#7fb069', '#d6b26e', '#5c9e5a'][i % 3];
      const x = rnd() * w;
      const y = 20 + rnd() * (h - 40);
      c.beginPath();
      c.ellipse(x, y, 10 + rnd() * 26, 6 + rnd() * 16, rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
  });

/** A parchment travel map with a dotted route and pins. */
const mapTex = () =>
  tex('map', 512, 256, (c, w, h) => {
    c.fillStyle = '#e9d6a8';
    c.fillRect(0, 0, w, h);
    const rnd = prng(23);
    c.fillStyle = '#c9b07a';
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      c.ellipse(rnd() * w, rnd() * h, 30 + rnd() * 70, 18 + rnd() * 40, rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = '#8e1422';
    c.lineWidth = 4;
    c.setLineDash([10, 9]);
    c.beginPath();
    c.moveTo(40, h - 50);
    c.bezierCurveTo(160, 40, 300, h - 30, w - 50, 60);
    c.stroke();
    c.setLineDash([]);
    for (const [x, y] of [[40, h - 50], [210, 120], [w - 50, 60]]) {
      c.fillStyle = '#c1121f';
      c.beginPath();
      c.arc(x, y - 10, 11, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(x - 8, y - 6);
      c.lineTo(x + 8, y - 6);
      c.lineTo(x, y + 8);
      c.fill();
    }
    c.strokeStyle = '#6b4a22';
    c.lineWidth = 8;
    c.strokeRect(4, 4, w - 8, h - 8);
  });

/** A certificate: cream paper, a gold border, ruled lines and a red seal. */
const certTex = () =>
  tex('cert', 256, 192, (c, w, h) => {
    c.fillStyle = '#fbf3dc';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#c9973a';
    c.lineWidth = 8;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.lineWidth = 2;
    c.strokeRect(20, 20, w - 40, h - 40);
    c.fillStyle = '#5c3a12';
    c.fillRect(w * 0.25, 40, w * 0.5, 12);
    c.fillStyle = '#8a6a3a';
    for (let i = 0; i < 3; i++) c.fillRect(w * 0.18, 76 + i * 20, w * 0.64, 5);
    c.fillStyle = '#c1121f';
    c.beginPath();
    c.arc(w * 0.78, h * 0.76, 18, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffd166';
    c.beginPath();
    c.arc(w * 0.78, h * 0.76, 8, 0, Math.PI * 2);
    c.fill();
  });

const basic = (t, k = 1.15) => new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(k, k, k) });

// ---------- the themes ----------

function builder(g, seed) {
  const rnd = prng(seed);
  const r = (a, b) => a + (b - a) * rnd();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const shelf = (y, w = W - 0.6) => box(w, 0.05, 0.4, M.wood, 0, y, SHELF_Z);
  return { rnd, r, add, box, shelf };
}

const BOOK_COLS = [0x8e1422, 0x1d3b6e, 0x1f6e43, 0xc98a1b, 0x0f6e78, 0x6a2c70, 0xb5651d];

const THEMES = {
  books(g, b) {
    const { r, box, shelf, rnd } = b;
    const cov = BOOK_COLS.map((c) => std(c, 0.75));
    const book = (x, y, z, w, h, d, ry) => {
      box(w, h, d, cov[Math.floor(rnd() * cov.length)], x, y + h / 2, z, 0, ry);
      box(w - 0.03, h * 0.72, d + 0.006, M.cream, x + 0.012 * Math.cos(ry), y + h / 2, z - 0.012 * Math.sin(ry), 0, ry);
    };
    for (const [x, n] of [[-1.95, 7], [-1.35, 5], [1.25, 6], [1.9, 8]]) {
      let y = TOP;
      for (let i = 0; i < n; i++) {
        const h = r(0.05, 0.08);
        book(x + r(-0.03, 0.03), y, CZ + r(-0.04, 0.04), r(0.36, 0.44), h, r(0.26, 0.32), r(-0.25, 0.25));
        y += h;
      }
    }
    // an open book on a little wooden stand, in front of the keeper
    box(0.5, 0.05, 0.3, M.wood, 0, TOP + 0.08, CZ + 0.15, -0.5);
    for (const s of [-1, 1]) box(0.23, 0.012, 0.3, M.cream, s * 0.12, TOP + 0.12, CZ + 0.14, -0.5, 0, -s * 0.12);
    // spines on the shelves behind
    for (const y of [1.6, 2.15, 2.62]) {
      shelf(y);
      let x = -2.25;
      while (x < 2.2) {
        const w = r(0.05, 0.09);
        const h = r(0.24, 0.36);
        box(w, h, 0.26, cov[Math.floor(rnd() * cov.length)], x + w / 2, y + 0.025 + h / 2, SHELF_Z, 0, 0, rnd() < 0.08 ? 0.18 : 0);
        x += w + 0.008;
      }
    }
  },

  tech(g, b) {
    const { add, box, shelf } = b;
    const shell = metal(0x3a3f48, 0.35);
    const screen = basic(screenTex(), 1.3);
    for (const x of [-1.55, 1.55]) {
      box(0.62, 0.03, 0.42, shell, x, TOP + 0.015, CZ + 0.05);
      const lid = new THREE.Group();
      lid.position.set(x, TOP + 0.03, CZ - 0.16);
      lid.rotation.x = -0.28;
      g.add(lid);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.02), shell);
      back.position.set(0, 0.21, 0);
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), screen);
      disp.position.set(0, 0.21, 0.012);
      lid.add(back, disp);
      box(0.5, 0.004, 0.2, std(0x22252b, 0.6), x, TOP + 0.032, CZ + 0.08); // keys
    }
    // phones on stands, low in front of the keeper
    const phone = basic(phoneTex(), 1.25);
    for (let i = 0; i < 4; i++) {
      const x = -0.54 + i * 0.36;
      box(0.13, 0.03, 0.12, M.black, x, TOP + 0.015, CZ + 0.18);
      box(0.11, 0.21, 0.012, M.black, x, TOP + 0.13, CZ + 0.16, -0.22);
      add(new THREE.PlaneGeometry(0.1, 0.19), phone, x, TOP + 0.13, CZ + 0.168, -0.22);
    }
    // ring lights on stands at the back corners: every creator's first purchase
    const glow = new THREE.MeshBasicMaterial({ color: hdr(0xfff1d6, 1.6) });
    for (const s of [-1, 1]) {
      g.add(beam(new THREE.Vector3(s * 2.05, 0.2, -1.2), new THREE.Vector3(s * 2.05, 2.05, -1.2), 0.018, M.black, 6));
      add(new THREE.TorusGeometry(0.26, 0.032, 8, 32), glow, s * 2.05, 2.3, -1.2, 0, s * -0.35);
    }
    // boxed gadgets and headphones on a shelf
    shelf(2.2, 3.2);
    const boxes = [std(0xf4f4f4, 0.5), std(0x1b1b1f, 0.5), std(0x4361ee, 0.5)];
    for (let i = 0; i < 6; i++) box(0.32, 0.22, 0.24, boxes[i % 3], -1.3 + i * 0.52, 2.22 + 0.11, SHELF_Z);
    const red = std(0xe63946, 0.4);
    for (const x of [-0.75, 0.75]) {
      add(new THREE.TorusGeometry(0.13, 0.018, 6, 16, Math.PI), red, x, 1.65 + 0.03, SHELF_Z);
      for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), red, x + s * 0.13, 1.66, SHELF_Z, 0, 0, Math.PI / 2);
    }
    shelf(1.6, 2.2);
  },

  fitness(g, b) {
    const { add, box, r } = b;
    const plateCols = [0xd62828, 0xf7b801, 0x1d4e89, 0x2a9d8f].map((c) => std(c, 0.55));
    const handle = metal(0xb9bec6, 0.3);
    // dumbbells on two little two-tier racks, end-on to the aisle so the coloured hex heads show
    const hex = new THREE.CylinderGeometry(0.1, 0.1, 0.11, 6);
    const bar = new THREE.CylinderGeometry(0.02, 0.02, 0.42, 8);
    for (const [x0, c0] of [[-2.2, 0], [1.05, 2]]) {
      const tiers = [TOP + 0.02, TOP + 0.33];
      for (const ty of tiers) box(1.2, 0.04, 0.5, M.darkWood, x0 + 0.58, ty, CZ);
      for (const ex of [x0 - 0.02, x0 + 1.18]) box(0.05, 0.36, 0.5, M.darkWood, ex, TOP + 0.18, CZ);
      tiers.forEach((ty, ti) => {
        for (let i = 0; i < 4; i++) {
          const x = x0 + 0.15 + i * 0.29;
          const mat = plateCols[(c0 + ti + (i >> 1)) % plateCols.length];
          add(bar, handle, x, ty + 0.12, CZ, Math.PI / 2);
          for (const s of [-1, 1]) add(hex, mat, x, ty + 0.12, CZ + s * 0.17, Math.PI / 2);
        }
      });
    }
    // kettlebells in front of the keeper
    const bell = new THREE.SphereGeometry(0.14, 16, 12);
    const grip = new THREE.TorusGeometry(0.08, 0.02, 8, 16, Math.PI);
    [[-0.5, 0], [0.0, 1], [0.5, 2]].forEach(([x, ci]) => {
      add(bell, plateCols[ci], x, TOP + 0.13, CZ + 0.12);
      add(grip, M.black, x, TOP + 0.24, CZ + 0.12);
    });
    // rolled yoga mats standing in a basket at the corner
    add(new THREE.CylinderGeometry(0.2, 0.17, 0.25, 16, 1, true), std(0x9c6b30, 0.9, { side: THREE.DoubleSide }), 2.0, 0.32, -0.9);
    [0x06d6a0, 0xff5d8f, 0x8338ec, 0xffbe0b].forEach((c, i) =>
      add(new THREE.CylinderGeometry(0.065, 0.065, 1.0, 14), std(c, 0.8), 2.0 + (i % 2 ? 0.07 : -0.07), 0.62, -0.9 + (i < 2 ? -0.06 : 0.07), r(-0.08, 0.08), 0, r(-0.12, 0.12))
    );
    // a loaded barbell on wall hooks
    add(new THREE.CylinderGeometry(0.02, 0.02, 3.6, 8), handle, 0, 2.3, BACK + 0.16, 0, 0, Math.PI / 2);
    const big = new THREE.CylinderGeometry(0.24, 0.24, 0.06, 24);
    for (const s of [-1, 1]) {
      add(big, M.black, s * 1.4, 2.3, BACK + 0.16, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24), plateCols[s < 0 ? 0 : 2], s * 1.48, 2.3, BACK + 0.16, 0, 0, Math.PI / 2);
      box(0.06, 0.16, 0.18, M.darkWood, s * 1.0, 2.2, BACK + 0.09);
    }
    // medicine balls on the floor at the back
    [[-1.5, 0], [-1.05, 3]].forEach(([x, ci]) => add(new THREE.SphereGeometry(0.17, 16, 12), plateCols[ci], x, 0.35, -1.3));
  },

  food(g, b) {
    const { add, box, shelf } = b;
    const plate = new THREE.CylinderGeometry(0.29, 0.26, 0.025, 28);
    const katori = new THREE.CylinderGeometry(0.065, 0.052, 0.05, 16);
    const fill = new THREE.CylinderGeometry(0.058, 0.058, 0.01, 16);
    const fills = [0xe8a21a, 0xd2561c, 0xf2ede0, 0x6a8f2a].map((c) => std(c, 0.55));
    const roti = std(0xd9a35c, 0.85);
    const rice = std(0xf5f1e6, 0.9);
    // each thali tilted up on a little brass stand, the way a dhaba shows off its special
    const thali = (x, z) => {
      add(new THREE.CylinderGeometry(0.03, 0.08, 0.2, 12), M.brass, x, TOP + 0.1, z - 0.06);
      const t = new THREE.Group();
      t.position.set(x, TOP + 0.21, z);
      t.rotation.x = 0.75;
      g.add(t);
      const put = (geo, mat, px, py, pz, rx = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        m.rotation.set(rx, 0, rz);
        t.add(m);
      };
      put(plate, M.steel, 0, 0, 0);
      for (let i = 0; i < 4; i++) {
        const a = -2.4 + i * 0.75;
        put(katori, M.steel, Math.cos(a) * 0.17, 0.037, Math.sin(a) * 0.17);
        put(fill, fills[i], Math.cos(a) * 0.17, 0.059, Math.sin(a) * 0.17);
      }
      put(new THREE.SphereGeometry(0.08, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), rice, 0.04, 0.012, 0.1);
      for (let k = 0; k < 3; k++) put(new THREE.CylinderGeometry(0.085, 0.085, 0.008, 18), roti, -0.1 + k * 0.012, 0.017 + k * 0.009, 0.12, 0.12, 0.1);
    };
    thali(-1.75, CZ);
    thali(-0.95, CZ + 0.1);
    thali(1.55, CZ);
    // a brass handi with a lid and a ladle, keeping warm
    add(new THREE.SphereGeometry(0.22, 18, 12), M.brass, 0.6, TOP + 0.2, CZ - 0.02);
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 18), M.brass, 0.6, TOP + 0.38, CZ - 0.02);
    // steel tiffins on the shelf, spice jars on the one above
    shelf(1.6);
    for (const x of [-1.7, -0.6, 0.6, 1.7]) {
      for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 18), M.steel, x, 1.68 + k * 0.105, SHELF_Z);
      add(new THREE.TorusGeometry(0.06, 0.008, 6, 14, Math.PI), M.steel, x, 1.98, SHELF_Z);
    }
    shelf(2.2);
    const spices = [0xf2b705, 0xc1121f, 0x7a4a22, 0x5a8f29, 0xe76f00, 0x8e1422].map((c) => std(c, 0.9));
    const jar = std(0xe8f1f2, 0.1, { transparent: true, opacity: 0.35 });
    for (let i = 0; i < 9; i++) {
      const x = -2.0 + i * 0.5;
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 14), spices[i % spices.length], x, 2.3, SHELF_Z);
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 14, 1, true), jar, x, 2.32, SHELF_Z);
      add(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 14), M.brass, x, 2.43, SHELF_Z);
    }
    void box;
  },

  finance(g, b) {
    const { add, box, r } = b;
    const coin = new THREE.CylinderGeometry(0.06, 0.06, 0.016, 18);
    // coin stacks rising like a bar chart
    for (let i = 0; i < 6; i++) {
      const n = 3 + i * 3;
      const x = -2.05 + i * 0.22;
      for (let k = 0; k < n; k++) add(coin, M.gold, x + r(-0.006, 0.006), TOP + 0.008 + k * 0.017, CZ + 0.05 + r(-0.006, 0.006));
    }
    // a golden piggy bank
    const pig = new THREE.Group();
    pig.position.set(1.7, TOP + 0.2, CZ);
    pig.rotation.y = -0.5;
    g.add(pig);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), M.gold);
    body.scale.set(1.25, 1, 1);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 14), M.gold);
    snout.rotation.z = Math.PI / 2;
    snout.position.set(0.26, 0, 0);
    pig.add(body, snout);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 8), M.gold);
      ear.position.set(0.12, 0.17, s * 0.08);
      pig.add(ear);
      for (const fx of [-0.12, 0.12]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), M.gold);
        leg.position.set(fx, -0.18, s * 0.09);
        pig.add(leg);
      }
    }
    // red bahi-khata ledgers
    const red = std(0xa4161a, 0.8);
    for (let k = 0; k < 4; k++) {
      box(0.3, 0.06, 0.4, red, 0.95, TOP + 0.03 + k * 0.062, CZ, 0, r(-0.15, 0.15));
      box(0.3, 0.004, 0.02, M.gold, 0.95, TOP + 0.062 + k * 0.062, CZ, 0, 0);
    }
    // a growth chart on the back wall
    box(3.2, 1.25, 0.04, std(0x183a2a, 0.9), 0, 2.15, BACK);
    box(3.3, 0.06, 0.06, M.wood, 0, 2.8, BACK + 0.02);
    box(3.3, 0.06, 0.06, M.wood, 0, 1.5, BACK + 0.02);
    const bars = [0x2a9d8f, 0xe9c46a, 0x2a9d8f, 0xe9c46a, 0x06d6a0].map((c) => new THREE.MeshBasicMaterial({ color: hdr(c, 0.85) }));
    for (let i = 0; i < 5; i++) {
      const h = 0.18 + i * 0.17;
      box(0.32, h, 0.04, bars[i], -1.1 + i * 0.55, 1.62 + h / 2, BACK + 0.04);
    }
    const arrow = new THREE.MeshBasicMaterial({ color: hdr(0xffd166, 1.05) });
    const a0 = new THREE.Vector3(-1.35, 1.75, BACK + 0.08);
    const a1 = new THREE.Vector3(1.25, 2.6, BACK + 0.08);
    g.add(beam(a0, a1, 0.03, arrow, 8));
    const tip = add(new THREE.ConeGeometry(0.08, 0.2, 10), arrow, a1.x + 0.05, a1.y + 0.02, a1.z, 0, 0, -Math.atan2(a1.x - a0.x, a1.y - a0.y));
    void tip;
  },

  fashion(g, b) {
    const { add, box, r } = b;
    // a brass rail across the back with kurtas on hangers
    g.add(beam(new THREE.Vector3(-2.2, 2.55, -1.15), new THREE.Vector3(2.2, 2.55, -1.15), 0.022, M.brass, 8));
    for (const s of [-1, 1]) g.add(beam(new THREE.Vector3(s * 2.2, 0.18, -1.15), new THREE.Vector3(s * 2.2, 2.6, -1.15), 0.022, M.brass, 8));
    const cols = [0x8e1422, 0xe9a400, 0x0f6e78, 0xd63384, 0x1f6e43, 0x3a0ca3, 0xff6d00, 0xb5179e, 0x2a9d8f];
    cols.forEach((c, i) => {
      const x = -1.95 + i * 0.49;
      const mat = std(c, 0.85);
      const ry = r(-0.15, 0.15);
      box(0.4, 0.08, 0.06, mat, x, 2.38, -1.15, 0, ry); // shoulders
      const bodyLen = r(0.75, 0.95);
      box(0.34, bodyLen, 0.05, mat, x, 2.38 - bodyLen / 2, -1.15, 0, ry);
      box(0.06, 0.04, 0.02, M.gold, x, 2.3, -1.12, 0, ry); // a gold button at the neck
      add(new THREE.TorusGeometry(0.035, 0.006, 4, 10, Math.PI * 1.4), M.brass, x, 2.48, -1.15, 0, Math.PI / 2);
    });
    // folded fabric stacks on the counter
    const folds = [0xd62828, 0xf7b801, 0x2a9d8f, 0x8338ec, 0xff5d8f, 0x1d4e89, 0xffffff, 0x06d6a0].map((c) => std(c, 0.85));
    [-1.95, -1.4, 1.35, 1.9].forEach((x, si) => {
      for (let k = 0; k < 6; k++) box(0.42, 0.055, 0.3, folds[(si * 3 + k) % folds.length], x + r(-0.02, 0.02), TOP + 0.03 + k * 0.056, CZ, 0, r(-0.06, 0.06));
    });
    // a dupatta draped over the counter front
    const dupatta = std(0xe0218a, 0.85, { side: THREE.DoubleSide });
    box(0.5, 0.012, 0.75, dupatta, -0.2, TOP + 0.01, CZ + 0.05);
    box(0.5, 0.6, 0.012, dupatta, -0.2, TOP - 0.29, CZ + 0.41);
    box(0.5, 0.03, 0.014, M.gold, -0.2, TOP - 0.58, CZ + 0.415);
  },

  art(g, b) {
    const { add, box, r } = b;
    const art = basic(artTex(), 1.1);
    // a table easel with a canvas on the counter
    const easel = new THREE.Group();
    easel.position.set(-1.55, TOP, CZ - 0.05);
    easel.rotation.x = -0.2;
    g.add(easel);
    for (const s of [-1, 1]) easel.add(beam(new THREE.Vector3(s * 0.3, 0, 0.05), new THREE.Vector3(s * 0.05, 1.0, 0), 0.02, M.wood, 6));
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.08), M.wood);
    ledge.position.set(0, 0.16, 0.04);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.56, 0.03), M.cream);
    board.position.set(0, 0.46, 0.03);
    const paint = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.5), art);
    paint.position.set(0, 0.46, 0.047);
    easel.add(ledge, board, paint);
    // paint jars and a brush cup
    const cols = [0xd62828, 0xf7b801, 0x2a9d8f, 0x3a86ff, 0x8338ec, 0xff5d8f];
    cols.forEach((c, i) => {
      const x = 0.3 + (i % 3) * 0.2;
      const z = CZ + (i < 3 ? -0.1 : 0.12);
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.11, 14), std(0xe8f1f2, 0.2), x, TOP + 0.055, z);
      add(new THREE.CylinderGeometry(0.068, 0.068, 0.012, 14), std(c, 0.4), x, TOP + 0.112, z);
    });
    add(new THREE.CylinderGeometry(0.08, 0.07, 0.18, 14), M.brass, 1.5, TOP + 0.09, CZ);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tx = 1.5 + Math.cos(a) * 0.1;
      const tz = CZ + Math.sin(a) * 0.1;
      g.add(beam(new THREE.Vector3(1.5 + Math.cos(a) * 0.03, TOP + 0.1, CZ + Math.sin(a) * 0.03), new THREE.Vector3(tx, TOP + 0.42, tz), 0.008, M.wood, 4));
      add(new THREE.ConeGeometry(0.016, 0.06, 6), std(cols[i], 0.5), tx, TOP + 0.44, tz, Math.PI);
    }
    // a palette with dabs of paint, in front of the keeper
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 20), M.wood, -0.45, TOP + 0.01, CZ + 0.12);
    cols.forEach((c, i) => add(new THREE.SphereGeometry(0.028, 8, 6), std(c, 0.4), -0.45 + Math.cos(i) * 0.12, TOP + 0.022, CZ + 0.12 + Math.sin(i) * 0.12));
    // framed paintings on the back wall
    [[-1.3, 2.15, 0.9, 0.7], [0.1, 2.3, 0.7, 0.55], [1.35, 2.05, 0.8, 0.95]].forEach(([x, y, w, h], i) => {
      box(w + 0.12, h + 0.12, 0.04, M.gold, x, y, BACK + 0.02);
      const p = add(new THREE.PlaneGeometry(w, h), art, x, y, BACK + 0.045);
      if (i === 1) p.rotation.z = Math.PI; // a different crop of the same little painting
      void r;
    });
  },

  music(g, b) {
    const { add, box } = b;
    // an acoustic guitar standing on the counter
    const gt = new THREE.Group();
    gt.position.set(-1.75, TOP, CZ - 0.1);
    gt.rotation.set(-0.18, 0.25, 0.08);
    g.add(gt);
    const woodL = std(0xc07a35, 0.45);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 24), woodL);
    lower.rotation.x = Math.PI / 2;
    lower.position.y = 0.22;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 24), woodL);
    upper.rotation.x = Math.PI / 2;
    upper.position.y = 0.48;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), M.black);
    hole.position.set(0, 0.36, 0.052);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.03), M.darkWood);
    neck.position.set(0, 0.88, 0.02);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, 0.035), M.darkWood);
    head.position.set(0, 1.22, 0.02);
    gt.add(lower, upper, hole, neck, head);
    // a dhol on its side, red with rope lacing
    const dx = 1.55;
    const dy = TOP + 0.2;
    add(new THREE.CylinderGeometry(0.19, 0.19, 0.5, 24), std(0xa4161a, 0.6), dx, dy, CZ, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) {
      add(new THREE.TorusGeometry(0.19, 0.018, 8, 24), M.darkWood, dx + s * 0.25, dy, CZ, 0, Math.PI / 2);
      add(new THREE.CircleGeometry(0.18, 20), M.cream, dx + s * 0.252, dy, CZ, 0, (s * Math.PI) / 2);
    }
    const rope = std(0xf1e6cc, 0.9);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const a2 = a + Math.PI / 12;
      g.add(beam(new THREE.Vector3(dx - 0.24, dy + Math.sin(a) * 0.195, CZ + Math.cos(a) * 0.195), new THREE.Vector3(dx + 0.24, dy + Math.sin(a2) * 0.195, CZ + Math.cos(a2) * 0.195), 0.006, rope, 4));
    }
    // a tabla pair in front of the keeper
    add(new THREE.CylinderGeometry(0.075, 0.085, 0.22, 16), M.darkWood, -0.3, TOP + 0.11, CZ + 0.1);
    add(new THREE.CircleGeometry(0.07, 16), M.cream, -0.3, TOP + 0.222, CZ + 0.1, -Math.PI / 2);
    add(new THREE.CircleGeometry(0.03, 12), M.black, -0.3, TOP + 0.224, CZ + 0.1, -Math.PI / 2);
    add(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), metal(0xb87333, 0.35), 0.0, TOP + 0.02, CZ + 0.1, Math.PI);
    add(new THREE.CircleGeometry(0.1, 16), M.cream, 0.0, TOP + 0.14, CZ + 0.1, -Math.PI / 2);
    add(new THREE.CircleGeometry(0.04, 12), M.black, 0.0, TOP + 0.142, CZ + 0.1, -Math.PI / 2);
    // a sitar hung across the back wall, and brass manjiras on a shelf
    const sitarWood = std(0x8a4b1d, 0.5);
    add(new THREE.SphereGeometry(0.24, 18, 14), sitarWood, -1.25, 1.75, BACK + 0.26);
    const n0 = new THREE.Vector3(-1.1, 1.85, BACK + 0.18);
    const n1 = new THREE.Vector3(0.9, 2.65, BACK + 0.1);
    g.add(beam(n0, n1, 0.04, sitarWood, 8));
    add(new THREE.SphereGeometry(0.1, 12, 10), sitarWood, 0.35, 2.43, BACK + 0.2);
    box(2.0, 0.05, 0.3, M.wood, 1.2, 1.55, SHELF_Z);
    for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.07, 0.04, 0.03, 16), M.gold, 0.6 + i * 0.4, 1.6, SHELF_Z, 0.3, 0, 0);
  },

  travel(g, b) {
    const { add, box } = b;
    // vintage trunks with stickers
    const leather = [std(0x7a4a22, 0.6), std(0x1d4e89, 0.6), std(0x8e1422, 0.6)];
    const stickers = [0xffd166, 0x06d6a0, 0xff5d8f, 0xffffff].map((c) => std(c, 0.7));
    [[0.66, 0.26, 0.42, 0], [0.56, 0.22, 0.36, 1], [0.44, 0.18, 0.3, 2]].reduce((y, [w, h, d, i]) => {
      const x = -1.75 + (i === 1 ? 0.04 : i === 2 ? -0.03 : 0);
      box(w, h, d, leather[i], x, y + h / 2, CZ, 0, i === 1 ? 0.12 : 0);
      for (const s of [-1, 1]) box(0.04, h + 0.01, d + 0.01, M.brass, x + s * w * 0.3, y + h / 2, CZ, 0, i === 1 ? 0.12 : 0);
      box(0.1, 0.1, 0.005, stickers[i], x - w * 0.1, y + h / 2, CZ + d / 2 + 0.006, 0, 0, 0.2);
      box(0.08, 0.08, 0.005, stickers[(i + 2) % 4], x + w * 0.12, y + h * 0.45, CZ + d / 2 + 0.006, 0, 0, -0.15);
      return y + h;
    }, TOP);
    // a globe on a brass stand
    const gx = 1.6;
    add(new THREE.CylinderGeometry(0.12, 0.14, 0.04, 18), M.brass, gx, TOP + 0.02, CZ);
    g.add(beam(new THREE.Vector3(gx, TOP + 0.03, CZ), new THREE.Vector3(gx, TOP + 0.15, CZ), 0.015, M.brass, 6));
    add(new THREE.SphereGeometry(0.24, 24, 16), std(0xffffff, 0.45, { map: globeTex() }), gx, TOP + 0.4, CZ, 0.4, 0.8);
    add(new THREE.TorusGeometry(0.27, 0.012, 6, 32, Math.PI * 1.3), M.brass, gx, TOP + 0.4, CZ, 0, Math.PI / 2, 0.4);
    // rolled maps in a basket, a camera in front of the keeper
    add(new THREE.CylinderGeometry(0.13, 0.11, 0.18, 14, 1, true), std(0x9c6b30, 0.9, { side: THREE.DoubleSide }), 0.85, TOP + 0.09, CZ);
    for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), std(0xe9d6a8, 0.85), 0.85 + Math.cos(i * 1.3) * 0.05, TOP + 0.26, CZ + Math.sin(i * 1.3) * 0.05, Math.cos(i) * 0.15, 0, Math.sin(i) * 0.15);
    box(0.2, 0.12, 0.08, M.black, -0.35, TOP + 0.06, CZ + 0.18);
    add(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 14), metal(0x555a60, 0.3), -0.35, TOP + 0.06, CZ + 0.25, Math.PI / 2);
    // a big map on the back wall
    box(2.6, 1.3, 0.03, M.wood, 0, 2.15, BACK);
    add(new THREE.PlaneGeometry(2.45, 1.18), basic(mapTex(), 1.05), 0, 2.15, BACK + 0.02);
  },

  career(g, b) {
    const { add, box } = b;
    // trophies on wooden plinths
    const cup = new THREE.LatheGeometry(
      [[0, 0], [0.06, 0], [0.06, 0.03], [0.02, 0.05], [0.02, 0.13], [0.09, 0.2], [0.11, 0.33], [0.1, 0.33], [0, 0.2]].map(([x, y]) => new THREE.Vector2(x, y)),
      20
    );
    [[-2.0, 1.0], [-1.55, 1.3], [-1.1, 0.9]].forEach(([x, s]) => {
      box(0.24 * s, 0.1 * s, 0.24 * s, M.darkWood, x, TOP + 0.05 * s, CZ);
      const m = add(cup, M.gold, x, TOP + 0.1 * s, CZ);
      m.scale.setScalar(s);
      for (const sd of [-1, 1]) {
        const h = add(new THREE.TorusGeometry(0.045, 0.01, 6, 12, Math.PI), M.gold, x + sd * 0.11 * s, TOP + 0.1 * s + 0.26 * s, CZ, 0, 0, (sd * -Math.PI) / 2);
        h.scale.setScalar(s);
      }
    });
    // a graduation cap and rolled diplomas with red ribbons
    box(0.34, 0.02, 0.34, M.black, 0.95, TOP + 0.12, CZ, 0, Math.PI / 4);
    add(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 16), M.black, 0.95, TOP + 0.06, CZ);
    g.add(beam(new THREE.Vector3(0.95, TOP + 0.135, CZ), new THREE.Vector3(1.12, TOP + 0.02, CZ + 0.12), 0.008, M.gold, 4));
    const paper = std(0xfbf3dc, 0.85);
    const ribbon = std(0xc1121f, 0.6);
    [[1.65, 0], [1.85, 0], [2.05, 0], [1.75, 1], [1.95, 1]].forEach(([x, row]) => {
      const y = TOP + 0.045 + row * 0.08;
      add(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 12), paper, x, y, CZ, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.043, 0.043, 0.04, 12), ribbon, x, y, CZ, Math.PI / 2);
    });
    // framed certificates on the back wall
    const cert = basic(certTex(), 0.72);
    [[-1.6, 2.35], [-0.55, 2.4], [0.55, 2.4], [1.6, 2.35], [-1.05, 1.7], [1.05, 1.7]].forEach(([x, y]) => {
      box(0.74, 0.58, 0.04, M.darkWood, x, y, BACK + 0.02);
      add(new THREE.PlaneGeometry(0.64, 0.48), cert, x, y, BACK + 0.045);
    });
  },
};

/** Re-stock-able goods builder for a theme, or null for 'general' / unknown (keep the stall's own goods). */
export function themedGoods(theme, seed = 1) {
  const fn = THEMES[theme];
  if (!fn) return null;
  return (g) => fn(g, builder(g, seed));
}
