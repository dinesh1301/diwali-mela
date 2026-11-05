// The character review cast (tools/lineup.js) standing in the real bazaar at night, through the
// director's free camera, so faces and fabrics are judged under the mela's own lights.
//   node tools/char-mela-lineup.mjs [--port 4306] [--out bench/characters] [--size 1440x900]
// Saves mela-lineup.png (the whole cast), mela-faces-1/2.png (close-ups), mela-back.png, mela-walk.png.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 4306));
const out = opt('out', 'bench/characters');
const size = opt('size', '1440x900');
mkdirSync(out, { recursive: true });

// the cast is the lineup page's, read from its source so the two never drift apart
const src = readFileSync(new URL('./lineup.js', import.meta.url), 'utf8');
const CAST = eval(src.slice(src.indexOf('const LOOKS = [') + 'const LOOKS = '.length, src.indexOf('];', src.indexOf('const LOOKS = [')) + 1));

// the bazaar lane, looking down it from the gate side (the stalls and their lights either side)
const Z = 44;
const VIEWS = [
  { id: 'mela-lineup', pos: [0, 1.15, Z + 7.6], target: [0, 0.95, Z], fov: 50 },
  { id: 'mela-faces-1', pos: [-2.4, 1.48, Z + 2.3], target: [-2.4, 1.38, Z], fov: 34 },
  { id: 'mela-faces-2', pos: [2.4, 1.42, Z + 2.3], target: [2.4, 1.3, Z], fov: 34 },
  { id: 'mela-back', pos: [0, 1.25, Z - 5.2], target: [0, 1.0, Z], fov: 50 },
  { id: 'mela-walk', pos: [4.8, 1.25, Z + 3.4], target: [0, 0.9, Z], fov: 44, walk: true },
];

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes(String(port)) && res()));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const [w, h] = size.split('x').map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/?director=free&size=${size}`);
await page.waitForFunction(() => window.__director, null, { timeout: 180000 });
await page.evaluate(() => window.__director.ready);
await page.evaluate(
  async ({ cast, Z }) => {
    const { Character } = await import('/src/character.js');
    const m = window.__mela;
    // clear the lane of wanderers so the lineup reads
    for (const n of m.crowd.npcs) if (Math.abs(n.pos.x) < 9 && Math.abs(n.pos.z - Z) < 10) n.char.root.visible = false;
    window.__cast = cast.map((look) => {
      const ch = new Character(look, { lod: false });
      m.scene.add(ch.root);
      return ch;
    });
  },
  { cast: CAST, Z }
);

for (const v of VIEWS) {
  const data = await page.evaluate(
    async ({ v, Z }) => {
      const cast = window.__cast;
      const gap = 0.8;
      cast.forEach((ch, i) => {
        ch.root.position.set((i - (cast.length - 1) / 2) * gap, 0, Z + (v.walk ? (i % 2) * 0.9 : 0));
        ch.root.rotation.y = v.walk ? Math.PI / 2 : 0;
        ch.phase = i * 1.3;
      });
      for (let k = 0; k < 40; k++) for (const ch of cast) ch.animate(1 / 30, { speed: v.walk ? 1.3 : 0 });
      window.__director.look(v.pos, v.target, v.fov);
      return window.__mela.renderer.domElement.toDataURL('image/png');
    },
    { v, Z }
  );
  writeFileSync(`${out}/${v.id}.png`, Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', `${out}/${v.id}.png`);
}
if (errors.length) console.log('page errors', errors.slice(0, 3));
await browser.close();
try {
  process.kill(-server.pid);
} catch {
  // gone
}
process.exit(0);
