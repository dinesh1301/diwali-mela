// Character review shots in the real game (serve with `npm run dev` or preview first):
//   node tools/char-shots.mjs --url http://localhost:4392 --out dir [--places bazaar,games,ghat,ravan]
// Saves: the crowd at night at each place (desktop 1440x900 and Pixel 7) and the customiser preview
// once per outfit (desktop and phone).
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const base = opt('url', 'http://localhost:4392');
const out = opt('out', 'bench/characters');
const places = opt('places', 'bazaar,games,ghat,ravan').split(',').filter(Boolean);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

async function crowd(name, ctxOpts, tier, place) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('melaCoach', '1'));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/?play&noyt&nonet&night&tier=${tier}&place=${place}&gov=0`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const ground = await page.evaluate(() => window.__mela.player.pos.y);
  void ground;
  // gather the wandering crowd into the lane ahead of the visitor, as a busy evening would
  await page.evaluate(() => {
    const { crowd, player } = window.__mela;
    const p = player.pos;
    crowd.npcs.slice(0, 14).forEach((n, i) => {
      const row = Math.floor(i / 4);
      n.pos.set(p.x - 3 + (i % 4) * 2 + (row % 2) * 0.8, p.y, p.z - 3.5 - row * 2.6);
      // half stroll towards the camera, half stand chatting, facing it
      n.heading = (i % 3) * 0.35 - 0.35;
      if (i % 2) {
        n.wait = 0;
        n.target.set(n.pos.x, 0, p.z + 30);
      } else {
        n.wait = 20;
        n.char.clearAction();
      }
    });
    player.pos.x += 2.2; // the visitor steps aside so the crowd is in view
    player.cam.targetDist = player.cam.dist = 6.5;
    player.cam.pitch = 0.16;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/crowd-${place}-night-${name}.png` });
  if (errors.length) console.log(name, 'errors', errors.slice(0, 3));
  await ctx.close();
}

for (const place of places) {
  await crowd('desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 'high', place);
  await crowd('pixel7', { ...devices['Pixel 7'] }, 'low', place);
}

// the avatar editor (opened from the HUD), facing the camera, once per outfit
for (const [dev, ctxOpts] of [['', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }], ['-phone', { ...devices['Pixel 7'] }]]) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('melaCoach', '1'));
  await page.goto(`${base}/?play&noyt&nonet&night&tier=high&place=bazaar&gov=0`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  for (const [style, hairStyle, extra] of [['saree', 'bun'], ['kurta', 'turban', { body: 'm', beard: 'grey', moustache: true }], ['lehenga', 'braid'], ['sherwani', 'short', { beard: 'dark' }], ['casual', 'curly', { body: 'm', beard: false }]]) {
    await page.evaluate(([style, hairStyle, extra]) => {
      const c = window.__mela.customizer;
      c.open('edit');
      c.apply({ style, hairStyle, ...(extra ?? {}) });
      c.char.clearAction();
      c.idleTimer = 99;
      c.spin = 0.25;
      c.dragging = { x: 0, id: -1 }; // hold the spin
    }, [style, hairStyle, extra]);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/customizer-${style}${dev}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log('saved to', out);
