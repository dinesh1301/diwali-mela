import * as THREE from 'three';
import { SHOTS } from './shots.js';

/*
  Director mode: deterministic, frame-stepped camera shots of the mela for the launch trailer.

    ?director=<shotId>[&cfg=<base64url CreatorConfig>][&size=1080x1920]

  implies ?play&noyt&nonet&tier=high&dpr=1&gov=0 (night is set per shot). Math.random is seeded,
  and once the scene is built the page's clock is virtual: performance.now, Date.now, setTimeout,
  setInterval and requestAnimationFrame only move when the capture calls step(), which advances
  exactly 1/30 s and renders one frame. So a capture is smooth and identical on any machine.

    window.__director = { ready: Promise<void>, frames: number, frame: number, step(): Promise<void>, shot, duration, lateFrames }

  step() draws one frame synchronously (grab the canvas right after it) and returns a promise that
  resolves once the next frame's video seeks are done: `await __director.step()` makes captures
  with the Mela Screen's reels exact.

  ?director=free adds look(pos[3], target[3], fov?) for finding camera positions.
*/

export const FPS = 30;
const T0 = 60; // scene time at the first frame: rides and lights are already running

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reads ?director=; adjusts the other switches and seeds Math.random. null when not directing. */
export function directorParams(params) {
  const shot = params.get('director');
  if (!shot) return null;
  if (!SHOTS[shot] && shot !== 'free') console.warn(`director: unknown shot "${shot}"`);
  for (const k of ['play', 'noyt', 'nonet']) params.set(k, '');
  params.set('tier', 'high');
  params.set('dpr', '1');
  params.set('gov', '0');
  params.delete('place');
  params.delete('pos');
  params.delete('show');
  const [w, h] = (params.get('size') || '1080x1920').split('x').map(Number);
  Math.random = mulberry32(0x6d656c61 ^ (Number(params.get('seed')) || 0));
  document.body.classList.add('director');
  const style = document.createElement('style');
  style.textContent = `body.director > *:not(#app) { display: none !important; }
    body.director { overflow: hidden; background: #000; }
    body.director #app canvas { position: fixed; left: 0; top: 0; width: ${w}px !important; height: ${h}px !important; }`;
  document.head.appendChild(style);
  try {
    localStorage.removeItem('melaPos');
  } catch {
    // ignore
  }
  return { shot, width: w || 1080, height: h || 1920, cfgGiven: params.has('cfg') };
}

/** Freezes the page's clocks and timers; they advance only through advance(ms). */
function installClock() {
  const realNow = performance.now();
  let now = realNow;
  const dateBase = Date.UTC(2026, 10, 8, 14, 30) - realNow; // Diwali evening, IST
  let nextId = 1e6;
  let timers = [];
  let rafs = [];
  performance.now = () => now;
  Date.now = () => dateBase + now;
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextId++;
    timers.push({ id, at: now + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = nextId++;
    const every = Math.max(1, Number(ms) || 1);
    timers.push({ id, at: now + every, fn, args, every });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => {
    timers = timers.filter((x) => x.id !== id);
  };
  window.requestAnimationFrame = (fn) => {
    rafs.push(fn);
    return rafs.length;
  };
  window.cancelAnimationFrame = () => {};
  const run = (fn, args) => {
    try {
      if (typeof fn === 'function') fn(...args);
    } catch (e) {
      console.error(e);
    }
  };
  return {
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const x of timers) if (x.at <= end && (!best || x.at < best.at || (x.at === best.at && x.id < best.id))) best = x;
        if (!best) break;
        now = Math.max(now, best.at);
        if (best.every) best.at += best.every;
        else timers = timers.filter((x) => x !== best);
        run(best.fn, best.args);
      }
      now = end;
      const due = rafs;
      rafs = [];
      for (const fn of due) run(fn, [now]);
    },
  };
}

// ---------- helpers shared with the shot definitions ----------

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const curves = new WeakMap();
/** Catmull-Rom through points (arrays or vectors) at u in [0, 1]. */
function path(points, u, out = new THREE.Vector3()) {
  let c = curves.get(points);
  if (!c) {
    c = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : V(...p))), false, 'centripetal');
    curves.set(points, c);
  }
  return c.getPoint(Math.min(1, Math.max(0, u)), out);
}
const smooth = (u) => u * u * (3 - 2 * u);
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const H = { V, path, smooth, easeInOut, lerp, FPS };

/** A painted Ramayan title card for the Ramleela screen (the live YouTube embed can't be captured). */
function ramleelaStill() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const c = canvas.getContext('2d');
  const w = 1280;
  const h = 720;
  const bg = c.createRadialGradient(w / 2, h * 0.45, 40, w / 2, h / 2, w * 0.7);
  bg.addColorStop(0, '#ffcf6b');
  bg.addColorStop(0.25, '#e2701b');
  bg.addColorStop(0.6, '#7a1414');
  bg.addColorStop(1, '#240406');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  // sun rays
  c.save();
  c.translate(w / 2, h * 0.45);
  c.fillStyle = 'rgba(255,230,150,0.12)';
  for (let i = 0; i < 24; i++) {
    c.rotate((Math.PI * 2) / 24);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(w, -38);
    c.lineTo(w, 38);
    c.fill();
  }
  c.restore();
  // a bow drawn taut, arrow ready: the one image everyone knows
  c.save();
  c.translate(w / 2, h * 0.45);
  c.strokeStyle = '#3a1004';
  c.lineWidth = 16;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(-140, 0, 230, -1.05, 1.05);
  c.stroke();
  c.strokeStyle = '#ffd98a';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(-140 + 230 * Math.cos(-1.05), 230 * Math.sin(-1.05));
  c.lineTo(-40, 0);
  c.lineTo(-140 + 230 * Math.cos(1.05), 230 * Math.sin(1.05));
  c.stroke();
  c.strokeStyle = '#3a1004';
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(-40, 0);
  c.lineTo(250, 0);
  c.stroke();
  c.fillStyle = '#3a1004';
  c.beginPath();
  c.moveTo(285, 0);
  c.lineTo(240, -18);
  c.lineTo(240, 18);
  c.fill();
  c.restore();
  c.textAlign = 'center';
  c.font = '150px "Yatra One", serif';
  c.lineJoin = 'round';
  c.strokeStyle = '#3a0a04';
  c.lineWidth = 14;
  c.strokeText('रामायण', w / 2, h * 0.86);
  c.fillStyle = '#ffe7a3';
  c.fillText('रामायण', w / 2, h * 0.86);
  c.font = '600 30px Poppins, sans-serif';
  c.fillStyle = 'rgba(255,231,163,0.85)';
  c.fillText('RAMLEELA MAIDAN · AAJ RAAT', w / 2, h * 0.95);
  // old projector look: grain + vignette
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  const vg = c.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.65);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Starts directing once the scene is built. `m` is window.__mela plus frame and setCameraHook. */
export function startDirector(opts, m) {
  const id = opts.shot;
  const def = SHOTS[id] ?? (id === 'free' ? { duration: 1 / FPS, night: true, setup() {}, camera() {} } : null);
  let resolveReady;
  let rejectReady;
  const api = {
    shot: id,
    duration: def?.duration ?? 0,
    frames: def ? Math.max(1, Math.round(def.duration * FPS)) : 0,
    frame: 0,
    ready: new Promise((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    }),
    step() {
      throw new Error('director: not ready');
    },
  };
  window.__director = api;
  if (!def) {
    rejectReady(new Error(`unknown shot "${id}"; known: ${Object.keys(SHOTS).join(', ')}`));
    return;
  }
  // a capture that asked for a creator must never silently come out as the plain mela
  if (opts.cfgGiven && !m.creator?.cfg) {
    rejectReady(new Error('director: ?cfg= could not be decoded into a CreatorConfig (needs base64url JSON with a name)'));
    return;
  }

  const { camera, dayNight, ramayan, renderer } = m;
  // the Ramleela screen shows a painted still instead of the (uncapturable) YouTube embed
  if (ramayan?.hole) {
    ramayan.hole.material = new THREE.MeshBasicMaterial({ map: ramleelaStill(), color: new THREE.Color(0.9, 0.9, 0.9) });
  }
  renderer.setAnimationLoop(null);
  const clock = installClock();
  const dt = 1 / FPS;
  let t = T0;
  const state = {}; // per-shot scratch
  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
  let u = 0;
  let free = null;

  const applyCam = (camera) => {
    if (free) {
      cam.pos.fromArray(free.pos);
      cam.look.fromArray(free.target);
      cam.fov = free.fov ?? 60;
    } else {
      def.camera({ u, t, sec: api.frame / FPS, cam, m, H, state });
    }
    camera.position.copy(cam.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.look);
    if (cam.roll) camera.rotateZ(cam.roll);
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
  };
  m.setCameraHook(applyCam);

  const tick = (render) => {
    clock.advance(1000 / FPS);
    def.update?.({ u, t, dt, sec: api.frame / FPS, m, H, state });
    m.frame(dt, t, { render });
    t += dt;
  };

  (async () => {
    try {
      dayNight.T = def.night === false ? def.dayT ?? 30 : 1e6;
      dayNight.running = def.night !== false && def.dayT == null;
      dayNight.apply();
      await m.creator?.ready;
      await m.billboard?.ready; // reels / posts loaded (and video metadata known) before frame 0
      await document.fonts?.ready;
      await def.setup?.({ m, H, state, t });
      // pre-roll: simulate (without drawing) so the shot opens mid-action
      const warm = Math.round((def.warm ?? 1) * FPS);
      for (let i = 0; i < warm; i++) tick(false);
      // one throwaway draw compiles anything new in view, then frame 0 is the first real step
      u = 0;
      m.frame(0, t, { render: true });
      // Videos (the Mela Screen's reels) are seeked to each frame's time rather than played: the seek
      // for the next frame starts as soon as a frame is drawn, and step() returns that promise. A
      // capture that awaits step() is exact; one that doesn't usually is (the seek finishes during the
      // grab), and a frame drawn while a seek is still pending is counted in api.lateFrames.
      let pending = m.billboard?.prepare?.(dt) ?? null;
      let settled = true;
      const track = (p) => {
        settled = !p;
        p?.then(() => (settled = true));
        return p;
      };
      track(pending);
      await pending;
      api.lateFrames = 0;
      api.step = () => {
        if (!settled) api.lateFrames++;
        u = api.frames > 1 ? Math.min(1, api.frame / (api.frames - 1)) : 0;
        tick(true);
        api.frame++;
        pending = track(m.billboard?.prepare?.(dt) ?? null);
        return pending ?? Promise.resolve();
      };
      if (id === 'free') {
        api.look = (pos, target, fov) => {
          free = { pos, target, fov };
          m.frame(0, t, { render: true });
        };
      }
      resolveReady();
    } catch (e) {
      console.error(e);
      rejectReady(e);
    }
  })();
}
