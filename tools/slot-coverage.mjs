// Slot coverage check (adversarial): proves every personal slot reaches the screen, the stock mela
// is unchanged without a config, and hostile values are cleaned.
//
//   npm run build && node tools/slot-coverage.mjs [--port 4732] [--only phone|desktop] [--shots]
//
// Run "markers": every slot gets a unique marker (M<n>), stall themes 'tech'. Canvas fillText is
//   recorded, so every sign / plate / backdrop marker must have been painted; zone toasts are read by
//   walking into each zone; menus, the jalebi prompt, keeper / shop shouts and ride toasts by using them.
// Run "stock": no creator. Every sign default is painted, zone toasts equal the pre-slot strings
//   (from git: HEAD's parent of the slot commit is not needed, they are listed below).
// Run "hostile": Devanagari, emoji, very long, <img onerror>, entity and bidi values; screenshots.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { SLOTS } from '../src/personalSlots.js';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = Number(opt('port', 4732));
const only = opt('only', null);
const shots = argv.includes('--shots');
const out = 'bench/shots-coverage';
mkdirSync(out, { recursive: true });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

let failed = 0;
const check = (name, ok, info = '') => {
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : info);
};

// ---------- configs ----------
const BASE = { slug: 'cov.test', name: 'Cov Tester', first: 'Cov', photoUrl: '/test-photo.png', stallNo: 3, stallTitle: 'Cov ki Dukaan', stallTheme: 'general', wallPosts: [] };
const marker = (i) => `M${i}q`;
const MARK = {};
SLOTS.forEach((s, i) => {
  if (s.kind === 'stallTheme') MARK[s.id] = 'tech';
  else if (/^game\.\w+\.sub$/.test(s.id)) MARK[s.id] = `${marker(i)} {prize}`;
  else MARK[s.id] = marker(i);
});
const M = (id) => (MARK[id].endsWith('{prize}') ? MARK[id].split(' ')[0] : MARK[id]);

const HOSTILE = {
  'gate.title': 'शुभ दीपावली, सबको!',
  'gate.subtitle': 'राहुल का दिवाली मेला 🪔✨',
  'stall.mithai.title': '<img src=x onerror="window.__xss=1">',
  'stall.mithai.sub': 'मिठाई · 👨‍👩‍👧‍👦 family packs · 🇮🇳',
  'stall.diyas.title': 'x'.repeat(200),
  'stall.diyas.sub': 'Hand‮made‬ di​yas\u0007 with\nnewlines',
  'stall.jalebi.title': 'जलेबी जंक्शन बहुत स्वादिष्ट है भाई',
  'menu.mithai.1': '<img src=x onerror="window.__xss=2">',
  'menu.mithai.2': '&lt;b&gt;hi&lt;/b&gt;',
  'menu.mithai.3': '" onmouseover="window.__xss=4" x="',
  'menu.mithai.4': 'काजू कतली 💎',
  'zone.gate': '<script>window.__xss=5</script> 🪔 Swagat hai!',
  'zone.bazaar': '🛍️ बाज़ार में आपका स्वागत है',
  'game.shoot.title': '🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯',
  'game.shoot.prize': 'एक टेडी बियर 🧸',
  'game.rings.sub': 'Ring 2 bottles {prize} {evil} {{prize}}',
  'ride.boat.name': 'गंगा नाव',
  'selfie.frame1': 'राहुल का',
  'selfie.frame2': 'Diwali Mela of the year with a long line',
  'shout.keeper.1': '<b>bold</b> aaiye 🙏',
  'shout.keeper.2': '<b>bold</b> aaiye 🙏',
  'shout.keeper.3': '<b>bold</b> aaiye 🙏',
  'ride.cars.sign': 'Chakri Cars Grand Prix Track',
};

// the zone toasts as they read before personal slots (keyboard / touch)
const STOCK_ZONES = {
  gate: ['🪔 Welcome to the Topmate Diwali Mela!'],
  selfie: ['📸 Selfie Point: get your mela poster to share'],
  deepmala: ['🪔 The Deepmala wall: bring a diya or kandeel and press Q to add yours', '🪔 The Deepmala wall: bring a diya or kandeel, then tap the button to add yours'],
  ramleela: ['📽️ Ramleela Maidan: take a seat for the Ramayan show'],
  ravan: ['🔥 Ravan Dahan: the effigy burns on the countdown, or light the fuse yourself'],
  bazaar: ['🛍️ The Bazaar: walk up to a stall and press E', '🛍️ The Bazaar: walk up to a stall and tap the glowing button'],
  games: ['🎯 Khel Gali: four mela games, win prizes!'],
  carousel: ['🎠 The Carousel: hop on!'],
  cars: ['🏁 Chakri Cars: a go-kart circuit · press E at a car', '🏁 Chakri Cars: a go-kart circuit · walk to a car and tap “Drive”'],
  airfield: ['✈️ Pushpak Viman Airfield: fly the plane or the heli'],
  wheel: ['🎡 The Giant Wheel: walk to the steps and press E', '🎡 The Giant Wheel: walk to the steps and tap the button'],
  fireworks: ['🚀 Fireworks Zone: press 1 to launch a rocket', '🚀 Fireworks Zone: tap 🚀 Rocket below to launch one'],
  ghat: ['🏮 The Ghat: float a diya, release a lantern, or row a boat out from the jetty'],
};
const ZONE_AT = { gate: [0, 64], selfie: [15, 56], deepmala: [-12, 65], ramleela: [-30, 60], ravan: [-56, 66], bazaar: [0, 32], games: [22, 27], carousel: [-14, 30], cars: [-53, 10], airfield: [52, 22], wheel: [-34, -12], fireworks: [36, -30], ghat: [0, -40] };
const NOWHERE = [8, 0]; // outside every zone

// stand points in front of each stall (No. 1 nearest the gate; odd left, even right)
const STALL_AT = { mithai: [-6.3, 47, -Math.PI / 2], diyas: [6.3, 47, Math.PI / 2], jalebi: [-6.3, 37, -Math.PI / 2], lanterns: [6.3, 37, Math.PI / 2], panipuri: [-6.3, 27, -Math.PI / 2], bangles: [6.3, 27, Math.PI / 2], kulfi: [-6.3, 17, -Math.PI / 2], toys: [6.3, 17, Math.PI / 2] };

// ---------- server ----------
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

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const MODES = [
  ['phone', { ...devices['Pixel 7'] }, 'low'],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 'high'],
].filter(([m]) => !only || m === only);

async function open(ctxOpts, tier, cfg) {
  const context = await browser.newContext(ctxOpts);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('melaCoach', '1');
    } catch {
      // ignore
    }
    window.__drawn = new Set();
    const P = CanvasRenderingContext2D.prototype;
    for (const k of ['fillText', 'strokeText']) {
      const f = P[k];
      P[k] = function (t, ...a) {
        window.__drawn.add(String(t));
        return f.call(this, t, ...a);
      };
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss();
  });
  await page.goto(`http://localhost:${port}/?play&noyt&nonet&night&tier=${tier}${cfg ? `&cfg=${b64(cfg)}` : ''}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(() => window.__mela.creator?.ready);
  await page.waitForTimeout(800);
  return { context, page, errors };
}

const tp = (page, x, z, h = 0) =>
  page.evaluate(([x, z, h]) => {
    const m = window.__mela;
    m.player.teleport(x, z, h);
    m.player.cam.yaw = h + Math.PI;
    m.player.cam.pitch = 0.12;
  }, [x, z, h]);
const toastText = (page) => page.evaluate(() => document.getElementById('toast')?.textContent ?? '');
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll('.bubble')].map((e) => e.textContent));
const drawn = (page) => page.evaluate(() => [...window.__drawn]);
const menuNow = (page) => page.evaluate(() => ({ title: document.querySelector('#menu h2')?.textContent, sub: document.querySelector('#menu p')?.textContent, items: [...document.querySelectorAll('#menu .o-label')].map((e) => e.textContent) }));
const closeMenu = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
};

async function zoneToasts(page) {
  const got = {};
  for (const [id, [x, z]] of Object.entries(ZONE_AT)) {
    await tp(page, ...NOWHERE);
    await page.waitForTimeout(250);
    await tp(page, x, z);
    await page.waitForTimeout(450);
    got[id] = await toastText(page);
  }
  await tp(page, ...NOWHERE);
  return got;
}

async function visit(page, goods) {
  const [x, z, h] = STALL_AT[goods];
  await tp(page, ...NOWHERE);
  await page.waitForTimeout(300);
  await tp(page, x, z, h);
  await page.waitForTimeout(900);
  const prompt = await page.evaluate(() => document.getElementById('prompt')?.textContent ?? '');
  const shout = await bubbles(page);
  await page.keyboard.press('e');
  await page.waitForTimeout(1100);
  return { prompt, shout, menu: await menuNow(page) };
}

for (const [mode, ctxOpts, tier] of MODES) {
  // ================= markers =================
  {
    const { context, page, errors } = await open(ctxOpts, tier, { ...BASE, mela: MARK });
    const rep = await page.evaluate(() => window.__mela.mela);
    check(`${mode} markers: every slot applied`, rep.applied.length === SLOTS.length && rep.rejected.length === 0, JSON.stringify(rep.rejected));

    // painted text (signs, plates, backdrop, gate, game booths)
    const own = ['stall.jalebi.title', 'stall.jalebi.sub']; // stallNo 3: the creator's board covers this sign
    const painted = SLOTS.filter((s) => ['sign', 'stallTitle'].includes(s.kind) && !own.includes(s.id) && !['game.golgappa.title'].includes(s.id));
    const d = (await drawn(page)).join('\n');
    const notPainted = painted.filter((s) => !d.includes(M(s.id))).map((s) => s.id);
    check(`${mode} markers: ${painted.length} sign slots painted`, notPainted.length === 0, notPainted.join(' '));
    for (const g of ['shoot', 'rings', 'cans', 'striker']) {
      check(`${mode} markers: game.${g}.prize in its sign`, d.includes(`${M(`game.${g}.sub`)} ${M(`game.${g}.prize`)}`));
    }
    const own3 = await page.evaluate(() => {
      const st = window.__mela.world.stalls.find((s) => s.def.goods === 'jalebi');
      return { visible: st.sign.visible, name: st.def.name };
    });
    check(`${mode} markers: own stall hides its slot sign, menu takes the creator's title`, own3.visible === false && own3.name === BASE.stallTitle, JSON.stringify(own3));

    // zone toasts: the creator's line plus the fixed controls hint
    const z = await zoneToasts(page);
    const badZ = Object.entries(z).filter(([id, t]) => !t.startsWith(M(`zone.${id}`))).map(([id, t]) => `${id}=${t}`);
    check(`${mode} markers: 13 zone toasts`, badZ.length === 0, badZ.join(' | '));
    check(`${mode} markers: bazaar toast keeps its hint`, /: walk up to a stall/.test(z.bazaar), z.bazaar);

    // menus, prompts and shouts
    const keeperMarks = [1, 2, 3].map((n) => M(`shout.keeper.${n}`));
    let keeperSeen = false;
    const menus = {
      mithai: ['stall.mithai.title', 4],
      kulfi: ['stall.kulfi.title', 4],
      lanterns: ['stall.lanterns.title', 4],
      bangles: ['stall.bangles.title', 4],
      toys: ['stall.toys.title', 4],
      panipuri: ['stall.panipuri.title', 3],
    };
    for (const [goods, [titleId, n]] of Object.entries(menus)) {
      const v = await visit(page, goods);
      keeperSeen ||= v.shout.some((t) => keeperMarks.includes(t));
      const want = { title: M(titleId), items: Array.from({ length: n }, (_, i) => M(`menu.${goods}.${i + 1}`)) };
      check(`${mode} markers: ${goods} menu`, v.menu.title === want.title && want.items.every((t, i) => v.menu.items[i] === t), JSON.stringify(v.menu));
      if (goods === 'panipuri') check(`${mode} markers: golgappa title in menu`, v.menu.sub?.includes(M('game.golgappa.title')), v.menu.sub);
      if (['lanterns', 'bangles'].includes(goods)) {
        await page.keyboard.press('1');
        await page.waitForTimeout(goods === 'bangles' ? 1200 : 2600);
        const b = await bubbles(page);
        check(`${mode} markers: shout.${goods}`, b.includes(M(`shout.${goods}`)), JSON.stringify(b));
        await page.keyboard.press('q').catch(() => {}); // put a kandeel down, if held
        await page.waitForTimeout(300);
      } else await closeMenu(page);
    }
    check(`${mode} markers: a keeper shout`, keeperSeen);
    // jalebi: the stall prompt carries the menu label (creator's own stall here, it still serves)
    const j = await visit(page, 'jalebi');
    check(`${mode} markers: jalebi prompt`, j.prompt.includes(M('menu.jalebi.1')), j.prompt);
    await page.waitForTimeout(2500);
    await closeMenu(page);
    // diyas: the keeper's blessing as he hands one over
    const dv = await visit(page, 'diyas');
    await page.waitForTimeout(1200);
    const db = [...dv.shout, ...(await bubbles(page))];
    check(`${mode} markers: shout.diyas`, db.includes(M('shout.diyas')), JSON.stringify(db));
    await page.keyboard.press('q');
    await page.waitForTimeout(400);

    // golgappa: teekha challenge start shout and the HUD title, then "bas bhaiya"
    await visit(page, 'panipuri');
    await page.keyboard.press('1');
    await page.waitForTimeout(500);
    const gb = await bubbles(page);
    const hud = await page.evaluate(() => document.querySelector('#gameHud')?.textContent ?? document.body.innerText.slice(0, 400));
    check(`${mode} markers: shout.golgappa`, gb.includes(M('shout.golgappa')), JSON.stringify(gb));
    check(`${mode} markers: golgappa HUD title`, hud.includes(M('game.golgappa.title')) && hud.includes(M('menu.panipuri.1')), hud.slice(0, 200));
    if (shots) await page.screenshot({ path: `${out}/${mode}-markers-golgappa.png` });
    await page.keyboard.press('q');
    await page.waitForTimeout(2500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await closeMenu(page);

    // rides: on / off toasts
    // every toast is logged (stepping off lands you back in the ride's zone, whose toast follows)
    await page.evaluate(() => {
      const ui = window.__mela.ui;
      const t = ui.toast;
      window.__toasts = [];
      ui.toast = function (x, ...a) {
        window.__toasts.push(x);
        return t.call(this, x, ...a);
      };
    });
    const ride = async (on, off) => {
      await page.evaluate(on);
      await page.waitForTimeout(400);
      const a = await toastText(page);
      await page.evaluate(() => (window.__toasts.length = 0));
      await page.evaluate(off);
      await page.waitForTimeout(600);
      return [a, (await page.evaluate(() => window.__toasts))[0] ?? ''];
    };
    const [wOn, wOff] = await ride(() => window.__mela.rides.boardWheel(), () => (window.__mela.rides.wheel.ride.done = true));
    check(`${mode} markers: wheel toasts`, wOn.startsWith(M('toast.wheel.on')) && /get off/i.test(wOn) && wOff === M('toast.wheel.off'), `${wOn} | ${wOff}`);
    const [cOn, cOff] = await ride(() => window.__mela.rides.boardCarousel(), () => (window.__mela.rides.rideTime = 99));
    check(`${mode} markers: carousel toasts`, cOn.startsWith(M('toast.carousel.on')) && cOff === M('toast.carousel.off'), `${cOn} | ${cOff}`);

    check(`${mode} markers: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  // ================= stock (no creator) =================
  {
    const { context, page, errors } = await open(ctxOpts, tier, null);
    const rep = await page.evaluate(() => window.__mela.mela);
    check(`${mode} stock: nothing applied`, rep.applied.length === 0 && Object.keys(rep.values).length === 0, JSON.stringify(rep));
    const d = await drawn(page);
    const all = d.join('\n');
    const SUB_STOCK = { 'game.shoot.sub': 'Balloon shooting · win a teddy', 'game.rings.sub': 'Ring 2 bottles · win a gift' };
    const want = SLOTS.filter((s) => ['sign', 'stallTitle'].includes(s.kind) && s.id !== 'game.golgappa.title').map((s) => SUB_STOCK[s.id] ?? (s.id === 'gate.subtitle' ? `✦  ${s.default}  ✦` : s.id === 'selfie.tagline' ? `${s.default} · ${new Date().getFullYear()}` : s.default));
    const missing = want.filter((t) => !d.includes(t));
    check(`${mode} stock: every sign default painted exactly`, missing.length === 0, missing.join(' | '));
    check(`${mode} stock: no placeholder painted`, !/\{\w+\}/.test(all));
    const z = await zoneToasts(page);
    const badZ = Object.entries(z).filter(([id, t]) => !STOCK_ZONES[id].includes(t)).map(([id, t]) => `${id}=${t}`);
    check(`${mode} stock: zone toasts as before`, badZ.length === 0, badZ.join(' | '));
    const v = await visit(page, 'mithai');
    check(`${mode} stock: mithai menu`, v.menu.title === 'Mithai Mahal' && v.menu.items.join('|') === 'Motichoor laddoo|Kaju katli|Gulab jamun|Pista barfi', JSON.stringify(v.menu));
    await closeMenu(page);
    check(`${mode} stock: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  // ================= hostile =================
  {
    const { context, page, errors } = await open(ctxOpts, tier, { ...BASE, stallNo: 5, mela: HOSTILE });
    const rep = await page.evaluate(() => window.__mela.mela);
    const v = rep.values;
    check(`${mode} hostile: 200 x title rejected`, rep.rejected.some((r) => r.id === 'stall.diyas.title' && r.reason === 'too long'));
    check(`${mode} hostile: 30 emoji title cut to 20 whole emoji`, v['game.shoot.title'] === '🎯'.repeat(20), JSON.stringify(v['game.shoot.title']));
    check(`${mode} hostile: no < > in any value`, !Object.values(v).some((t) => /[<>`\\]/.test(t)));
    check(`${mode} hostile: bidi / zero-width / control gone`, v['stall.diyas.sub'] === 'Hand made diyas with newlines', JSON.stringify(v['stall.diyas.sub']));
    check(`${mode} hostile: Devanagari kept`, v['gate.title'] === 'शुभ दीपावली, सबको!' && v['menu.mithai.4'] === 'काजू कतली 💎');
    check(`${mode} hostile: ZWJ family emoji kept whole`, v['stall.mithai.sub'].includes('👨‍👩‍👧‍👦') && v['stall.mithai.sub'].includes('🇮🇳'), v['stall.mithai.sub']);
    check(`${mode} hostile: Devanagari counted in graphemes (34 code points, 20 letters: kept)`, v['stall.jalebi.title'] === 'जलेबी जंक्शन बहुत स्वादिष्ट है भाई', JSON.stringify(v['stall.jalebi.title']));
    check(`${mode} hostile: braces`, v['game.rings.sub'] === 'Ring 2 bottles {prize} evil', JSON.stringify(v['game.rings.sub']));
    check(`${mode} hostile: cars sign cut at a word`, v['ride.cars.sign'] === 'Chakri Cars Grand Prix', JSON.stringify(v['ride.cars.sign']));
    // the menu (innerHTML of each option) must stay text
    const m = await visit(page, 'mithai');
    const imgs = await page.evaluate(() => document.querySelectorAll('#menu img, #menu [onmouseover], #menu script').length);
    check(`${mode} hostile: menu labels are text`, imgs === 0 && m.menu.items[0].startsWith('img src=x onerror="') && m.menu.items[1] === '&lt;b&gt;hi&lt;/b&gt;' && m.menu.items[2].startsWith('" onmouseover="window'), JSON.stringify(m.menu.items));
    if (shots) await page.screenshot({ path: `${out}/${mode}-hostile-menu.png` });
    await closeMenu(page);
    await tp(page, ...NOWHERE);
    await page.waitForTimeout(300);
    await tp(page, 0, 64);
    await page.waitForTimeout(450);
    const gt = await toastText(page);
    check(`${mode} hostile: gate toast`, gt === 'scriptwindow.__xss=5/script 🪔 Swagat hai!', gt);
    await page.mouse.move(200, 200);
    const xss = await page.evaluate(() => window.__xss ?? null);
    check(`${mode} hostile: nothing ran`, xss === null, String(xss));
    if (shots) {
      const SPOTS = [
        ['gate', 0, 74, Math.PI, -0.05],
        ['bazaar-mithai', -1.5, 47, -Math.PI / 2],
        ['bazaar-jalebi', -1.5, 37, -Math.PI / 2],
        ['bazaar-diyas', 1.5, 47, Math.PI / 2],
        ['game-shoot', 19, 14, Math.PI / 2],
        ['game-rings', 19, 23, Math.PI / 2],
        ['cars', -37.5, 21, -Math.PI / 2],
        ['jetty', 9, -38, Math.PI],
        ['selfie', 10.5, 56, Math.PI / 2],
      ];
      for (const [name, x, z, h, pitch] of SPOTS) {
        await page.evaluate(([x, z, h, p]) => {
          const m = window.__mela;
          m.player.teleport(x, z, h);
          m.player.cam.yaw = h + Math.PI;
          m.player.cam.pitch = p ?? 0.12;
        }, [x, z, h, pitch]);
        await page.waitForTimeout(1300);
        await page.screenshot({ path: `${out}/${mode}-hostile-${name}.png` });
      }
    }
    check(`${mode} hostile: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
}
await browser.close();
stopServer();
console.log(failed ? `${failed} FAILED` : 'all passed', shots ? `· screenshots in ${out}/` : '');
process.exit(failed ? 1 : 0);
