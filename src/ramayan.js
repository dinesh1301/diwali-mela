import { tk } from './touch.js';
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { StringLights } from './stringLights.js';
import { Character, randomLook } from './character.js';
import { diyaMesh } from './items.js';
import { beam, hdr, setLayer, clamp, rand, pick, WARM_PALETTE } from './utils.js';
import { signTexture } from './stalls.js';
import { slot } from './personalSlots.js';
import { SITES } from './world.js';
import { mergeAdded } from './merge.js';
import { track } from './track.js';

export const PLAYLIST = 'PLFPJRCFRDARSZofcQcV6m7Pu2EAL8_1dv';
const SCREEN_W = 12;
const SCREEN_H = 6.75;
const SCREEN_Y = 2.0 + SCREEN_H / 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const _v = new THREE.Vector3();
const NEAR = 45; // metres from the screen: the video streams, plays and is composited only within this

/*
  Ramleela Maidan: an open-air projector screen west of the gate. The video is a real YouTube
  embed placed in the world with CSS3D; a "hole" mesh in the WebGL scene lets it show through,
  so people and props in front of the screen still occlude it correctly.
*/
export class Ramayan {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene, world } = ctx;
    const R = SITES.ramleela;
    this.center = V(R.x, SCREEN_Y, R.z + 10);
    this.stage = { cx: R.x, z: R.z + 10, top: SCREEN_Y + SCREEN_H / 2 + 0.8 }; // where the Ramleela board hangs
    this.seated = false;
    this.ready = false;
    this.shuffled = false;
    this.volume = -1;
    this.lights = new StringLights(scene);
    const before = new Set(scene.children);

    // ---- screen, frame and the CSS3D video behind it ----
    const sx = R.x;
    const sz = R.z + 10;
    const post = std(0x3d2a1c, 0.8);
    for (const s of [-1, 1]) {
      scene.add(beam(V(sx + s * (SCREEN_W / 2 + 0.4), 0, sz), V(sx + s * (SCREEN_W / 2 + 0.4), SCREEN_Y + SCREEN_H / 2 + 0.8, sz), 0.14, post));
      scene.add(beam(V(sx + s * (SCREEN_W / 2 + 0.4), 0, sz + 2.2), V(sx + s * (SCREEN_W / 2 + 0.4), SCREEN_Y + SCREEN_H / 2 + 0.6, sz + 0.1), 0.08, post));
    }
    scene.add(beam(V(sx - SCREEN_W / 2 - 0.4, SCREEN_Y + SCREEN_H / 2 + 0.8, sz), V(sx + SCREEN_W / 2 + 0.4, SCREEN_Y + SCREEN_H / 2 + 0.8, sz), 0.12, post));
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W + 0.5, SCREEN_H + 0.5), std(0x111014, 0.9));
    frame.position.set(sx, SCREEN_Y, sz + 0.06);
    frame.rotation.y = Math.PI;
    scene.add(frame);
    const backside = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W + 0.5, SCREEN_H + 0.5), std(0x2a2430, 0.95));
    backside.position.set(sx, SCREEN_Y, sz + 0.08);
    scene.add(backside);
    // this plane writes depth but no colour and leaves the canvas transparent, revealing the CSS3D video
    this.hole = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, fog: false }));
    this.hole.position.set(sx, SCREEN_Y, sz);
    this.hole.rotation.y = Math.PI;
    this.hole.layers.set(1);
    scene.add(this.hole);
    world.colliders.push({ type: 'box', minX: sx - SCREEN_W / 2 - 0.6, maxX: sx + SCREEN_W / 2 + 0.6, minZ: sz - 0.4, maxZ: sz + 2.4 });
    world.tall.push({ type: 'box', minX: sx - SCREEN_W / 2 - 0.6, maxX: sx + SCREEN_W / 2 + 0.6, minZ: sz - 0.4, maxZ: sz + 2.4, h: SCREEN_Y + SCREEN_H / 2 + 1 });

    this.cssScene = new THREE.Scene();
    this.cssRenderer = new CSS3DRenderer({ element: document.getElementById('css3d') });
    this.cssRenderer.setSize(innerWidth, innerHeight);
    const el = document.createElement('div');
    el.className = 'yt-screen';
    el.style.width = '1280px';
    el.style.height = '720px';
    el.innerHTML = '<div class="yt-fallback"><b>Ramleela</b><span>Ramayan show · loading…</span></div><div id="ytplayer"></div>';
    this.el = el;
    this.cssObj = new CSS3DObject(el);
    this.cssObj.position.copy(this.center);
    this.cssObj.rotation.y = Math.PI;
    this.cssObj.scale.setScalar(SCREEN_W / 1280);
    this.cssScene.add(this.cssObj);
    this.near = true; // the screen starts shown; the first update() settles it
    this.wanted = false; // start() was called: load the embed on the first approach
    this.hidden = document.hidden;
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.playback();
    });

    const lightsTop = [];
    for (let x = -SCREEN_W / 2 - 0.4; x <= SCREEN_W / 2 + 0.4; x += 0.4) lightsTop.push(V(sx + x, SCREEN_Y + SCREEN_H / 2 + 0.75, sz - 0.15));
    this.lights.addPolyline(lightsTop, { spacing: 0.4, palette: WARM_PALETTE, mode: 'chase' });
    for (const s of [-1, 1]) {
      const col = [];
      for (let y = 0.5; y <= SCREEN_Y + SCREEN_H / 2 + 0.6; y += 0.4) col.push(V(sx + s * (SCREEN_W / 2 + 0.55), y, sz - 0.15));
      this.lights.addPolyline(col, { spacing: 0.4, palette: WARM_PALETTE, mode: 'twinkle' });
    }

    // ---- benches, aisle diyas, projector ----
    const plank = std(0x6b3f22, 0.85);
    const durrie = std(0x9b2226, 0.95);
    this.seats = [];
    this.benches = [];
    const rows = [68, 65, 62, 59, 56];
    for (const z of rows) {
      for (const side of [-1, 1]) {
        const bx = R.x + side * 4;
        const spot = { x: bx, z, seats: [] };
        this.benches.push(spot);
        const bench = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 0.5), plank);
        bench.position.set(bx, 0.48, z);
        scene.add(bench);
        for (const lx of [-2.2, 2.2]) scene.add(beam(V(bx + lx, 0, z), V(bx + lx, 0.45, z), 0.06, plank));
        const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.6), durrie);
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(bx, 0.015, z + 0.3);
        scene.add(rug);
        world.colliders.push({ type: 'box', minX: bx - 2.5, maxX: bx + 2.5, minZ: z - 0.3, maxZ: z + 0.3 });
        for (const ox of [-1.6, 0, 1.6]) {
          const seat = { x: bx + ox, z, taken: false };
          this.seats.push(seat);
          spot.seats.push(seat);
        }
      }
      for (const dx of [-1.3, 1.3]) {
        const d = diyaMesh();
        d.position.set(R.x + dx, 0.02, z);
        scene.add(d);
      }
    }
    // the player's seat moves to whichever bench they pick
    this.seat = new THREE.Object3D();
    scene.add(this.seat);
    this.taken = null;

    const px = R.x;
    const pz = 52.5;
    scene.add(beam(V(px, 0, pz), V(px, 1.6, pz), 0.07, std(0x444444, 0.5, { metalness: 0.6 })));
    const proj = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.9), std(0x2b2b30, 0.5, { metalness: 0.4 }));
    proj.position.set(px, 1.8, pz);
    scene.add(proj);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 14), new THREE.MeshBasicMaterial({ color: hdr(0xcfe8ff, 3) }));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(px, 1.85, pz + 0.5);
    scene.add(lens);
    world.colliders.push({ type: 'circle', x: px, z: pz, r: 0.5 });

    // ---- audience ----
    this.audience = [];
    const free = this.seats.filter((s) => !s.taken);
    for (let i = 0; i < 10 && free.length; i++) {
      const s = free.splice(Math.floor(Math.random() * free.length), 1)[0];
      s.taken = true;
      const kid = i % 4 === 3;
      const ch = new Character(randomLook({ kid }));
      ch.root.position.set(s.x, 0, s.z);
      ch.root.rotation.y = 0;
      ch.setAction('sit');
      ch.t = Math.random() * 10;
      setLayer(ch.root, 1);
      scene.add(ch.root);
      this.audience.push(ch);
    }
    this.clapTimer = 6;

    // ---- sign, lights ----
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 1.55),
      new THREE.MeshBasicMaterial({ map: signTexture(slot('sign.ramleela'), 'Ramayan show · take a seat on any bench', '#4a0d0d'), color: new THREE.Color(1.0, 1.0, 1.0), side: THREE.DoubleSide })
    );
    sign.position.set(R.x + 10, 3.2, 56);
    sign.rotation.y = Math.PI / 2;
    scene.add(sign);
    for (const s of [-1, 1]) scene.add(beam(V(R.x + 10, 0, 56 + s * 2.6), V(R.x + 10, 4.1, 56 + s * 2.6), 0.07, post));
    world.colliders.push({ type: 'box', minX: R.x + 9.7, maxX: R.x + 10.3, minZ: 53.2, maxZ: 58.8 });
    const glow = new THREE.PointLight(0x9fc4ff, 70, 30, 2);
    glow.position.set(sx, 4, sz - 3);
    scene.add(glow);
    this.glow = glow;
    const warm = new THREE.PointLight(0xffb46b, 40, 22, 2);
    warm.position.set(R.x, 3, 60);
    scene.add(warm);
    // posts, benches, rugs, projector: one mesh per material look (the screen's hole stays its own)
    mergeAdded(scene, before, { live: new Set([this.hole]) });
    this.lights.build();

    const gesture = () => {
      if (!this.ready || this.volume <= 0) return;
      try {
        if (this.player.isMuted()) this.player.unMute();
      } catch {
        // ignore
      }
    };
    addEventListener('pointerdown', gesture, { passive: true });
    addEventListener('keydown', gesture);

    for (const bench of this.benches) {
      ctx.interactions.add({
        pos: V(bench.x, 0, bench.z - 0.9),
        radius: 3.4,
        markAt: V(bench.x, 0, bench.z),
        markerHeight: 2.0,
        label: 'Watch the Ramayan show 📽️',
        enabled: () => ctx.player.mode === 'walk' && bench.seats.some((s) => !s.taken),
        action: () => this.sit(bench),
      });
    }
  }

  // ---------- YouTube ----------

  loadApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    return new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }

  /**
   * Called once the visitor has entered (a user gesture), so the embed may play with sound. The
   * iframe API and player load on the first approach to the screen, not here.
   */
  start() {
    this.wanted = true;
    // not this.near: with ?play, start() runs before the first update() has settled it
    if (this.seated || this.ctx.camera.position.distanceToSquared(this.center) < NEAR * NEAR) this.load();
  }

  load() {
    if (this.starting) return;
    this.starting = true;
    this.loadApi().then((YT) => {
      this.player = new YT.Player('ytplayer', {
        width: 1280,
        height: 720,
        playerVars: {
          listType: 'playlist',
          list: PLAYLIST,
          autoplay: 1,
          mute: 1,
          controls: 0,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          disablekb: 1,
          fs: 0,
          origin: location.origin,
        },
        events: {
          onReady: (e) => {
            this.ready = true;
            try {
              e.target.unloadModule('captions'); // no subtitles on the big screen
              e.target.unloadModule('cc');
              e.target.setShuffle(true);
              e.target.setLoop(true);
              if (this.near && !this.hidden) e.target.playVideo();
              else e.target.pauseVideo();
            } catch {
              // the embed may still be settling
            }
          },
          onStateChange: (e) => {
            // pick a random episode once the playlist is known
            if (!this.shuffled && (e.data === 1 || e.data === 5)) {
              const n = e.target.getPlaylist()?.length || 0;
              if (n > 1) {
                this.shuffled = true;
                e.target.playVideoAt(Math.floor(Math.random() * n));
              }
            }
            if (e.data === 1) this.el.classList.add('playing');
          },
        },
      });
    });
  }

  nowPlaying() {
    try {
      return this.player?.getVideoData?.()?.title || '';
    } catch {
      return '';
    }
  }

  nextEpisode() {
    try {
      const n = this.player.getPlaylist()?.length || 0;
      if (n > 1) this.player.playVideoAt(Math.floor(Math.random() * n));
      else this.player.nextVideo();
      this.ctx.ui.toast('📽️ Next episode…');
      track('ramleela_seat', { action: 'next' });
    } catch {
      // ignore
    }
  }

  // ---------- seating ----------

  sit(bench) {
    const { player, ui, passport } = this.ctx;
    const free = bench.seats.filter((s) => !s.taken);
    if (!free.length) return;
    const seat = free.reduce((a, b) => (Math.hypot(a.x - player.pos.x, a.z - player.pos.z) <= Math.hypot(b.x - player.pos.x, b.z - player.pos.z) ? a : b));
    seat.taken = true;
    this.taken = seat;
    this.seat.position.set(seat.x, 0, seat.z);
    player.sitOn(this.seat, new THREE.Vector3(0, 0, 0), 0, 'sit');
    player.cam.yaw = Math.PI;
    player.cam.pitch = 0.1;
    player.cam.targetDist = 5.5;
    this.seated = true;
    this.seatedAt = performance.now();
    passport.stamp('ramayan');
    track('ramleela_seat', { action: 'sit', video: this.nowPlaying().slice(0, 120) });
    const title = this.nowPlaying().split(/\s[-|–]\s/)[0].trim();
    ui.toast(title ? `📽️ Now playing: ${title} · ${tk('Press Q for another episode', 'Tap “Next episode” for another')}` : tk('📽️ Enjoy the show! Press Q for another episode.', '📽️ Enjoy the show! Tap “Next episode” for another one.'), 4500);
  }

  standUp() {
    const { player } = this.ctx;
    const s = this.taken ?? { x: SITES.ramleela.x, z: 65 };
    if (this.taken) this.taken.taken = false;
    this.taken = null;
    player.standUp(s.x, s.z - 1.0, 0);
    player.cam.targetDist = 5;
    if (this.seated) track('ramleela_seat', { action: 'stand', secs: Math.round((performance.now() - this.seatedAt) / 1000) });
    this.seated = false;
  }

  promptLabel() {
    return 'Get up';
  }

  prompt2Label() {
    return this.ready ? 'Next episode' : null;
  }

  get help() {
    return { key: [['E', 'Get up'], ['Q', 'Next episode'], ['Drag', 'Look around']], tap: [['👆', 'Get up'], ['⏭️', 'Next episode'], ['👉', 'Drag to look around']] };
  }

  /** Plays the video only while the screen is near and the tab is visible. */
  playback() {
    if (!this.ready) return;
    try {
      if (this.near && !this.hidden) this.player.playVideo();
      else this.player.pauseVideo();
    } catch {
      // the embed may still be settling
    }
  }

  // ---------- per frame ----------

  update(dt, t, { started, muted }) {
    const cam = this.ctx.camera.position;
    const near = this.seated || cam.distanceToSquared(this.center) < NEAR * NEAR;
    if (near !== this.near) {
      this.near = near;
      // far away: no iframe to composite and no CSS3D pass; the dark screen frame shows instead
      this.el.style.display = near ? '' : 'none';
      this.hole.visible = near;
      if (near && this.wanted) this.load();
      this.playback();
    }

    this.lights.update(t);
    this.glow.intensity = 60 + Math.sin(t * 7) * 6;
    for (const ch of this.audience) ch.update(dt);
    this.clapTimer -= dt;
    if (this.clapTimer <= 0) {
      this.clapTimer = rand(5, 11);
      const ch = pick(this.audience);
      ch.setAction(pick(['clap', 'cheer', 'lookUp']));
      setTimeout(() => ch.setAction('sit'), 2200);
    }

    if (this.seated) {
      const { input } = this.ctx;
      if (input.pressedAction('interact')) {
        input.consumeAction('interact');
        this.standUp();
      } else if (input.pressedAction('use') && this.ready) {
        input.consumeAction('use');
        this.nextEpisode();
      }
    }

    // full sound only inside the arena (among the benches) or when seated; outside it is a faint
    // spill that dies away within 20 m of the arena edge, and the song barely ducks
    if (this.ready && this.player?.setVolume) {
      const R = SITES.ramleela;
      const p = this.ctx.player.char.root.getWorldPosition(_v);
      const dx = Math.max(0, Math.abs(p.x - R.x) - 8);
      const dz = Math.max(0, 52 - p.z, p.z - 74.5);
      const inside = this.seated || (dx === 0 && dz === 0);
      const spill = clamp(1 - Math.hypot(dx, dz) / 20, 0, 1);
      const vol = muted || !started ? 0 : inside ? 100 : Math.round(10 * spill);
      if (vol !== this.volume) {
        this.volume = vol;
        try {
          if (vol > 0 && this.player.isMuted()) this.player.unMute();
          this.player.setVolume(vol);
        } catch {
          // ignore
        }
      }
      this.ctx.audio.ambientDuck(inside ? 1 : spill * 0.25);
    }
  }

  render(camera) {
    if (this.near) this.cssRenderer.render(this.cssScene, camera);
  }

  resize() {
    this.cssRenderer.setSize(innerWidth, innerHeight);
  }
}

