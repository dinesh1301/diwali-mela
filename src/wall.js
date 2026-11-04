import * as THREE from 'three';
import { canvasTexture, beam, setLayer } from './utils.js';
import { signTexture } from './stalls.js';

/*
  Three walls that visitors fill:
  - the Deepmala wall by the entrance, where bought diyas and kandeels snap into niches
  - the leaderboard at the gate (golgappa, best lap, strongman)
  - the wish wall at the ghat (recent lantern wishes)
*/
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const fmtLap = (ms) => {
  const s = ms / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
const RANKS = [[0.3, 'Kamzor'], [0.55, 'Theek-thaak'], [0.75, 'Taakatwar'], [0.92, 'Pehelwan'], [2, 'BAHUBALI']];
const rank = (p) => RANKS.find(([max]) => p < max)[1];

function board(scene, world, { x, z, ry, w, h, draw, title, sub, bg }) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * h) / w);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.14), std(0x3d2a1c, 0.8));
  frame.position.y = 0.9 + h / 2;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.15, 1.15, 1.15) }));
  face.position.set(0, 0.9 + h / 2, 0.08);
  for (const s of [-1, 1]) g.add(beam(V(s * (w / 2 + 0.05), 0, 0), V(s * (w / 2 + 0.05), 0.95, 0), 0.07, std(0x3d2a1c)));
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, h * 0.22), new THREE.MeshBasicMaterial({ map: signTexture(title, sub, bg), color: new THREE.Color(1.2, 1.2, 1.2) }));
  cap.position.set(0, 0.9 + h + 0.15 + h * 0.11, 0.08);
  g.add(frame, face, cap); // the face and caption are unlit (basic), so a board needs no lamp of its own
  scene.add(g);
  g.updateMatrixWorld(true);
  const a = g.localToWorld(V(-w / 2 - 0.2, 0, -0.15));
  const b = g.localToWorld(V(w / 2 + 0.2, 0, 0.15));
  world.colliders.push({ type: 'box', minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
  const redraw = (data) => {
    const ctx = c.getContext('2d');
    draw(ctx, c.width, c.height, data);
    tex.needsUpdate = true;
  };
  return { group: g, redraw };
}

function paper(ctx, w, h) {
  ctx.fillStyle = '#2a1430';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,207,92,0.6)';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, w - 28, h - 28);
}

export class Walls {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene, world, net } = ctx;

    // ---- Deepmala wall ----
    this.slots = [];
    const wx = -13;
    const z0 = 61;
    const len = 8;
    const brick = canvasTexture(256, 128, (c, w, h) => {
      c.fillStyle = '#7a3b2a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#5a2a1e';
      for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) c.fillRect(((i + (r % 2) * 0.5) * w) / 4 + 2, (r * h) / 4 + 2, w / 4 - 4, h / 4 - 4);
    });
    brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
    brick.repeat.set(6, 2);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.9, len), std(0xffffff, 0.95, { map: brick }));
    wall.position.set(wx, 0.95, z0 + len / 2);
    wall.castShadow = wall.receiveShadow = true;
    scene.add(wall);
    const shelfMat = std(0xe8d0a8, 0.85);
    for (const y of [0.55, 1.05, 1.55]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, len), shelfMat);
      shelf.position.set(wx + 0.4, y, z0 + len / 2);
      shelf.castShadow = shelf.receiveShadow = true;
      scene.add(shelf);
      for (let i = 0; i < 16; i++) this.slots.push({ pos: V(wx + 0.4, y + 0.03, z0 + 0.25 + i * 0.5), taken: false });
    }
    world.colliders.push({ type: 'box', minX: wx - 0.3, maxX: wx + 0.65, minZ: z0, maxZ: z0 + len });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 0.9),
      new THREE.MeshBasicMaterial({ map: signTexture('Deepmala', 'Bring a diya or kandeel and press Q here', '#5c0a10', '#ffe7a3', 1024, 288), color: new THREE.Color(1.2, 1.2, 1.2) })
    );
    sign.position.set(wx + 0.3, 2.6, z0 + len / 2);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);
    const lamp = new THREE.PointLight(0xffb46b, 30, 10, 2);
    lamp.position.set(wx + 1.5, 2.6, z0 + len / 2);
    scene.add(lamp);
    this.wallCenter = V(wx + 0.4, 0, z0 + len / 2);

    // ---- leaderboard at the gate ----
    this.leader = board(scene, world, {
      x: -12.5,
      z: 54,
      ry: Math.PI / 2,
      w: 4.6,
      h: 2.9,
      title: 'Mela Champions',
      sub: 'Golgappa · Best lap · Strongman',
      bg: '#13306b',
      draw: (c, w, h, boards) => {
        paper(c, w, h);
        const cols = [
          ['🥟 Golgappa', 'golgappa', (v) => `${v}`],
          ['🏁 Best lap', 'lap', (v) => fmtLap(v)],
          ['🔔 Strongman', 'striker', (v) => rank(v)],
        ];
        const cw = (w - 60) / 3;
        cols.forEach(([title, key, fmt], ci) => {
          const x = 30 + ci * cw;
          c.fillStyle = '#ffcf5c';
          c.font = '600 40px Poppins, sans-serif';
          c.textAlign = 'left';
          c.fillText(title, x + 16, 70);
          c.fillStyle = 'rgba(255,255,255,0.15)';
          c.fillRect(x + 16, 86, cw - 40, 3);
          const list = (boards?.[key] ?? []).slice(0, 6);
          c.font = '500 30px Poppins, sans-serif';
          if (!list.length) {
            c.fillStyle = 'rgba(255,246,229,0.5)';
            c.fillText('Be the first!', x + 16, 140);
          }
          list.forEach((e, i) => {
            const y = 140 + i * 52;
            c.fillStyle = i === 0 ? '#ffd166' : '#fff6e5';
            c.textAlign = 'left';
            const name = (e.handle ? '@' + e.handle : e.name || 'Visitor').slice(0, 16);
            c.fillText(`${i + 1}. ${name}`, x + 16, y);
            c.textAlign = 'right';
            c.fillText(fmt(e.value), x + cw - 30, y);
          });
        });
      },
    });

    // ---- wish wall at the ghat ----
    this.wishWall = board(scene, world, {
      x: 30,
      z: -39.6,
      ry: Math.PI,
      w: 5.2,
      h: 3.0,
      title: 'Wish Wall',
      sub: 'Wishes released into the sky tonight',
      bg: '#4a0d4a',
      draw: (c, w, h, wishes) => {
        paper(c, w, h);
        const list = (wishes ?? []).slice(-12).reverse();
        c.textAlign = 'left';
        if (!list.length) {
          c.fillStyle = 'rgba(255,246,229,0.55)';
          c.font = '500 34px Poppins, sans-serif';
          c.fillText('Release a lantern at the ghat and your wish appears here', 40, 110);
        }
        list.forEach((wsh, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = 40 + col * (w / 2);
          const y = 90 + row * 88;
          c.fillStyle = '#fff6e5';
          c.font = '500 30px Poppins, sans-serif';
          c.fillText(`“${String(wsh.text).slice(0, 26)}${wsh.text.length > 26 ? '…' : ''}”`, x, y);
          c.fillStyle = '#ffcf5c';
          c.font = '400 24px Poppins, sans-serif';
          c.fillText(`— ${wsh.handle ? '@' + wsh.handle : wsh.name || 'a visitor'}`, x + 16, y + 34);
        });
      },
    });

    this.leader.redraw(net?.boards);
    this.wishWall.redraw(net?.wishes);
    net?.on('boards', () => this.leader.redraw(net.boards));
    net?.on('wishes', () => this.wishWall.redraw(net.wishes));
  }

  /** The Deepmala accepts a held diya or kandeel from within a few metres. */
  nearDeepmala(p) {
    return Math.abs(p.x - this.wallCenter.x) < 3.5 && Math.abs(p.z - this.wallCenter.z) < 5.5;
  }

  nextSlot() {
    return this.slots.find((s) => !s.taken) ?? null;
  }

  /** Marks niches already filled by things restored from a previous visit. */
  claimFrom(placed) {
    for (const p of placed) {
      const slot = this.slots.find((s) => s.pos.distanceTo(p.obj.position) < 0.12);
      if (slot) slot.taken = true;
    }
  }
}

export { setLayer };
