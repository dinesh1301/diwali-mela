// Personal-slot check: unit-checks the slot cleaner, then opens the mela with the sample
// data-science creator (tools/personal-sample.mjs: every slot set) on a phone (Pixel 7) and a
// desktop, walks to the bazaar, a food menu, Khel Gali, the rides, the ghat and the Selfie Point
// and saves screenshots to bench/shots-personal/ (read them: everything must read at phone size).
//
//   npm run build && node tools/personal-check.mjs [--port 4722] [--only phone|desktop]
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { SAMPLE, b64 } from './personal-sample.mjs';
import { cleanText, setMelaSlots, slot, SLOTS, melaReport } from '../src/personalSlots.js';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 4722));
const only = opt('only', null);
const out = 'bench/shots-personal';
mkdirSync(out, { recursive: true });

// ---------- unit: cleaning and fallbacks ----------
let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
eq('strips html', cleanText('<img src=x onerror=alert(1)>Hi', 40), 'img src=x onerror=alert(1)Hi');
eq('strips control + bidi', cleanText('A‮B\u0007C', 10), 'A B C');
eq('collapses space', cleanText('  a \n\t b ', 10), 'a b');
eq('word cut', cleanText('Golgappa Gradient Descent', 22), 'Golgappa Gradient');
eq('too long -> null', cleanText('x'.repeat(40), 22), null);
eq('not a string', cleanText(42, 10), null);
eq('placeholders', cleanText('{first}’s {prize} {evil}', 40, { first: 'Asha' }), 'Asha’s {prize} evil');
setMelaSlots({ 'stall.diyas.theme': 'TECH', 'stall.toys.theme': 'rocket', 'zone.gate': '', 'game.shoot.prize': 'a hoodie', bogus: 'x' }, { first: 'Asha', name: 'Asha Rao' });
eq('theme ok', slot('stall.diyas.theme'), 'tech');
eq('bad theme -> default', slot('stall.toys.theme'), 'general');
eq('empty -> creatorDefault', slot('zone.gate'), '🪔 Welcome to Asha’s Diwali Mela!');
eq('prize template', slot('game.shoot.sub', { prize: slot('game.shoot.prize') }), 'Balloon shooting · win a hoodie');
eq('rejected', melaReport().rejected.map((r) => r.id).sort(), ['bogus', 'stall.toys.theme', 'zone.gate']);
setMelaSlots(null, null);
eq('plain mela defaults', slot('gate.subtitle'), 'TOPMATE DIWALI MELA');
eq('ids unique', new Set(SLOTS.map((s) => s.id)).size, SLOTS.length);
eq('defaults fit', SLOTS.filter((s) => s.kind !== 'stallTheme' && [...s.default.replace('{prize}', 'a teddy bear')].length > s.maxLen + 12).map((s) => s.id), []);

// ---------- in the browser ----------
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // gone
  }
};
process.on('exit', stopServer);
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  server.on('exit', (c) => rej(new Error(`preview exited ${c}`)));
});

// [name, x, z, heading, phoneOnly]   heading: 0 faces +z, PI faces -z (towards the river)
const SPOTS = [
  ['gate', 0, 70, Math.PI],
  ['bazaar-aisle', 0, 52, Math.PI],
  ['stall1-mithai', -1.5, 47, -Math.PI / 2],
  ['stall2-diyas-books', 1.5, 47, Math.PI / 2, true],
  ['stall4-kandeel-art', 1.5, 37, Math.PI / 2, true],
  ['stall5-own', -1.5, 27, -Math.PI / 2, true],
  ['stall8-toys-tech', 1.5, 17, Math.PI / 2],
  ['menu-mithai', -6.3, 47, -Math.PI / 2, false, 'menu'],
  ['game1-shoot', 19, 14, Math.PI / 2],
  ['game2-rings', 19, 23, Math.PI / 2, true],
  ['game3-cans', 19, 32, Math.PI / 2, true],
  ['game4-striker', 19, 41, Math.PI / 2, true],
  ['wheel', -34, -10, Math.PI],
  ['carousel', -14, 30, -Math.PI / 2, true],
  ['train-station', 12.5, 36, Math.PI / 2, true],
  ['airfield', 40, 18, Math.PI / 2, true],
  ['cars', -37.5, 21, -Math.PI / 2, true],
  ['ghat', -10, -36.5, Math.PI],
  ['jetty', 9, -38, Math.PI, true],
  ['selfie', 10.5, 56, Math.PI / 2],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const MODES = [
  ['phone', { ...devices['Pixel 7'] }, 'low'],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 'high'],
].filter(([m]) => !only || m === only);

for (const [mode, ctxOpts, tier] of MODES) {
  const context = await browser.newContext(ctxOpts);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('melaCoach', '1');
    } catch {
      // ignore
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=${tier}&cfg=${b64(SAMPLE)}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(() => window.__mela.creator?.ready);
  const rep = await page.evaluate(() => window.__mela.mela);
  const want = Object.keys(SAMPLE.mela).filter((k) => !['not.a.slot', 'stall.kulfi.theme'].includes(k)).length;
  eq(`${mode}: slots applied`, rep.applied.length, want);
  eq(`${mode}: rejected`, rep.rejected.map((r) => r.id).sort(), ['not.a.slot', 'stall.kulfi.theme']);
  for (const [name, x, z, h, phoneOnly, act] of SPOTS) {
    if (phoneOnly && mode !== 'phone') continue;
    await page.evaluate(([x, z, h]) => {
      const m = window.__mela;
      m.player.teleport(x, z, h);
      m.player.cam.yaw = h + Math.PI;
      m.player.cam.pitch = 0.12;
    }, [x, z, h]);
    await page.waitForTimeout(1300);
    if (act === 'menu') {
      await page.keyboard.press('e');
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: `${out}/${mode}-${name}.png` });
    if (act === 'menu') {
      const menu = await page.evaluate(() => ({ title: document.querySelector('#menu h2')?.textContent, items: [...document.querySelectorAll('#menu .o-label')].map((e) => e.textContent) }));
      eq(`${mode}: mithai menu`, menu, { title: 'Mithai Model Mahal', items: ['Gradient Laddoo', 'Kaju Kernel Katli', 'Gulab Jamun-py', 'Pandas Pista Barfi'] });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }
  eq(`${mode}: no page errors`, errors.slice(0, 3), []);
  await context.close();
}
await browser.close();
stopServer();
console.log(failed ? `${failed} FAILED` : 'all passed', `· screenshots in ${out}/`);
process.exit(failed ? 1 : 0);
