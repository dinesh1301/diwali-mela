// Dev-only character lineup (npm run dev, then /tools/lineup.html?low&walk&night&cam=face&only=0,1)
import * as THREE from 'three';
import { settings } from '../src/settings.js';

const q = new URLSearchParams(location.search);
settings.quality = q.has('low') ? 'low' : 'high';
const { Character } = await import('../src/character.js');

const LOOKS = [
  { name: 'man in kurta', skin: 0xc68642, top: 0xfff1d0, bottom: 0xf5ebe0, accent: 0xff7a00, hair: 0x140c08, shoes: 0x5c2a12, style: 'kurta', hairStyle: 'short', dupatta: 0xff7a00, moustache: true, body: 'm', age: 'adult', scale: 1.02 },
  { name: 'woman in saree', skin: 0xa8754a, top: 0xc1121f, bottom: 0xffd166, accent: 0xffd166, hair: 0x140c08, shoes: 0xd4a017, style: 'saree', hairStyle: 'bun', bindi: true, bangles: 0xd4a017, body: 'f', age: 'adult', scale: 0.96 },
  { name: 'woman in lehenga', skin: 0xe0ac69, top: 0xe0218a, bottom: 0x1f9d55, accent: 0xe0218a, hair: 0x2b1a10, shoes: 0xd4a017, style: 'lehenga', hairStyle: 'braid', dupatta: 0xffd166, bindi: true, bangles: 0xe63946, body: 'f', age: 'adult', scale: 0.95 },
  { name: 'older man, pagdi', skin: 0x8d5524, top: 0xf5ebe0, bottom: 0xf5ebe0, accent: 0xff7a00, turban: 0xff7a00, hair: 0xb9b2a8, shoes: 0x3b2a1a, style: 'kurta', hairStyle: 'turban', moustache: true, glasses: true, body: 'm', age: 'elder', scale: 0.98 },
  { name: 'child', skin: 0xd99a6c, top: 0xffb703, bottom: 0xe63946, accent: 0x3a86ff, hair: 0x140c08, shoes: 0xe63946, style: 'lehenga', hairStyle: 'pony', body: 'f', age: 'kid', scale: 0.64 },
  { name: 'teen casual', skin: 0xb07a52, top: 0x219ebc, bottom: 0x2f4a7a, accent: 0xe63946, hair: 0x2b1a10, shoes: 0xf2f2f2, style: 'casual', hairStyle: 'curly', body: 'm', age: 'teen', scale: 0.93 },
  { name: 'groom, sherwani', skin: 0xe0ac69, top: 0x7a1f3d, bottom: 0xf1e3c6, accent: 0xffd166, hair: 0x140c08, shoes: 0xd4a017, style: 'sherwani', hairStyle: 'short', body: 'm', age: 'adult', scale: 1.0 },
  { name: 'salwar + dupatta', skin: 0x6f4422, top: 0x2a9d8f, bottom: 0xfff1d0, accent: 0xffd166, hair: 0x140c08, shoes: 0x8b1e3f, style: 'salwar', hairStyle: 'open', dupatta: 0xffd166, bindi: true, body: 'f', age: 'adult', scale: 0.95 },
  { name: 'boy', skin: 0xc68642, top: 0x06d6a0, bottom: 0xfff1d0, accent: 0xff7a00, hair: 0x140c08, shoes: 0x5c2a12, style: 'kurta', hairStyle: 'short', body: 'm', age: 'kid', scale: 0.62 },
];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const night = q.has('night');
scene.background = new THREE.Color(night ? 0x120a1c : 0x3a2440);
scene.add(new THREE.HemisphereLight(night ? 0x8a7aa8 : 0xfff0d0, 0x3a2030, night ? 0.6 : 1.3));
const key = new THREE.DirectionalLight(0xffe0b0, night ? 0.8 : 2.4);
key.position.set(2, 4, 5);
key.castShadow = true;
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 4, bottom: -1 });
scene.add(key);
if (night) {
  for (const x of [-4, 0, 4]) {
    const p = new THREE.PointLight(0xffa040, 12, 9, 1.6);
    p.position.set(x, 2.6, 2.5);
    scene.add(p);
  }
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const only = q.get('only');
const list = only ? only.split(',').map((i) => LOOKS[+i]) : LOOKS.slice(0, +(q.get('n') ?? 6));
const gap = +(q.get('gap') ?? 0.85);
const chars = list.map((l, i) => {
  const c = new Character(l, { ownMaterial: q.has('own') });
  c.root.position.x = (i - (list.length - 1) / 2) * gap;
  c.root.rotation.y = +(q.get('rot') ?? 0);
  scene.add(c.root);
  return c;
});
const cam = new THREE.PerspectiveCamera(+(q.get('fov') ?? 30), innerWidth / innerHeight, 0.1, 100);
const mode = q.get('cam');
const fy = +(q.get('fy') ?? 1.6);
if (mode === 'face') {
  cam.position.set(0, fy, +(q.get('d') ?? 1.4));
  cam.lookAt(0, fy - 0.03, 0);
} else {
  cam.position.set(0, 1.15, mode === 'far' ? 18 : (list.length * gap) / 0.5);
  cam.lookAt(0, 0.92, 0);
}
let tris = 0;
for (const c of chars) tris += c.mesh.geometry.index.count / 3;
document.getElementById('info').textContent = `${chars.length} people · avg ${Math.round(tris / chars.length)} tris · ${settings.tier}`;
window.__tris = tris / chars.length;
const action = q.get('action');
if (action) chars.forEach((c) => c.setAction(action));
const speed = q.has('walk') ? +(q.get('walk') || 1.4) : 0;
let last = performance.now();
for (let i = 0; i < +(q.get('pre') ?? 0); i++) for (const c of chars) c.animate(1 / 60, { speed });
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!q.has('freeze')) for (const c of chars) c.animate(dt, { speed });
  renderer.render(scene, cam);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__ready = true;
