// Finds camera framings: loads ?director=free once and renders a list of views to JPEGs.
//   node tools/director-look.mjs views.json [--port 4304] [--out bench/shots-director/look] [--cfg b64] [--scale 0.5]
// views.json: [{ "id": "a", "pos": [x,y,z], "target": [x,y,z], "fov": 60, "eval": "optional JS run first" }]
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const views = JSON.parse(readFileSync(argv[0], 'utf8'));
const port = Number(opt('port', 4304));
const out = opt('out', 'bench/shots-director/look');
const scale = Number(opt('scale', 0.5));
const cfg = opt('cfg', Buffer.from(JSON.stringify({ slug: 'test', name: 'Dinesh Singh', first: 'Dinesh', photoUrl: '/test-photo.png', stallNo: 21 })).toString('base64url'));
mkdirSync(out, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes(String(port)) && res()));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(`http://localhost:${port}/?director=free&cfg=${cfg}`);
await page.waitForFunction(() => window.__director, null, { timeout: 180000 });
await page.evaluate(() => window.__director.ready);
for (const v of views) {
  const data = await page.evaluate(async (v) => {
    if (v.eval) await (0, eval)(v.eval);
    window.__director.look(v.pos, v.target, v.fov);
    return window.__mela.renderer.domElement.toDataURL('image/jpeg', 0.85);
  }, v);
  const f = `${out}/${v.id}.jpg`;
  writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
  if (scale !== 1) spawnSync('sips', ['-Z', String(Math.round(1920 * scale)), f], { stdio: 'ignore' });
  console.log('wrote', f);
}
await browser.close();
server.kill();
process.exit(0);
