// Average triangles per person for the high and phone tiers: node tools/char-tris.mjs [old-character.js]
const oldPath = process.argv[2];
const { settings } = await import('../src/settings.js');
const cur = await import('../src/character.js');
const { buildPerson } = await import('../src/charGeo.js');
const old = oldPath ? await import(new URL(oldPath, `file://${process.cwd()}/`).href) : null;
for (const tier of ['high', 'low']) {
  settings.quality = tier;
  let a = 0;
  let b = 0;
  const n = 80;
  for (let i = 0; i < n; i++) {
    if (old) {
      const c = new old.Character(old.randomLook({ kid: i % 5 === 0 }));
      a += c.mesh.geometry.index.count / 3;
    }
    b += buildPerson(cur.randomLook({ kid: i % 5 === 0 }), { low: tier === 'low' }).geometry.index.count / 3;
  }
  console.log(tier.padEnd(5), old ? `old ${Math.round(a / n)}` : '', `new ${Math.round(b / n)}`);
}
// per-part breakdown on the phone tier
settings.quality = 'low';
const sum = {};
for (let i = 0; i < 80; i++) {
  const { stats } = buildPerson(cur.randomLook({ kid: i % 5 === 0 }), { low: true });
  for (const k in stats) sum[k] = (sum[k] ?? 0) + stats[k] / 80;
}
console.log(Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round(v)])));
