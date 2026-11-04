// Mela Screen check (live mode, not director): with test media in public/test-billboard/ (gitignored;
// any 9:16 mp4s / jpgs named 1-3.mp4, 1-3.jpg, post1.jpg, post2.jpg), served by vite preview of dist/.
//
//   npm run build && node tools/billboard-check.mjs [--port 4822] [--desktop] [--kind reels|posts|none] [--shots DIR]
//
// Asserts: the screen wakes near the gate (a video plays and advances), the carousel moves on, the
// decoders are released far away (ghat, ~90 m) and come back, a tap on the screen opens the overlay.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 4822));
const desktop = flag('desktop');
const kind = opt('kind', 'reels');
const shots = opt('shots', null);
const cfg = {
  slug: 'test',
  name: 'Dinesh Singh',
  first: 'Dinesh',
  stallNo: 3,
  ...(kind === 'reels'
    ? { billboard: { kind: 'reels', items: [1, 2, 3].map((i) => ({ type: 'video', src: `/test-billboard/${i}.mp4`, poster: `/test-billboard/${i}.jpg`, caption: `Test reel ${i}` })) } }
    : kind === 'posts'
      ? { billboard: { kind: 'posts', items: [{ type: 'image', src: '/test-billboard/post1.jpg', caption: 'A 4:5 post' }, { type: 'image', src: '/test-billboard/post2.jpg' }] } }
      : {}),
};
const b64 = Buffer.from(JSON.stringify(cfg)).toString('base64url');

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
process.on('exit', () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // gone
  }
});
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  server.on('exit', (c) => rej(new Error(`preview exited ${c}`)));
});
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext(desktop ? { viewport: { width: 1440, height: 900 } } : { ...devices['Pixel 7'] });
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('melaCoach', '1'));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// stand in the bazaar facing the gate: the screen's front faces the entrance, so look from the gate side
await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=${desktop ? 'high' : 'low'}&pos=0,60.5,3.14159&cfg=${b64}`);
await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 120000 });
// look up at the screen
await page.evaluate(() => {
  const p = window.__mela.player;
  p.cam.pitch = -0.3;
});
const state = () =>
  page.evaluate(() => {
    const b = window.__mela.billboard;
    const vids = [...b.videos.values()].map((v) => ({ t: +v.el.currentTime.toFixed(2), paused: v.el.paused, ready: v.ready, src: v.el.currentSrc.split('/').pop() }));
    return { active: b.active, idx: b.idx, fade: +b.fade.toFixed(2), videos: vids, holder: document.querySelectorAll('video').length, custom: b.custom };
  });
let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(ok ? 'PASS' : 'FAIL', msg, extra);
  if (!ok) fail++;
};
await page.waitForTimeout(2500);
const s1 = await state();
await page.waitForTimeout(1500);
const s2 = await state();
if (shots) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${desktop ? 'desktop' : 'phone'}-${kind}-near.png` });
}
check(s1.active, 'awake near the gate', JSON.stringify(s1));
if (kind === 'reels') {
  check(s2.videos.some((v) => !v.paused && v.t > 0.5), 'a reel is playing', JSON.stringify(s2));
  check(s2.videos.length <= 2, 'at most two video elements', s2.videos.length);
  // carousel: reel 1 is 6 s, so by ~9 s we are on another item
  await page.waitForTimeout(5000);
  const s3 = await state();
  check(s3.idx !== s1.idx, 'carousel moved on', JSON.stringify(s3));
  check(s3.videos.length <= 2 && s3.holder <= 2, 'still at most two videos', JSON.stringify(s3));
  if (shots) await page.screenshot({ path: `${shots}/${desktop ? 'desktop' : 'phone'}-${kind}-later.png` });
} else {
  await page.waitForTimeout(7000);
  const s3 = await state();
  if (kind === 'posts') check(s3.idx !== s1.idx, 'posts carousel moved on', JSON.stringify(s3));
  if (shots) await page.screenshot({ path: `${shots}/${desktop ? 'desktop' : 'phone'}-${kind}-later.png` });
}
// far away: decoders released
await page.evaluate(() => window.__mela.player.teleport(0, -38, Math.PI));
await page.waitForTimeout(800);
const far = await state();
check(!far.active && far.videos.length === 0 && far.holder === 0, 'asleep and released at the ghat', JSON.stringify(far));
// back: wakes again
await page.evaluate(() => window.__mela.player.teleport(0, 60.5, Math.PI));
await page.evaluate(() => (window.__mela.player.cam.pitch = -0.3));
await page.waitForTimeout(2500);
const back = await state();
check(back.active && (kind !== 'reels' || back.videos.some((v) => !v.paused)), 'awake again near the gate', JSON.stringify(back));
// tap the screen's centre
if (kind !== 'none') {
  const xy = await page.evaluate(() => {
    const { billboard: b, camera, renderer } = window.__mela;
    const s = b.size;
    const p = b.pos.clone().setY((s.y0 + s.y1) / 2).setZ(b.pos.z + 0.2).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, inView: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 };
  });
  if (!xy.inView) check(false, 'screen centre in view for the tap', JSON.stringify(xy));
  else {
    if (desktop) await page.mouse.click(xy.x, xy.y);
    else await page.touchscreen.tap(xy.x, xy.y);
    await page.waitForTimeout(600);
    const open = await page.evaluate(() => !!document.querySelector('.bb-overlay'));
    check(open, 'tap opens the overlay', JSON.stringify(xy));
    if (shots && open) await page.screenshot({ path: `${shots}/${desktop ? 'desktop' : 'phone'}-${kind}-overlay.png` });
    if (open) {
      await page.evaluate(() => [...document.querySelectorAll('.bb-overlay button')].pop().click());
      const closed = await page.evaluate(() => !document.querySelector('.bb-overlay') && !window.__mela.input.blocked);
      check(closed, 'overlay closes and input is unblocked');
    }
  }
}
check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(fail ? 1 : 0);
