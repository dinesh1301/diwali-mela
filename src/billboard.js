import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beamGeometry, canvasTexture, WARM_PALETTE } from './utils.js';
import { StringLights } from './stringLights.js';
import { lowDetail } from './lod.js';

/*
  The Mela Screen: a big festive billboard hung over the walkway just inside the gate, facing the
  entrance (everyone walks under it in their first seconds, and it is in view from the gate and down
  the main path). It plays the creator's reels, or shows their LinkedIn posts, on a carousel; without
  a creator it loops painted "Topmate Diwali Mela" posters.

  CreatorConfig.billboard (optional):
    { kind: 'reels' | 'posts',
      items: [{ type: 'video' | 'image', src, poster?, caption? }]   // 1-6 items
    }
  src / poster are same-origin URLs (e.g. /api/creators/<slug>/billboard/1.mp4, .jpg). Videos are
  9:16 H.264 without audio, <= 12 s; images 4:5 or 9:16. Reels get a 9:16 screen, posts a 4:5 one;
  media of another shape is cover-cropped.

  Phones: media load and videos play only while the camera is within ~60 m and the tab is visible;
  going further than 70 m (or hiding the tab) pauses and *releases* the video decoders (src removed),
  leaving the current poster on the screen. At most two <video> elements exist at once (current and
  next, during the crossfade).

  Director mode (deterministic capture): nothing plays. Each frame's video time is a pure function of
  the scene clock; prepare(dt) seeks the videos for the *next* frame and resolves on 'seeked', so a
  capture that awaits __director.step() always draws exactly the right frame.
*/

export const BILLBOARD_SITE = { x: 0, z: 48 }; // over the walkway between the first two lane-pole pairs
const NEAR = 60; // m: wake up (load, play)
const FAR = 70; // m: sleep (pause, release decoders)
const FADE = 0.8; // s crossfade
const IMAGE_DUR = 7; // s per post / poster
const MAX_VIDEO = 12; // s: longer reels are cut here
const SCREEN_Y = 4.45; // bottom of the screen: clear of heads and the lane strands
const MAX_ITEMS = 6;
const URL_RE = /^(https?:\/\/|\/(?!\/))/i;

/** Validates CreatorConfig.billboard; returns null when there is nothing usable. */
export function normaliseBillboard(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const kind = raw.kind === 'posts' ? 'posts' : 'reels';
  const items = raw.items
    .filter((it) => it && typeof it === 'object' && typeof it.src === 'string' && URL_RE.test(it.src))
    .slice(0, MAX_ITEMS)
    .map((it) => {
      const type = it.type === 'video' || (it.type !== 'image' && /\.(mp4|webm|mov)(\?|$)/i.test(it.src)) ? 'video' : 'image';
      const poster = typeof it.poster === 'string' && URL_RE.test(it.poster) ? it.poster : '';
      const caption = typeof it.caption === 'string' ? it.caption.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      return { type, src: it.src, poster, caption };
    });
  return items.length ? { kind, items } : null;
}

// ---------- painting ----------

const YATRA = '"Yatra One", "Poppins", serif';
const POP = 'Poppins, sans-serif';

function fitText(c, text, font, size, maxW) {
  let s = size;
  c.font = font(s);
  while (s > 14 && c.measureText(text).width > maxW) {
    s -= 2;
    c.font = font(s);
  }
  return s;
}

/** The painted header board over the screen. */
function headerTexture(title, sub) {
  return canvasTexture(1024, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#a3172f');
    g.addColorStop(1, '#5a0a1a');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // gold border with little painted dots
    c.strokeStyle = '#f2c14e';
    c.lineWidth = 10;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#ffd98a';
    for (let x = 30; x < w - 20; x += 34) {
      c.beginPath();
      c.arc(x, 26, 4, 0, Math.PI * 2);
      c.arc(x, h - 26, 4, 0, Math.PI * 2);
      c.fill();
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(255,150,40,0.9)';
    c.shadowBlur = 16;
    c.fillStyle = '#ffe08a';
    fitText(c, title, (s) => `${s}px ${YATRA}`, 104, w - 120);
    c.fillText(title, w / 2, sub ? h * 0.44 : h * 0.52);
    if (sub) {
      c.shadowBlur = 6;
      c.fillStyle = '#ffeacc';
      fitText(c, sub, (s) => `600 ${s}px ${POP}`, 34, w - 160);
      c.fillText(sub, w / 2, h * 0.8);
    }
  });
}

/** A caption strip under the screen (redrawn when the item changes). */
function captionCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return {
    tex,
    draw(text) {
      const c = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#2a0710';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#f2c14e';
      c.fillRect(0, 0, w, 6);
      c.fillRect(0, h - 6, w, 6);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#fff2d6';
      fitText(c, text, (s) => `600 ${s}px ${POP}`, 50, w - 60);
      c.fillText(text, w / 2, h / 2 + 2);
      tex.needsUpdate = true;
    },
  };
}

/** The festive default loop: three painted posters (9:16). */
function defaultPosters() {
  const W = 540;
  const H = 960;
  const sparkle = (c, n, seed) => {
    let a = seed;
    const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      c.fillStyle = `rgba(255,${200 + r() * 55},${120 + r() * 100},${0.3 + r() * 0.6})`;
      c.beginPath();
      c.arc(r() * W, r() * H, 1 + r() * 3, 0, Math.PI * 2);
      c.fill();
    }
  };
  const diya = (c, x, y, s) => {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    const glow = c.createRadialGradient(0, -60, 5, 0, -60, 120);
    glow.addColorStop(0, 'rgba(255,220,120,0.9)');
    glow.addColorStop(1, 'rgba(255,140,30,0)');
    c.fillStyle = glow;
    c.fillRect(-140, -200, 280, 260);
    c.fillStyle = '#ffcf4d';
    c.beginPath();
    c.moveTo(0, -110);
    c.quadraticCurveTo(26, -60, 0, -28);
    c.quadraticCurveTo(-26, -60, 0, -110);
    c.fill();
    c.fillStyle = '#b5451b';
    c.beginPath();
    c.moveTo(-90, -20);
    c.quadraticCurveTo(0, 70, 90, -20);
    c.closePath();
    c.fill();
    c.fillStyle = '#f2c14e';
    c.fillRect(-90, -26, 180, 8);
    c.restore();
  };
  const frame = (c, top, bottom) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  };
  const text = (c, t, y, font, color = '#ffe08a', blur = 18) => {
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(255,140,30,0.85)';
    c.shadowBlur = blur;
    c.fillStyle = color;
    c.font = font;
    c.fillText(t, W / 2, y);
    c.shadowBlur = 0;
  };
  const a = canvasTexture(W, H, (c) => {
    frame(c, '#2a0b3d', '#7a1630');
    sparkle(c, 220, 7);
    // a rangoli ring
    for (let k = 0; k < 3; k++) {
      c.strokeStyle = ['#ff6b35', '#ffd166', '#ef476f'][k];
      c.lineWidth = 10;
      c.beginPath();
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const r = 150 - k * 34 + Math.sin(t * 8) * 16;
        const x = W / 2 + Math.cos(t) * r;
        const y = 430 + Math.sin(t) * r;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.stroke();
    }
    diya(c, W / 2, 470, 1.1);
    text(c, 'TOPMATE', 130, `700 54px ${POP}`, '#fff2d6', 10);
    text(c, 'Diwali Mela', 205, `84px ${YATRA}`);
    text(c, 'शुभ दीपावली', 760, `64px ${YATRA}`);
    text(c, 'Walk in · play · light a diya', 850, `500 30px ${POP}`, '#ffeacc', 6);
  });
  const b = canvasTexture(W, H, (c) => {
    frame(c, '#061233', '#3a0f4a');
    sparkle(c, 160, 31);
    // fireworks
    const burst = (x, y, r, col) => {
      c.strokeStyle = col;
      c.lineWidth = 4;
      for (let i = 0; i < 28; i++) {
        const t = (i / 28) * Math.PI * 2;
        c.beginPath();
        c.moveTo(x + Math.cos(t) * r * 0.25, y + Math.sin(t) * r * 0.25);
        c.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
        c.stroke();
      }
    };
    burst(160, 240, 120, '#ffd166');
    burst(390, 330, 140, '#ef476f');
    burst(270, 520, 100, '#06d6a0');
    text(c, 'Aaj Raat', 650, `78px ${YATRA}`);
    text(c, 'Grand Fireworks', 740, `700 42px ${POP}`, '#fff2d6', 8);
    text(c, 'Ravan Dahan · Ramleela', 800, `600 32px ${POP}`, '#ffeacc', 6);
  });
  const d = canvasTexture(W, H, (c) => {
    frame(c, '#5a0a1a', '#ff8a1c');
    sparkle(c, 120, 101);
    for (let i = 0; i < 5; i++) diya(c, 70 + i * 100, 640 + (i % 2) * 30, 0.55);
    text(c, 'Khel Gali', 180, `76px ${YATRA}`);
    text(c, 'Balloon shoot · Ring toss', 270, `600 34px ${POP}`, '#fff2d6', 6);
    text(c, 'Giant Wheel · Boat ride', 330, `600 34px ${POP}`, '#fff2d6', 6);
    text(c, 'Pushpak Viman', 390, `600 34px ${POP}`, '#fff2d6', 6);
    text(c, 'Sab ke liye!', 860, `64px ${YATRA}`);
  });
  return [a, b, d].map((tex) => ({ type: 'image', tex, aspect: W / H, caption: '' }));
}

// ---------- the screen shader ----------

function screenMaterial() {
  const blank = new THREE.DataTexture(new Uint8Array([24, 8, 16, 255]), 1, 1);
  blank.needsUpdate = true;
  return new THREE.ShaderMaterial({
    uniforms: {
      mapA: { value: blank },
      mapB: { value: blank },
      uvA: { value: new THREE.Vector4(1, 1, 0, 0) },
      uvB: { value: new THREE.Vector4(1, 1, 0, 0) },
      uMix: { value: 0 },
      uSlide: { value: 0 },
      uDots: { value: 0 },
      uActive: { value: 0 },
      uProg: { value: 0 },
      uAspect: { value: 9 / 16 },
      uBright: { value: 0.82 }, // under the bloom threshold for most of the picture: a screen, not a lamp
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D mapA;
      uniform sampler2D mapB;
      uniform vec4 uvA;
      uniform vec4 uvB;
      uniform float uMix;
      uniform float uSlide;
      uniform float uDots;
      uniform float uActive;
      uniform float uProg;
      uniform float uAspect;
      uniform float uBright;
      varying vec2 vUv;
      void main() {
        // the incoming item slides in a little from the right as it fades up
        vec2 ub = vUv + vec2(uSlide * (1.0 - uMix), 0.0);
        vec3 a = texture2D(mapA, vUv * uvA.xy + uvA.zw).rgb;
        vec3 b = texture2D(mapB, ub * uvB.xy + uvB.zw).rgb;
        vec3 c = mix(a, b, uMix);
        // progress dots along the bottom
        float n = uDots;
        if (n > 1.5) {
          vec2 p = vec2(vUv.x * uAspect, vUv.y);
          float gap = 0.06;
          float x0 = 0.5 * uAspect - (n - 1.0) * gap * 0.5;
          for (int i = 0; i < 6; i++) {
            float fi = float(i);
            if (fi > n - 0.5) break;
            vec2 d = p - vec2(x0 + fi * gap, 0.035);
            float on = step(abs(fi - uActive), 0.1);
            float r = mix(0.011, 0.015, on);
            float disc = smoothstep(r, r - 0.004, length(d));
            float ring = on * smoothstep(0.004, 0.0, abs(length(d) - r - 0.006)) * step(atan(d.x, d.y) / 6.2832 + 0.5, uProg);
            c = mix(c, mix(vec3(0.85), vec3(1.0, 0.78, 0.3), on), disc * 0.9);
            c = mix(c, vec3(1.0, 0.82, 0.35), ring);
          }
        }
        // a soft vignette sells the "screen"
        vec2 q = vUv - 0.5;
        c *= 1.0 - dot(q, q) * 0.35;
        gl_FragColor = vec4(c * uBright, 1.0);
      }`,
  });
}

// ---------- media ----------

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 4 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function imageTexture(img) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// the real timer: director mode swaps window.setTimeout for a virtual clock that only moves on step()
const realSetTimeout = window.setTimeout.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);

/** Waits for one of a media element's events (or an error/timeout); resolves true on the event. */
function once(el, ev, ms = 15000) {
  return new Promise((resolve) => {
    let timer = 0;
    const done = (ok) => {
      el.removeEventListener(ev, onEv);
      el.removeEventListener('error', onErr);
      realClearTimeout(timer);
      resolve(ok);
    };
    const onEv = () => done(true);
    const onErr = () => done(false);
    el.addEventListener(ev, onEv);
    el.addEventListener('error', onErr);
    if (ms) timer = realSetTimeout(() => done(false), ms);
  });
}

let holder = null;
/** Off-screen (not display:none, which some phones throttle) parent for the playing videos. */
function videoHolder() {
  if (!holder) {
    holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(holder);
  }
  return holder;
}

function makeVideo(src, { director }) {
  const el = document.createElement('video');
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.setAttribute('muted', '');
  el.setAttribute('playsinline', '');
  el.setAttribute('webkit-playsinline', '');
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  el.disablePictureInPicture = true;
  el.src = src;
  if (!director) videoHolder().appendChild(el);
  return el;
}

function releaseVideo(v) {
  if (!v) return;
  v.released = true; // a late 'error' from emptying the element must not mark the reel as broken
  try {
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load(); // drops the decoder
  } catch {
    // ignore
  }
  v.el.remove();
  v.tex.dispose();
}

// ---------- the billboard ----------

export class Billboard {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {object|null} o.cfg  the CreatorConfig (normalised), or null for the plain mela
   * @param {Array} o.colliders  world colliders (the two posts are added)
   * @param {boolean} o.director frame-stepped capture: seek instead of play
   */
  constructor({ scene, cfg, colliders, director = false }) {
    this.scene = scene;
    this.director = director;
    const bb = cfg?.billboard ?? null;
    this.custom = !!bb;
    this.kind = bb?.kind ?? 'reels';
    this.aspect = this.kind === 'posts' ? 4 / 5 : 9 / 16;
    this.items = [];
    this.idx = 0;
    this.lt = 0; // seconds into the current item (live mode)
    this.fade = 0; // 0 = no crossfade, else 0..1
    this.ct = 0; // carousel clock (director mode)
    this.active = false;
    this.videos = new Map(); // item -> { el, tex, ready }
    this.captionShown = null;
    this.lights = new StringLights(scene);
    this.pos = new THREE.Vector3(BILLBOARD_SITE.x, 0, BILLBOARD_SITE.z);

    const first = cfg?.first || '';
    const title = !bb ? 'Mela TV' : this.kind === 'posts' ? `${first} on LinkedIn` : `${first} ke Reels`;
    const sub = !bb ? 'Topmate Diwali Mela' : this.kind === 'posts' ? 'Latest posts' : 'Fresh reels · Topmate Mela';
    this.build(title, sub, colliders);

    if (bb) {
      this.items = bb.items.map((it) => ({ ...it, tex: null, aspect: this.aspect, dur: it.type === 'video' ? 10 : IMAGE_DUR, failed: false, loading: null }));
      this.hasCaptions = this.items.some((it) => it.caption);
    } else {
      this.items = defaultPosters().map((p) => ({ ...p, dur: IMAGE_DUR - 1.5, failed: false, loading: null }));
      this.hasCaptions = false;
    }
    this.caption.mesh.visible = this.hasCaptions;
    this.mat.uniforms.uDots.value = this.items.length;
    this.ready = director ? this.prepareDirector() : Promise.resolve();
    this.onHidden = () => document.hidden && this.sleep();
    document.addEventListener('visibilitychange', this.onHidden);
  }

  // ---------- structure ----------

  build(title, sub, colliders) {
    const { x, z } = BILLBOARD_SITE;
    const sw = this.kind === 'posts' ? 3.9 : 3.2;
    const sh = sw / this.aspect;
    const fw = 0.22; // frame bar width
    const y0 = SCREEN_Y;
    const y1 = y0 + sh;
    const hh = 1.4; // header board height
    const hw = sw + 1.7;
    const hy = y1 + fw + hh / 2 + 0.05;
    const top = hy + hh / 2 + 0.55; // the gantry beam
    const PX = 5.0; // posts at the walkway edges
    const V = (a, b, c) => new THREE.Vector3(a, b, c);
    this.size = { sw, sh, y0, y1, top };

    const woodGeos = [];
    const box = (w, h, d, cx, cy, cz) => woodGeos.push(new THREE.BoxGeometry(w, h, d).translate(cx, cy, cz));
    // two tall posts and the gantry beam, the screen's wooden frame and the header backing
    for (const s of [-1, 1]) {
      woodGeos.push(beamGeometry(V(x + s * PX, 0, z), V(x + s * PX, top + 0.3, z), 0.16, 10));
      woodGeos.push(beamGeometry(V(x + s * PX, 0, z), V(x + s * (PX - 1.4), 2.6, z - 0.01), 0.07, 6)); // a brace
      colliders?.push({ type: 'circle', x: x + s * PX, z, r: 0.25 });
    }
    box(PX * 2 + 0.8, 0.26, 0.3, x, top, z);
    box(sw + fw * 2, fw, 0.24, x, y0 - fw / 2, z);
    box(sw + fw * 2, fw, 0.24, x, y1 + fw / 2, z);
    for (const s of [-1, 1]) box(fw, sh + fw * 2, 0.24, x + s * (sw / 2 + fw / 2), (y0 + y1) / 2, z);
    box(hw + 0.16, hh + 0.16, 0.18, x, hy, z);
    // ropes from the beam to the header's corners
    const ropes = [];
    for (const s of [-1, 1]) ropes.push(beamGeometry(V(x + s * (hw / 2 - 0.2), hy + hh / 2, z), V(x + s * (hw / 2 + 0.3), top, z), 0.025, 4));
    const wood = new THREE.Mesh(mergeGeometries([...woodGeos, ...ropes].map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      return g;
    })), new THREE.MeshStandardMaterial({ color: 0x5a3320, roughness: 0.8 }));
    this.scene.add(wood);

    // gold trim inside the frame (front and back)
    const trimGeos = [];
    for (const zz of [z + 0.125, z - 0.125]) {
      trimGeos.push(new THREE.BoxGeometry(sw + 0.08, 0.05, 0.02).translate(x, y0 - 0.02, zz));
      trimGeos.push(new THREE.BoxGeometry(sw + 0.08, 0.05, 0.02).translate(x, y1 + 0.02, zz));
      for (const s of [-1, 1]) trimGeos.push(new THREE.BoxGeometry(0.05, sh + 0.08, 0.02).translate(x + s * (sw / 2 + 0.02), (y0 + y1) / 2, zz));
    }
    const gold = new THREE.Mesh(mergeGeometries(trimGeos), new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.3, metalness: 0.75, emissive: 0x3a2400 }));
    this.scene.add(gold);

    // the screen: front and back faces in one mesh (the back reads unmirrored from the chowk)
    const front = new THREE.PlaneGeometry(sw, sh).translate(0, 0, 0.13);
    const back = new THREE.PlaneGeometry(sw, sh).translate(0, 0, 0.13).rotateY(Math.PI);
    const screenGeo = mergeGeometries([front, back]).translate(x, (y0 + y1) / 2, z);
    this.mat = screenMaterial();
    this.blank = this.mat.uniforms.mapA.value;
    this.mat.uniforms.uAspect.value = this.aspect;
    this.screen = new THREE.Mesh(screenGeo, this.mat);
    this.screen.name = 'billboard-screen';
    this.scene.add(this.screen);

    // header board, both faces
    const htex = headerTexture(title, sub);
    const hf = new THREE.PlaneGeometry(hw, hh).translate(0, 0, 0.1);
    const hb = new THREE.PlaneGeometry(hw, hh).translate(0, 0, 0.1).rotateY(Math.PI);
    this.header = new THREE.Mesh(mergeGeometries([hf, hb]).translate(x, hy, z), new THREE.MeshBasicMaterial({ map: htex, color: new THREE.Color(1.25, 1.25, 1.25) }));
    this.scene.add(this.header);

    // caption strip under the screen (only when some item has a caption)
    this.caption = captionCanvas();
    const cf = new THREE.PlaneGeometry(sw + fw * 2, 0.42).translate(0, 0, 0.13);
    const cb = new THREE.PlaneGeometry(sw + fw * 2, 0.42).translate(0, 0, 0.13).rotateY(Math.PI);
    this.caption.mesh = new THREE.Mesh(mergeGeometries([cf, cb]).translate(x, y0 - fw - 0.23, z), new THREE.MeshBasicMaterial({ map: this.caption.tex, color: new THREE.Color(1.1, 1.1, 1.1) }));
    this.scene.add(this.caption.mesh);

    // marigold garlands: round the frame, swagged along the beam, wound up the posts
    const balls = [];
    const ring = (a, b, step = 0.13) => {
      const n = Math.max(2, Math.round(a.distanceTo(b) / step));
      for (let i = 0; i < n; i++) balls.push(a.clone().lerp(b, i / n));
    };
    const ox = sw / 2 + fw + 0.04;
    const oy0 = y0 - fw - 0.04;
    const oy1 = y1 + fw + 0.04;
    ring(V(x - ox, oy0, z), V(x + ox, oy0, z));
    ring(V(x + ox, oy0, z), V(x + ox, oy1, z));
    ring(V(x + ox, oy1, z), V(x - ox, oy1, z));
    ring(V(x - ox, oy1, z), V(x - ox, oy0, z));
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 70; i++) {
        const k = i / 70;
        const a = k * Math.PI * 12;
        balls.push(V(x + s * PX + Math.cos(a) * 0.2, 0.3 + k * (top - 0.6), z + Math.sin(a) * 0.2));
      }
    }
    for (let i = 0; i <= 60; i++) {
      const k = i / 60;
      const xx = x - PX + k * PX * 2;
      const swag = Math.abs(Math.sin(k * Math.PI * 4)) * 0.45;
      balls.push(V(xx, top - 0.2 - swag, z + 0.18));
    }
    const mg = new THREE.InstancedMesh(
      lowDetail() ? new THREE.IcosahedronGeometry(0.075, 0) : new THREE.IcosahedronGeometry(0.075, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x4a1800 }),
      balls.length
    );
    const m4 = new THREE.Matrix4();
    const cols = [new THREE.Color(0xff8a00), new THREE.Color(0xffc300), new THREE.Color(0xff6a00)];
    balls.forEach((p, i) => {
      mg.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
      mg.setColorAt(i, cols[i % 3]);
    });
    mg.computeBoundingSphere();
    this.scene.add(mg);

    // bulbs: a chasing border on both faces, a row under the beam, lines up the posts
    for (const zz of [z + 0.2, z - 0.2]) {
      const bx = sw / 2 + fw + 0.16;
      const by0 = y0 - fw - 0.16;
      const by1 = hy + hh / 2 + 0.12;
      const hx = hw / 2 + 0.14;
      this.lights.addPolyline([V(x - bx, by0, zz), V(x + bx, by0, zz), V(x + bx, hy - hh / 2 - 0.05, zz), V(x + hx, hy - hh / 2 - 0.05, zz), V(x + hx, by1, zz), V(x - hx, by1, zz), V(x - hx, hy - hh / 2 - 0.05, zz), V(x - bx, hy - hh / 2 - 0.05, zz), V(x - bx, by0, zz)], { spacing: 0.42, mode: 'chase' });
    }
    this.lights.addStrand(V(x - PX, top - 0.18, z - 0.2), V(x + PX, top - 0.18, z - 0.2), { sag: 0.1, spacing: 0.3, palette: WARM_PALETTE, mode: 'twinkle', wire: false });
    for (const s of [-1, 1]) this.lights.addPolyline([V(x + s * PX, 0.5, z + 0.22), V(x + s * PX, top - 0.3, z + 0.22)], { spacing: 0.35, palette: WARM_PALETTE, mode: 'chase' });
    this.lights.build();

    // the screen's glow on the people below: a real light the LightPool may pick when you're close
    this.glow = new THREE.PointLight(0xffd2b0, 26, 16, 2);
    this.glow.position.set(x, y0 - 0.6, z + 2.2);
    this.scene.add(this.glow);
  }

  // ---------- media helpers ----------

  /** The still texture for an item: the image itself, or a video's poster. Loads lazily. */
  still(it) {
    if (it.tex) return it.tex;
    if (!it.loading) {
      const url = it.type === 'image' ? it.src : it.poster;
      it.loading = url
        ? loadImage(url).then((img) => {
            if (img) {
              it.tex = imageTexture(img);
              if (it.type === 'image') it.aspect = img.naturalWidth / img.naturalHeight;
            } else if (it.type === 'image') it.failed = true;
          })
        : Promise.resolve();
    }
    return null;
  }

  video(it) {
    let v = this.videos.get(it);
    if (!v) {
      const el = makeVideo(it.src, { director: this.director });
      el.loop = this.items.length === 1;
      const tex = new THREE.VideoTexture(el);
      tex.colorSpace = THREE.SRGBColorSpace;
      v = { el, tex, ready: false };
      el.addEventListener('loadeddata', () => {
        v.ready = true;
        it.aspect = el.videoWidth / el.videoHeight || this.aspect;
        if (isFinite(el.duration) && el.duration > 0) it.dur = Math.min(el.duration, MAX_VIDEO);
      });
      el.addEventListener('error', () => {
        if (v.released) return;
        it.failed = !it.poster; // with a poster it carries on as a still
        it.noVideo = true;
      });
      this.videos.set(it, v);
    }
    return v;
  }

  /** What to draw for an item right now: { tex, aspect } (null until something has loaded). */
  visual(it) {
    if (it.type === 'video' && !it.noVideo) {
      const v = this.videos.get(it);
      if (v?.ready && v.el.readyState >= 2) return { tex: v.tex, aspect: it.aspect };
    }
    const t = this.still(it);
    return t ? { tex: t, aspect: it.type === 'image' ? it.aspect : this.aspect } : null;
  }

  /** Cover-fit plus a slow Ken Burns for stills, as a uv scale/offset. */
  uv(out, vis, it, lt) {
    const am = vis?.aspect || this.aspect;
    let sx = 1;
    let sy = 1;
    if (am > this.aspect) sx = this.aspect / am;
    else sy = am / this.aspect;
    let zoom = 1;
    let px = 0;
    let py = 0;
    if (it.type === 'image' || (vis && !vis.tex.isVideoTexture)) {
      // 0 -> 1 over the item; a lone still keeps drifting back and forth
      const kk = (lt / (it.dur || IMAGE_DUR)) % 2;
      const k = kk > 1 ? 2 - kk : kk;
      zoom = 1.02 + 0.1 * k;
      const dir = (this.items.indexOf(it) % 2 ? 1 : -1) * 0.025;
      px = dir * (k - 0.5);
      py = 0.015 * (k - 0.5);
    }
    const w = sx / zoom;
    const h = sy / zoom;
    out.set(w, h, (1 - w) / 2 + px * w, (1 - h) / 2 + py * h);
  }

  usable(i) {
    const it = this.items[i];
    return it && !it.failed;
  }

  nextIndex(i) {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (this.usable(j)) return j;
    }
    return i;
  }

  // ---------- live mode ----------

  sleep() {
    if (!this.active) return;
    this.active = false;
    for (const v of this.videos.values()) releaseVideo(v);
    this.videos.clear();
    if (this.fade) this.advance();
    this.unbindReleased();
  }

  /** A released reel's texture must not stay on the screen (it would re-upload an emptied <video>). */
  unbindReleased() {
    const u = this.mat.uniforms;
    const live = new Set([...this.videos.values()].map((v) => v.tex));
    for (const k of ['mapA', 'mapB']) {
      const t = u[k].value;
      if (t.isVideoTexture && !live.has(t)) u[k].value = this.blank;
    }
    // the poster of what is showing now, so a woken screen has its still while the reel buffers
    const cur = this.items[this.idx];
    if (cur?.type === 'video') {
      const st = this.still(cur);
      if (st && u.mapA.value === this.blank) u.mapA.value = st;
    }
  }

  advance() {
    const old = this.items[this.idx];
    this.idx = this.nextIndex(this.idx);
    this.lt = 0;
    this.fade = 0;
    const keep = new Set([this.items[this.idx], this.items[this.nextIndex(this.idx)]]);
    if (old !== this.items[this.idx] && !keep.has(old)) {
      releaseVideo(this.videos.get(old));
      this.videos.delete(old);
      this.unbindReleased();
    }
  }

  /** Called every frame. `camPos` decides whether the screen is awake. `input` handles taps. */
  update(dt, t, camPos, input) {
    this.lights.update(t);
    if (!this.items.length) return;
    if (this.director) return this.updateDirector(dt);
    if (this.overlay) {
      for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
      return;
    }
    const d = Math.hypot(camPos.x - this.pos.x, camPos.z - this.pos.z);
    const want = !document.hidden && (this.active ? d < FAR : d < NEAR);
    if (!want) {
      this.sleep();
      this.applyStill();
      return;
    }
    this.active = true;
    if (!this.usable(this.idx)) this.idx = this.nextIndex(this.idx);
    const n = this.items.length;
    const cur = this.items[this.idx];
    const nextI = this.nextIndex(this.idx);
    const next = this.items[nextI];
    let lt = this.lt;
    const isVid = cur.type === 'video' && !cur.noVideo;
    if (isVid) {
      if (cur.poster) this.still(cur);
      const v = this.video(cur);
      if (v.ready && v.el.paused && !v.el.ended) v.el.play().catch(() => {});
      lt = v.el.currentTime;
      if (v.el.ended) lt = cur.dur;
      // a reel that never starts (stalled network) gives up after a while and shows its poster
      if (!v.ready) {
        this.lt += dt;
        if (this.lt > 8) cur.noVideo = true;
      }
    } else {
      this.lt += dt;
      lt = this.lt;
    }
    if (n > 1 && nextI !== this.idx) {
      if (lt >= cur.dur - 3) {
        if (next.type === 'video' && !next.noVideo) this.video(next); // start buffering
        else this.still(next);
      }
      if (!this.fade && (lt >= cur.dur - FADE || (isVid && this.videos.get(cur)?.el.ended))) {
        this.fade = 1e-4;
        const nv = this.videos.get(next);
        if (nv?.ready) {
          nv.el.currentTime = 0;
          nv.el.play().catch(() => {});
        }
      }
      if (this.fade) {
        this.fade = Math.min(1, this.fade + dt / FADE);
        const nv = this.videos.get(next);
        if (nv?.ready && nv.el.paused) nv.el.play().catch(() => {});
        if (this.fade >= 1) {
          this.advance();
          return this.update(0, t, camPos, input);
        }
      }
    }
    this.apply(cur, lt, next, this.fade ? this.fade * FADE : 0, this.fade);
    if (input) this.handleTap(input);
  }

  /** Far away or asleep: the current item's still. */
  applyStill() {
    const cur = this.items[this.idx];
    this.apply(cur, this.lt, cur, 0, 0);
  }

  apply(cur, lt, next, nextLt, fade) {
    const u = this.mat.uniforms;
    const a = this.visual(cur);
    const b = fade > 0 ? this.visual(next) : null;
    if (a) u.mapA.value = a.tex;
    this.uv(u.uvA.value, a, cur, lt);
    if (b) {
      u.mapB.value = b.tex;
      this.uv(u.uvB.value, b, next, nextLt);
    }
    const k = b ? fade : 0;
    u.uMix.value = k * k * (3 - 2 * k);
    u.uSlide.value = 0.06;
    u.uActive.value = fade > 0.5 ? this.items.indexOf(next) : this.items.indexOf(cur);
    u.uProg.value = fade > 0.5 ? 0 : Math.min(1, lt / (cur.dur || IMAGE_DUR));
    const cap = (fade > 0.5 ? next : cur).caption || '';
    if (this.hasCaptions && cap !== this.captionShown) {
      this.captionShown = cap;
      this.caption.draw(cap || (this.kind === 'posts' ? 'On LinkedIn' : 'Reels'));
    }
  }

  // ---------- tap to open ----------

  handleTap(input) {
    if (!input.clicks?.length || !this.camera) return;
    const c = input.clicks[input.clicks.length - 1];
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((c.x - r.left) / r.width) * 2 - 1, -((c.y - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    ray.far = 40;
    if (ray.intersectObject(this.screen, false).length) this.openOverlay();
  }

  /** Full-screen view of the current reel or post, with a mute toggle. */
  openOverlay() {
    if (this.overlay || !this.custom) return;
    const it = this.items[this.fade > 0.5 ? this.nextIndex(this.idx) : this.idx];
    if (!it) return;
    const wrap = document.createElement('div');
    wrap.className = 'bb-overlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(10,4,12,0.88);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:16px;box-sizing:border-box';
    let media;
    if (it.type === 'video' && !it.noVideo) {
      media = document.createElement('video');
      Object.assign(media, { src: it.src, muted: true, playsInline: true, autoplay: true, loop: true, controls: false, poster: it.poster || '' });
      media.setAttribute('playsinline', '');
      media.play().catch(() => {});
    } else {
      media = document.createElement('img');
      media.src = it.src || it.poster;
      media.alt = it.caption || '';
    }
    media.style.cssText = 'max-width:100%;max-height:calc(100% - 120px);border-radius:14px;box-shadow:0 0 0 3px #f2c14e,0 10px 40px rgba(0,0,0,0.6);background:#000';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center';
    const btn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'font:600 15px Poppins,sans-serif;color:#2a0710;background:#ffd166;border:0;border-radius:999px;padding:10px 18px;cursor:pointer';
      row.appendChild(b);
      return b;
    };
    if (media.tagName === 'VIDEO') {
      const mute = btn('🔇 Unmute');
      mute.onclick = (e) => {
        e.stopPropagation();
        media.muted = !media.muted;
        mute.textContent = media.muted ? '🔇 Unmute' : '🔊 Mute';
        if (!media.muted) media.play().catch(() => {});
      };
    }
    const close = btn('✕ Close');
    if (it.caption) {
      const cap = document.createElement('div');
      cap.textContent = it.caption;
      cap.style.cssText = 'font:500 15px Poppins,sans-serif;color:#fff2d6;text-align:center;max-width:520px';
      wrap.append(media, cap, row);
    } else wrap.append(media, row);
    const shut = () => {
      if (media.tagName === 'VIDEO') {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      this.overlay = null;
      this.onOverlay?.(false);
    };
    close.onclick = (e) => {
      e.stopPropagation();
      shut();
    };
    wrap.addEventListener('pointerdown', (e) => e.target === wrap && shut());
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        shut();
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    this.overlay = wrap;
    this.onOverlay?.(true);
  }

  // ---------- director mode ----------

  async prepareDirector() {
    const jobs = this.items.map(async (it) => {
      if (it.type === 'video') {
        const v = this.video(it);
        const ok = v.ready || (await once(v.el, 'loadeddata', 20000));
        if (!ok || v.el.readyState < 2) it.noVideo = true;
        else {
          v.ready = true;
          it.aspect = v.el.videoWidth / v.el.videoHeight || this.aspect;
          it.dur = Math.min(v.el.duration || 10, MAX_VIDEO);
        }
      }
      this.still(it);
      await it.loading;
    });
    await Promise.all(jobs);
    this.sched = this.items.filter((it) => !it.failed);
    if (!this.sched.length) this.sched = [];
  }

  /** Item, local time and fade at carousel time ct (a pure function: the capture is repeatable). */
  scheduleAt(ct) {
    const s = this.sched;
    if (!s?.length) return null;
    const total = s.reduce((a, it) => a + it.dur, 0);
    let c = ((ct % total) + total) % total;
    let i = 0;
    while (i < s.length - 1 && c >= s[i].dur) c -= s[i++].dur;
    const cur = s[i];
    const next = s[(i + 1) % s.length];
    const f0 = cur.dur - FADE;
    const fade = s.length > 1 && c > f0 ? (c - f0) / FADE : 0;
    return { cur, next, lt: c, nextLt: fade ? c - f0 : 0, fade };
  }

  updateDirector(dt) {
    this.ct += dt;
    const s = this.scheduleAt(this.ct);
    if (!s) return;
    this.apply(s.cur, s.lt, s.next, s.nextLt, s.fade);
  }

  /** Director: seek the videos for the frame `dtNext` ahead; resolves once they show that frame. */
  prepare(dtNext) {
    const s = this.scheduleAt(this.ct + dtNext);
    if (!s) return Promise.resolve();
    const seeks = [];
    const seek = (it, time) => {
      if (it.type !== 'video' || it.noVideo) return;
      const v = this.videos.get(it);
      if (!v?.ready) return;
      const target = Math.max(0, Math.min(time, (v.el.duration || it.dur) - 0.04));
      if (Math.abs(v.el.currentTime - target) < 1e-4 && !v.el.seeking) return;
      const p = once(v.el, 'seeked', 10000).then(() => {
        v.tex.needsUpdate = true;
      });
      v.el.currentTime = target;
      seeks.push(p);
    };
    seek(s.cur, s.lt);
    if (s.fade > 0 && s.next !== s.cur) seek(s.next, s.nextLt);
    this.pending = Promise.all(seeks);
    return this.pending;
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onHidden);
    for (const v of this.videos.values()) releaseVideo(v);
    this.videos.clear();
  }
}
