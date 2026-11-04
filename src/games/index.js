import * as THREE from 'three';
import { StringLights } from '../stringLights.js';
import { mergeStatic, freezeStatic } from '../merge.js';
import { buildBooth } from './booth.js';
import { BalloonShoot } from './balloonShoot.js';
import { RingToss } from './ringToss.js';
import { Cans } from './cans.js';
import { Striker } from './striker.js';

const BOOTHS = [
  { z: 14, title: 'Gubbara Phod', sub: 'Balloon shooting · win a teddy', c1: '#e63946', c2: '#ffd166', sign: '#5c0a10', Game: BalloonShoot, label: 'Play balloon shooting 🎯' },
  { z: 23, title: 'Ring Toss', sub: 'Ring 2 bottles · win a gift', c1: '#3a86ff', c2: '#ffffff', sign: '#13306b', Game: RingToss, label: 'Play ring toss ⭕' },
  { z: 32, title: 'Dabba Maar', sub: 'Knock down all 6 cans', c1: '#06d6a0', c2: '#fff1d0', sign: '#0d4f2b', Game: Cans, label: 'Play Dabba Maar 🥫' },
  { z: 41, title: 'Taakat Pariksha', sub: 'Strongman · ring the bell', c1: '#8338ec', c2: '#ffbe0b', sign: '#3c1361', Game: Striker, label: 'Test your strength 🔔', rail: false, roof: false },
];

/** Khel Gali: the four game booths and the mode switch in and out of a game. */
export class Games {
  constructor(ctx) {
    this.ctx = ctx;
    this.lights = new StringLights(ctx.scene);
    this.active = null;
    this.camLook = new THREE.Vector3();
    this.games = BOOTHS.map((d, i) => {
      const booth = buildBooth(ctx, this.lights, { ...d, lamp: i % 2 === 0 });
      const game = new d.Game(ctx, booth);
      // merge the booth shell and the game's fixed props; anything the game holds on to stays live
      const live = new Set();
      for (const v of Object.values(game)) {
        if (v?.isObject3D) live.add(v);
        else if (Array.isArray(v)) for (const x of v) if (x?.isObject3D) live.add(x);
      }
      mergeStatic(booth.group, { skip: (o) => live.has(o) });
      freezeStatic(booth.group, (o) => live.has(o));
      game.finish = (r) => this.finish(game, r);
      ctx.interactions.add({
        pos: new THREE.Vector3(24.3, 0, d.z),
        radius: 2.8,
        markerHeight: 3,
        label: d.label,
        enabled: () => ctx.player.mode === 'walk',
        action: () => this.play(game),
      });
      return game;
    });
    this.lights.build();
  }

  play(game) {
    const { player, input, ui, camera } = this.ctx;
    this.stash = player.held;
    if (this.stash) {
      player.held = null;
      player.char.holdR = null;
      this.stash.obj.visible = false;
    }
    player.mode = 'game';
    player.teleport(game.stand.x, game.stand.z, game.stand.heading);
    input.lookEnabled = false;
    this.active = game;
    this.prize = null;
    this.camLook.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5));
    ui.gameHud.show({ title: game.title, help: game.help });
    ui.setHelp(game.helpLines);
    game.start();
  }

  async finish(game, r) {
    const { ui, audio, passport, player, debris } = this.ctx;
    passport.stamp(r.stamp);
    if (r.win) {
      audio.cheer();
      this.prize = r.prize;
      player.char.setAction('cheer');
      debris.burst(player.headWorld(new THREE.Vector3()), { count: 40, colors: [0xffd166, 0xff006e, 0x06d6a0, 0x3a86ff], speed: 2.5, up: 3, size: 0.06, flat: true, life: 2.5, floor: 0.05 });
    } else {
      audio.fail();
    }
    const choice = await ui.result({
      icon: r.icon,
      title: r.title,
      text: r.text,
      buttons: [
        { label: 'Play again', value: 'again', primary: true },
        { label: 'Leave', value: 'leave' },
      ],
    });
    if (this.active !== game) return;
    if (choice === 'again') {
      game.stop();
      game.start();
    } else {
      this.leave();
    }
  }

  leave() {
    const game = this.active;
    if (!game) return;
    const { player, input, ui, shops } = this.ctx;
    game.stop();
    this.active = null;
    input.lookEnabled = true;
    player.mode = 'walk';
    ui.gameHud.hide();
    ui.crosshair(null);
    if (this.prize) {
      if (this.stash) this.stash.obj.removeFromParent();
      shops.givePrize(this.prize);
      ui.toast(this.prize === 'gift' ? '🎁 You are carrying your prize! Press Q to put it down.' : '🧸 Your teddy is in your hands! Press Q to put it down.');
    } else if (this.stash) {
      this.stash.obj.visible = true;
      player.held = this.stash;
      player.char.holdR = this.stash.pose ?? 'hold';
    }
    this.stash = null;
    player.cam.yaw = player.heading + Math.PI;
    player.cam.pitch = 0.22;
  }

  update(dt, t) {
    if (!this.active) return;
    if (this.ctx.input.wasPressed('Escape')) return this.leave();
    this.active.update(dt, t);
  }

  applyCamera(camera, dt) {
    const g = this.active;
    const k = 1 - Math.exp(-dt * 6);
    camera.position.lerp(g.camPos, k);
    this.camLook.lerp(g.camLook, k);
    camera.lookAt(this.camLook);
  }
}
