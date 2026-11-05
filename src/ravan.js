import { tk } from './touch.js';
import * as THREE from 'three';
import { shape, merged } from './character.js';
import { beam, canvasTexture, rand, setLayer, pick } from './utils.js';
import { signTexture } from './stalls.js';
import { slot } from './personalSlots.js';
import { CONFIG } from './config.js';

/*
  Ravan Dahan: a twelve-metre effigy on the Ramleela maidan that burns on a schedule, with
  crackers going off inside it, so everyone gathers for the same moment. A countdown chip
  sits in the HUD; anyone nearby can light it early with a short fuse.
*/
const POS = new THREE.Vector3(-56, 0, 64);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

export class Ravan {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene, world, interactions, player } = ctx;
    this.group = new THREE.Group();
    this.group.position.copy(POS);
    scene.add(this.group);
    this.state = 'idle'; // idle | burning | ash
    this.burnT = 0;
    this.nextAt = null;
    this.warned = false;
    this.lastChip = '';

    const skin = 0x3a9a3a; // the traditional green Ravan
    const paint = canvasTexture(256, 512, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f4b400');
      g.addColorStop(0.5, '#e0218a');
      g.addColorStop(1, '#3a86ff');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      for (let y = 30; y < h; y += 60) for (let x = 20; x < w; x += 50) {
        c.beginPath();
        c.arc(x, y, 12, 0, Math.PI * 2);
        c.fill();
      }
    });
    this.bodyMat = std(0xffffff, 0.9, { map: paint, emissive: 0x000000 });
    this.skinMat = std(skin, 0.8, { emissive: 0x000000 });
    this.goldMat = std(0xd4a017, 0.35, { metalness: 0.7, emissive: 0x000000 });

    const body = new THREE.Group();
    this.body = body;
    this.group.add(body);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 5, 12), this.bodyMat);
    torso.position.y = 5.5;
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.2, 12, 1, true), this.bodyMat);
    skirt.position.y = 1.6;
    body.add(torso, skirt);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.18, 8, 24), this.goldMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 3.4;
    body.add(belt);
    // ten heads in a row
    const headGeo = new THREE.SphereGeometry(0.62, 14, 10);
    const faceParts = [];
    for (let i = -4; i <= 5; i++) {
      const centre = i === 0 || i === 1;
      const x = (i - 0.5) * 1.15;
      const yy = 8.9 + (centre ? 0.35 : 0);
      const sc = centre ? 1.15 : 1;
      faceParts.push(shape(headGeo.clone(), skin, [x, yy, 0], [], [sc, sc, sc]));
      faceParts.push(shape(new THREE.BoxGeometry(0.5 * sc, 0.1, 0.1), 0x111111, [x, yy - 0.12 * sc, 0.58 * sc]));
      faceParts.push(shape(new THREE.SphereGeometry(0.07, 6, 5), 0x111111, [x - 0.2 * sc, yy + 0.12 * sc, 0.55 * sc]));
      faceParts.push(shape(new THREE.SphereGeometry(0.07, 6, 5), 0x111111, [x + 0.2 * sc, yy + 0.12 * sc, 0.55 * sc]));
      faceParts.push(shape(new THREE.ConeGeometry(0.42 * sc, 0.7, 6), 0xd4a017, [x, yy + 0.85 * sc, 0]));
    }
    this.heads = merged(faceParts, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: 0x000000 }));
    body.add(this.heads);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(11, 0.5, 1.2), this.goldMat);
    neck.position.y = 8.1;
    body.add(neck);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 3.6, 10), this.skinMat);
      arm.position.set(s * 2.6, 6.6, 0);
      arm.rotation.z = s * 1.1;
      body.add(arm);
    }
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.2, 0.5), std(0xcfd4da, 0.3, { metalness: 0.8 }));
    sword.position.set(4.2, 9.6, 0);
    body.add(sword);
    const shield = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16), this.goldMat);
    shield.position.set(-4.2, 8.2, 0.3);
    body.add(shield);
    const mala = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.16, 8, 28), std(0xff7b00, 0.9));
    mala.position.y = 7.2;
    mala.rotation.x = 0.4;
    body.add(mala);
    // bamboo scaffold at the back
    for (const x of [-1.2, 1.2]) this.group.add(beam(V(x, 0, -1.9), V(x, 10.5, -1.9), 0.07, std(0xc9a46a)));
    for (const y of [3, 6, 9]) this.group.add(beam(V(-1.2, y, -1.9), V(1.2, y, -1.9), 0.05, std(0xc9a46a)));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.3, 0.5, 16), std(0x6b5a48, 0.95));
    base.position.y = 0.25;
    this.group.add(base);
    setLayer(this.group, 0); // big enough to reflect in the river and cast real shadows
    this.group.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    world.colliders.push({ type: 'circle', x: POS.x, z: POS.z, r: 3.6 });
    world.tall.push({ type: 'circle', x: POS.x, z: POS.z, r: 6, h: 13 });

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 1.0),
      new THREE.MeshBasicMaterial({ map: signTexture(slot('sign.ravan'), tk('Burns on the hour · press E to light the fuse', 'Burns on the hour · tap the button to light the fuse'), '#4a0d0d', '#ffe7a3', 1024, 288), color: new THREE.Color(1, 1, 1), side: THREE.DoubleSide })
    );
    sign.position.set(POS.x + 5.5, 2.4, POS.z + 1);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);
    scene.add(beam(V(POS.x + 5.5, 0, POS.z + 1), V(POS.x + 5.5, 1.9, POS.z + 1), 0.06, std(0x3d2a1c)));
    const lamp = new THREE.PointLight(0xffb46b, 50, 24, 2);
    lamp.position.set(POS.x, 6, POS.z + 6);
    scene.add(lamp);
    this.fire = new THREE.PointLight(0xff6a1c, 0, 40, 1.6);
    this.fire.position.set(POS.x, 4, POS.z);
    scene.add(this.fire);

    interactions.add({
      pos: V(POS.x + 4.4, 0, POS.z + 1),
      radius: 3,
      markerHeight: 3,
      markAt: V(POS.x, 8, POS.z),
      label: 'Light the Ravan now 🔥 (15 s fuse)',
      enabled: () => player.mode === 'walk' && this.state === 'idle' && this.remaining() > 40,
      action: () => this.lightFuse(),
    });
  }

  start() {
    this.nextAt = performance.now() + CONFIG.ravanFirstAfterMinutes * 60000;
  }

  remaining() {
    return this.nextAt ? Math.max(0, (this.nextAt - performance.now()) / 1000) : Infinity;
  }

  lightFuse() {
    const { ui, player } = this.ctx;
    this.nextAt = performance.now() + 15000;
    this.warned = true;
    ui.toast('🔥 The fuse is lit! Ravan Dahan in 15 seconds at the Ramleela Maidan', 5000, { important: true });
    this.ctx.net?.sendBubble('Ravan Dahan in 15 seconds! 🔥');
    player.char.setAction('cheer');
    setTimeout(() => player.char.action === 'cheer' && player.char.clearAction(), 1500);
  }

  burn() {
    const { ui, audio, passport, player, smoke } = this.ctx;
    this.state = 'burning';
    this.burnT = 0;
    this.nextRocket = 2;
    this.stamped = false;
    audio.duck(45);
    audio.crackle(POS, 40, 3);
    ui.toast('🔥 Ravan Dahan has begun! Look towards the Ramleela Maidan', 5000, { important: true });
    this.emitters = [
      smoke.emitter((o) => o.set(POS.x + rand(-1.5, 1.5), 1 + rand(0, 2), POS.z + rand(-1, 1)), { kind: 'fire', rate: 40, size: 1.2, grow: 1.6, rise: 3.5, drift: 0.5, life: 1.4, peak: 0.55 }),
      smoke.emitter((o) => o.set(POS.x + rand(-1.5, 1.5), 6 + rand(0, 3), POS.z + rand(-1, 1)), { kind: 'smoke', rate: 14, size: 2.2, grow: 2.4, rise: 2.6, drift: 0.8, life: 7, peak: 0.42 }),
    ];
    this.ctx.crowd?.cheerNear(POS.x, POS.z, 60);
    for (const ch of this.ctx.ramayan?.audience ?? []) {
      ch.setAction('cheer');
      setTimeout(() => ch.setAction('sit'), 6000);
    }
    void passport;
    void player;
  }

  update(dt, t) {
    const { ui, fireworks, audio, passport, player, debris } = this.ctx;
    if (this.state === 'idle') {
      const r = this.remaining();
      if (r !== Infinity) {
        const chip = r > 60 ? `🔥 Ravan Dahan in ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}` : `🔥 Ravan Dahan in ${Math.ceil(r)}s`;
        if (chip !== this.lastChip) {
          this.lastChip = chip;
          ui.setChip('ravan', chip);
        }
        if (r < 60 && !this.warned) {
          this.warned = true;
          ui.toast('🔥 Ravan Dahan in one minute at the Ramleela Maidan (west of the gate)!', 5000, { important: true });
        }
        if (r <= 0) this.burn();
      }
      return;
    }
    if (this.state === 'burning') {
      this.burnT += dt;
      const T = this.burnT;
      ui.setChip('ravan', '🔥 Ravan Dahan is burning!');
      const heat = Math.min(1, T / 6);
      const flicker = 0.75 + 0.25 * Math.sin(t * 17) * Math.sin(t * 7.3);
      this.fire.intensity = 500 * heat * flicker * (T > 36 ? Math.max(0, 1 - (T - 36) / 10) : 1);
      for (const m of [this.bodyMat, this.skinMat, this.goldMat, this.heads.material]) m.emissive.setRGB(0.9 * heat * flicker, 0.3 * heat * flicker, 0.02);
      // crackers inside the effigy
      this.nextRocket -= dt;
      if (this.nextRocket <= 0 && T < 34) {
        this.nextRocket = rand(0.6, 1.6);
        fireworks.launchRocketFrom?.(V(POS.x + rand(-1, 1), 8, POS.z), { height: rand(30, 45) });
        if (Math.random() < 0.5) audio.crackle(POS, 12, 0.8);
      }
      if (Math.random() < dt * 6) fireworks.embers?.(POS.x + rand(-1.5, 1.5), 3 + rand(0, 6), POS.z + rand(-1, 1), 14);
      // collapse
      // the effigy topples forward from its base and sags as the bamboo gives way
      if (T > 26) {
        const k = Math.min(1, (T - 26) / 12);
        this.body.rotation.x = k * k * 1.25;
        this.body.scale.set(1, 1 - 0.25 * k * k, 1);
        this.body.position.y = -k * k * 1.2;
      }
      if (T > 34) this.emitters?.[0]?.stop();
      if (T > 42) this.emitters?.[1]?.stop();
      if (!this.stamped && Math.hypot(player.pos.x - POS.x, player.pos.z - POS.z) < 45) {
        this.stamped = true;
        passport.stamp('ravan');
        debris.burst(player.headWorld(new THREE.Vector3()), { count: 30, colors: [0xffd166, 0xff6d00, 0xffffff], speed: 2.5, up: 3, size: 0.06, flat: true, life: 2.5, floor: player.pos.y });
      }
      if (T > 46) {
        this.state = 'ash';
        this.ashT = 0;
        this.fire.intensity = 0;
        ui.setChip('ravan', '');
        ui.toast(pick(['🙏 Burai par achchhai ki jeet! Happy Dussehra-Diwali!', '🎉 Jai Shri Ram! The effigy has burned']), 5000, { important: true });
      }
      return;
    }
    if (this.state === 'ash') {
      this.ashT += dt;
      if (this.ashT > 50) {
        // rebuilt overnight for the next show
        this.body.rotation.x = 0;
        this.body.scale.set(1, 1, 1);
        this.body.position.y = 0;
        for (const m of [this.bodyMat, this.skinMat, this.goldMat, this.heads.material]) m.emissive.setRGB(0, 0, 0);
        this.state = 'idle';
        this.warned = false;
        this.nextAt = performance.now() + CONFIG.ravanEveryMinutes * 60000;
      }
    }
  }
}
