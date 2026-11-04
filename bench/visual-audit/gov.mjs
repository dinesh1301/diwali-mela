import { chromium, devices } from 'playwright';
const [port, place = 'bazaar', cpu = '4', secs = '24', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu });
await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=low&place=${place}${extra}`);
await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
for (let t = 0; t <= +secs; t += 2) {
  const g = await page.evaluate(() => { const g = window.__mela.gov; return { pr: g.pixelRatio, ch: g.changes, mean: g.mean, slow: g.slow, work: g.work, cap30: g.cap30, blocked: g.blockedFrom, hold: g.holdDrops }; });
  console.log(t + 's', JSON.stringify(g));
  await page.waitForTimeout(2000);
}
await browser.close(); process.exit(0);
