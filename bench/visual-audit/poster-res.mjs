// Poster grab width on a phone whose governor sits at 0.8x (should be taken at >= 1.25x)
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${process.argv[2]}/?play&noyt&nonet&night&tier=low&gov=0&dpr=0.8&place=plaza`);
await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
await page.waitForTimeout(2000);
const r = await page.evaluate(() => { const m = window.__mela; const before = m.renderer.getPixelRatio(); const a = m.poster.captureCurrent(); const b = m.poster.capture(); return { before, after: m.renderer.getPixelRatio(), current: [a.width, a.height], tripod: [b.width, b.height], canvas: m.renderer.domElement.width }; });
console.log(JSON.stringify(r), errors);
await browser.close();
