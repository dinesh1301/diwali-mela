import * as THREE from 'three';
import { ringMesh } from '../items.js';
import { hdr, clamp, rand } from '../utils.js';

const G = 9.8;
const RINGS = 5;
const TO_WIN = 2;
const TABLE_TOP = 0.93;
const BOTTLE_H = 0.335;
const RING_COLORS = [0xff006e, 0xffbe0b, 0x3a86ff, 0x06d6a0, 0xfb5607];

const _v = new THREE.Vector3();
const _n = new THREE.Vector2();

/** Ring toss: land a ring over a bottle neck. The aim wobbles like a real wrist. */
export class RingToss {
  constructor(ctx, booth) {
    this.ctx = ctx;
    this.booth = booth;
    this.title = '⭕ Ring Toss';
    this.help = `Point at a bottle and click or tap to toss. ${RINGS} rings, ring ${TO_WIN} bottles to win!`;
    this.helpLines = [['Click', 'Toss a ring'], ['Esc', 'Leave']];
    const g = booth.group;

    const table = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 2.4), new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.8 }));
    table.position.set(0, 0.45, -0.9);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.03, 2.5), new THREE.MeshStandardMaterial({ color: 0xb3122e, roughness: 0.9 }));
    cloth.position.set(0, 0.915, -0.9);
    g.add(table, cloth);

    const profile = [[0, 0], [0.06, 0], [0.065, 0.17], [0.04, 0.23], [0.024, 0.27], [0.024, 0.33], [0.028, 0.335], [0, 0.335]].map(([x, y]) => new THREE.Vector2(x, y));
    const bottleGeo = new THREE.LatheGeometry(profile, 16);
    const glass = [0x2d6a4f, 0x7f5539, 0x1d3557].map((c) => new THREE.Color(c));
    // twelve bottles, one instanced draw; rows go back to front so the glass blends the way the
    // separately sorted bottles did when seen from the throwing line
    const bottles = new THREE.InstancedMesh(bottleGeo, new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85 }), 12);
    const m4 = new THREE.Matrix4();
    this.bottles = [];
    let k = 0;
    for (const lz of [-1.75, -1.0, -0.25]) {
      for (const lx of [-1.5, -0.5, 0.5, 1.5]) {
        bottles.setMatrixAt(k, m4.makeTranslation(lx, TABLE_TOP, lz));
        bottles.setColorAt(k, glass[k % 3]);
        k++;
        this.bottles.push(booth.w(lx, 0, lz));
      }
    }
    bottles.computeBoundingSphere();
    g.add(bottles);
    const a = booth.w(-2.35, 0, -2.15);
    const b = booth.w(2.35, 0, 0.35);
    this.table = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };

    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.135, 32), new THREE.MeshBasicMaterial({ color: hdr(0xffd166, 1.6), transparent: true, opacity: 0.85, depthWrite: false }));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.visible = false;
    this.reticle.layers.set(1);
    ctx.scene.add(this.reticle);

    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(TABLE_TOP + BOTTLE_H));
    this.ray = new THREE.Raycaster();
    this.rings = [];
    this.stand = { ...booth.w(0, 0, 4.1), heading: Math.PI / 2 };
    this.camPos = booth.w(0.6, 2.5, 6.0);
    this.camLook = booth.w(0, 1.0, -1.0);
    this.aim = new THREE.Vector3();
  }

  start() {
    this.left = RINGS;
    this.ringed = 0;
    this.ending = false;
    this.rings.forEach((r) => r.mesh.removeFromParent());
    this.rings = [];
    this.reticle.visible = true;
    this.giveRing();
    this.stats();
  }

  stats() {
    this.ctx.ui.gameHud.stats(`Rings <b>${this.left}</b> · Ringed <b>${this.ringed}</b> / ${TO_WIN} to win`);
  }

  giveRing() {
    if (this.left <= 0) return;
    const mesh = ringMesh(RING_COLORS[(RINGS - this.left) % RING_COLORS.length]);
    mesh.layers.set(1);
    this.ctx.player.hold(mesh, 'ring', { pose: 'hold', offset: [0, 0.02, 0.06] });
    this.inHand = mesh;
  }

  update(dt, t) {
    const { input, camera, player } = this.ctx;
    this.ray.setFromCamera(input.ndc(_n), camera);
    if (this.ray.ray.intersectPlane(this.plane, _v)) {
      this.aim.set(clamp(_v.x, this.table.minX - 0.5, this.table.maxX + 0.5), _v.y, clamp(_v.z, this.table.minZ - 0.5, this.table.maxZ + 0.5));
    }
    const wob = 0.09;
    this.reticle.position.set(
      this.aim.x + Math.sin(t * 2.1) * wob + Math.sin(t * 5.3) * 0.03,
      TABLE_TOP + BOTTLE_H + 0.01,
      this.aim.z + Math.cos(t * 1.7) * wob + Math.cos(t * 4.1) * 0.03
    );
    player.targetHeading = Math.atan2(this.reticle.position.x - player.pos.x, this.reticle.position.z - player.pos.z);

    if (!this.ending && this.inHand && (input.pointerPressed || input.pressedAction('jump'))) this.toss(this.reticle.position.clone());

    for (const r of this.rings) this.step(r, dt);

    if (!this.ending && this.left === 0 && !this.inHand && this.rings.every((r) => r.state === 'rest')) {
      this.ending = true;
      setTimeout(() => {
        const win = this.ringed >= TO_WIN;
        this.finish({
          icon: win ? '🎁' : '⭕',
          title: `${this.ringed} ringed!`,
          text: win ? 'Wah! You won a gift box 🎁' : `Ring ${TO_WIN} bottles to win. Have another go?`,
          win,
          prize: 'gift',
          stamp: 'rings',
        });
      }, 700);
    }
  }

  toss(target) {
    const { player, audio, tasks } = this.ctx;
    const mesh = this.inHand;
    this.inHand = null;
    player.releaseHeld();
    this.left--;
    this.stats();
    target.x += rand(-0.03, 0.03);
    target.z += rand(-0.03, 0.03);
    const start = mesh.position.clone();
    const T = 0.75 + start.distanceTo(target) * 0.04;
    const vel = new THREE.Vector3((target.x - start.x) / T, (target.y - start.y + 0.5 * G * T * T) / T, (target.z - start.z) / T);
    this.rings.push({ mesh, vel, state: 'fly', prevY: start.y, slideTo: 0 });
    audio.whoosh();
    player.char.setAction('throw', 0, { snappy: true });
    tasks.tween(0.2, (k) => (player.char.actionParam = k)).then(() => setTimeout(() => player.char.clearAction(), 250));
    setTimeout(() => this.ctx.player.mode === 'game' && this.giveRing(), 600);
  }

  step(r, dt) {
    const p = r.mesh.position;
    if (r.state === 'fly') {
      r.prevY = p.y;
      r.vel.y -= G * dt;
      p.addScaledVector(r.vel, dt);
      r.mesh.rotation.y += 9 * dt;
      const topY = TABLE_TOP + BOTTLE_H;
      if (r.prevY >= topY && p.y < topY) {
        let best = null;
        let bestD = Infinity;
        for (const b of this.bottles) {
          const d = Math.hypot(p.x - b.x, p.z - b.z);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        if (bestD < 0.095) {
          p.x = best.x;
          p.z = best.z;
          r.state = 'slide';
          r.slideTo = TABLE_TOP + 0.21;
          this.ringed++;
          this.stats();
          this.ctx.audio.ding(0.3);
          this.ctx.debris.burst(p, { count: 16, colors: [0xffd166, 0xff006e, 0x06d6a0], speed: 1.5, up: 2, size: 0.04, flat: true, life: 1.4, floor: TABLE_TOP });
          return;
        }
        if (bestD < 0.16) {
          const dx = (p.x - best.x) / bestD;
          const dz = (p.z - best.z) / bestD;
          r.vel.set(dx * 1.6, 1.2, dz * 1.6);
          this.ctx.audio.clank();
        }
      }
      const onTable = p.x > this.table.minX && p.x < this.table.maxX && p.z > this.table.minZ && p.z < this.table.maxZ;
      const floor = onTable ? TABLE_TOP + 0.02 : 0.03;
      if (p.y <= floor) {
        p.y = floor;
        r.state = 'rest';
        this.ctx.audio.thud();
      }
    } else if (r.state === 'slide') {
      p.y -= 1.4 * dt;
      if (p.y <= r.slideTo) {
        p.y = r.slideTo;
        r.state = 'rest';
      }
    }
  }

  stop() {
    const { player } = this.ctx;
    if (this.inHand) {
      player.releaseHeld();
      this.inHand.removeFromParent();
      this.inHand = null;
    }
    player.char.clearAction();
    this.reticle.visible = false;
  }
}
