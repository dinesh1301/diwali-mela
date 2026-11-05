// Proximity voice check: the gain curve (unit) and a real two-page WebRTC run with Chrome's fake mic.
// Serves the dev server (which hosts the realtime socket), opens two visitors in one room, turns both
// mics on, steps visitor B away from A and prints the gain A's Web Audio graph applies to B's voice,
// plus whether A is still sending its mic to B (beyond ~9 m it stops: no bandwidth for the inaudible).
//
//   node tools/voice-check.mjs            # exits 1 if anything is off
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port = 4183;
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

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const room = `voicecheck${Date.now() % 1e6}`;
const open = async (name) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 500 }, permissions: ['microphone'] });
  await context.addInitScript(() => localStorage.setItem('melaCoach', '1'));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, String(e)));
  await page.goto(`http://localhost:${port}/?play&noyt&night&tier=low&place=gate&c=${room}&name=${name}`);
  await page.waitForFunction(() => window.__mela && document.getElementById('loader')?.classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(async () => {
    const m = window.__mela;
    m.audio.init();
    await m.audio.ctx.resume();
    await m.voice.enable();
  });
  return page;
};

let ok = true;
const check = (cond, label) => {
  ok &&= !!cond;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

// ---- unit: the curve itself, straight from the module ----
const A = await open('Asha');
const curve = await A.evaluate(async () => {
  const { voiceGain } = await import('/src/voice.js');
  return [0, 0.5, 1, 1.5, 2, 3, 4, 4.5, 5, 6, 8].map((d) => [d, voiceGain(d)]);
});
console.log('voiceGain(d):', curve.map(([d, g]) => `${d}m=${g.toFixed(3)}`).join('  '));
const G = Object.fromEntries(curve);
check(G[0.5] === 1 && G[1] === 1, 'full volume within 1 m');
check(G[3] > 0.1 && G[3] < 0.4, 'clearly quieter at 3 m');
check(G[4] < 0.1 && G[5] === 0 && G[6] === 0, 'near-silent by 4 m, silent from 5 m');
check(curve.every(([, g], i) => i === 0 || g <= curve[i - 1][1]), 'monotonic');

// ---- two pages, real peer connection ----
const B = await open('Bala');
const peered = await A.waitForFunction(
  () => {
    const v = window.__mela.voice;
    const p = [...v.peers.values()][0];
    return p && p.pc.connectionState === 'connected' && p.gain && p.remoteTracks > 0;
  },
  null,
  { timeout: 30000 }
).then(() => true, () => false);
check(peered, 'A and B connected over WebRTC with a remote voice track');

const ax = await A.evaluate(() => [window.__mela.player.pos.x, window.__mela.player.pos.z]);
const sample = async (d) => {
  await B.evaluate(([x, z]) => window.__mela.player.teleport(x, z), [ax[0] + d, ax[1]]);
  await A.waitForTimeout(1800); // B's state reaches A, A's remote avatar glides there, the gain settles
  return A.evaluate(async () => {
    const v = window.__mela.voice;
    const p = [...v.peers.values()][0];
    const sender = v.audioSender(p);
    const st = await p.pc.getStats();
    let rx = 0;
    st.forEach((r) => r.type === 'inbound-rtp' && r.kind === 'audio' && (rx = r.bytesReceived));
    return { dist: p.dist, gain: p.gain.gain.value, far: p.far, sending: !!sender?.track, rx };
  });
};

console.log('\n  B at   measured   gain    sending to B');
const rows = {};
for (const d of [0.5, 1, 3, 6, 12, 2]) {
  const r = await sample(d);
  rows[d] = r;
  console.log(`  ${String(d).padStart(4)} m  ${r.dist.toFixed(2).padStart(6)} m  ${r.gain.toFixed(3).padStart(6)}  ${r.sending}`);
}
check(rows[0.5].gain > 0.97 && rows[1].gain > 0.97, 'A hears B at full volume at 0.5 m and 1 m');
check(Math.abs(rows[3].gain - 0.25) < 0.05, 'about a quarter at 3 m');
check(rows[6].gain < 0.01, 'silent at 6 m');
check(rows[12].far && !rows[12].sending, 'beyond 9 m A stops sending its mic to B');
check(!rows[2].far && rows[2].sending, 'and resumes when B walks back');
// B's side: with A's sender empty, B's inbound bytes stop growing
const rxB = async () =>
  B.evaluate(async () => {
    const p = [...window.__mela.voice.peers.values()][0];
    let rx = 0;
    (await p.pc.getStats()).forEach((r) => r.type === 'inbound-rtp' && r.kind === 'audio' && (rx = r.bytesReceived));
    return rx;
  });
await B.evaluate(([x, z]) => window.__mela.player.teleport(x, z), [ax[0] + 14, ax[1]]);
await A.waitForTimeout(2500);
const r0 = await rxB();
await A.waitForTimeout(2000);
const r1 = await rxB();
console.log(`  B's inbound audio over 2 s while 14 m away: ${r1 - r0} bytes`);
check(r1 - r0 < 400, 'no voice bandwidth for a peer out of earshot');

// ---- the sliders ----
const vol = await A.evaluate(async () => {
  const m = window.__mela;
  m.settings.voiceVolume = 0.4;
  m.voice.applySettings();
  m.audio.setMusicVolume(0.3);
  await new Promise((r) => setTimeout(r, 400));
  return { voices: m.voice.bus.gain.value, music: m.audio.musicBus.gain.value };
});
check(Math.abs(vol.voices - 0.4) < 0.02 && Math.abs(vol.music - 0.3) < 0.02, `Voices and Music buses follow their sliders (${vol.voices.toFixed(2)}, ${vol.music.toFixed(2)})`);

await browser.close();
stop();
console.log(ok ? '\nvoice check passed' : '\nvoice check FAILED');
process.exit(ok ? 0 : 1);
