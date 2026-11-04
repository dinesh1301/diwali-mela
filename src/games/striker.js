import { tk } from '../touch.js';
import * as THREE from 'three';
import { hammerMesh } from '../items.js';
import { canvasTexture } from '../utils.js';
import { lowDetail } from '../lod.js';

const G = 9.8;
const SWINGS = 3;
const BASE_Y = 0.6;
const BELL_Y = 6.45;
const SWEET = 0.92;
const RANKS = [
  [0.3, 'Kamzor 😅'],
  [0.55, 'Theek-thaak 🙂'],
  [0.75, 'Taakatwar 💪'],
  [SWEET, 'Pehelwan! 🏋️'],
  [2, 'BAHUBALI! 🔔'],
];
const _v = new THREE.Vector3();
const rank = (p) => RANKS.find(([max]) => p < max)[1];

/** Taakat Pariksha: time the swing on an oscillating power meter to ring the bell. */
export class Striker {
  constructor(ctx, booth) {
    this.ctx = ctx;
    this.booth = booth;
    this.title = '🔔 Taakat Pariksha';
    this.help = `Click, tap or press Space when the power is in the green zone. ${SWINGS} swings to ring the bell!`;
    this.helpLines = [['Click', 'Swing the hammer'], ['Space', 'Swing'], ['Esc', 'Leave']];
    this.tapHelp = `Tap anywhere when the power is in the green zone. ${SWINGS} swings to ring the bell!`;
    this.tapLines = [['👆', 'Tap to swing'], ['✕', 'Leave']];
    const g = booth.group;

    const scale = canvasTexture(128, 1024, (c, w, h) => {
      const grd = c.createLinearGradient(0, h, 0, 0);
      grd.addColorStop(0, '#2a9d8f');
      grd.addColorStop(0.5, '#ffd166');
      grd.addColorStop(0.85, '#ff7a00');
      grd.addColorStop(1, '#e63946');
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = 0; y < h; y += 32) c.fillRect(0, y, w * 0.3, 3);
      c.save();
      c.translate(w / 2 + 14, h / 2);
      c.rotate(-Math.PI / 2);
      c.fillStyle = '#2a0c00';
      c.font = '44px "Yatra One", serif';
      c.textAlign = 'center';
      c.fillText('Kamzor · Taakatwar · Pehelwan · BAHUBALI', 0, 14);
      c.restore();
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 6.2), new THREE.MeshStandardMaterial({ map: scale, roughness: 0.7, emissive: 0xffffff, emissiveMap: scale, emissiveIntensity: 0.25 }));
    board.position.set(0, 3.55, -1.82);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.75, roughness: 0.3 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.0, 7.0, 0.2), wood);
    post.position.set(0, 3.5, -1.95);
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.06, 6.0, 0.05), gold);
    track.position.set(0, 3.5, -1.76);
    this.puck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.12), new THREE.MeshStandardMaterial({ color: 0xe63946, emissive: 0x5a0000, roughness: 0.4 }));
    this.puck.position.set(0, BASE_Y, -1.68);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    bell.position.set(0, 6.7, -1.72);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.6), new THREE.MeshStandardMaterial({ color: 0xb3122e, roughness: 0.5 }));
    pad.position.set(0, 0.09, -0.9);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.9), gold);
    lever.position.set(0, 0.2, -1.25);
    g.add(board, post, track, this.puck, bell, pad, lever);
    this.bell = bell;

    // bulbs up both sides light to the height the puck reaches
    const pts = [];
    for (const x of [-0.5, 0.5]) for (let i = 0; i < 22; i++) pts.push(new THREE.Vector3(x, BASE_Y + (i / 21) * (BELL_Y - BASE_Y), -1.78));
    this.bulbs = new THREE.InstancedMesh(lowDetail() ? new THREE.IcosahedronGeometry(0.06, 0) : new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial(), pts.length);
    pts.forEach((p, i) => {
      this.bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      this.bulbs.setColorAt(i, new THREE.Color(1, 1, 1));
    });
    this.bulbs.layers.set(1);
    g.add(this.bulbs);
    this.bulbY = pts.map((p) => p.y);
    this.lit = 0;
    this.flash = 0;
    this.tmp = new THREE.Color();

    this.hammer = hammerMesh();
    this.stand = { ...booth.w(0, 0, 0.05), heading: Math.PI / 2 };
    this.camPos = booth.w(2.4, 2.3, 4.4);
    this.camLook = booth.w(0, 2.9, -1.4);
    this.puckY = BASE_Y;
    this.puckV = 0;
  }

  start() {
    this.left = SWINGS;
    this.best = 0;
    this.rang = false;
    this.state = 'aim';
    this.ending = false;
    this.lit = 0;
    this.phase = 0;
    const { player, ui } = this.ctx;
    player.hold(this.hammer, 'hammer', { pose: null, attach: true, offset: [0, -0.02, 0] });
    player.char.setAction('hammer', 0.85);
    this.stats();
    ui.gameHud.bar(0, { label: 'POWER', zone: [SWEET, 1] });
  }

  stats() {
    this.ctx.ui.gameHud.stats(`Swings <b>${this.left}</b> · Best <b>${this.best ? rank(this.best) : '–'}</b>`);
  }

  update(dt, t) {
    const { input, ui } = this.ctx;
    if (this.state === 'aim') {
      this.phase += dt;
      this.power = (1 - Math.cos(this.phase * 4.4)) / 2;
      ui.gameHud.bar(this.power, { label: 'POWER', zone: [SWEET, 1] });
      if (input.pointerPressed || input.pressedAction('jump') || input.pressedAction('interact')) this.swing(this.power);
    }

    if (this.puckV !== 0 || this.puckY > BASE_Y) {
      this.puckV -= G * dt;
      this.puckY += this.puckV * dt;
      if (this.puckY >= BELL_Y) {
        this.puckY = BELL_Y;
        this.puckV = -1;
      }
      if (this.puckY <= BASE_Y) {
        this.puckY = BASE_Y;
        this.puckV = 0;
      }
      this.lit = Math.max(this.lit, this.puckY);
    }
    this.puck.position.y = this.puckY;
    this.flash = Math.max(0, this.flash - dt);
    const c = this.tmp;
    for (let i = 0; i < this.bulbY.length; i++) {
      const on = this.bulbY[i] <= this.lit + 0.01;
      if (this.flash > 0) c.setHSL((t * 2 + i * 0.05) % 1, 1, 0.6).multiplyScalar(3);
      else c.set(on ? 0xffc94a : 0x3a2a1a).multiplyScalar(on ? 3 : 1);
      this.bulbs.setColorAt(i, c);
    }
    this.bulbs.instanceColor.needsUpdate = true;
  }

  async swing(p) {
    const { player, tasks, audio, debris, ui } = this.ctx;
    this.state = 'swing';
    this.lit = BASE_Y;
    ui.gameHud.bar(p, { label: 'POWER', zone: [SWEET, 1] });
    player.char.snappy = false;
    await tasks.tween(0.35, (k) => (player.char.actionParam = 0.85 * (1 - k)));
    await tasks.wait(0.08);
    player.char.snappy = true;
    await tasks.tween(0.12, (k) => (player.char.actionParam = k));
    audio.thud();
    debris.burst(this.booth.w(0, 0.2, -0.9), { count: 14, colors: [0x8a6a48, 0xc8a06a], speed: 1.6, up: 1.2, size: 0.04, life: 1, floor: 0.12 });
    const bell = p >= SWEET;
    const h = bell ? BELL_Y - BASE_Y + 0.3 : (BELL_Y - BASE_Y) * Math.pow(p / SWEET, 1.3) * 0.93;
    this.puckV = Math.sqrt(2 * G * h);
    this.left--;
    this.best = Math.max(this.best, p);
    this.stats();
    const head = (o) => player.headWorld(o);
    if (bell) {
      this.rang = true;
      setTimeout(() => {
        audio.ding(0.45);
        audio.cheer();
        this.flash = 2.5;
        this.bell.getWorldPosition(_v);
        debris.burst(_v, { count: 40, colors: [0xffd166, 0xff006e, 0x06d6a0, 0x3a86ff], speed: 3, up: 2, size: 0.06, flat: true, life: 2.5, floor: 0.1 });
      }, (Math.sqrt(2 * h / G) * 1000) | 0);
    }
    ui.bubble(head, rank(p), 1.8);
    await tasks.wait(0.4);
    player.char.snappy = false;
    player.char.actionParam = 0.85;
    await tasks.wait(1.4);
    if (this.ctx.player.mode !== 'game') return;
    if (this.left > 0) {
      this.state = 'aim';
      this.phase = Math.random() * 3;
      return;
    }
    this.state = 'done';
    this.ctx.net?.submitScore('striker', +this.best.toFixed(3));
    this.finish({
      icon: this.rang ? '🔔' : '💪',
      title: this.rang ? 'You rang the bell!' : `Best: ${rank(this.best)}`,
      text: this.rang ? `Asli Bahubali! You won ${this.prizeName ?? 'a gift box'} 🎁` : 'Swing in the green zone to ring the bell. Again?',
      win: this.rang,
      prize: 'gift',
      stamp: 'striker',
    });
  }

  stop() {
    const { player, ui } = this.ctx;
    if (player.held?.obj === this.hammer) player.releaseHeld();
    this.hammer.removeFromParent();
    player.char.clearAction();
    ui.gameHud.bar(null);
    this.state = 'done';
  }
}

