// Mobile HUD audit: opens the built mela as a phone in portrait and landscape, screenshots the HUD,
// the intro customiser and a few modals, and reports horizontal overflow and small touch targets.
//
//   npm run build && node tools/ui-audit.mjs --port 4211 --shots bench/shots-ui
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 4179));
const shots = opt('shots', 'bench/shots-ui');
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

const pixel = devices['Pixel 7'];
const views = {
  portrait: { ...pixel },
  landscape: { ...pixel, viewport: { width: pixel.viewport.height, height: pixel.viewport.width } },
  small: { ...devices['iPhone SE'] },
};

// Reports visible elements that overflow the viewport or their scroll box, and tap targets under 40px.
const audit = () => {
  const W = innerWidth, H = innerHeight;
  const out = { pageOverflowX: document.documentElement.scrollWidth > W, offscreen: [], small: [], clipped: [] };
  const name = (el) => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${el.dataset.action ? `[${el.dataset.action}]` : ''}${el.dataset.place ? `[${el.dataset.place}]` : ''}`;
  for (const el of document.querySelectorAll('button, input, select, #hud-top, #actionbar, #prompts, #chips, .modal-card, .cust-card')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    const scroller = el.closest('#places, #actionbar, .cust-card, .modal-card, .stamps, .board-body');
    if ((r.right > W + 1 || r.left < -1 || r.bottom > H + 1) && !(scroller && scroller !== el)) out.offscreen.push(`${name(el)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && (r.width < 40 || r.height < 40)) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) out.clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`);
  }
  out.small = [...new Set(out.small)].slice(0, 30);
  return out;
};

for (const [vname, ctxOpts] of Object.entries(views)) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // intro / customiser
  await page.goto(`http://localhost:${port}/?noyt&nonet&night&tier=low`);
  await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/${vname}-intro.png` });
  console.log(vname, 'intro', JSON.stringify(await page.evaluate(audit)));
  // HUD
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=low&place=bazaar`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/${vname}-hud.png` });
  console.log(vname, 'hud', JSON.stringify(await page.evaluate(audit)));
  for (const btn of ['#settingsBtn', '#passportBtn', '#boardsBtn']) {
    await page.tap(btn);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/${vname}-${btn.slice(1)}.png` });
    console.log(vname, btn, JSON.stringify(await page.evaluate(audit)));
    await page.evaluate(() => document.querySelector('.overlay:not(.hidden) [data-close]')?.click());
    await page.waitForTimeout(200);
  }
  if (errors.length) console.log(vname, 'errors', errors.slice(0, 5));
  await context.close();
}
await browser.close();

process.exit(0);
