// Screenshot a dev page: node tools/shoot.mjs <url> <out.png> [w h] [--phone]  (waits for window.__ready)
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [url, out, w = 1440, h = 900] = args;
const phone = process.argv.includes('--phone');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(phone ? { ...devices['Pixel 7'] } : { viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
await page.screenshot({ path: out });
console.log('tris/person', await page.evaluate(() => window.__tris));
if (errs.length) console.log('ERRORS', errs.slice(0, 5));
await browser.close();
