// Performance bench: serves dist/ via `vite preview`, opens the mela as an emulated phone (or desktop)
// and reports draw calls, triangles, shader programs, lights, shadow casters and frame times per spot.
//
//   npm run build && node tools/bench.mjs                 # phone (tier=low, 4x CPU throttle)
//   node tools/bench.mjs --desktop                        # desktop, tier=high
//   node tools/bench.mjs --out bench/after.json --secs 6  # save the result
//
// Frame times here come from a desktop GPU with a throttled CPU: compare them run-to-run, not with a
// real phone. Draw calls / programs / lights are exact on any machine.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const desktop = flag('desktop');
const secs = Number(opt('secs', 5));
const cpu = Number(opt('cpu', desktop ? 1 : 4));
const out = opt('out', null);
const port = Number(opt('port', 4179));
const shots = opt('shots', null); // directory: saves a screenshot per spot
const SPOTS = (opt('spots', 'gate,bazaar,games,plaza,ramleela,show')).split(',');

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
// npx forks the real vite process: kill the whole group so no preview is left holding the port
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // already gone
  }
};
process.on('exit', stopServer);
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  server.on('exit', (c) => rej(new Error(`preview exited ${c}`)));
});

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctxOpts = desktop ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } : { ...devices['Pixel 7'] };
const results = { mode: desktop ? 'desktop' : 'phone', cpu, secs, spots: {} };

for (const spot of SPOTS) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const place = spot === 'show' ? 'plaza&show' : spot;
  const tier = desktop ? 'high' : 'low';
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=${tier}&place=${place}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(1500); // settle: shader compiles, first shadow maps
  const r = await page.evaluate(async (secs) => {
    const { renderer, scene } = window.__mela;
    const raf = () => new Promise((f) => requestAnimationFrame(f));
    // one frame's totals across every render call (main, shadow, reflection, bloom)
    renderer.info.autoReset = false;
    await raf();
    renderer.info.reset();
    await raf();
    const calls = renderer.info.render.calls;
    const tris = renderer.info.render.triangles;
    renderer.info.autoReset = true;
    let meshes = 0, casters = 0, pts = 0, spots = 0;
    scene.traverseVisible((o) => {
      if (o.isMesh || o.isPoints || o.isLine) meshes++;
      if (o.isMesh && o.castShadow) casters++;
      if (o.isPointLight && o.intensity > 0) pts++;
      if (o.isSpotLight && o.intensity > 0) spots++;
    });
    const dts = [];
    let last = performance.now();
    const end = last + secs * 1000;
    while (performance.now() < end) {
      await raf();
      const now = performance.now();
      dts.push(now - last);
      last = now;
    }
    dts.sort((a, b) => a - b);
    const q = (p) => +dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(1);
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null;
    return {
      calls, tris, programs: renderer.info.programs.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      meshes, casters, pointLights: pts, spotLights: spots, pixelRatio: renderer.getPixelRatio(),
      fps: +(dts.length / secs).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), over33: +(dts.filter((d) => d > 33.4).length / dts.length * 100).toFixed(1), heapMB: heap,
    };
  }, secs);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: `${shots}/${results.mode}-${spot}.png` });
  }
  results.spots[spot] = { loadMs, ...r, errors: errors.slice(0, 5) };
  console.log(spot.padEnd(9), JSON.stringify(results.spots[spot]));
  await context.close();
}

await browser.close();
stopServer();
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('wrote', out);
}
process.exit(0);
