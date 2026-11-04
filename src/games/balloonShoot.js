import * as THREE from 'three';
import { canvasTexture, pick, clamp } from '../utils.js';
import { toyGunMesh } from '../items.js';

// bullet holes share one geometry and material, so a round's marks cost nothing to throw away
const MARK_GEO = new THREE.CircleGeometry(0.025, 10);
const MARK_MAT = new THREE.MeshBasicMaterial({ color: 0x111111 });

const COLORS = [0xff006e, 0xffbe0b, 0x3a86ff, 0x06d6a0, 0xfb5607, 0x8338ec, 0xff5d8f];
const SHOTS = 10;
const TO_WIN = 7;

/** Gubbara Phod: pop balloons on a board with a toy rifle. */
export class BalloonShoot {
  constructor(ctx, booth) {
    this.ctx = ctx;
    this.booth = booth;
    this.title = '🎯 Gubbara Phod';
    this.help = `Click or tap balloons to shoot. ${SHOTS} shots. Pop ${TO_WIN} to win a teddy!`;
    this.helpLines = [['Click', 'Shoot'], ['Space', 'Shoot at the crosshair'], ['Esc', 'Leave']];
    const g = booth.group;

    const cloth = canvasTexture(512, 256, (c, w, h) => {
      c.fillStyle = '#1b1f4a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,209,102,0.5)';
      for (let i = 0; i < 70; i++) {
        c.beginPath();
        c.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 0, Math.PI * 2);
        c.fill();
      }
    });
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.8), new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.9 }));
    this.board.position.set(0, 1.95, -2.3);
    g.add(this.board);
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.3 });
    for (const [x, y, sx, sy] of [[0, 3.38, 5.8, 0.1], [0, 0.52, 5.8, 0.1], [-2.85, 1.95, 0.1, 2.9], [2.85, 1.95, 0.1, 2.9]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.06), gold);
      bar.position.set(x, y, -2.27);
      g.add(bar);
    }

    const geo = new THREE.SphereGeometry(0.2, 16, 12).scale(1, 1.15, 1);
    this.balloons = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 6; col++) {
        const color = pick(COLORS);
        const b = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.3, emissive: new THREE.Color(color).multiplyScalar(0.25) }));
        b.userData = { color, home: new THREE.Vector3(-2.0 + col * 0.8, 1.05 + row * 0.6, -2.08), phase: Math.random() * 6 };
        b.position.copy(b.userData.home);
        b.layers.set(1);
        g.add(b);
        this.balloons.push(b);
      }
    }

    this.gun = toyGunMesh();
    this.marks = [];
    this.ray = new THREE.Raycaster();
    this.ray.layers.enableAll();
    this.stand = { ...booth.w(0, 0, 4.4), heading: Math.PI / 2 };
    this.camPos = booth.w(0.55, 2.2, 6.1);
    this.camLook = booth.w(0, 1.85, -2.2);
    this.ndc = new THREE.Vector2();
  }

  start() {
    this.shots = SHOTS;
    this.popped = 0;
    this.recoil = 0;
    this.ending = false;
    this.balloons.forEach((b) => (b.visible = true));
    this.marks.forEach((m) => m.removeFromParent());
    this.marks = [];
    const { player, ui } = this.ctx;
    player.hold(this.gun, 'gun', { pose: null, offset: [0, 0.02, 0.12] });
    player.char.setAction('aim', 0);
    this.stats();
    ui.crosshair(innerWidth / 2, innerHeight / 2);
  }

  stats() {
    this.ctx.ui.gameHud.stats(`Shots <b>${this.shots}</b> · Popped <b>${this.popped}</b> / ${TO_WIN} to win`);
  }

  update(dt, t) {
    const { input, ui, player, camera } = this.ctx;
    this.balloons.forEach((b) => (b.position.y = b.userData.home.y + Math.sin(t * 1.5 + b.userData.phase) * 0.04));
    ui.crosshair(input.pointer.x, input.pointer.y);
    input.ndc(this.ndc);
    this.ray.setFromCamera(this.ndc, camera);
    const d = this.ray.ray.direction;
    player.targetHeading = clamp(Math.atan2(d.x, d.z), Math.PI / 2 - 0.5, Math.PI / 2 + 0.5);
    this.recoil = Math.max(0, this.recoil - dt * 5);
    player.char.actionParam = this.recoil;
    if (!this.ending && this.shots > 0 && (input.pointerPressed || input.pressedAction('jump'))) this.shoot();
  }

  shoot() {
    const { audio, debris } = this.ctx;
    this.shots--;
    this.recoil = 1;
    audio.pew();
    const hit = this.ray.intersectObjects(this.balloons.filter((b) => b.visible), false)[0];
    if (hit) {
      hit.object.visible = false;
      this.popped++;
      audio.pop();
      debris.burst(hit.point, { count: 14, colors: [hit.object.userData.color], speed: 2.2, up: 1.5, size: 0.05, flat: true, life: 1.4, floor: 0.1 });
    } else {
      const b = this.ray.intersectObject(this.board, false)[0];
      if (b) {
        const mark = new THREE.Mesh(MARK_GEO, MARK_MAT);
        this.booth.group.add(mark);
        this.booth.group.worldToLocal(mark.position.copy(b.point));
        mark.position.z += 0.01;
        mark.layers.set(1);
        this.marks.push(mark);
        audio.thud();
      }
    }
    this.stats();
    if (this.shots === 0) {
      this.ending = true;
      setTimeout(() => {
        const win = this.popped >= TO_WIN;
        this.finish({
          icon: win ? '🧸' : '🎈',
          title: `${this.popped} / ${SHOTS} popped`,
          text: win ? 'Shabash, sharpshooter! You won a teddy bear 🧸' : `Pop ${TO_WIN} to win a prize. One more try?`,
          win,
          prize: 'teddy',
          stamp: 'shoot',
        });
      }, 900);
    }
  }

  stop() {
    const { player, ui } = this.ctx;
    if (player.held?.obj === this.gun) player.releaseHeld();
    this.gun.removeFromParent();
    player.char.clearAction();
    ui.crosshair(null);
  }
}
