// Creator personalisation check: opens the mela with a ?cfg= creator and asserts their board and
// banner are in the scene, then saves screenshots to bench/shots-creator/.
//
//   node tools/creator-check.mjs [--port 4303] [--dev]   (default: vite preview of dist/; --dev: vite dev server)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';

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
  // niche personalisation: titled + themed stall, Wall of Fame (one poster 404s -> painted placeholder)
  {
    id: 'themed',
    posts: 3,
    cfg: { slug: 'the.datascience.gal', name: 'Aishwarya Srinivasan', first: 'Aishwarya', photoUrl: '/test-photo.png', stallNo: 21, stallTitle: 'Aishwarya ki AI Dukaan', stallTheme: 'tech', knownFor: 'Data science', wallPosts: ['/__posts/p1.jpg', '/__posts/p2.jpg', '/__posts/missing.jpg', '/__posts/p3.jpg'] },
  },
  { id: 'diyastall', posts: 0, cfg: { slug: 'rahulbansaledits', name: 'Rahul Bansal', first: 'Rahul', photoUrl: '', stallNo: 2, stallTitle: 'Rahul ka Edit Studio', stallTheme: 'art', wallPosts: [] } },
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
  await page.route('**/__posts/*', (route) => {
    const f = `bench/shots-posts/${route.request().url().split('/').pop()}`;
    return existsSync(f) ? route.fulfill({ body: readFileSync(f), contentType: 'image/jpeg' }) : route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=high&cfg=${b64(c.cfg)}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(() => window.__mela.creator?.ready);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const cr = window.__mela.creator;
    return { board: cr?.stallBoard?.visible === true, banner: cr?.banner?.visible === true, wall: !!cr?.wall?.group?.parent, posts: cr?.postsLoaded ?? 0, photo: !!cr?.photoLoaded, title: document.title };
  });
  await page.screenshot({ path: `${out}/${c.id}-spawn.png` });
  if (r.wall) {
    // a look at the Wall of Fame and the stall from the aisle
    await page.evaluate(() => {
      const m = window.__mela;
      const w = m.creator.wall.center;
      const st = m.world.stalls.find((s) => s.group.children.includes(m.creator.stallBoard));
      const out = st.stand.clone().sub(st.group.position).setY(0).normalize();
      m.player.teleport(w.x + out.x * 4.5, w.z + out.z * 4.5 - 2.5);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${c.id}-wall.png` });
  }
  const ok = r.board && r.banner && r.wall && errors.length === 0 && (c.id !== 'photo' || r.photo) && (c.posts == null || r.posts === c.posts);
  if (!ok) failed++;
  console.log(c.id.padEnd(9), ok ? 'PASS' : 'FAIL', JSON.stringify(r), errors.slice(0, 3));
  await page.close();
}
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
