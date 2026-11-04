// Director mode check: loads every shot, steps it, saves frames, asserts no page errors and a
// non-black picture. Frames go to bench/shots-director/<shot>-<frame>.jpg.
//
//   node tools/director-check.mjs                       # all shots, 3 frames each (vite preview of dist/)
//   node tools/director-check.mjs --dev --full          # vite dev server; step whole shots, save first/mid/last
//   node tools/director-check.mjs --shots gate,stall --at 0,45,149 --cfg <b64url>
//   node tools/director-check.mjs --shots stall --full --theme books   # default cfg with another stall theme
//   node tools/director-check.mjs --shots gate --full --billboard reels  # Mela Screen with public/test-billboard/ media
//
// Test posters for the Wall of Fame are served from bench/shots-posts/ at /__posts/ (never shipped).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 4305));
const out = opt('out', 'bench/shots-director');
const ALL = ['gate', 'stall', 'games', 'viman', 'karts', 'wheel', 'train', 'boat', 'ramleela', 'ravan', 'fireworks'];
const shots = opt('shots', ALL.join(',')).split(',');
const full = flag('full');
const at = opt('at', null)?.split(',').map(Number);
const size = opt('size', '1080x1920');
const [W, H] = size.split('x').map(Number);
const theme = opt('theme', 'tech');
const cfg = opt(
  'cfg',
  Buffer.from(
    JSON.stringify({
      slug: 'test',
      name: 'Dinesh Singh',
      first: 'Dinesh',
      photoUrl: '/test-photo.png',
      stallNo: Number(opt('stall', 21)),
      stallTitle: opt('title', 'Dinesh ki Startup Dukaan'),
      stallTheme: theme,
      knownFor: 'Founder, Topmate',
      wallPosts: ['/__posts/p1.jpg', '/__posts/p2.jpg', '/__posts/p4.jpg', '/__posts/p3.jpg'].slice(0, Number(opt('posts', 4))),
      // --billboard reels|posts: test media from public/test-billboard/ (gitignored; see tools/README in the header)
      ...(opt('billboard', null) === 'reels'
        ? { billboard: { kind: 'reels', items: [1, 2, 3].map((i) => ({ type: 'video', src: `/test-billboard/${i}.mp4`, poster: `/test-billboard/${i}.jpg`, caption: `Test reel ${i}` })) } }
        : opt('billboard', null) === 'posts'
          ? { billboard: { kind: 'posts', items: [{ type: 'image', src: '/test-billboard/post1.jpg', caption: 'A 4:5 post' }, { type: 'image', src: '/test-billboard/post2.jpg' }] } }
          : {}),
    })
  ).toString('base64url')
);
mkdirSync(out, { recursive: true });

const server = spawn('npx', flag('dev') ? ['vite', '--port', String(port), '--strictPort'] : ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  server.on('exit', (c) => rej(new Error(`server exited ${c}`)));
});
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

let failed = 0;
for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/__posts/*', (route) => {
    const f = `bench/shots-posts/${route.request().url().split('/').pop()}`;
    return existsSync(f) ? route.fulfill({ body: readFileSync(f), contentType: 'image/jpeg' }) : route.fulfill({ status: 404, body: '' });
  });
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?director=${shot}&cfg=${cfg}&size=${size}`);
  await page.waitForFunction(() => window.__director, null, { timeout: 180000 });
  let info;
  try {
    info = await page.evaluate(async () => {
      await window.__director.ready;
      return { frames: window.__director.frames, duration: window.__director.duration };
    });
  } catch (e) {
    console.log(shot.padEnd(10), 'FAIL ready', String(e).slice(0, 300), errors.slice(0, 3));
    failed++;
    await page.close();
    continue;
  }
  const loadMs = Date.now() - t0;
  const want = at ? at.filter((f) => f < info.frames) : full ? [0, Math.floor(info.frames / 2), info.frames - 1] : [0, 1, 2];
  const last = Math.max(...want);
  const lum = [];
  const s0 = Date.now();
  for (let f = 0; f <= last; f++) {
    const grab = want.includes(f);
    const r = await page.evaluate(async (grab) => {
      const next = window.__director.step(); // draws now; resolves when the next frame's videos are seeked
      if (!grab) {
        await next;
        return null;
      }
      const cv = window.__mela.renderer.domElement;
      const url = cv.toDataURL('image/jpeg', 0.9);
      const small = document.createElement('canvas');
      small.width = 27;
      small.height = 48;
      const c = small.getContext('2d');
      c.drawImage(cv, 0, 0, 27, 48);
      const d = c.getImageData(0, 0, 27, 48).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      await next;
      return { url, lum: s / (d.length / 4) / 3 };
    }, grab);
    if (r) {
      writeFileSync(`${out}/${shot}-${String(f).padStart(3, '0')}.jpg`, Buffer.from(r.url.split(',')[1], 'base64'));
      lum.push(+r.lum.toFixed(1));
    }
  }
  const msPerFrame = Math.round((Date.now() - s0) / (last + 1));
  const ok = errors.length === 0 && lum.every((l) => l > 6);
  if (!ok) failed++;
  console.log(shot.padEnd(10), ok ? 'PASS' : 'FAIL', JSON.stringify({ frames: info.frames, saved: want, lum, loadMs, msPerFrame }), errors.slice(0, 3));
  await page.close();
}
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
