import { chromium, devices } from 'playwright';
const port = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, o] of Object.entries({ land: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } }, se: { ...devices['iPhone SE'] }, phone: devices['Pixel 7'] })) {
  const ctx = await browser.newContext(o); const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=low&place=bazaar`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  for (const [btn, id] of [['#passportBtn', '#passport'], ['#settingsBtn', '#settingsPanel'], ['#boardsBtn', '#boards']]) {
    await page.tap(btn); await page.waitForTimeout(300);
    const r = await page.evaluate((id) => { const c = document.querySelector(id + ' .modal-card'); const b = c.querySelector('[data-close]'); const br = b.getBoundingClientRect(); return { scrollH: c.scrollHeight, clientH: c.clientHeight, closeTop: Math.round(br.top), vh: innerHeight }; }, id);
    console.log(name, id, JSON.stringify(r));
    await page.evaluate((id) => document.querySelector(id + ' [data-close]').click(), id); await page.waitForTimeout(200);
  }
  await ctx.close();
}
await browser.close(); process.exit(0);
