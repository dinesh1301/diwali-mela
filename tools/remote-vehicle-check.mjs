// Remote vehicles check: two phone-sized visitors in one room. A drives a car, flies the heli and the
// plane and gets out; B must see the right vehicle with A seated in it, where A's vehicle really is
// (and tilted like it), and nothing left over once A is walking again. Then A rides the Giant Wheel
// and the carousel: B must seat A in one of its own gondolas / on one of its own animals. Saves B's
// view of the vehicle steps.
//
//   node tools/remote-vehicle-check.mjs [outDir]     # exits 1 if anything is off
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'remote-vehicle-shots';
mkdirSync(out, { recursive: true });
const port = 4187;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // gone
  }
};
process.on('exit', stop);
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  server.on('exit', (c) => rej(new Error(`vite exited ${c}`)));
});

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const room = `vehcheck${Date.now() % 1e6}`;
const open = async (name) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('melaCoach', '1'));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, String(e)));
  await page.goto(`http://localhost:${port}/?play&noyt&night&tier=low&place=gate&c=${room}&name=${name}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  return page;
};

let ok = true;
const check = (cond, label) => {
  ok &&= !!cond;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

const A = await open('Asha');
const B = await open('Bala');
await B.waitForFunction(() => window.__mela.net.remote.size === 1, null, { timeout: 20000 });

/** A boards vehicle `pick` (a kind, or 'car' for the first car) right where it is parked. */
const board = (kind) =>
  A.evaluate(async (kind) => {
    const m = window.__mela;
    const v = m.vehicles.list.find((x) => x.kind === kind);
    const p = v.climbWorld()[0];
    m.player.teleport(p.x + 0.3, p.z + 0.3, 0);
    await m.vehicles.enter(v);
    return m.vehicles.active?.kind;
  }, kind);

/** What B knows of A, next to where A's vehicle and rider really are. */
const compare = async () => {
  const a = await A.evaluate(() => {
    const m = window.__mela;
    const v = m.vehicles.active;
    const r = m.player.char.root.getWorldPosition(new m.player.pos.constructor());
    return { v: v ? { x: v.pos.x, y: v.pos.y, z: v.pos.z, rx: v.group.rotation.x, rz: v.group.rotation.z } : null, root: { x: r.x, y: r.y, z: r.z } };
  });
  const b = await B.evaluate(() => {
    const r = [...window.__mela.net.remote.values()][0];
    const g = r.vehicle?.group;
    const vehicles = window.__mela.scene.children.filter((o) => o.isGroup && o.userData.remoteVehicle).length;
    return { veh: r.veh, vkey: r.vkey, shown: r.shown, action: r.char.action, visible: !!g?.visible, v: g ? { x: g.position.x, y: g.position.y, z: g.position.z, rx: g.rotation.x, rz: g.rotation.z } : null, root: { x: r.char.root.position.x, y: r.char.root.position.y, z: r.char.root.position.z }, vehicles };
  });
  return { a, b };
};
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

/** B stands `back` metres behind A's vehicle (at A's height if `lift`), looking at it. */
const watch = async (back = 12, side = 4) => {
  const a = await A.evaluate(() => {
    const m = window.__mela;
    const v = m.vehicles.active;
    const p = v ? v.pos : m.player.pos;
    return { x: p.x, y: p.y, z: p.z, h: v ? v.heading : m.player.heading };
  });
  await B.evaluate(
    ([a, back, side]) => {
      const m = window.__mela;
      const x = a.x - Math.sin(a.h) * back + Math.cos(a.h) * side;
      const z = a.z - Math.cos(a.h) * back - Math.sin(a.h) * side;
      m.player.teleport(x, z, Math.atan2(a.x - x, a.z - z));
      const c = m.player.cam;
      c.yaw = Math.atan2(x - a.x, z - a.z) + 0.35; // a little off B's shoulder, so B does not hide A
      c.pitch = Math.max(-0.35, Math.min(1.25, -Math.atan2(a.y - m.player.pos.y, Math.hypot(a.x - x, a.z - z)) * 0.8 + 0.05));
      c.targetDist = 4;
    },
    [a, back, side]
  );
};

const hold = async (keys, ms) => {
  for (const k of keys) await A.keyboard.down(k);
  await A.waitForTimeout(ms);
  for (const k of keys) await A.keyboard.up(k);
};

// ---------- car ----------
check((await board('car')) === 'car', 'A is in a car');
await hold(['KeyS'], 900); // back off the pit lane lamp post, then out onto the circuit
await hold(['KeyW', 'KeyD'], 1400);
await hold(['KeyW'], 3000);
const moved = await A.evaluate(() => {
  const v = window.__mela.vehicles.active;
  return Math.hypot(v.pos.x - v.spawn.x, v.pos.z - v.spawn.z);
});
console.log(`  A drove ${moved.toFixed(1)} m from the pit lane`);
check(moved > 8, 'A drove off');
await watch(9, 7);
await A.waitForTimeout(1200);
let s = await compare();
console.log('  car:', JSON.stringify(s.b.veh), 'B sees vehicle at', s.b.v && dist(s.a.v, s.b.v).toFixed(2), 'm from A\'s car');
check(s.b.vkey === 'c0' && s.b.visible && s.b.action === 'drive', 'B draws A in a car, driving');
check(s.b.v && dist(s.a.v, s.b.v) < 1.5, "B's car is where A's car is");
await B.screenshot({ path: `${out}/1-car.png` });

// ---------- out of the car ----------
await A.evaluate(() => window.__mela.vehicles.exit());
await A.waitForFunction(() => window.__mela.player.mode === 'walk', null, { timeout: 10000 });
await watch(6, 2);
await A.waitForTimeout(1500);
s = await compare();
check(!s.b.vkey && !s.b.visible && !s.b.v && s.b.action !== 'drive', 'A got out: B sees A walking, no leftover car');
await B.screenshot({ path: `${out}/2-car-out.png` });

// ---------- heli ----------
check((await board('heli')) === 'heli', 'A is in the heli');
await hold(['Space'], 3500);
await hold(['KeyW'], 1800);
await A.keyboard.down('KeyW');
await A.waitForTimeout(400);
await watch(14, 9);
await A.waitForTimeout(900);
s = await compare();
await A.keyboard.up('KeyW');
console.log('  heli:', JSON.stringify(s.b.veh), 'alt', s.a.v.y.toFixed(1), 'tilt A', s.a.v.rx.toFixed(2), s.a.v.rz.toFixed(2), 'B', s.b.v?.rx.toFixed(2), s.b.v?.rz.toFixed(2));
check(s.b.vkey === 'h' && s.b.visible && s.b.action === 'pilot', 'B draws A in the heli');
check(s.b.v && dist(s.a.v, s.b.v) < 2.5, "B's heli is where A's heli is (in the air)");
check(s.a.v.y > 3 && s.b.v.y > 3, 'it is flying');
check(s.b.v && Math.abs(s.a.v.rx - s.b.v.rx) < 0.12 && Math.abs(s.a.v.rz - s.b.v.rz) < 0.12, "B's heli tilts like A's");
await B.screenshot({ path: `${out}/3-heli.png` });
// land and get out
await A.evaluate(async () => {
  const m = window.__mela;
  const v = m.vehicles.active;
  v.pos.y = v.floor();
  v.vel.set(0, 0, 0);
  await m.vehicles.exit({ force: true });
});
await A.waitForTimeout(1500);
s = await compare();
check(!s.b.vkey && !s.b.visible, 'out of the heli: no leftover heli on B');

// ---------- plane ----------
check((await board('plane')) === 'plane', 'A is in the plane');
await hold(['KeyW'], 5000);
await A.keyboard.down('KeyW');
await A.keyboard.down('Space');
await A.waitForTimeout(900);
await A.keyboard.up('Space');
await A.keyboard.down('KeyD');
await A.waitForTimeout(400);
await watch(24, 10);
await A.waitForTimeout(500);
s = await compare();
await B.screenshot({ path: `${out}/4-plane.png` });
for (const k of ['KeyW', 'KeyD']) await A.keyboard.up(k);
console.log('  plane:', JSON.stringify(s.b.veh), 'alt', s.a.v.y.toFixed(1), 'tilt A', s.a.v.rx.toFixed(2), s.a.v.rz.toFixed(2), 'B', s.b.v?.rx.toFixed(2), s.b.v?.rz.toFixed(2));
check(s.b.vkey === 'p' && s.b.visible && s.b.action === 'pilot', 'B draws A in the plane');
check(s.b.v && dist(s.a.v, s.b.v) < 10, "B's plane is near A's plane (it moves ~30 m/s: a 10 Hz feed plus smoothing trails it a few metres)");
console.log(`  plane gap ${s.b.v && dist(s.a.v, s.b.v).toFixed(1)} m`);
check(s.b.v && Math.abs(s.a.v.rz - s.b.v.rz) < 0.25, "B's plane banks like A's");
await A.evaluate(async () => {
  const m = window.__mela;
  await m.vehicles.exit({ force: true });
});
await A.waitForTimeout(1500);
await watch(6, 2);
await A.waitForTimeout(1200);
s = await compare();
check(!s.b.vkey && !s.b.visible && !s.b.v, 'out of the plane: B sees A walking, no leftover plane');
await B.screenshot({ path: `${out}/5-plane-out.png` });

// ---------- fixed rides: seated on B's own wheel gondola / carousel animal ----------
for (const [ride, board, seat] of [
  ['wheel', 'boardWheel', 'w'],
  ['carousel', 'boardCarousel', 'k'],
]) {
  await A.evaluate((board) => window.__mela.rides[board](), board);
  await A.waitForTimeout(2500);
  const gap = await B.evaluate(() => {
    const m = window.__mela;
    const r = [...m.net.remote.values()][0];
    const p = r.char.root.position;
    const v = new m.player.pos.constructor();
    let best = Infinity;
    for (const g of m.rides.wheel.gondolas) best = Math.min(best, g.localToWorld(v.set(0, -2.09, -0.4)).distanceTo(p));
    for (const a of m.rides.carousel.animals) best = Math.min(best, a.seat.localToWorld(v.set(0, -0.5, 0)).distanceTo(p));
    return { best, veh: r.veh };
  });
  console.log(`  ${ride}:`, JSON.stringify(gap.veh), `B seats A ${gap.best.toFixed(2)} m from one of B's own seats`);
  check(gap.veh?.[0] === seat && gap.best < 0.1, `B seats A on its own ${ride}`);
  await A.evaluate(() => window.__mela.rides.getOff());
  await A.waitForTimeout(1200);
  s = await compare();
  check(dist(s.b.root, s.a.root) < 0.5, `off the ${ride}: B sees A where A stepped down`);
}

// ---------- leaving ----------
await A.close();
await B.waitForFunction(() => window.__mela.net.remote.size === 0, null, { timeout: 15000 }).catch(() => {});
check((await B.evaluate(() => window.__mela.net.remote.size)) === 0, 'A left: B dropped A');

await browser.close();
stop();
console.log(ok ? '\nall good' : '\nSOMETHING IS OFF');
process.exit(ok ? 0 : 1);
