// Draw calls and triangles that the people cost: renders each spot with every SkinnedMesh shown and
// hidden, freezing the crowd so both passes see the same frame. Serve a build first, e.g.
//   npx vite preview --port 4394 [--outDir other-dist] & node tools/char-calls.mjs --port 4394
import { chromium, devices } from 'playwright';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = opt('port', '4394');
const spots = opt('spots', 'gate,bazaar,games').split(',');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const spot of spots) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=low&place=${spot}&gov=0`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const { renderer, scene } = window.__mela;
    const raf = () => new Promise((f) => requestAnimationFrame(f));
    const people = [];
    scene.traverse((o) => o.isSkinnedMesh && people.push(o));
    const measure = async () => {
      renderer.info.autoReset = false;
      let calls = 0;
      let tris = 0;
      for (let i = 0; i < 12; i++) {
        renderer.info.reset();
        await raf();
        calls += renderer.info.render.calls;
        tris += renderer.info.render.triangles;
      }
      renderer.info.autoReset = true;
      return { calls: calls / 12, tris: Math.round(tris / 12) };
    };
    // stop time for everyone so both passes draw the same crowd in the same places
    const speed = window.__mela.clock ? null : null;
    void speed;
    const on = await measure();
    for (const p of people) p.visible = false;
    const off = await measure();
    for (const p of people) p.visible = true;
    let tri = 0;
    for (const p of people) tri += p.geometry.index.count / 3;
    return { people: people.length, perPersonTris: Math.round(tri / people.length), callsAll: on.calls, callsNoPeople: off.calls, peopleCalls: on.calls - off.calls, trisAll: on.tris, peopleTris: on.tris - off.tris };
  });
  console.log(spot.padEnd(7), JSON.stringify(r));
  await ctx.close();
}
await browser.close();
