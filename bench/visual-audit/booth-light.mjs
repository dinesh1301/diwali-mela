// A/B of the pooled Khel Gali booth light: node booth-light.mjs PORT OUTPREFIX intensity,intensity,...
import { chromium } from 'playwright';
const [port, out, list] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=high&place=games`);
await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
await page.waitForTimeout(4000);
for (const k of list.split(',')) {
  const n = await page.evaluate((k) => {
    let n = 0;
    window.__mela.scene.traverse((o) => { if (o.isPointLight && o.color.getHex() === 0xffc27a && o.distance === 15) { o.intensity = +k; n++; } });
    return n;
  }, k);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}-${k}.png` });
  console.log(k, n);
}
await browser.close();
