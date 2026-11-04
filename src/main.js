import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSky } from './sky.js';
import { buildWorld, SITES } from './world.js';
import { Fireworks } from './fireworks.js';
import { Lanterns } from './lanterns.js';
import { MelaAudio } from './audio.js';
import { createUI } from './ui.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { randomPlayerLook } from './character.js';
import { tasks } from './tasks.js';
import { Debris } from './debris.js';
import { Interactions } from './interact.js';
import { Passport } from './passport.js';
import { FoodStalls } from './activities/food.js';
import { Shops } from './activities/shop.js';
import { Rituals } from './activities/misc.js';
import { Rides } from './rides.js';
import { Games } from './games/index.js';
import { Crowd } from './npcs.js';
import { updateFlames } from './items.js';
import { NameTag } from './nametag.js';
import { Customizer } from './customizer.js';
import { profile, normalizeHandle } from './profile.js';
import { Vehicles } from './vehicles/vehicles.js';
import { Ramayan } from './ramayan.js';
import { Poster } from './poster.js';
import { BoatRide } from './boat.js';
import { settings } from './settings.js';
import { Smoke } from './smoke.js';
import { DayNight } from './daynight.js';
import { Ambience } from './ambience.js';
import { Net } from './net.js';
import { buildDecor } from './decor.js';
import { Walls } from './wall.js';
import { Train } from './train.js';
import { Ravan } from './ravan.js';
import { CrowdScenes } from './extras.js';
import { StringLights } from './stringLights.js';
import { CONFIG } from './config.js';
import { shadowify } from './utils.js';
import { Voice } from './voice.js';
import { LightPool } from './lightpool.js';
import { TOUCH, tk } from './touch.js';
import { startDirector, directorParams } from './director/director.js';
import { loadCreatorConfig, applyCreator, personaliseIntro, stallIndexFor } from './creatorStage.js';
import { setMelaSlots, slot, melaReport } from './personalSlots.js';
import { Billboard } from './billboard.js';

// zone toasts: the line itself is a personal slot (zone.<id>); a controls hint, when there is one, is added after it
const ZONES = [
  { id: 'gate', x: 0, z: 62, r: 9 },
  { id: 'selfie', x: 15, z: 56, r: 6 },
  { id: 'deepmala', x: -12, z: 65, r: 6, hint: ['bring a diya or kandeel and press Q to add yours', 'bring a diya or kandeel, then tap the button to add yours'] },
  { id: 'ramleela', x: -30, z: 62, r: 14 },
  { id: 'ravan', x: -56, z: 64, r: 10 },
  { id: 'bazaar', x: 0, z: 32, r: 13, hint: ['walk up to a stall and press E', 'walk up to a stall and tap the glowing button'] },
  { id: 'games', x: 22, z: 27, r: 12 },
  { id: 'carousel', x: -20, z: 30, r: 9 },
  { id: 'cars', x: -53, z: 24, r: 24, hint: ['a go-kart circuit · press E at a car', 'a go-kart circuit · walk to a car and tap “Drive”'] },
  { id: 'airfield', x: 52, z: 22, r: 20 },
  { id: 'wheel', x: -34, z: -18, r: 12, hint: ['walk to the steps and press E', 'walk to the steps and tap the button'] },
  { id: 'fireworks', x: 36, z: -30, r: 15, hint: ['press 1 to launch a rocket', 'tap 🚀 Rocket below to launch one'] },
  { id: 'ghat', x: 0, z: -42, r: 12 },
];
const zoneToast = (z) => {
  const line = slot(`zone.${z.id}`);
  return z.hint ? `${line}: ${tk(...z.hint)}` : line;
};

const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const PLACES = {
  gate: [0, 70, Math.PI],
  selfie: [12.6, 56.4, Math.PI / 2],
  ramleela: [-30, 52, 0],
  ravan: [-48, 66, -Math.PI / 2],
  bazaar: [0, 50, Math.PI],
  games: [19, 27, Math.PI / 2],
  train: [12.5, 36, Math.PI / 2],
  carousel: [-16, 30, -Math.PI / 2],
  cars: [-37.5, 21, -Math.PI / 2],
  airfield: [44, 18, Math.PI / 2],
  plaza: [0, 12, Math.PI], // the open chowk (no chip; the bench and ?place= use it)
  wheel: [-34, -12, Math.PI],
  fireworks: [8, -2, face(8, -2, 36, -30)],
  ghat: [0, -38, Math.PI],
};

// help lines per mode; `tap` is the phone version (walking is explained by the coach card instead)
const HELP = {
  walk: { key: [['W A S D', 'Move'], ['run', 'Run'], ['jump', 'Jump'], ['interact', 'Interact'], ['Drag', 'Camera'], ['Scroll', 'Zoom'], ['photo', 'Photo'], ['look', 'Change look'], ['talk', 'Voice chat'], ['passport', 'Passport']], tap: [] },
  ride: { key: [['interact', 'Get off'], ['Drag', 'Look around'], ['Scroll', 'Zoom']], tap: [['👆', 'Tap “Get off” to get off'], ['👉', 'Drag to look around']] },
  busy: { key: [['Drag', 'Camera']], tap: [] },
  anim: { key: [], tap: [] },
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/*
  Adaptive resolution. Phones start a little above 1x (a 2.6x screen at 1x looks jagged) and the
  governor raises the pixel ratio while frames have headroom and drops it when they don't. It looks
  at 1.5 s windows of frame times against a 60 fps budget (or 30 fps when the display itself is
  capped there, as in a phone's power-saving mode), needs three good windows in a row to step up,
  and after a level fails it stays below it for a while (30 s, doubling each time it fails again),
  so it settles instead of thrashing. A step down that doesn't make frames faster (the CPU, not the
  pixels, is the bottleneck) is undone and further drops pause for a minute.
*/
class ResolutionGovernor {
  constructor({ levels, start, apply, enabled = true }) {
    this.levels = levels;
    this.i = Math.max(0, levels.indexOf(start));
    this.apply = apply;
    this.enabled = enabled && levels.length > 1;
    this.blockUntil = 0; // levels >= blockLevel are off-limits until then
    this.blockLevel = Infinity;
    this.backoff = 30000;
    this.noDropUntil = 0;
    this.lastUp = { at: -1e9, level: 0 };
    this.probe = null; // a step down we are checking actually helped
    this.cap30 = false; // learned: the display (not the GPU) holds frames at 33 ms
    this.changes = 0;
    this.last = { mean: 0, slow: 0, work: 0, budget: 16.7 };
    this.reset(2500);
  }

  get pixelRatio() {
    return this.levels[this.i];
  }

  /** Forget the current window (after a resize, a level change, a hidden tab, a throttled stretch). */
  reset(settleMs = 2000) {
    this.ignoreUntil = performance.now() + settleMs;
    this.n = this.sum = this.slowN = this.capN = this.work = this.winStart = 0;
    this.good = this.bad = 0;
  }

  sample(dtMs, workMs) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now < this.ignoreUntil || dtMs <= 0 || dtMs > 250) return;
    if (!this.winStart) this.winStart = now;
    this.n++;
    this.sum += dtMs;
    this.work += workMs;
    if (dtMs > 1000 / 60 * 1.45) this.slowN++;
    if (dtMs > 31.5 && dtMs < 35.5) this.capN++;
    if (now - this.winStart < 1500 || this.n < 20) return;
    const mean = this.sum / this.n;
    const work = this.work / this.n;
    // Frames locked to 33 ms look the same whether the display runs at 30 Hz (power saving) or a
    // GPU-bound frame just misses every other 60 Hz vsync, so a lock alone proves nothing. Only once
    // a step down failed to unlock it is 30 fps taken as the budget.
    const locked = this.capN / this.n > 0.9 && work < 12;
    const capped = this.cap30 && locked;
    const budget = capped ? 1000 / 30 : 1000 / 60;
    const slow = capped ? 0 : this.slowN / this.n;
    this.last = { mean: +mean.toFixed(1), slow: +slow.toFixed(2), work: +work.toFixed(1), budget: +budget.toFixed(1) };
    this.n = this.sum = this.slowN = this.capN = this.work = 0;
    this.winStart = now;

    if (this.probe) {
      const p = this.probe;
      this.probe = null;
      if (mean > p.mean * 0.9) {
        // dropping the resolution bought nothing: go back and leave it alone for a minute
        if (locked && p.locked) this.cap30 = true;
        this.noDropUntil = now + 60000;
        this.blockLevel = Infinity;
        this.step(p.from - this.i);
        return;
      }
    }
    const tooSlow = mean > budget * 1.22 || slow > 0.15;
    const roomy = mean < budget * 1.06 && slow < 0.03;
    this.bad = tooSlow ? this.bad + 1 : 0;
    this.good = roomy ? this.good + 1 : 0;
    const lvl = this.pixelRatio;
    const cpuBound = work > mean * 0.8;
    // a level we only just climbed to gets one bad window, not two, so a failed probe barely shows
    const fresh = this.lastUp.level === lvl && now - this.lastUp.at < 8000;
    if ((this.bad >= 2 || (fresh && this.bad >= 1)) && this.i > 0 && now > this.noDropUntil && !(cpuBound && this.levels[this.i - 1] < 1)) {
      // a level that fails soon after we climbed to it is blocked for longer each time
      if (now - this.lastUp.at < 20000 && this.lastUp.level === lvl) this.backoff = Math.min(this.backoff * 2, 300000);
      this.blockLevel = lvl;
      this.blockUntil = now + this.backoff;
      const from = this.i;
      this.step(-1);
      this.probe = { from, mean, locked };
    } else if (this.good >= 3 && this.i < this.levels.length - 1) {
      const next = this.levels[this.i + 1];
      if (next >= this.blockLevel && now < this.blockUntil) return;
      this.lastUp = { at: now, level: next };
      this.step(1);
    }
  }

  step(d) {
    if (!d) return;
    this.i += d;
    this.changes++;
    this.apply(this.pixelRatio);
    this.reset();
  }

  get state() {
    const now = performance.now();
    return { pixelRatio: this.pixelRatio, levels: this.levels, enabled: this.enabled, changes: this.changes, blockedFrom: now < this.blockUntil ? this.blockLevel : null, holdDrops: now < this.noDropUntil, cap30: this.cap30, ...this.last };
  }
}

// Every face the canvas textures use; the sample text pulls in the Devanagari subsets too (gate sign, Pushpak plate).
const CANVAS_FONTS = [['64px "Yatra One"', 'Mela शुभ दीपावली'], ['600 24px Poppins', 'Mela पुष्पक'], ['500 24px Poppins'], ['400 24px Poppins'], ['700 24px Poppins']];

async function loadFonts() {
  try {
    await Promise.race([
      Promise.all(CANVAS_FONTS.map(([f, text]) => document.fonts.load(f, text))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    // canvas text falls back to system fonts
  }
}

async function init() {
  const fontsReady = loadFonts(); // fetched while the renderer and lights are set up
  const params = new URLSearchParams(location.search);
  const director = directorParams(params); // ?director=<shot>: frame-stepped capture (see director/)
  const viewW0 = () => director?.width ?? innerWidth;
  const viewH0 = () => director?.height ?? innerHeight;
  const creatorCfg = loadCreatorConfig(params); // ?c=<slug> / ?cfg=: a creator's own mela
  settings.load();
  profile.load();
  const look = { ...randomPlayerLook(), ...(profile.look || {}) };
  profile.look = look;

  // an invite link: both the inviter (via their poster) and the guest get the golden kandeel
  const ref = normalizeHandle(params.get('ref') || '');
  if (ref && ref !== profile.handle && !profile.ref) {
    profile.ref = ref;
    profile.golden = true;
    profile.save();
  }

  const loaderSteps = ['Lighting the diyas…', 'Raising the tents…', 'Tuning the dhol…', 'Filling the river…', 'Inviting the crowd…', 'Fuelling the Pushpak Viman…', 'Almost there…'];
  let step = 0;
  const loading = (label) => {
    document.querySelector('#loader .ld-label').textContent = label ?? loaderSteps[Math.min(step, loaderSteps.length - 1)];
    document.querySelector('#loader .ld-fill').style.width = `${Math.round((step / loaderSteps.length) * 100)}%`;
    step++;
    return nextFrame();
  };

  await loading();

  // The canvas is transparent so the Ramleela screen (a CSS3D YouTube embed behind it) can show through.
  // No antialias: everything goes through the composer's (non-multisampled) render target, so canvas
  // MSAA only cost memory and bandwidth. Sharpness comes from the governor's pixel ratio instead.
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  settings.detect(renderer);
  if (params.get('tier')) settings.quality = params.get('tier');
  const tier = settings.tier;
  const low = tier === 'low';
  // pixel-ratio steps the governor moves between; &dpr=1.5 pins one (and switches the governor off)
  const dpr = window.devicePixelRatio || 1;
  const maxPr = Math.min(dpr, low ? 2 : 1.75);
  const levels = [...new Set([...(low ? [0.8, 1, 1.25, 1.5, 1.75, 2] : [1, 1.25, 1.5, 1.75]).filter((v) => v < maxPr), maxPr])];
  const startPr = low ? Math.min(maxPr, dpr >= 2 ? 1.25 : 1) : settings.midGpu ? Math.min(maxPr, 1.25) : maxPr;
  const pinnedPr = Number(params.get('dpr')) || 0;
  renderer.setPixelRatio(pinnedPr || startPr);
  document.body.classList.toggle('low', low); // style.css drops the backdrop blur on the phone tier
  renderer.setSize(viewW0(), viewH0());
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18; // a bright festival night (the bloom threshold is set before this)
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0x2c1a36);
  scene.fog = new THREE.FogExp2(fogColor, 0.0055);

  const camera = new THREE.PerspectiveCamera(60, viewW0() / viewH0(), 0.1, 700);
  camera.layers.enable(1);
  scene.add(camera);
  const hemi = new THREE.HemisphereLight(0x8e84cc, 0x5a3a24, 1.35);
  scene.add(hemi);
  // one directional light: the setting sun at dusk, a faint blue sky light at night; it casts the shadows
  const sun = new THREE.DirectionalLight(0xffa050, 1.2);
  sun.position.set(-90, 18, 60);
  sun.target.position.set(0, 0, 10);
  scene.add(sun, sun.target);
  if (!low) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95;
    sun.shadow.camera.bottom = -95;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
  }

  await loading();
  await fontsReady; // sign textures are drawn on canvas, so fonts must be ready first
  // a creator's mela renames signs, menus, prizes and toasts everywhere: known before anything is painted
  const cfg = await creatorCfg;
  setMelaSlots(cfg?.mela, cfg);
  const sky = createSky(scene, fogColor);
  const world = buildWorld(scene, { reflectionScale: low ? 0.25 : 0.5 });
  world.water.limitReflectionTo(camera); // reflections skip people and props (layer 1)
  const smoke = new Smoke(scene, low ? 500 : 1500);
  const audio = new MelaAudio();
  audio.mode = CONFIG.publicBuild ? 'band' : settings.music;
  const ambience = new Ambience(audio);
  const fireworks = new Fireworks(scene, camera, audio, SITES.fireworks);
  const lanterns = new Lanterns(scene, camera);
  const input = new Input(renderer.domElement);
  const player = new Player({ scene, camera, input, world, look });
  player.teleport(...PLACES.gate);
  const nameTag = new NameTag(player.char.headTop, { name: profile.name, handle: profile.handle });
  const debris = new Debris(scene);
  const interactions = new Interactions(scene);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(viewW0(), viewH0()), 0.85, 0.55, 0.82); // sized in resize()
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- UI + activities ----------

  let started = false;
  let muted = false;
  let musicOn = true;
  try {
    musicOn = localStorage.getItem('melaMusic') !== 'off';
  } catch {
    // ignore
  }
  audio.musicOn = musicOn;

  const ctx = { scene, camera, renderer, composer, bloom, input, player, world, audio, ambience, smoke, tasks, debris, interactions, fireworks, lanterns, profile, settings };

  const groundAhead = (dist = 1.8) => {
    const f = player.forward();
    return new THREE.Vector3(player.pos.x + f.x * dist, player.pos.y, player.pos.z + f.z * dist);
  };

  async function lightCracker(kind) {
    if (player.mode !== 'walk') return ui.toast('Finish what you’re doing first 🙂');
    const spot = groundAhead();
    player.setBusy(true);
    player.char.setAction('crouch');
    await tasks.wait(0.6);
    player.char.clearAction();
    player.setBusy(false);
    if (!fireworks[kind](spot)) return ui.toast('Too many crackers burning, wait a moment');
    passport.stamp('crackers');
  }

  function enter() {
    started = true;
    nameTag.set({ name: profile.name, handle: profile.handle });
    audio.init();
    ambience.start();
    ambience.setBand(audio.mode === 'band');
    dayNight.start({ night: params.has('night') });
    ravan.start();
    ramayan.start();
    net.connect();
    if (profile.handle) profile.fetchTopmate();
    const welcome = () =>
      ui.toast(
        tk(`🪔 Welcome, ${profile.name}! Walk up to anything glowing and press ${settings.keys.interact.replace('Key', '')}`, `🪔 Welcome, ${profile.name}! Use the joystick to walk up to anything glowing, then tap the button`),
        4500,
        { important: true }
      );
    // phones: the coach card explains the controls first, the welcome follows once it's tapped away
    if (!ui.showCoach(welcome)) welcome();
    frameMelaScreen();
    if (profile.golden && profile.ref) setTimeout(() => ui.toast(`✨ Invited by @${profile.ref}: a golden kandeel is waiting for you at Kandeel House`, 5000, { important: true }), 5000);
  }

  const handlers = {
    input,
    onModal(open) {
      input.blocked = open;
    },
    onPromptTap(code) {
      input.press(code);
    },
    onGameExit() {
      games.leave();
    },
    onMic() {
      if (!started) return;
      voice.toggle();
    },
    onAvatar() {
      if (!started || ui.modalOpen) return;
      if (player.mode !== 'walk') return ui.toast('Finish what you’re doing first 🙂');
      customizer.open('edit');
    },
    onSettings(key) {
      if (key === 'music') {
        audio.setMode(settings.music);
        ambience.setBand(settings.music === 'band' && musicOn);
      }
      if (key === 'keys') ui.setHelp(HELP[player.mode] ?? HELP.walk);
      if (key === 'voice' || key === 'voiceVolume') voice.applySettings();
      if (key === 'quality') return settings.tier !== tier ? 'Graphics changes apply after a reload.' : '';
      return '';
    },
    passportDone: () => passport.done,
    boards: () => net.boards,
    wishes: () => net.wishes,
    online: () => net.online,
    onAction(action) {
      switch (action) {
        case 'rocket':
          fireworks.launchRocket();
          ui.toast('🚀 Launched from the Fireworks Zone. Look up!');
          passport.stamp('crackers');
          break;
        case 'anaar':
        case 'chakri':
          lightCracker(action);
          break;
        case 'phuljhadi':
          if (player.mode === 'ride' || player.mode === 'game' || player.mode === 'anim') return ui.toast('Not right now 🙂');
          player.char.holdL = 'holdUp';
          fireworks.phuljhadi(
            (out) => {
              player.char.handL.getWorldPosition(out);
              return player.heading;
            },
            () => (player.char.holdL = null)
          );
          passport.stamp('crackers');
          ui.toast('✨ Phuljhadi lit! Walk around with it.');
          break;
        case 'lantern':
          if (player.mode !== 'walk' && !boat.riding) return;
          rituals.wishLantern();
          break;
        case 'show':
          if (fireworks.grandShow()) {
            ui.toast('🎆 The grand fireworks show is starting! Look towards the Fireworks Zone');
            passport.stamp('show');
          } else ui.toast('The show is already on!');
          break;
        case 'photo':
          if (!started || ui.modalOpen || player.mode === 'game' || player.mode === 'anim') return;
          poster.snapHere();
          break;
      }
    },
    onPlace(id) {
      if (player.mode === 'game') games.leave();
      if (vehicles.active) vehicles.exit({ force: true });
      if (boat.state !== 'docked') boat.abort();
      if (ramayan.seated) ramayan.standUp();
      train.abort();
      if (player.mode === 'ride') rides.getOff();
      if (player.mode === 'busy' || player.mode === 'anim') return;
      player.teleport(...PLACES[id]);
      frameMelaScreen();
    },
    onMute() {
      muted = !muted;
      audio.setMuted(muted);
      ui.setMuted(muted);
    },
    onMusic() {
      musicOn = !musicOn;
      audio.setMusic(musicOn);
      ambience.setBand(audio.mode === 'band' && musicOn);
      ui.setMusic(musicOn);
      try {
        localStorage.setItem('melaMusic', musicOn ? 'on' : 'off');
      } catch {
        // ignore
      }
    },
  };
  const ui = createUI(handlers);
  ui.setMusic(musicOn);
  const passport = new Passport(ui, audio);
  Object.assign(ctx, { ui, passport });
  const net = new Net(ctx);
  ctx.net = net;
  const voice = new Voice(ctx, net);
  ctx.voice = voice;
  voice.on('state', () => ui.setMic(voice.live, false));
  voice.on('level', (talking) => ui.setMic(voice.live, talking));
  net.on('boards', () => ui.refreshBoards());
  net.on('wishes', () => ui.refreshBoards());
  net.on('online', (n) => ui.setChip('online', n > 1 ? `👥 ${n} at the mela` : ''));
  net.on('status', (ok) => {
    if (!ok) ui.setChip('online', '');
  });

  await loading();
  const shops = new Shops(ctx);
  ctx.shops = shops;
  const food = new FoodStalls(ctx);
  const rituals = new Rituals(ctx);
  const rides = new Rides(ctx, world.wheel);
  const games = new Games(ctx);
  await loading();
  const crowd = new Crowd(ctx, low ? 12 : 22);
  ctx.crowd = crowd;
  const ramayan = new Ramayan(ctx);
  ctx.ramayan = ramayan;
  const boat = new BoatRide(ctx, { wish: () => rituals.wishLantern() });
  net.makeBoat = () => boat.remoteHull(); // other visitors at the oars get a boat under them
  const decor = buildDecor(ctx);
  await loading();
  const vehicles = new Vehicles(ctx);
  const poster = new Poster(ctx);
  const extraLights = new StringLights(scene);
  const walls = new Walls(ctx);
  ctx.walls = walls;
  walls.claimFrom(shops.placed);
  const train = new Train(ctx, extraLights);
  const ravan = new Ravan(ctx);
  const scenes = low ? null : new CrowdScenes(ctx);
  extraLights.build();
  const ownStall = cfg && world.stalls[stallIndexFor(cfg.stallNo, world.stalls.length)];
  const creator = applyCreator(scene, cfg, { stallAnchor: ownStall, ravanAnchor: { pos: new THREE.Vector3(-46.6, 0, 76.5), facing: 0.22 }, colliders: world.colliders, diyas: world.diyas });
  // the creator's own stall shows their board, so its menu takes the board's name too (not the slot's)
  if (ownStall?.def) ownStall.def.name = cfg.stallTitle || `${cfg.name} ka Stall`;
  personaliseIntro(cfg);
  // the Mela Screen over the entrance: the creator's reels / posts, or the festive default loop
  const billboard = new Billboard({ scene, cfg, colliders: world.colliders, director: !!director });
  billboard.camera = camera;
  billboard.renderer = renderer;
  billboard.onOverlay = (open) => (input.blocked = open); // the full-screen reel: no walking behind it
  /**
   * At the gate, facing in, the Mela Screen is the first thing to see. On a phone in portrait the
   * top HUD (buttons + places strip) covers the upper part of the view, so the default camera pitch
   * leaves the screen behind it (iPhone SE: all of it). Lower the pitch (the camera drops and looks
   * up the walkway) just enough that the picture clears the HUD, never below -0.08 (lower, the gate
   * arch's banner comes down over the screen). Where it already clears (desktop), nothing changes.
   */
  const _top = new THREE.Vector3();
  const _tgt = new THREE.Vector3();
  function frameMelaScreen() {
    const s = billboard.size;
    const dz = player.pos.z - billboard.pos.z;
    if (!s || player.mode !== 'walk' || dz < 8 || dz > 35 || Math.abs(player.pos.x - billboard.pos.x) > 6) return;
    if (Math.cos(player.heading - Math.PI) < 0.8) return; // not facing into the mela
    const hudEl = document.getElementById('hud-top');
    const hr = hudEl && getComputedStyle(hudEl).display !== 'none' ? hudEl.getBoundingClientRect() : null;
    const cr = renderer.domElement.getBoundingClientRect();
    if (!hr || hr.height <= 0 || !cr.height) return;
    const want = hr.bottom - cr.top + cr.height * 0.03;
    const c = player.cam;
    const pos = camera.position.clone();
    const quat = camera.quaternion.clone();
    _tgt.set(player.pos.x, player.pos.y + 1.55 * (player.char.look.scale ?? 1), player.pos.z);
    _top.set(billboard.pos.x, s.y1, billboard.pos.z); // the picture's top edge (its header may stay under the HUD)
    for (let p = c.pitch; p >= -0.08; p -= 0.02) {
      camera.position.set(Math.sin(c.yaw) * Math.cos(p), Math.sin(p), Math.cos(c.yaw) * Math.cos(p)).multiplyScalar(c.dist).add(_tgt);
      camera.lookAt(_tgt);
      camera.updateMatrixWorld();
      c.pitch = p;
      if (((1 - _top.clone().project(camera).y) / 2) * cr.height >= want) break;
    }
    camera.position.copy(pos);
    camera.quaternion.copy(quat);
    camera.updateMatrixWorld();
  }
  await loading();
  const dayNight = new DayNight({ scene, sky, hemi, sun, lightSystems: [world.lights, games.lights, vehicles.lights, poster.lights, ramayan.lights, extraLights, billboard.lights].filter(Boolean) });
  const customizer = new Customizer({
    onApply: (lk) => {
      player.char.setLook(lk);
      net.sendLook();
    },
    onEnter: enter,
    onDone: () => {
      nameTag.set({ name: profile.name, handle: profile.handle });
      net.sendLook();
      ui.toast('✨ Looking good!');
    },
    onOpen: () => (input.blocked = true),
    onClose: () => (input.blocked = false),
  });
  ctx.customizer = customizer;
  void food;

  // smoke follows the crackers
  fireworks.onBurst = (p) => smoke.puff(p.x, p.y, p.z, { kind: 'smoke', count: low ? 3 : 8, size: 3, grow: 2.2, rise: 0.3, drift: 0.6, life: 7, peak: 0.1, spread: 1.5 });
  fireworks.onGround = (kind, p, dur) => {
    const e = smoke.emitter(new THREE.Vector3(p.x, 0.6, p.z), { kind: 'smoke', rate: kind === 'anaar' ? 10 : 6, size: 0.5, grow: 0.9, rise: 1.4, drift: 0.3, life: 3, peak: 0.22 });
    setTimeout(() => e.stop(), dur * 1000);
  };
  fireworks.onShow = (seconds) => {
    const e = smoke.emitter((o) => o.set(SITES.fireworks.x + (Math.random() - 0.5) * 10, 1, SITES.fireworks.z + (Math.random() - 0.5) * 10), { kind: 'smoke', rate: 6, size: 1.2, grow: 1.6, rise: 1.2, drift: 0.5, life: 6, peak: 0.16 });
    setTimeout(() => e.stop(), seconds * 1000);
  };
  // shared lanterns: ours go out to everyone
  const releaseFrom = lanterns.releaseFrom.bind(lanterns);
  lanterns.releaseFrom = (p, text) => {
    const r = releaseFrom(p, text);
    net.sendLantern(text, r.pos, r.dir);
    return r;
  };
  // buffs show as chips
  player.onBuff = (id, b) => ui.setChip(`buff-${id}`, b ? `${b.icon} ${b.label} · ${Math.ceil(b.left)}s` : '');

  // Every tier lights the scene through a small pool of real lights that follows the player: phones
  // can't compile a shader for ~60 lights at all, and on desktops it was the biggest per-pixel cost.
  const maxFrag = renderer.getContext().getParameter(renderer.getContext().MAX_FRAGMENT_UNIFORM_VECTORS);
  const poolSize = low ? { points: 8, spots: 2 } : maxFrag < 700 ? { points: 14, spots: 3 } : { points: 16, spots: 4 };
  const lightPool = new LightPool(scene, () => player.pos, poolSize);

  // shadows: everything built so far casts and receives (bulbs and glow meshes excluded)
  if (!low) {
    shadowify(scene);
    world.water.mesh.castShadow = world.water.mesh.receiveShadow = false;
    debris.mesh.castShadow = false; // small flying bits: invisible at the shadow map's 9 cm texel
    // the shadow map is redrawn on a cadence (see the loop) instead of on every render call
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
  }

  let viewW = 0;
  let viewH = 0;
  function resize() {
    const w = viewW0();
    const h = viewH0();
    const pr = renderer.getPixelRatio();
    viewW = w;
    viewH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    // bloom is a blur: phones run it at 1x whatever the pixel ratio (composer.setSize just reset it).
    // Not lower: below 1x the 2-4 px diya flames average away in the first mip and lose their halo.
    if (low) bloom.setSize(w, h);
    fireworks.setViewportHeight(h * pr);
    smoke.setViewportHeight(h * pr, camera.fov);
    ramayan.resize();
  }
  /** Runs fn (a render + grab) at a pixel ratio of at least minPr, then puts the governor's back. */
  ctx.atLeastPixelRatio = (minPr, fn) => {
    const pr = renderer.getPixelRatio();
    if (pr >= minPr) return fn();
    renderer.setPixelRatio(minPr);
    resize();
    try {
      return fn();
    } finally {
      renderer.setPixelRatio(pr);
      resize();
      composer.render(); // the resize cleared the canvas: never leave it blank until the next frame
    }
  };
  let pendingPr = 0; // see the governor's apply()
  const governor = new ResolutionGovernor({
    levels,
    start: renderer.getPixelRatio(),
    enabled: !pinnedPr && params.get('gov') !== '0',
    // The governor steps after a frame's render (it samples that frame's time). Resizing the canvas
    // there would clear its drawing buffer (alpha, no preserveDrawingBuffer) and the browser would
    // composite that blank buffer: a one-frame transparent flash. So the new ratio waits for the next
    // frame that draws and is applied just before its render, in the same task.
    apply(pr) {
      pendingPr = pr;
    },
  });
  const applyPendingPr = () => {
    if (!pendingPr) return;
    const pr = pendingPr;
    pendingPr = 0;
    if (pr === renderer.getPixelRatio()) return;
    renderer.setPixelRatio(pr);
    resize();
  };
  // phones: rotating, the URL bar sliding and the on-screen keyboard all resize; some browsers report
  // the new size a moment late, so check again shortly after
  let resizeTimer = 0;
  const onResize = () => {
    if (!director && (innerWidth !== viewW || innerHeight !== viewH)) {
      resize();
      governor.reset();
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => !director && (innerWidth !== viewW || innerHeight !== viewH) && (resize(), governor.reset()), 300);
  };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  resize();

  // where you left off last time
  let savedPos = null;
  try {
    savedPos = JSON.parse(localStorage.getItem('melaPos') || 'null');
  } catch {
    // ignore
  }
  const atStall = creator.stallBoard && world.stalls[stallIndexFor(cfg.stallNo, world.stalls.length)];
  if (atStall && !params.has('place') && !params.has('pos')) player.teleport(0, atStall.center.z + 5, face(0, atStall.center.z + 5, atStall.center.x, atStall.center.z)); // facing their stall
  else if (savedPos && !params.has('place') && !params.has('pos') && vehicles.walkable(savedPos)) player.teleport(savedPos.x, savedPos.z, savedPos.h);
  setInterval(() => {
    if (started && player.mode === 'walk') {
      try {
        localStorage.setItem('melaPos', JSON.stringify({ x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1), h: +player.heading.toFixed(2) }));
      } catch {
        // ignore
      }
    }
  }, 5000);

  // dev shortcuts: ?play skips the intro (&name=&handle= set who you are), &place=games jumps to a
  // spot, &pos=x,z,heading stands somewhere exact, &do=rocket runs actions, &show starts the grand
  // show, &warp=10 pre-simulates fireworks, &noyt skips the YouTube embed, &night skips dusk,
  // &nonet stays offline, &tier=low forces the phone tier, &script=E@1.5,Digit1@2.5 replays input
  await loading('Opening the gates…');
  // compile every shader (in parallel where the browser can) and draw one frame while the loader is
  // still up, so the first seconds of play don't stall on ~40-70 synchronous shader compiles
  // Program variants depend on the render target (a null target means tone mapping + sRGB output in
  // the shader), and the scene is only ever drawn into the composer's target, so compile against it.
  lightPool.update();
  try {
    renderer.setRenderTarget(composer.readBuffer);
    const compiled = renderer.compileAsync(scene, camera); // programs are created synchronously here
    renderer.setRenderTarget(null);
    await Promise.race([compiled, new Promise((r) => setTimeout(r, 8000))]);
  } catch {
    // older browsers: the warm-up render below still compiles what's in view
    renderer.setRenderTarget(null);
  }
  composer.render();
  await nextFrame();
  document.getElementById('loader').classList.add('done');
  setTimeout(() => document.getElementById('loader').classList.add('hidden'), 500);
  if (params.has('play')) {
    customizer.close();
    profile.name = params.get('name') || profile.name || 'Mela Visitor';
    if (params.has('handle')) profile.handle = params.get('handle');
    started = !director; // director shots: no prompts, markers or keeper bubbles
    nameTag.set({ name: profile.name, handle: profile.handle });
    dayNight.start({ night: params.has('night') });
    // &dayT=30 holds the evening at that many seconds after dusk (screenshots, the bench's --dusk)
    if (params.get('dayT')) {
      dayNight.T = Number(params.get('dayT')) || 0;
      dayNight.running = false;
    }
    ravan.start();
    if (!params.has('noyt')) ramayan.start();
    if (!params.has('nonet')) net.connect();
    if (!director) ui.showCoach();
    window.__mela = { ...ctx, creator, mela: melaReport(), billboard, games, rides, crowd, vehicles, ramayan, poster, customizer, nameTag, boat, train, ravan, walls, dayNight, scenes, decor, voice, lightPool, governor, get gov() { return { ...governor.state, gpu: settings.gpu, midGpu: settings.midGpu }; } }; // for automated checks
  } else {
    customizer.open('intro');
  }
  if (PLACES[params.get('place')]) player.teleport(...PLACES[params.get('place')]);
  if (params.has('show')) fireworks.grandShow();
  for (const a of (params.get('do') || '').split(',').filter(Boolean)) handlers.onAction(a);
  for (let i = 0; i < (Number(params.get('warp')) || 0) * 60; i++) fireworks.update(1 / 60);
  if (params.get('pos')) player.teleport(...params.get('pos').split(',').map(Number));
  if (started) frameMelaScreen(); // the gate spawn on a phone: the Mela Screen clear of the top HUD
  for (const stepDef of (params.get('script') || '').split(',').filter(Boolean)) {
    const [what, at] = stepDef.split('@');
    setTimeout(() => {
      if (what.startsWith('click:')) {
        const [, x, y] = what.split(':').map(Number);
        const ev = { clientX: x, clientY: y, pointerId: 7, pointerType: 'mouse', bubbles: true };
        renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', ev));
        dispatchEvent(new PointerEvent('pointerup', ev));
      } else {
        const code = what === 'E' ? 'KeyE' : what;
        const key = code.startsWith('Digit') ? code.slice(5) : code;
        dispatchEvent(new KeyboardEvent('keydown', { code, key }));
        setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code, key })), 80);
      }
    }, Number(at) * 1000);
  }

  // stall-keepers wave when you walk up
  const waved = new Set();
  const greetKeepers = () => {
    for (const s of world.stalls) {
      const d = Math.hypot(s.stand.x - player.pos.x, s.stand.z - player.pos.z);
      if (d < 4 && !waved.has(s) && player.mode === 'walk') {
        waved.add(s);
        s.keeper.setAction('wave');
        setTimeout(() => s.keeper.action === 'wave' && s.keeper.clearAction(), 1600);
        ui.bubble((o) => s.keeper.headTop.getWorldPosition(o), slot(`shout.keeper.${1 + Math.floor(Math.random() * 3)}`), 1.8);
      } else if (d > 9) {
        waved.delete(s);
      }
    }
  };

  // ---------- loop ----------

  const timer = new THREE.Timer();
  timer.connect(document);
  let zone = null;
  let zoneTimer = 0;
  let helpKey = '';
  let vehKind = null;
  const joyLabel = document.querySelector('#joystick .joy-label');
  const jumpBtn = document.getElementById('jumpBtn');

  // behind the intro card and other full-screen panels the scene is only a blurred backdrop, so it is
  // drawn at a few frames a second (or every 3rd frame) while the simulation keeps running
  const introEl = document.getElementById('intro');
  let frameNo = 0;
  let lastDraw = 0;
  let lastTime = 0;
  let throttled = false;
  let sinceShadow = 0;

  // the director takes the camera (and the clock) for frame-stepped capture
  let cameraHook = null;

  /** One simulation step and (unless render is false) one draw. `time` is the rAF timestamp. */
  function frame(dt, t, { time = performance.now(), render = true } = {}) {
    frameNo++;
    tasks.update(dt);
    games.update(dt, t);
    rides.update(dt, t);
    vehicles.update(dt, t);
    boat.update(dt, t);
    train.update(dt, t);
    ramayan.update(dt, t, { started, muted });
    player.update(dt);
    world.update(dt, t);
    extraLights.update(t);
    crowd.update(dt, camera);
    scenes?.update(dt, t);
    shops.update(dt, t);
    poster.update(t);
    ravan.update(dt, t);
    decor.update(dt, t);
    creator.update(dt, t);
    updateFlames(t);
    dayNight.update(dt);

    if (cameraHook) cameraHook(camera, dt, t);
    else if (games.active) games.applyCamera(camera, dt);
    else if (vehicles.active) vehicles.applyCamera(camera, dt);
    else if (boat.riding) boat.applyCamera(camera, dt);
    else player.updateCamera(dt);
    camera.updateMatrixWorld();
    // after the camera: it wakes / sleeps by distance, and a tap on the screen opens the reel
    billboard.update(dt, t, camera.position, started && player.mode === 'walk' && !ui.modalOpen ? input : null);

    // prompts and help: whoever owns the seat (vehicle, show, ride) supplies them
    const mode = games.active ? 'game' : player.mode;
    const owner = vehicles.active ? vehicles : ramayan.seated ? ramayan : boat.riding ? boat : train.riding ? train : null;
    const ownerKey = owner === vehicles ? `veh:${vehicles.active.kind}` : owner ? owner.constructor.name : 'ride';
    const key = mode === 'ride' ? ownerKey : mode;
    if (key !== helpKey) {
      helpKey = key;
      // the stick says what it does now
      if (TOUCH) joyLabel.textContent = owner === boat ? 'Row' : owner === vehicles ? (vehicles.active.kind === 'car' ? 'Drive' : 'Fly') : 'Walk';
      if (TOUCH) jumpBtn.classList.toggle('boat-hidden', owner === boat); // nothing to jump in a boat
      nameTag.setVisible(mode !== 'game' && !director); // the close game cameras sit right behind the head; director shots have no tag
      ui.setPrompt(null);
      ui.setPrompt2(null);
      if (mode === 'ride') ui.setHelp(owner === vehicles ? vehicles.active.help : owner ? owner.help : HELP.ride);
      else if (mode !== 'game') ui.setHelp(HELP[mode] ?? HELP.walk);
    }
    const kind = vehicles.active?.kind ?? null;
    if (kind !== vehKind) {
      vehKind = kind;
      ui.setVehicleButtons(kind);
    }
    // touch: the stick is there while you can walk, drive or row, and gets out of the way otherwise
    if (TOUCH) input.setJoystick(started && !ui.modalOpen && (mode === 'walk' || (mode === 'ride' && (owner === vehicles || owner === boat))));
    const canInteract = started && mode === 'walk' && !ui.modalOpen;
    const best = interactions.update(t, player, canInteract);
    if (mode === 'ride') {
      ui.setPrompt(owner?.promptLabel?.() ?? 'Get off');
      ui.setPrompt2(owner?.prompt2Label?.() ?? null);
    }
    if (mode === 'walk') {
      ui.setPrompt(best ? interactions.label(best) : null);
      const label = shops.heldLabel();
      ui.setPrompt2(label);
      if (best && input.pressedAction('interact')) best.action();
      else if (label && input.pressedAction('use')) shops.useHeld();
    }

    if (started) greetKeepers();
    zoneTimer -= dt;
    if (started && player.mode === 'walk' && zoneTimer <= 0) {
      zoneTimer = 0.4;
      const p = player.pos;
      const z = ZONES.find((zz) => (p.x - zz.x) ** 2 + (p.z - zz.z) ** 2 < zz.r * zz.r);
      if ((z?.id ?? null) !== zone) {
        zone = z?.id ?? null;
        if (z) ui.toast(zoneToast(z), 3200);
      }
    }

    sky.update(t, camera.position);
    fireworks.update(dt);
    lanterns.update(dt, t);
    debris.update(dt);
    smoke.update(dt, t);
    audio.listener.copy(camera.position);
    if (started) ambience.update(dt, t, camera.position);
    net.update(dt, performance.now());
    if (started && !ui.modalOpen) {
      if (settings.voice === 'ptt') voice.setTalking(input.isAction('talk') || ui.micHeld);
      else if (input.pressedAction('talk')) voice.toggle();
    }
    voice.update(dt, camera);
    ui.updateBubbles(camera);

    const intro = !introEl.classList.contains('hidden');
    const covered = intro || ui.modalOpen;
    const draw = render && (!covered || (intro ? time - lastDraw > 140 : frameNo % 3 === 0));
    if (covered !== throttled) {
      throttled = covered;
      governor.reset(); // frame times behind a panel say nothing about the full scene
    }
    if (draw) {
      lastDraw = time;
      // shadows: every frame while the sun is still sliding into night, then every 2nd frame
      // (rides and people move slowly enough that a 30 Hz shadow is not noticeable). When the river
      // reflection is also on a 2-frame cadence, the shadow takes the frames it skips, so the two
      // heavy passes never land in the same frame.
      if (renderer.shadowMap.enabled) {
        sinceShadow++;
        if (dayNight.T < 95 || sinceShadow >= 2 || !world.water.reflectDue(camera)) {
          renderer.shadowMap.needsUpdate = true;
          sinceShadow = 0;
        }
      }
      applyPendingPr(); // a governor step from the last frame: resize and redraw in this one
      lightPool.update();
      composer.render();
      ramayan.render(camera);
    }
    input.endFrame();
    return covered;
  }

  const loop = (time) => {
    const t0 = performance.now();
    const rafDt = lastTime ? time - lastTime : 0;
    lastTime = time;
    timer.update(time);
    const covered = frame(Math.min(timer.getDelta(), 0.05), timer.getElapsed(), { time });
    if (!covered) governor.sample(rafDt, performance.now() - t0);
  };
  if (director) {
    nameTag.setVisible(false);
    startDirector(director, { ...window.__mela, frame, setCameraHook: (fn) => (cameraHook = fn) });
    return;
  }
  renderer.setAnimationLoop(loop);

  // a hidden tab draws nothing at all (some browsers keep firing rAF for a while)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else {
      lastTime = 0;
      governor.reset();
      renderer.setAnimationLoop(loop);
    }
  });
}

init();
