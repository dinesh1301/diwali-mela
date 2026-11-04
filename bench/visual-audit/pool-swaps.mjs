import { chromium, devices } from 'playwright';
const [port, vp, place, keys = 'KeyW'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(vp === 'desktop' ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } : devices['Pixel 7']);
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=${vp === 'desktop' ? 'high' : 'low'}&place=${place}`);
await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const lp = window.__mela.lightPool; const P = window.__mela.player; window.__swaps = [];
  let prev = new Set(lp.chosen.point.map((r) => r.o));
  const orig = lp.update.bind(lp);
  const v = new (P.pos.constructor)();
  lp.update = function () {
    orig();
    const now = new Set(lp.chosen.point.map((r) => r.o));
    for (const o of prev) if (!now.has(o) && o.intensity > 0) {
      o.getWorldPosition(v); const d = v.distanceTo(P.pos);
      if (d < o.distance) window.__swaps.push({ d: +d.toFixed(1), I: o.intensity, range: o.distance, atPlayer: +(o.intensity / (1 + d * d)).toFixed(2) });
    }
    prev = now;
  };
});
for (const k of keys.split(',')) await page.keyboard.down(k);
await page.waitForTimeout(10000);
const s = await page.evaluate(() => window.__swaps);
console.log(vp, place, 'drops within range while walking 10s:', s.length, JSON.stringify(s.sort((a, b) => a.d - b.d).slice(0, 12)));
await browser.close(); process.exit(0);
