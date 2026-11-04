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
import { Creators } from './creators.js';
import { Walls } from './wall.js';
import { Train } from './train.js';
import { Columbus } from './columbus.js';
import { Ravan } from './ravan.js';
import { Tambola } from './games/tambola.js';
import { Kuan } from './kuan.js';
import { CrowdScenes } from './extras.js';
import { StringLights } from './stringLights.js';
import { CONFIG } from './config.js';
import { shadowify } from './utils.js';
import { Voice } from './voice.js';
import { LightPool } from './lightpool.js';

const ZONES = [
  { id: 'gate', x: 0, z: 62, r: 9, msg: '🪔 Welcome to the Topmate Diwali Mela!' },
  { id: 'creators', x: 16, z: 65, r: 8, msg: '🤝 Creator Corner: meet Topmate creators and book a session' },
  { id: 'selfie', x: 15, z: 56, r: 6, msg: '📸 Selfie Point: get your mela poster to share' },
  { id: 'tambola', x: 33, z: 58, r: 8, msg: '🎟️ Tambola Tent: join a round of housie' },
  { id: 'deepmala', x: -12, z: 65, r: 6, msg: '🪔 The Deepmala wall: bring a diya or kandeel and press Q to add yours' },
  { id: 'ramleela', x: -30, z: 62, r: 14, msg: '📽️ Ramleela Maidan: take a seat for the Ramayan show' },
  { id: 'ravan', x: -56, z: 64, r: 10, msg: '🔥 Ravan Dahan: the effigy burns on the countdown, or light the fuse yourself' },
  { id: 'bazaar', x: 0, z: 32, r: 13, msg: '🛍️ The Bazaar: walk up to a stall and press E' },
  { id: 'games', x: 22, z: 27, r: 12, msg: '🎯 Khel Gali: four mela games, win prizes!' },
  { id: 'carousel', x: -20, z: 30, r: 9, msg: '🎠 The Carousel: hop on!' },
  { id: 'columbus', x: -26, z: 50, r: 7, msg: '🚢 The Columbus swing: board at the steps' },
  { id: 'cars', x: -53, z: 24, r: 24, msg: '🏁 Chakri Cars: a go-kart circuit · press E at a car' },
  { id: 'airfield', x: 52, z: 22, r: 20, msg: '✈️ Pushpak Viman Airfield: fly the plane or the heli' },
  { id: 'plaza', x: 0, z: 0, r: 10, msg: '🌸 Rangoli Chowk: join the garba!' },
  { id: 'kuan', x: -24, z: 6, r: 10, msg: '🏍️ Maut ka Kuan: climb the stairs to watch the riders' },
  { id: 'wheel', x: -34, z: -18, r: 12, msg: '🎡 The Giant Wheel: walk to the steps and press E' },
  { id: 'fireworks', x: 36, z: -30, r: 15, msg: '🚀 Fireworks Zone: press 1 to launch a rocket' },
  { id: 'ghat', x: 0, z: -42, r: 12, msg: '🏮 The Ghat: float a diya, release a lantern, or take a boat ride from the jetty' },
];

const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const PLACES = {
  gate: [0, 70, Math.PI],
  creators: [16, 70, 0],
  selfie: [12.6, 56.4, Math.PI / 2],
  tambola: [33, 67, Math.PI],
  ramleela: [-30, 52, 0],
  ravan: [-48, 66, -Math.PI / 2],
  bazaar: [0, 50, Math.PI],
  games: [19, 27, Math.PI / 2],
  train: [12.5, 36, Math.PI / 2],
  carousel: [-16, 30, -Math.PI / 2],
  columbus: [-26, 55, Math.PI],
  cars: [-37.5, 21, -Math.PI / 2],
  airfield: [44, 18, Math.PI / 2],
  plaza: [0, 12, Math.PI],
  kuan: [-14, 10, -Math.PI / 2],
  wheel: [-34, -12, Math.PI],
  fireworks: [8, -2, face(8, -2, 36, -30)],
  ghat: [0, -38, Math.PI],
};

const HELP = {
  walk: [['W A S D', 'Move'], ['run', 'Run'], ['jump', 'Jump'], ['interact', 'Interact'], ['Drag', 'Camera'], ['Scroll', 'Zoom'], ['photo', 'Photo'], ['look', 'Change look'], ['talk', 'Voice chat'], ['passport', 'Passport']],
  ride: [['interact', 'Get off'], ['Drag', 'Look around'], ['Scroll', 'Zoom']],
  busy: [['Drag', 'Camera']],
  anim: [],
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function loadFonts() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('64px "Yatra One"'), document.fonts.load('600 24px Poppins')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    // canvas text falls back to system fonts
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
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
  await loadFonts(); // sign textures are drawn on canvas, so fonts must be ready first

  // The canvas is transparent so the Ramleela screen (a CSS3D YouTube embed behind it) can show through.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  settings.detect(renderer);
  if (params.get('tier')) settings.quality = params.get('tier');
  const tier = settings.tier;
  const low = tier === 'low';
  document.body.classList.toggle('low', low); // style.css drops the backdrop blur on the phone tier
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0x1a0d2c);
  scene.fog = new THREE.FogExp2(fogColor, 0.0075);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 700);
  camera.layers.enable(1);
  scene.add(camera);
  const hemi = new THREE.HemisphereLight(0x6a5aa0, 0x2a1a12, 0.8);
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(low ? innerWidth / 2 : innerWidth, low ? innerHeight / 2 : innerHeight), 0.85, 0.55, 0.82);
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
    ui.toast(`🪔 Welcome, ${profile.name}! Walk up to anything glowing and press ${settings.keys.interact.replace('Key', '')}`, 4500, { important: true });
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
      columbus.abort();
      kuan.abort();
      if (player.mode === 'ride') rides.getOff();
      if (player.mode === 'busy' || player.mode === 'anim') return;
      player.teleport(...PLACES[id]);
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
  const decor = buildDecor(ctx);
  await loading();
  const vehicles = new Vehicles(ctx);
  const poster = new Poster(ctx);
  const extraLights = new StringLights(scene);
  const creators = new Creators(ctx, extraLights);
  const walls = new Walls(ctx);
  ctx.walls = walls;
  walls.claimFrom(shops.placed);
  const train = new Train(ctx, extraLights);
  const columbus = new Columbus(ctx, extraLights);
  const ravan = new Ravan(ctx);
  const tambola = new Tambola(ctx, extraLights);
  const kuan = new Kuan(ctx, extraLights);
  const scenes = low ? null : new CrowdScenes(ctx);
  extraLights.build();
  await loading();
  const dayNight = new DayNight({ scene, sky, hemi, sun, lightSystems: [world.lights, games.lights, vehicles.lights, poster.lights, ramayan.lights, extraLights].filter(Boolean) });
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
  void creators;

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

  // Phones (and any GPU with few shader uniforms) get a small pool of real lights that follows the
  // player; otherwise the lit shader fails to compile there and every lit object disappears.
  const maxFrag = renderer.getContext().getParameter(renderer.getContext().MAX_FRAGMENT_UNIFORM_VECTORS);
  const poolSize = low ? { points: 8, spots: 2 } : maxFrag < 700 ? { points: 14, spots: 3 } : null;
  const lightPool = poolSize ? new LightPool(scene, () => player.pos, poolSize) : null;

  // shadows: everything built so far casts and receives (bulbs and glow meshes excluded)
  if (!low) {
    shadowify(scene);
    world.water.mesh.castShadow = world.water.mesh.receiveShadow = false;
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    fireworks.setViewportHeight(innerHeight * renderer.getPixelRatio());
    smoke.setViewportHeight(innerHeight * renderer.getPixelRatio(), camera.fov);
    ramayan.resize();
  }
  addEventListener('resize', resize);
  resize();

  // where you left off last time
  let savedPos = null;
  try {
    savedPos = JSON.parse(localStorage.getItem('melaPos') || 'null');
  } catch {
    // ignore
  }
  if (savedPos && !params.has('place') && !params.has('pos') && vehicles.walkable(savedPos)) player.teleport(savedPos.x, savedPos.z, savedPos.h);
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
  document.getElementById('loader').classList.add('done');
  setTimeout(() => document.getElementById('loader').classList.add('hidden'), 500);
  if (params.has('play')) {
    customizer.close();
    profile.name = params.get('name') || profile.name || 'Mela Visitor';
    if (params.has('handle')) profile.handle = params.get('handle');
    started = true;
    nameTag.set({ name: profile.name, handle: profile.handle });
    dayNight.start({ night: params.has('night') });
    ravan.start();
    if (!params.has('noyt')) ramayan.start();
    if (!params.has('nonet')) net.connect();
    window.__mela = { ...ctx, games, rides, crowd, vehicles, ramayan, poster, customizer, nameTag, boat, train, columbus, ravan, tambola, kuan, walls, dayNight, scenes, decor, voice, lightPool }; // for automated checks
  } else {
    customizer.open('intro');
  }
  if (PLACES[params.get('place')]) player.teleport(...PLACES[params.get('place')]);
  if (params.has('show')) fireworks.grandShow();
  for (const a of (params.get('do') || '').split(',').filter(Boolean)) handlers.onAction(a);
  for (let i = 0; i < (Number(params.get('warp')) || 0) * 60; i++) fireworks.update(1 / 60);
  if (params.get('pos')) player.teleport(...params.get('pos').split(',').map(Number));
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
        ui.bubble((o) => s.keeper.headTop.getWorldPosition(o), ['Aaiye, aaiye! 🙏', 'Happy Diwali! ✨', 'Fresh hai, le lo! 😄'][Math.floor(Math.random() * 3)], 1.8);
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

  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();

    tasks.update(dt);
    games.update(dt, t);
    rides.update(dt, t);
    vehicles.update(dt, t);
    boat.update(dt, t);
    train.update(dt, t);
    columbus.update(dt, t);
    kuan.update(dt, t);
    ramayan.update(dt, t, { started, muted });
    player.update(dt);
    world.update(dt, t);
    extraLights.update(t);
    crowd.update(dt, camera);
    scenes?.update(dt, t);
    shops.update(dt, t);
    poster.update(t);
    tambola.update(dt);
    ravan.update(dt, t);
    decor.update(dt, t);
    updateFlames(t);
    dayNight.update(dt);
    lightPool?.update();

    if (games.active) games.applyCamera(camera, dt);
    else if (vehicles.active) vehicles.applyCamera(camera, dt);
    else player.updateCamera(dt);
    camera.updateMatrixWorld();

    // prompts and help: whoever owns the seat (vehicle, show, ride) supplies them
    const mode = games.active ? 'game' : player.mode;
    const owner = vehicles.active ? vehicles : ramayan.seated ? ramayan : boat.riding ? boat : train.riding ? train : columbus.state === 'ride' || columbus.state === 'stopping' ? columbus : kuan.watching ? kuan : null;
    const ownerKey = owner === vehicles ? `veh:${vehicles.active.kind}` : owner ? owner.constructor.name : 'ride';
    const key = mode === 'ride' ? ownerKey : mode;
    if (key !== helpKey) {
      helpKey = key;
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
        if (z) ui.toast(z.msg, 3200);
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
      if (settings.voice === 'ptt') voice.setTalking(input.isAction('talk'));
      else if (input.pressedAction('talk')) voice.toggle();
    }
    voice.update(dt, camera);
    ui.updateBubbles(camera);

    composer.render();
    ramayan.render(camera);
    input.endFrame();
  });
}

init();
