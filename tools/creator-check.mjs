// Creator personalisation check: opens the mela with a ?cfg= creator and asserts their board and
// banner are in the scene, then saves screenshots to bench/shots-creator/.
//
//   node tools/creator-check.mjs [--port 4303] [--dev]   (default: vite preview of dist/; --dev: vite dev server)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 4303));
const dev = argv.includes('--dev');
const out = 'bench/shots-creator';
mkdirSync(out, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const CASES = [
  { id: 'photo', cfg: { slug: 'test', name: 'Dinesh Singh', first: 'Dinesh', photoUrl: '/test-photo.png', stallNo: 21 } },
  { id: 'nophoto', cfg: { slug: 'priya.s', name: 'Priya Sharma', first: 'Priya', photoUrl: '/missing.png', stallNo: 3 } },
  { id: 'longname', cfg: { slug: 'long', name: 'Venkataraghavan Subramanian', first: 'Venkat', photoUrl: '', stallNo: 8 } },
];

const server = spawn('npx', dev ? ['vite', '--port', String(port), '--strictPort'] : ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  server.on('exit', (c) => rej(new Error(`server exited ${c}`)));
});

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let failed = 0;
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=high&cfg=${b64(c.cfg)}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(() => window.__mela.creator?.ready);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const cr = window.__mela.creator;
    return { board: cr?.stallBoard?.visible === true, banner: cr?.banner?.visible === true, photo: !!cr?.photoLoaded, title: document.title };
  });
  await page.screenshot({ path: `${out}/${c.id}-spawn.png` });
  const ok = r.board && r.banner && errors.length === 0 && (c.id !== 'photo' || r.photo);
  if (!ok) failed++;
  console.log(c.id.padEnd(9), ok ? 'PASS' : 'FAIL', JSON.stringify(r), errors.slice(0, 3));
  await page.close();
}
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
