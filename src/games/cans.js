import { tk } from '../touch.js';
import * as THREE from 'three';
import { ballMesh } from '../items.js';
import { shape, merged } from '../character.js';
import { hdr, rand } from '../utils.js';

const G = 9.8;
const BALLS = 3;
const CAN_R = 0.075;
const SHELF_TOP = 1.1;
const LAYOUT = [
  [-0.16, 1.21, []],
  [0, 1.21, []],
  [0.16, 1.21, []],
  [-0.08, 1.43, [0, 1]],
  [0.08, 1.43, [1, 2]],
  [0, 1.65, [3, 4]],
];

const _n = new THREE.Vector2();
const _v = new THREE.Vector3();

/** Dabba Maar: three balls to knock a six-can pyramid off the shelf. Simple hand-rolled physics. */
export class Cans {
  constructor(ctx, booth) {
    this.ctx = ctx;
    this.booth = booth;
    this.title = '🥫 Dabba Maar';
    this.help = `Aim at the cans and click or tap to throw. ${BALLS} balls to knock all 6 off the shelf!`;
    this.helpLines = [['Click', 'Throw'], ['Esc', 'Leave']];
    this.tapHelp = `Tap a can to throw at it. ${BALLS} balls to knock all 6 off the shelf!`;
    this.tapLines = [['👆', 'Tap a can to throw'], ['✕', 'Leave']];
    const g = booth.group;

    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.8 });
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.0, SHELF_TOP, 0.7), wood);
    shelf.position.set(0, SHELF_TOP / 2, -1.0);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.2), new THREE.MeshStandardMaterial({ color: 0x3c1361, roughness: 0.95 }));
    curtain.position.set(0, 1.6, -2.28);
    g.add(shelf, curtain);

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.35 });
    const labels = [0xe63946, 0x2a9d8f, 0xffbe0b, 0x3a86ff, 0xff006e, 0x06d6a0];
    this.cans = LAYOUT.map(([lx, ly, supports], i) => {
      const mesh = merged(
        [
          shape(new THREE.CylinderGeometry(CAN_R, CAN_R, 0.05, 16), 0xcfd4da, [0, -0.085, 0]),
          shape(new THREE.CylinderGeometry(CAN_R, CAN_R, 0.12, 16), labels[i], [0, 0, 0]),
          shape(new THREE.CylinderGeometry(CAN_R, CAN_R, 0.05, 16), 0xcfd4da, [0, 0.085, 0]),
        ],
        material
      );
      mesh.layers.set(1);
      ctx.scene.add(mesh);
      return { mesh, home: booth.w(lx, ly, -1.0), supports, pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), angle: 0, spin: 0, dyn: false, wake: 0 };
    });

    const a = booth.w(-1.0, 0, -0.65);
    const b = booth.w(1.0, 0, -1.35);
    this.shelf = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
    this.backX = booth.w(0, 0, -2.25).x;
    this.sideZ = [booth.z - 3.4, booth.z + 3.4];
    this.plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), this.cans[0].home.x);

    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 28), new THREE.MeshBasicMaterial({ color: hdr(0xffd166, 1.6), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    this.reticle.rotation.y = -Math.PI / 2;
    this.reticle.visible = false;
    this.reticle.layers.set(1);
    ctx.scene.add(this.reticle);

    this.ray = new THREE.Raycaster();
    this.balls = [];
    this.stand = { ...booth.w(0, 0, 4.2), heading: Math.PI / 2 };
    this.camPos = booth.w(0.55, 1.95, 6.0);
    this.camLook = booth.w(0, 1.35, -1.0);
    this.aim = this.cans[1].home.clone();
  }

  start() {
    for (const c of this.cans) {
      c.pos.copy(c.home);
      c.vel.set(0, 0, 0);
      c.angle = 0;
      c.spin = 0;
      c.dyn = false;
      c.wake = 0;
      this.place(c);
    }
    this.balls.forEach((b) => b.mesh.removeFromParent());
    this.balls = [];
    this.left = BALLS;
    this.ending = false;
    this.lastThrow = 0;
    this.reticle.visible = true;
    this.giveBall();
    this.stats();
  }

  knocked() {
    return this.cans.filter((c) => c.dyn && (c.pos.distanceTo(c.home) > 0.2 || c.pos.y < c.home.y - 0.12)).length;
  }

  stats() {
    this.ctx.ui.gameHud.stats(`Balls <b>${this.left}</b> · Cans down <b>${this.knocked()}</b> / 6`);
  }

  giveBall() {
    if (this.left <= 0) return;
    const mesh = ballMesh();
    mesh.layers.set(1);
    this.ctx.player.hold(mesh, 'ball', { pose: 'hold', offset: [0, 0.05, 0.03] });
    this.inHand = mesh;
  }

  place(c) {
    c.mesh.position.copy(c.pos);
    c.mesh.quaternion.setFromAxisAngle(c.axis, c.angle);
  }

  update(dt, t) {
    const { input, camera, player } = this.ctx;
    this.ray.setFromCamera(input.ndc(_n), camera);
    if (this.ray.ray.intersectPlane(this.plane, _v)) this.aim.set(_v.x, THREE.MathUtils.clamp(_v.y, 0.6, 2.4), THREE.MathUtils.clamp(_v.z, this.booth.z - 2.5, this.booth.z + 2.5));
    this.reticle.position.set(this.aim.x - 0.4, this.aim.y + Math.sin(t * 1.9) * 0.05 + Math.sin(t * 4.7) * 0.015, this.aim.z + Math.cos(t * 1.4) * 0.06);
    player.targetHeading = Math.atan2(this.reticle.position.x - player.pos.x, this.reticle.position.z - player.pos.z);

    if (!this.ending && this.inHand && (input.pointerPressed || input.pressedAction('jump'))) {
      this.throwBall(_v.set(this.aim.x, this.reticle.position.y, this.reticle.position.z));
    }

    const steps = 3;
    for (let s = 0; s < steps; s++) this.physics(dt / steps);
    this.cans.forEach((c) => this.place(c));
    this.lastThrow += dt;

    const down = this.knocked();
    if (!this.ending && !this.inHand && ((this.left === 0 && this.lastThrow > 2.5) || (down === 6 && this.lastThrow > 1.2))) {
      this.ending = true;
      this.stats();
      const win = down === 6;
      setTimeout(
        () =>
          this.finish({
            icon: win ? '🏆' : '🥫',
            title: win ? 'All 6 down!' : `${down} of 6 down`,
            text: win ? 'Dabba gul! You won a teddy bear 🧸' : 'Knock all six off to win. Try again?',
            win,
            prize: 'teddy',
            stamp: 'cans',
          }),
        500
      );
    }
  }

  throwBall(target) {
    const { player, audio, tasks } = this.ctx;
    const mesh = this.inHand;
    this.inHand = null;
    player.releaseHeld();
    this.left--;
    this.lastThrow = 0;
    const start = mesh.position.clone();
    const T = start.distanceTo(target) / 14;
    const vel = new THREE.Vector3((target.x - start.x) / T, (target.y - start.y + 0.5 * G * T * T) / T, (target.z - start.z) / T);
    this.balls.push({ mesh, vel, age: 0 });
    audio.whoosh();
    player.char.setAction('throw', 0, { snappy: true });
    tasks.tween(0.18, (k) => (player.char.actionParam = k)).then(() => setTimeout(() => player.char.clearAction(), 250));
    this.stats();
    setTimeout(() => this.ctx.player.mode === 'game' && this.giveBall(), 700);
  }

  physics(dt) {
    const { audio } = this.ctx;
    const onShelf = (p) => p.x > this.shelf.minX && p.x < this.shelf.maxX && p.z > this.shelf.minZ && p.z < this.shelf.maxZ;

    for (const b of this.balls) {
      const p = b.mesh.position;
      b.age += dt;
      b.vel.y -= G * dt;
      p.addScaledVector(b.vel, dt);
      const floor = onShelf(p) && p.y > SHELF_TOP - 0.05 ? SHELF_TOP + 0.07 : 0.07;
      if (p.y < floor) {
        p.y = floor;
        b.vel.y = Math.abs(b.vel.y) * 0.4;
        b.vel.x *= 0.7;
        b.vel.z *= 0.7;
      }
      if (p.x > this.backX - 0.07) {
        p.x = this.backX - 0.07;
        b.vel.x = -Math.abs(b.vel.x) * 0.3;
      }
      for (const c of this.cans) {
        if (p.distanceTo(c.pos) < 0.07 + 0.1) {
          if (!c.dyn) this.wake(c);
          c.vel.addScaledVector(b.vel, 0.55);
          c.vel.y += rand(0.8, 1.6);
          c.spin = rand(8, 14);
          c.axis.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
          b.vel.multiplyScalar(-0.3);
          p.add(_v.subVectors(p, c.pos).setLength(0.05));
          audio.clank();
        }
      }
    }

    for (const c of this.cans) {
      if (!c.dyn) {
        if (c.supports.some((i) => this.cans[i].dyn)) {
          c.wake += dt;
          if (c.wake > 0.05) {
            this.wake(c);
            c.vel.set(rand(-0.6, 0.6), 0.3, rand(-0.6, 0.6));
            c.spin = rand(3, 7);
            c.axis.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
          }
        }
        continue;
      }
      c.vel.y -= G * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.angle += c.spin * dt;
      const floor = onShelf(c.pos) && c.pos.y > SHELF_TOP - 0.02 ? SHELF_TOP + CAN_R : CAN_R;
      if (c.pos.y < floor) {
        c.pos.y = floor;
        c.vel.y = Math.abs(c.vel.y) * 0.3;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin *= 0.6;
        if (c.vel.length() < 0.25) {
          c.vel.set(0, 0, 0);
          c.spin = 0;
        }
      }
      if (c.pos.x > this.backX - CAN_R) {
        c.pos.x = this.backX - CAN_R;
        c.vel.x = -Math.abs(c.vel.x) * 0.3;
      }
      c.pos.z = THREE.MathUtils.clamp(c.pos.z, this.sideZ[0], this.sideZ[1]);
      for (const o of this.cans) {
        if (o === c || o.dyn) continue;
        if (c.pos.distanceTo(o.pos) < 0.16 && c.vel.lengthSq() > 0.5) {
          this.wake(o);
          o.vel.copy(c.vel).multiplyScalar(0.6);
          o.vel.y += 0.5;
          o.spin = rand(5, 10);
          o.axis.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
          audio.clank();
        }
      }
    }
  }

  wake(c) {
    c.dyn = true;
    this.stats();
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

