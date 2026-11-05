import * as THREE from 'three';
import { thaliMesh, forgetFlames } from '../items.js';
import { SITES } from '../world.js';
import { track } from '../track.js';

const _v = new THREE.Vector3();

/** Temple aarti and the wish-lantern spot on the ghat. */
export class Rituals {
  constructor(ctx) {
    this.ctx = ctx;
    const { interactions, player } = ctx;
    const t = SITES.temple;
    interactions.add({
      pos: new THREE.Vector3(t.x + 4.4, 0, t.z),
      radius: 2.8,
      markerHeight: 3,
      label: 'Do aarti at the temple 🛕',
      enabled: () => player.mode === 'walk',
      action: () => this.aarti(),
    });
    interactions.add({
      pos: new THREE.Vector3(0, 0, -44.4),
      radius: 3.2,
      label: 'Release a wish lantern 🏮',
      enabled: () => player.mode === 'walk',
      action: () => this.wishLantern(),
    });
  }

  async aarti() {
    const { player, tasks, audio, ui, passport, scene } = this.ctx;
    const t = SITES.temple;
    player.setBusy(true);
    player.faceTowards(t.x, t.z);
    const thali = thaliMesh();
    scene.add(thali);
    const prevHeld = player.held;
    if (prevHeld) prevHeld.obj.visible = false;
    player.char.setAction('aarti');
    const follow = () => {
      player.char.handR.getWorldPosition(_v);
      thali.position.copy(_v);
      player.char.handL.getWorldPosition(_v);
      thali.position.lerp(_v, 0.5).y += 0.03;
    };
    audio.duck(5);
    for (let i = 0; i < 6; i++) {
      if (i % 2 === 0) audio.templeBell();
      await tasks.tween(0.8, follow, (k) => k);
    }
    forgetFlames(thali);
    thali.removeFromParent();
    if (prevHeld) prevHeld.obj.visible = true;
    player.char.setAction('namaste');
    ui.bubble((o) => player.headWorld(o), '🙏 Shubh Deepavali', 2.2);
    await tasks.wait(1.2);
    player.char.clearAction();
    player.setBusy(false);
    passport.stamp('aarti');
    track('activity', { what: 'aarti' });
  }

  async wishLantern() {
    const { ui, lanterns, player, passport } = this.ctx;
    player.setBusy(true);
    const text = await ui.askWish();
    player.setBusy(false);
    if (!text) return track('lantern', { action: 'cancel' });
    lanterns.releaseFrom(player, text);
    passport.stamp('lantern');
    ui.toast('🏮 Your wish is rising into the sky');
  }
}
