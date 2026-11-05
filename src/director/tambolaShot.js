import * as THREE from 'three';
import { NameTag } from '../nametag.js';

/*
  Trailer shot 'tambola' (shared, 4 s = 120 frames at 30 fps): a round already well under way in the
  Tambola Tent. Opens outside on the tent's sign, then pushes in over the players' tables (tickets
  in front of them) onto the caller and the big number board as three more numbers are called;
  someone at the tables jumps up with a claim near the end. Uses m.tambola.stageShot / callShot /
  claimShot (src/games/tambola.js).

  It also has to read as multiplayer: the players at the tables wear the same floating name tags as
  real visitors in a creator's room (src/net.js), and two of them "say" something in the same
  cream chat bubble (ui.bubble, drawn on a sprite here because the capture only grabs the canvas).
  The names are generic follower-style ones: the shot is shared by every creator. Tags and bubbles
  keep a fixed size on screen (as the DOM bubbles do), so the close push-in never blows them up.
*/
const CALLS = [0.35, 1.45, 2.55];
const CLAIM = 3.0;
const NAMES = ['Priya', 'Aarav', 'Meera', 'Kabir', 'Riya', 'Ishaan', 'Sana'];
/** [from, to] seconds of each chat bubble. */
const HELLO = [0.45, 2.1];
const FULL = [CLAIM + 0.1, 4.2];
/** Screen-relative sizes (sizeAttenuation off: about a fraction of the frame height). */
const TAG_H = 0.046;
const _p = new THREE.Vector3();
const BUBBLE_H = 0.064;

/** A chat bubble in the look of the game's .bubble (cream pill, dark text, tail at the bottom). */
function bubbleSprite(text) {
  const W = 512;
  const H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 50px Poppins, system-ui, sans-serif';
  const pw = Math.min(W - 24, ctx.measureText(text).width + 64);
  const ph = 96;
  const px = (W - pw) / 2;
  const py = 22;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#fff6e5';
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 30);
  ctx.moveTo(W / 2 - 16, py + ph - 1);
  ctx.lineTo(W / 2, py + ph + 18);
  ctx.lineTo(W / 2 + 16, py + ph - 1);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#3a1206';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, py + ph / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0 }));
  sprite.scale.set((BUBBLE_H * W) / H, BUBBLE_H, 1);
  sprite.center.set(0.5, -TAG_H / BUBBLE_H + 0.05); // stacked just above the name tag
  sprite.position.y = 0.1;
  sprite.renderOrder = 21;
  sprite.layers.set(1);
  return sprite;
}

export const TAMBOLA_SHOT = {
  duration: 4,
  warm: 0.5,
  async setup({ m, state }) {
    const tb = m.tambola;
    state.tb = tb;
    tb.stageShot(24);
    state.w = (x, y, z) => tb.group.localToWorld(new THREE.Vector3(x, y, z));
    // a soft key on the caller's side so faces and the front table read without blowing the board
    const l = new THREE.PointLight(0xffd9a8, 8, 9, 1.6);
    l.position.set(1.5, 2.6, -1.0);
    tb.group.add(l);

    // ---- the room: name tags and two chat bubbles ----
    await document.fonts?.load('600 50px Poppins');
    const rivals = tb.rivals;
    const tags = rivals.map((r, i) => {
      const tag = new NameTag(r.headTop, { name: NAMES[i % NAMES.length] }, { height: 0.1 });
      tag.sprite.material.sizeAttenuation = false;
      tag.sprite.scale.set((TAG_H * 512) / 160, TAG_H, 1);
      return tag;
    });
    state.tagged = rivals.map((r, i) => ({ r, tag: tags[i] }));
    // the claimer is the one claimShot() picks; the greeter sits in the back row near the middle,
    // in frame for the first half of the push-in
    const score = (c) => Math.abs(c.root.position.x) + 2 * Math.abs(c.root.position.z - 1.15);
    const claimer = rivals.slice().sort((a, b) => score(a) - score(b))[0];
    const back = rivals.filter((r) => r !== claimer).sort((a, b) => a.root.position.z - b.root.position.z || Math.abs(a.root.position.x) - Math.abs(b.root.position.x));
    const greeter = back[0];
    state.bubbles = [];
    if (greeter) {
      const s = bubbleSprite('Hi everyone!');
      greeter.headTop.add(s);
      state.bubbles.push({ s, at: HELLO });
    }
    if (claimer) {
      // on the claim the bubble takes the tag's place, right over the head, so it stays low under the board
      const s = bubbleSprite('Full house!');
      s.center.y = 0;
      claimer.headTop.add(s);
      state.claimerTag = tags[rivals.indexOf(claimer)];
      state.bubbles.push({ s, at: FULL });
    }
  },
  update({ sec, m, state }) {
    const near = (x) => Math.abs(sec - x) < 1 / 60;
    for (const at of CALLS) {
      if (near(at)) state.tb.callShot();
      if (near(at + 0.5)) state.tb.caller.clearAction();
    }
    if (near(CLAIM)) {
      state.tb.claimShot();
      state.claimerTag?.setVisible(false);
    }
    // a tag whose wearer the camera has pushed past (head off the bottom of the frame) would float alone
    for (const { r, tag } of state.tagged ?? []) {
      if (tag === state.claimerTag && sec >= CLAIM - 1 / 60) continue;
      r.headTop.getWorldPosition(_p).project(m.camera);
      tag.setVisible(_p.z < 1 && _p.y > -0.8);
    }
    for (const { s, at } of state.bubbles ?? []) {
      const k = Math.max(0, Math.min(1, (sec - at[0]) / 0.15, (at[1] - sec) / 0.2));
      s.material.opacity = k;
      s.visible = k > 0;
      const pop = 0.85 + 0.15 * k;
      s.scale.set(((BUBBLE_H * 512) / 160) * pop, BUBBLE_H * pop, 1);
    }
  },
  camera({ u, cam, H, state }) {
    const k = H.easeInOut ? H.easeInOut(u) : H.smooth(u);
    cam.pos.copy(state.w(H.lerp(0.35, 0.5, k), H.lerp(2.5, 2.4, k), H.lerp(13.0, 3.9, k)));
    const tilt = H.smooth(Math.min(1, u / 0.55)); // off the sign and down into the tent early
    cam.look.copy(state.w(H.lerp(0.1, 0, k), H.lerp(3.5, 2.15, tilt), -4.4));
    cam.fov = H.lerp(56, 50, k);
  },
};
