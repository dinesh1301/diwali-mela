import { chromium, devices } from 'playwright';
const [port, vp] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const spot of ['gate', 'bazaar', 'plaza', 'ramleela']) {
  const ctx = await browser.newContext(vp === 'desktop' ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } : devices['Pixel 7']); const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=${vp === 'desktop' ? 'high' : 'low'}&place=${spot}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const { scene, camera } = window.__mela; const THREE_F = camera.constructor; let skinned = 0, skinnedInView = 0, people = 0;
    const m = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
    const v = camera.position.clone();
    scene.traverseVisible((o) => { if (o.isSkinnedMesh) { skinned++; const p = o.getWorldPosition(v.clone()).applyMatrix4(m); if (Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1) skinnedInView++; } });
    let meshesNamedCrowd = window.__mela.crowd?.people?.length ?? window.__mela.crowd?.npcs?.length ?? null;
    return { skinned, skinnedInView, crowd: meshesNamedCrowd };
  });
  console.log(vp, spot, JSON.stringify(r));
  await ctx.close();
}
await browser.close(); process.exit(0);
