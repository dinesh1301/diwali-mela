import { tk } from './touch.js';
import * as THREE from 'three';
import { StringLights } from './stringLights.js';
import { Garlands } from './garlands.js';
import { diyaMesh } from './items.js';
import { beam, canvasTexture, hdr, WARM_PALETTE } from './utils.js';
import { signTexture } from './stalls.js';
import { SITES } from './world.js';
import { profile } from './profile.js';
import { STAMPS } from './passport.js';

export const MELA_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const YEAR = new Date().getFullYear();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const lerp = THREE.MathUtils.lerp;

const FORMATS = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
  linkedin: { w: 1200, h: 628 },
};
const POSES = [
  { icon: '🙏', label: 'Namaste', action: 'namaste' },
  { icon: '🙌', label: 'Cheer', action: 'cheer' },
  { icon: '👋', label: 'Wave', action: 'wave' },
  { icon: '😊', label: 'Just smile', action: null },
];

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // a photo from a cross-origin VITE_API_BASE must not taint the poster canvas
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const SHOT_MAX = 1920; // longest side of a captured frame: posters are at most 1920 px wide

/**
 * Copies the frame just rendered into a 2D canvas, scaled down to SHOT_MAX. It must run in the
 * same task as the render (the WebGL buffer is cleared once the browser composites), and unlike
 * toDataURL it doesn't JPEG-encode a 4 MP frame into a string on the main thread.
 */
function grabFrame(src) {
  const k = Math.min(1, SHOT_MAX / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Draws img to cover the box; focusX/focusY (0..1) pick which part of the image stays visible. */
function cover(g, img, x, y, w, h, focusX = 0.5, focusY = 0.5) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  const sx = Math.max(0, Math.min(img.width - sw, img.width * focusX - sw / 2));
  const sy = Math.max(0, Math.min(img.height - sh, img.height * focusY - sh / 2));
  g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function pill(g, x, y, text, { font, fg, bg, pad = 20, align = 'left', stroke = null }) {
  g.font = font;
  const tw = g.measureText(text).width;
  const h = parseInt(font.match(/(\d+)px/)[1], 10) * 1.6;
  const w = tw + pad * 2;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(x0, y, w, h, h / 2);
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 3;
    g.stroke();
  }
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x0 + pad, y + h / 2 + 1);
  return { w, h };
}

function fitFont(g, text, font, maxWidth) {
  let size = parseInt(font.match(/(\d+)px/)[1], 10);
  g.font = font;
  while (g.measureText(text).width > maxWidth && size > 12) {
    size -= 2;
    g.font = font.replace(/\d+px/, `${size}px`);
  }
  return g.font;
}

/** Composes the share poster on an offscreen canvas. All inputs are same-origin, so it exports cleanly. */
export async function composePoster({ shot, photo, name, handle, headline, done, total, format = 'square', shareLink = MELA_URL }) {
  const { w: W, h: H } = FORMATS[format];
  const land = W > H;
  const u = land ? (H / 1080) * 1.15 : W / 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  const img = typeof shot === 'string' ? await loadImage(shot) : shot; // a URL or a grabbed canvas
  cover(g, img, 0, 0, W, H, land ? 0.62 : 0.5, 0.5);

  if (land) {
    const grad = g.createLinearGradient(0, 0, W * 0.72, 0);
    grad.addColorStop(0, 'rgba(22,6,30,0.95)');
    grad.addColorStop(0.55, 'rgba(22,6,30,0.78)');
    grad.addColorStop(1, 'rgba(22,6,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  } else {
    const grad = g.createLinearGradient(0, H * 0.38, 0, H);
    grad.addColorStop(0, 'rgba(22,6,30,0)');
    grad.addColorStop(0.45, 'rgba(22,6,30,0.72)');
    grad.addColorStop(1, 'rgba(22,6,30,0.97)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  const top = g.createLinearGradient(0, 0, 0, H * 0.22);
  top.addColorStop(0, 'rgba(22,6,30,0.6)');
  top.addColorStop(1, 'rgba(22,6,30,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, W, H * 0.22);

  // frame
  g.strokeStyle = 'rgba(255,207,92,0.85)';
  g.lineWidth = 6 * u;
  g.strokeRect(20 * u, 20 * u, W - 40 * u, H - 40 * u);
  g.strokeStyle = 'rgba(255,207,92,0.35)';
  g.lineWidth = 2 * u;
  g.strokeRect(34 * u, 34 * u, W - 68 * u, H - 68 * u);

  // top pills
  pill(g, 54 * u, 54 * u, '🪔 topmate', { font: `700 ${Math.round(34 * u)}px Poppins, sans-serif`, fg: '#1a1020', bg: '#ffffff', pad: 22 * u });
  pill(g, W - 54 * u, 54 * u, `Diwali ${YEAR}`, { font: `600 ${Math.round(30 * u)}px Poppins, sans-serif`, fg: '#ffcf5c', bg: 'rgba(20,6,30,0.6)', pad: 22 * u, align: 'right', stroke: 'rgba(255,207,92,0.6)' });

  const M = 64 * u; // left margin
  const maxW = (land ? W * 0.56 : W) - M * 2;
  let y = H - 64 * u;

  // bottom: hashtag + link
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffcf5c';
  g.font = `600 ${Math.round(26 * u)}px Poppins, sans-serif`;
  const cx = land ? M + maxW / 2 : W / 2;
  g.fillText('#TopmateDiwaliMela', cx, y);
  y -= 46 * u;
  const link = shareLink.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const linkFont = fitFont(g, `Join me 👉 ${link}`, `600 ${Math.round(30 * u)}px Poppins, sans-serif`, maxW);
  const lp = pill(g, cx, y - 30 * u * 1.6, `Join me 👉 ${link}`, { font: linkFont, fg: '#fff6e5', bg: 'rgba(255,255,255,0.14)', pad: 24 * u, align: 'center', stroke: 'rgba(255,255,255,0.25)' });
  y -= lp.h + 44 * u;

  // visitor card
  const r = 84 * u;
  const cy = y - r;
  g.save();
  g.beginPath();
  g.arc(M + r, cy, r, 0, Math.PI * 2);
  g.closePath();
  g.fillStyle = '#3a1a40';
  g.fill();
  g.clip();
  if (photo) {
    try {
      const pimg = await loadImage(photo);
      cover(g, pimg, M, cy - r, r * 2, r * 2, 0.5, 0.35);
    } catch {
      photo = null;
    }
  }
  if (!photo) {
    g.fillStyle = '#ff8a1c';
    g.fillRect(M, cy - r, r * 2, r * 2);
    g.fillStyle = '#fff';
    g.font = `700 ${r * 0.9}px Poppins, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((name || '?').trim().charAt(0).toUpperCase(), M + r, cy + 4 * u);
  }
  g.restore();
  g.strokeStyle = '#ffcf5c';
  g.lineWidth = 7 * u;
  g.beginPath();
  g.arc(M + r, cy, r + 3 * u, 0, Math.PI * 2);
  g.stroke();

  const tx = M + r * 2 + 30 * u;
  const tw = maxW - r * 2 - 30 * u;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff6e5';
  g.font = fitFont(g, name, `700 ${Math.round(50 * u)}px Poppins, sans-serif`, tw);
  g.fillText(name, tx, cy - 30 * u);
  g.fillStyle = '#ffcf5c';
  const sub = handle ? `topmate.io/${handle}` : headline || 'Visitor at the mela';
  g.font = fitFont(g, sub, `500 ${Math.round(30 * u)}px Poppins, sans-serif`, tw);
  g.fillText(sub, tx, cy + 14 * u);
  g.fillStyle = 'rgba(255,246,229,0.8)';
  g.font = fitFont(g, `⭐ ${done} of ${total} mela experiences unlocked`, `500 ${Math.round(26 * u)}px Poppins, sans-serif`, tw);
  g.fillText(`⭐ ${done} of ${total} mela experiences unlocked`, tx, cy + 56 * u);
  y = cy - r - 40 * u;

  // headline
  g.textAlign = 'left';
  g.fillStyle = '#ffcf5c';
  g.shadowColor = 'rgba(255,150,40,0.75)';
  g.shadowBlur = 28 * u;
  const big = fitFont(g, 'Topmate Diwali Mela', `${Math.round(108 * u)}px "Yatra One", serif`, maxW);
  g.font = big;
  g.fillText('Topmate Diwali Mela', M, y);
  g.shadowBlur = 0;
  y -= parseInt(big.match(/(\d+)px/)[1], 10) * 1.0;
  g.fillStyle = '#fff6e5';
  g.font = `600 ${Math.round(34 * u)}px Poppins, sans-serif`;
  g.letterSpacing = `${Math.round(6 * u)}px`;
  g.fillText("I'VE BEEN TO THE", M, y);
  g.letterSpacing = '0px';
  y -= 64 * u;
  g.font = `${Math.round(56 * u)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  g.fillText('🪔 🎡 🎆 🎠 ✈️', M, y);

  return c;
}

/** Selfie Point: a decorated backdrop, a tripod camera, and the poster flow. */
export class Poster {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene, world, interactions, player } = ctx;
    const S = SITES.selfie;
    this.S = S;
    this.mark = V(S.x - 2.2, 0, S.z);
    this.format = 'square';
    this.photoMode = null;
    this.shot = null;
    this.rendering = null;

    const lights = new StringLights(scene);
    const garlands = new Garlands(scene);
    this.lights = lights;

    // backdrop
    const tex = canvasTexture(1024, 672, (c, w, h) => {
      const grad = c.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.7);
      grad.addColorStop(0, '#8a1f3f');
      grad.addColorStop(1, '#3a0b2a');
      c.fillStyle = grad;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,207,92,0.5)';
      for (const [cx, cy] of [[90, 90], [w - 90, 90], [90, h - 90], [w - 90, h - 90]]) {
        for (let k = 0; k < 3; k++) {
          c.lineWidth = 3;
          c.beginPath();
          c.arc(cx, cy, 30 + k * 22, 0, Math.PI * 2);
          c.stroke();
        }
        c.fillStyle = '#ffcf5c';
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          c.beginPath();
          c.ellipse(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50, 10, 5, a, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ffcf5c';
      c.shadowColor = 'rgba(255,150,40,0.9)';
      c.shadowBlur = 24;
      c.font = '112px "Yatra One", serif';
      c.fillText('Topmate', w / 2, h / 2 - 110);
      c.fillText('Diwali Mela', w / 2, h / 2 + 10);
      c.shadowBlur = 0;
      c.fillStyle = '#fff6e5';
      c.font = '600 40px Poppins, sans-serif';
      c.fillText(`#TopmateDiwaliMela · ${YEAR}`, w / 2, h / 2 + 120);
      c.font = '64px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      c.fillText('🪔  🎆  🪔', w / 2, h / 2 + 210);
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14 }));
    panel.position.set(S.x, 1.95, S.z);
    panel.rotation.y = -Math.PI / 2;
    scene.add(panel);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, 5.5), std(0x3d2a1c, 0.8));
    backing.position.set(S.x + 0.08, 1.95, S.z);
    scene.add(backing);
    const post = std(0xd4a017, 0.3, { metalness: 0.7 });
    for (const s of [-1, 1]) scene.add(beam(V(S.x, 0, S.z + s * 2.85), V(S.x, 4.0, S.z + s * 2.85), 0.09, post));
    scene.add(beam(V(S.x, 4.0, S.z - 2.85), V(S.x, 4.0, S.z + 2.85), 0.07, post));
    garlands.addSwag(V(S.x - 0.08, 3.95, S.z - 2.8), V(S.x - 0.08, 3.95, S.z + 2.8), 0.45);
    garlands.addDrop(V(S.x - 0.08, 3.8, S.z - 2.75), 3.4);
    garlands.addDrop(V(S.x - 0.08, 3.8, S.z + 2.75), 3.4);
    const pts = [];
    for (let z = -2.85; z <= 2.85; z += 0.3) pts.push(V(S.x - 0.1, 4.05, S.z + z));
    lights.addPolyline(pts, { spacing: 0.3, palette: WARM_PALETTE, mode: 'twinkle' });
    world.colliders.push({ type: 'box', minX: S.x - 0.3, maxX: S.x + 0.4, minZ: S.z - 3.1, maxZ: S.z + 3.1 });

    for (const s of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.0, 10), std(0x8a5a2b, 0.8));
      stand.position.set(S.x - 0.7, 0.5, S.z + s * 2.3);
      scene.add(stand);
      const d = diyaMesh();
      d.position.set(S.x - 0.7, 1.0, S.z + s * 2.3);
      d.scale.setScalar(1.6);
      scene.add(d);
      world.colliders.push({ type: 'circle', x: S.x - 0.7, z: S.z + s * 2.3, r: 0.25 });
    }

    const mat = canvasTexture(256, 256, (c, w) => {
      c.translate(w / 2, w / 2);
      const cols = ['#ff7a00', '#ffd166', '#e0218a', '#1f9d55', '#3a86ff'];
      for (let i = 5; i >= 0; i--) {
        c.fillStyle = cols[i % cols.length];
        c.beginPath();
        c.arc(0, 0, 20 + i * 20, 0, Math.PI * 2);
        c.fill();
      }
    });
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), std(0xffffff, 0.95, { map: mat, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(this.mark.x, 0.03, this.mark.z);
    scene.add(rug);

    // tripod camera, pointing at the mark
    const T = V(S.x - 5.4, 0, S.z);
    const metal = std(0x333333, 0.4, { metalness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      scene.add(beam(V(T.x + Math.cos(a) * 0.55, 0, T.z + Math.sin(a) * 0.55), V(T.x, 1.35, T.z), 0.025, metal));
    }
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.4), std(0x202024, 0.4, { metalness: 0.5 }));
    cam.position.set(T.x, 1.5, T.z);
    scene.add(cam);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.22, 14), metal);
    lens.rotation.z = -Math.PI / 2;
    lens.position.set(T.x + 0.27, 1.5, T.z);
    scene.add(lens);
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: hdr(0xffffff, 1.2) }));
    this.bulb.position.set(T.x, 1.7, T.z);
    scene.add(this.bulb);
    world.colliders.push({ type: 'circle', x: T.x, z: T.z, r: 0.55 });

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.95),
      new THREE.MeshBasicMaterial({ map: signTexture('Selfie Point', tk('Press E · get your mela poster', 'Tap the button · get your mela poster'), '#6a0d2b'), color: new THREE.Color(1.2, 1.2, 1.2), side: THREE.DoubleSide })
    );
    sign.position.set(S.x - 3.2, 2.6, S.z - 3.6);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
    scene.add(beam(V(S.x - 3.2, 0, S.z - 3.6), V(S.x - 3.2, 2.1, S.z - 3.6), 0.06, std(0x3d2a1c)));
    world.colliders.push({ type: 'circle', x: S.x - 3.2, z: S.z - 3.6, r: 0.15 });
    const light = new THREE.PointLight(0xffd9a0, 28, 12, 2);
    light.position.set(S.x - 2.2, 3.2, S.z);
    scene.add(light);
    const fill = new THREE.PointLight(0xfff0dc, 34, 8, 2); // the photographer's light, from the tripod side
    fill.position.set(S.x - 4.2, 2.2, S.z + 0.6);
    scene.add(fill);
    lights.build();
    garlands.build();

    interactions.add({
      pos: this.mark,
      radius: 2.8,
      markerHeight: 2.6,
      label: 'Take a poster photo 📸',
      enabled: () => player.mode === 'walk',
      action: () => this.shoot(),
    });

    this.bindModal();
  }

  // ---------- the photo ----------

  async shoot() {
    const { player, ui, tasks, audio, passport } = this.ctx;
    if (player.mode !== 'walk') return;
    player.setBusy(true);
    const choice = await ui.menu('Strike a pose! 📸', 'The tripod takes your photo in front of the backdrop', POSES);
    if (choice === null) {
      player.setBusy(false);
      return;
    }
    const start = player.pos.clone();
    await tasks.tween(0.45, (k) => {
      player.pos.x = lerp(start.x, this.mark.x, k);
      player.pos.z = lerp(start.z, this.mark.z, k);
    });
    player.targetHeading = -Math.PI / 2; // face the tripod
    await tasks.wait(0.35);
    if (POSES[choice].action) player.char.setAction(POSES[choice].action);
    for (const n of [3, 2, 1]) {
      ui.toast(`📸 ${n}…`, 900);
      audio.beep(n === 1);
      await tasks.wait(0.75);
    }
    this.flash();
    audio.shutter();
    this.shot = this.capture();
    await tasks.wait(0.5);
    player.char.clearAction();
    player.setBusy(false);
    passport.stamp('poster');
    this.open();
  }

  flash() {
    const el = document.getElementById('flash');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    this.bulb.material.color.copy(hdr(0xffffff, 12));
    setTimeout(() => this.bulb.material.color.copy(hdr(0xffffff, 1.2)), 160);
  }

  /** Renders one frame from the tripod and grabs it before the browser composites. */
  capture() {
    const { camera, renderer, composer, interactions, bloom } = this.ctx;
    const S = this.S;
    const exposure = renderer.toneMappingExposure;
    const strength = bloom?.strength;
    renderer.toneMappingExposure = 0.82;
    if (bloom) bloom.strength = 0.28;
    const fov = camera.fov;
    const pos = camera.position.clone();
    const quat = camera.quaternion.clone();
    camera.fov = 40;
    camera.position.set(S.x - 5.3, 1.5, S.z + 0.55);
    camera.lookAt(this.mark.x + 0.2, 1.15, this.mark.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const marker = interactions.marker.visible;
    interactions.marker.visible = false;
    composer.render();
    const shot = grabFrame(renderer.domElement);
    renderer.toneMappingExposure = exposure;
    if (bloom) bloom.strength = strength;
    interactions.marker.visible = marker;
    camera.fov = fov;
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    camera.updateProjectionMatrix();
    return shot;
  }

  // ---------- the poster modal ----------

  bindModal() {
    const $ = (s) => document.querySelector(s);
    this.el = $('#posterModal');
    this.img = $('#posterImg');
    this.status = $('#posterStatus');
    $('#posterFormat').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.format = b.dataset.f;
      this.syncSeg();
      this.render();
    });
    $('#posterPhoto').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.p === 'upload') return $('#posterFile').click();
      this.photoMode = b.dataset.p;
      this.syncSeg();
      this.render();
    });
    $('#posterFile').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (this.uploadUrl) URL.revokeObjectURL(this.uploadUrl);
      this.uploadUrl = URL.createObjectURL(f);
      this.photoMode = 'upload';
      this.syncSeg();
      this.render();
    });
    $('#posterDownload').addEventListener('click', () => this.download());
    $('#posterShare').addEventListener('click', () => this.share());
    $('#posterCaption').addEventListener('click', () => this.copyCaption());
    $('#posterRetake').addEventListener('click', () => {
      this.close();
      this.shoot();
    });
    $('#posterClose').addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.el.classList.contains('hidden')) this.close();
    });
    if (!navigator.canShare) $('#posterShare').classList.add('hidden');
  }

  syncSeg() {
    document.querySelectorAll('#posterFormat button').forEach((b) => b.classList.toggle('on', b.dataset.f === this.format));
    document.querySelectorAll('#posterPhoto button').forEach((b) => b.classList.toggle('on', b.dataset.p === this.photoMode));
    document.querySelector('#posterPhoto [data-p="topmate"]').disabled = !profile.topmate?.image;
  }

  /** The mela link with the visitor's handle as a referral, so friends they bring get the invite bonus. */
  shareLink() {
    return profile.handle ? `${MELA_URL}?ref=${encodeURIComponent(profile.handle)}` : MELA_URL;
  }

  caption() {
    const who = profile.handle ? ` (topmate.io/${profile.handle})` : '';
    return `I've been to the Topmate Diwali Mela 🪔🎆${who} — ate jalebi, rode the giant wheel and flew the Pushpak Viman! Come celebrate with me: ${this.shareLink()} #TopmateDiwaliMela #Diwali #Topmate`;
  }

  /** A photo from wherever the camera is right now (the 📸 button). */
  snapHere() {
    const { ui, audio, passport } = this.ctx;
    if (ui.modalOpen) return;
    audio.shutter();
    this.flash();
    this.shot = this.captureCurrent();
    passport.stamp('poster');
    this.open();
  }

  captureCurrent() {
    const { renderer, composer, interactions } = this.ctx;
    const marker = interactions.marker.visible;
    interactions.marker.visible = false;
    composer.render();
    const shot = grabFrame(renderer.domElement);
    interactions.marker.visible = marker;
    return shot;
  }

  async open() {
    const { ui } = this.ctx;
    ui.open(this.el);
    this.status.textContent = '';
    if (profile.handle && !profile.topmate) {
      this.status.textContent = 'Looking up your Topmate profile…';
      await profile.fetchTopmate();
    }
    this.photoMode = profile.topmate?.image ? 'topmate' : 'avatar';
    this.syncSeg();
    this.status.textContent = profile.topmate?.found ? `✓ Using your Topmate photo (${profile.topmate.name})` : profile.handle ? 'Topmate profile not found, using your avatar' : '';
    this.render();
  }

  close() {
    this.ctx.ui.close(this.el);
  }

  photoSrc() {
    if (this.photoMode === 'topmate') return profile.topmate?.image ?? null;
    if (this.photoMode === 'upload') return this.uploadUrl ?? null;
    if (this.photoMode === 'avatar') return this.ctx.customizer?.portrait() ?? null;
    return null;
  }

  async render() {
    if (!this.shot) return;
    const my = (this.rendering = (this.rendering ?? Promise.resolve()).then(async () => {
      this.el.classList.add('busy');
      const canvas = await composePoster({
        shot: this.shot,
        photo: this.photoSrc(),
        name: profile.name || 'Mela visitor',
        handle: profile.handle,
        headline: profile.topmate?.headline,
        done: this.ctx.passport.done.size,
        total: STAMPS.length,
        format: this.format,
        shareLink: this.shareLink(),
      });
      this.canvas = canvas;
      // encode off the main thread where the browser can, and show it through an object URL
      this.posterBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (this.posterBlob) {
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = URL.createObjectURL(this.posterBlob);
        this.img.src = this.previewUrl;
      }
      this.el.classList.remove('busy');
    }));
    return my;
  }

  async blob() {
    await this.rendering;
    return this.posterBlob ?? new Promise((r) => this.canvas.toBlob(r, 'image/jpeg', 0.92));
  }

  async download() {
    const blob = await this.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `topmate-diwali-mela-${this.format}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.ctx.ui.toast('⬇ Poster saved. Share it with #TopmateDiwaliMela!');
  }

  async share() {
    const blob = await this.blob();
    const file = new File([blob], 'topmate-diwali-mela.jpg', { type: 'image/jpeg' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: this.caption(), title: 'Topmate Diwali Mela' });
      else await this.download();
    } catch {
      // the share sheet was dismissed
    }
  }

  async copyCaption() {
    try {
      await navigator.clipboard.writeText(this.caption());
      this.ctx.ui.toast('📋 Caption copied. Paste it with your poster!');
    } catch {
      this.status.textContent = this.caption();
    }
  }

  update(t) {
    this.lights.update(t);
  }
}
