import * as THREE from 'three';
import { Character, randomLook, setViewer } from './character.js';
import { balloonMesh } from './items.js';
import { pick, rand, setLayer } from './utils.js';
import { slot, slotSet } from './personalSlots.js';

/*
  Mela-goers wander a hand-made path graph. Some nodes are places to linger: in front of stalls,
  watching games, gazing at the wheel or fireworks, praying at the temple, looking at the river.
*/
const W = -Math.PI / 2; // facing -x
const E = Math.PI / 2; // facing +x
const N = Math.PI; // facing -z
const NODES = {
  gateOut: [0, 68],
  gateIn: [0, 54],
  b42: [0, 42],
  b32: [0, 32],
  b22: [0, 22],
  b14: [0, 14],
  sL47: [-5.6, 48.9, 'stall', W],
  sR47: [5.6, 48.9, 'stall', E],
  sL37: [-5.6, 38.9, 'stall', W],
  sR37: [5.6, 38.9, 'stall', E],
  sL27: [-5.6, 28.9, 'stall', W],
  sR27: [5.6, 28.9, 'stall', E],
  sL17: [-5.6, 18.9, 'stall', W],
  sR17: [5.6, 18.9, 'stall', E],
  p0: [0, 9, 'look', N],
  p1: [9, 0, 'look', W],
  p2: [0, -9, 'look', 0],
  p3: [-9, 0, 'look', E],
  e42: [14, 42],
  e32: [14, 32],
  e22: [14, 22],
  g41: [21.5, 41, 'game', E],
  g32: [21.5, 32, 'game', E],
  g23: [21.5, 23, 'game', E],
  g14: [21.5, 14, 'game', E],
  w42: [-14, 42],
  w32: [-14, 32],
  w22: [-14, 22],
  c1: [-17.5, 30, 'look', W],
  c2: [-26, 39.5, 'look', N],
  c3: [-26, 20.5, 'look', 0],
  x0: [0, -18],
  x1: [-12, -18],
  x2: [-24, -16.5, 'sky', Math.atan2(-10, -9.5)],
  x3: [12, -18],
  x4: [24, -16.5, 'sky', Math.atan2(12, -13.5)],
  h0: [0, -30],
  h1: [0, -41, 'river', N],
  h2: [-9, -41, 'river', N],
  h3: [9, -41, 'river', N],
  t0: [-13.2, -37, 'pray', W],
};
const EDGES = `gateOut-gateIn gateIn-b42 b42-b32 b32-b22 b22-b14 b14-p0
  gateIn-sL47 gateIn-sR47 b42-sL47 b42-sR47 b42-sL37 b42-sR37 b32-sL37 b32-sR37 b32-sL27 b32-sR27
  b22-sL27 b22-sR27 b22-sL17 b22-sR17 b14-sL17 b14-sR17
  p0-p1 p1-p2 p2-p3 p3-p0
  b42-e42 b32-e32 b22-e22 e42-g41 e32-g32 e22-g23 g41-g32 g32-g23 g23-g14 g14-p1
  b42-w42 b32-w32 b22-w22 w32-c1 w42-c2 w22-c3 c1-c2 c1-c3
  p2-x0 x0-x1 x1-x2 x0-x3 x3-x4 x0-h0 h0-h1 h1-h2 h1-h3 h2-t0`;

const GRAPH = {};
for (const id of Object.keys(NODES)) GRAPH[id] = [];
for (const e of EDGES.split(/\s+/).filter(Boolean)) {
  const [a, b] = e.split('-');
  GRAPH[a].push(b);
  GRAPH[b].push(a);
}

const LINES = [
  'Happy Diwali! 🪔',
  'Shubh Deepavali! ✨',
  'Saal Mubarak! 🎉',
  'shout.crowd.1', // personal slots (a creator's mela can put their own lines in the crowd's mouth)
  'shout.crowd.2',
  'shout.crowd.3',
  'Don’t miss the grand show! 🎆',
  'Aapko bhi Happy Diwali! 🙏',
  'Golgappe khaye? Ekdum teekha! 🌶️',
  'Float a diya at the ghat 🌊',
];
const ACTIONS = { game: ['clap', 'cheer', null], sky: ['lookUp'], pray: ['namaste'], stall: [null, null, 'give'], look: [null], river: [null] };


export class Crowd {
  constructor(ctx, count = 22) {
    this.ctx = ctx;
    const ids = Object.keys(NODES);
    this.npcs = [];
    for (let i = 0; i < count; i++) {
      const kid = i % 5 === 0;
      const char = new Character(randomLook({ kid }));
      if (kid && Math.random() < 0.7) {
        // balloon on a string, hung from the (scaled) body above the raised right hand
        const b = balloonMesh(pick([0xff006e, 0xffbe0b, 0x3a86ff, 0x06d6a0]));
        b.position.set(-0.3, 2.35, 0.3);
        const string = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.3, 2.1, 0.3), new THREE.Vector3(-0.27, 1.5, 0.33)]),
          new THREE.LineBasicMaterial({ color: 0xdddddd })
        );
        char.body.add(b, string);
        char.holdR = 'holdUp';
      }
      setLayer(char.root, 1);
      ctx.scene.add(char.root);
      const node = pick(ids);
      const [x, z] = NODES[node];
      const npc = {
        char,
        pos: new THREE.Vector3(x + rand(-1, 1), 0, z + rand(-1, 1)),
        heading: rand(0, Math.PI * 2),
        node,
        prev: null,
        target: new THREE.Vector3(),
        speed: kid ? rand(1.4, 1.9) : rand(1.0, 1.5),
        offset: rand(-1.2, 1.2),
        wait: rand(0, 3),
        greeting: false,
      };
      this.pickNext(npc);
      this.npcs.push(npc);
      ctx.interactions.add({
        pos: (o) => o.copy(npc.pos),
        radius: 1.9,
        markerHeight: 2.3 * (char.look.scale ?? 1),
        label: 'Wish them Happy Diwali 🙏',
        enabled: () => ctx.player.mode === 'walk' && !npc.greeting,
        action: () => this.greet(npc),
      });
    }
  }

  pickNext(npc) {
    const options = GRAPH[npc.node].filter((n) => n !== npc.prev);
    const next = pick(options.length ? options : GRAPH[npc.node]);
    npc.prev = npc.node;
    npc.node = next;
    const [x, z] = NODES[next];
    const isLinger = NODES[next][2];
    // walk a little to one side of the path so the crowd doesn't march in single file
    const dx = x - npc.pos.x;
    const dz = z - npc.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const off = isLinger ? npc.offset * 0.6 : npc.offset;
    npc.target.set(x + (-dz / len) * off, 0, z + (dx / len) * off);
  }

  async greet(npc) {
    const { player, ui, tasks, passport } = this.ctx;
    npc.greeting = true;
    player.setBusy(true);
    player.faceTowards(npc.pos.x, npc.pos.z);
    npc.heading = Math.atan2(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z);
    player.char.setAction('namaste');
    ui.bubble((o) => player.headWorld(o), 'Happy Diwali! 🪔', 2.2);
    await tasks.wait(0.7);
    npc.char.setAction('namaste');
    // a creator's own crowd lines come up half the time
    const mine = LINES.filter((l) => l.startsWith('shout.') && slotSet(l));
    const line = mine.length && Math.random() < 0.5 ? pick(mine) : pick(LINES);
    ui.bubble((o) => npc.char.headTop.getWorldPosition(o), line.startsWith('shout.') ? slot(line) : line, 2.8);
    await tasks.wait(1.6);
    player.char.clearAction();
    player.setBusy(false);
    passport.stamp('greet');
    await tasks.wait(0.8);
    npc.char.clearAction();
    npc.greeting = false;
    npc.wait = 1;
  }

  /** Everyone within r turns to (x, z) and cheers for a while. */
  cheerNear(x, z, r) {
    for (const npc of this.npcs) {
      if (npc.greeting || Math.hypot(npc.pos.x - x, npc.pos.z - z) > r) continue;
      npc.heading = Math.atan2(x - npc.pos.x, z - npc.pos.z);
      npc.char.setAction('cheer');
      npc.wait = Math.max(npc.wait, 6);
    }
  }

  /** Vehicles push people out of the way (and get a reaction). */
  pushAway(x, z, r) {
    for (const npc of this.npcs) {
      const dx = npc.pos.x - x;
      const dz = npc.pos.z - z;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) {
        npc.pos.x = x + (dx / d) * r;
        npc.pos.z = z + (dz / d) * r;
        if (!npc.greeting && npc.char.action !== 'cheer') {
          npc.char.setAction('cheer');
          npc.wait = Math.max(npc.wait, 1.2);
        }
      }
    }
  }

  update(dt, camera) {
    const { player, world } = this.ctx;
    // every Character past 60 m (here, at the stalls, rides and shows) animates every 3rd frame
    setViewer(camera.position);
    for (const npc of this.npcs) {
      let speed = 0;
      if (npc.greeting) {
        // stand still, facing the player
      } else if (npc.wait > 0) {
        npc.wait -= dt;
        if (npc.wait <= 0) {
          npc.char.clearAction();
          this.pickNext(npc);
        }
      } else {
        const dx = npc.target.x - npc.pos.x;
        const dz = npc.target.z - npc.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          const [, , kind, face] = NODES[npc.node];
          if (kind && Math.random() < 0.75) {
            npc.wait = rand(3, 9);
            npc.heading = face ?? npc.heading;
            npc.char.setAction(pick(ACTIONS[kind] ?? [null]));
          } else {
            this.pickNext(npc);
          }
        } else {
          let mx = dx / d;
          let mz = dz / d;
          // step aside for the player and for each other
          const px = npc.pos.x - player.pos.x;
          const pz = npc.pos.z - player.pos.z;
          const pd = Math.hypot(px, pz);
          if (pd < 1.4 && pd > 0.01) {
            mx += (px / pd) * (1.4 - pd) * 1.5;
            mz += (pz / pd) * (1.4 - pd) * 1.5;
          }
          for (const o of this.npcs) {
            if (o === npc) continue;
            const ox = npc.pos.x - o.pos.x;
            const oz = npc.pos.z - o.pos.z;
            const od = ox * ox + oz * oz;
            if (od < 0.64 && od > 1e-4) {
              const s = Math.sqrt(od);
              mx += (ox / s) * (0.8 - s);
              mz += (oz / s) * (0.8 - s);
            }
          }
          const ml = Math.hypot(mx, mz) || 1;
          speed = npc.speed;
          npc.pos.x += (mx / ml) * speed * dt;
          npc.pos.z += (mz / ml) * speed * dt;
          world.collide(npc.pos, 0.3);
          const want = Math.atan2(mx, mz);
          let dh = want - npc.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          npc.heading += dh * (1 - Math.exp(-dt * 8));
        }
      }
      npc.char.root.position.copy(npc.pos);
      npc.char.root.rotation.y = npc.heading;
      npc.char.update(dt, { speed });
    }
  }
}
