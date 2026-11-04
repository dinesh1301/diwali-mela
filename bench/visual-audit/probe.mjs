import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const [port, out, vp, query, n = '4', gap = '1500', evalExpr = ''] = process.argv.slice(2);
const VP = {
  phone: { ...devices['Pixel 7'] },
  land: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 } },
  se: { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
};
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(VP[vp]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type(), m.text().slice(0, 300)));
page.on('response', (r) => r.status() >= 400 && console.log('HTTP', r.status(), r.url()));
await page.goto(`http://localhost:${port}/?${query}`);
await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
for (let i = 0; i < +n; i++) {
  await page.waitForTimeout(+gap);
  await page.screenshot({ path: `${out}/${vp}-${i}.png` });
  if (evalExpr) console.log(i, JSON.stringify(await page.evaluate(evalExpr)));
}
await browser.close(); process.exit(0);
