import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [port, outDir, vps, modes, spotsArg] = process.argv.slice(2);
const VP = {
  phone: { ...devices['Pixel 7'] },
  land: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 } },
  se: { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
};
const SPOTS = (spotsArg || 'gate,bazaar,games,plaza,ramleela,show').split(',');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const report = {};
for (const vp of vps.split(',')) for (const mode of modes.split(',')) for (const spot of SPOTS) {
  const ctx = await browser.newContext(VP[vp]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.type() + ':' + m.text().slice(0, 200)));
  const place = spot === 'show' ? 'plaza&show' : spot;
  const tier = vp === 'desktop' ? 'high' : 'low';
  const night = mode === 'night' ? '&night' : '';
  await page.goto(`http://localhost:${port}/?play&noyt&nonet${night}&tier=${tier}&place=${place}`);
  try { await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 }); } catch (e) { errors.push('TIMEOUT'); }
  await page.waitForTimeout(mode === 'night' ? 3000 : 2500);
  const name = `${vp}-${mode}-${spot}`;
  await page.screenshot({ path: `${outDir}/${name}.png` });
  const info = await page.evaluate(() => ({ gov: window.__mela?.gov, pr: window.__mela?.renderer.getPixelRatio(), T: window.__mela?.dayNight?.T })).catch((e) => ({ err: String(e) }));
  report[name] = { ...info, errors: errors.slice(0, 6) };
  console.log(name, JSON.stringify(report[name]));
  await ctx.close();
}
writeFileSync(`${outDir}/report-${vps}-${modes}.json`, JSON.stringify(report, null, 2));
await browser.close();
