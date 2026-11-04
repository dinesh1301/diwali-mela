import { tk } from '../touch.js';
import * as THREE from 'three';
import { foodMesh, FOOD_COLORS } from '../items.js';
import { pick, rand } from '../utils.js';
import { slot, slotSet } from '../personalSlots.js';

const _v = new THREE.Vector3();

// labels are personal slots (menu.<stall>.<n>); a renamed item drops the stock description under it
const named = (goods, items) => items.map((it, i) => (slotSet(`menu.${goods}.${i + 1}`) ? { ...it, label: slot(`menu.${goods}.${i + 1}`), sub: '' } : it));
const MITHAI = () =>
  named('mithai', [
    { kind: 'laddoo', icon: '🟠', label: 'Motichoor laddoo', sub: 'Round, golden, melts in the mouth' },
    { kind: 'kaju', icon: '💎', label: 'Kaju katli', sub: 'Cashew fudge with silver vark' },
    { kind: 'jamun', icon: '🟤', label: 'Gulab jamun', sub: 'Soaked in warm rose syrup' },
    { kind: 'barfi', icon: '🟩', label: 'Pista barfi', sub: 'Milky, nutty squares' },
  ]);
const KULFI = () =>
  named('kulfi', [
    { color: 0xfff1c1, icon: '🤍', label: 'Malai', sub: 'Classic creamy' },
    { color: 0xffc04d, icon: '🧡', label: 'Kesar', sub: 'Saffron and cardamom' },
    { color: 0xb8e0a0, icon: '💚', label: 'Pista', sub: 'Pistachio' },
    { color: 0xffb347, icon: '🥭', label: 'Mango', sub: 'Alphonso season, always' },
  ]);
const GOLGAPPA = () =>
  named('panipuri', [
    { icon: '🌶️', label: 'Teekha challenge', sub: 'Spicy! How many can you handle?' },
    { icon: '🍯', label: 'Meetha challenge', sub: 'Sweet and tangy, go for a record' },
    { icon: '🥟', label: 'Just one, please', sub: 'A single golgappa' },
  ]);
const REACTIONS = {
  mithai: ['So sweet! 😋', 'Wah! Ekdum fresh!', 'One more? 🤤', 'Mummy ke haath jaisa!'],
  jalebi: ['Garam garam! 🔥', 'Crispy and juicy! 😋', 'Sticky fingers! 🍯'],
  kulfi: ['Thandi thandi! 🥶', 'Brain freeze! 😵', 'Perfect! 🍦'],
  panipuri: ['Teekha! 🌶️', 'Ek aur! 😋'],
};
const LABELS = {
  mithai: 'Buy mithai 🍬',
  jalebi: () => `${slot('menu.jalebi.1')} 🥨`,
  panipuri: 'Golgappa challenge 🥟',
  kulfi: 'Buy a kulfi 🍦',
};

/** The four food stalls: choose, get served by the stall-keeper, and eat bite by bite. */
export class FoodStalls {
  constructor(ctx) {
    this.ctx = ctx;
    for (const st of ctx.world.stalls) {
      const g = st.def.goods;
      if (!LABELS[g]) continue;
      ctx.interactions.add({
        pos: st.stand,
        markAt: st.center,
        markerHeight: 2.2,
        radius: 2.6,
        label: typeof LABELS[g] === 'function' ? LABELS[g]() : LABELS[g],
        enabled: () => ctx.player.mode === 'walk',
        action: () => this.visit(st),
      });
    }
  }

  async visit(st) {
    const { ui, player } = this.ctx;
    player.setBusy(true);
    player.faceTowards(st.center.x, st.center.z);
    try {
      switch (st.def.goods) {
        case 'mithai': {
          const menu = MITHAI();
          const i = await ui.menu(st.def.name, 'Kya loge? What would you like?', menu);
          if (i !== null) await this.serveAndEat(st, foodMesh(menu[i].kind), menu[i].kind, 3, 'mithai', pick(REACTIONS.mithai));
          break;
        }
        case 'jalebi':
          await this.serveAndEat(st, foodMesh('jalebi'), 'jalebi', 4, 'jalebi', pick(REACTIONS.jalebi));
          player.buff('sugar', 20, { icon: '⚡', label: 'Sugar rush · you run faster' });
          break;
        case 'kulfi': {
          const menu = KULFI();
          const i = await ui.menu(st.def.name, 'Pick a flavour', menu);
          if (i !== null) {
            await this.serveAndEat(st, foodMesh('kulfi', menu[i].color), 'kulfi', 4, 'kulfi', pick(REACTIONS.kulfi), menu[i].color);
            player.char.setTint(0);
            player.buff('cool', 15, { icon: '❄️', label: 'Cooled down' });
          }
          break;
        }
        case 'panipuri': {
          const menu = GOLGAPPA();
          const i = await ui.menu(st.def.name, `Ready for the ${slot('game.golgappa.title')}?`, menu);
          if (i === 2) await this.serveAndEat(st, foodMesh('puri'), 'puri', 1, null, pick(REACTIONS.panipuri));
          else if (i !== null) await this.golgappa(st, i === 0 ? 'teekha' : 'meetha', menu[i].label);
          break;
        }
      }
    } finally {
      player.char.clearAction();
      player.setBusy(false);
    }
  }

  /** Keeper reaches out, the item arcs across to the player's hand. */
  async handOver(st, item, duration = 0.45) {
    const { scene, player, tasks } = this.ctx;
    const keeper = st.keeper;
    scene.add(item);
    keeper.setAction('give');
    player.char.holdR = 'hold';
    await tasks.wait(0.3);
    keeper.handR.getWorldPosition(item.position);
    const start = item.position.clone();
    await tasks.tween(duration, (k) => {
      player.char.handR.getWorldPosition(_v);
      item.position.lerpVectors(start, _v, k);
      item.position.y += Math.sin(k * Math.PI) * 0.25;
      item.rotation.y = player.heading;
    });
    keeper.clearAction();
    player.hold(item, 'food');
  }

  async serveAndEat(st, item, kind, bites, stampId, reaction, color) {
    const { player, tasks, audio, debris, ui, passport } = this.ctx;
    audio.chaChing();
    await this.handOver(st, item);
    await tasks.wait(0.2);
    player.char.setAction('eat', 0);
    const colors = color ? [color, 0xffffff] : FOOD_COLORS[kind] ?? [0xd9a441];
    for (let b = 0; b < bites; b++) {
      await tasks.tween(0.32, (k) => (player.char.actionParam = k));
      audio.crunch();
      debris.burst(item.position, { count: 6, colors, speed: 0.6, up: 0.4, size: 0.018, life: 1.2, floor: player.pos.y });
      const left = 1 - (b + 1) / bites;
      item.scale.setScalar(Math.max(0.001, Math.pow(left, 0.7)));
      if (left <= 0) item.visible = false;
      await tasks.tween(0.28, (k) => (player.char.actionParam = 1 - k));
      await tasks.wait(0.12);
    }
    player.discardHeld();
    player.char.clearAction();
    ui.bubble((o) => player.headWorld(o), reaction, 2.4);
    if (stampId) passport.stamp(stampId);
  }

  // ---------- golgappa challenge ----------

  async golgappa(st, flavour, choice) {
    const { scene, ui, player, tasks, audio, debris, passport, input } = this.ctx;
    const keeper = st.keeper;
    const keeperHead = (o) => keeper.headTop.getWorldPosition(o);
    const playerHead = (o) => player.headWorld(o);
    let best = 0;
    try {
      best = Number(localStorage.getItem('golgappaBest')) || 0;
    } catch {
      // ignore
    }
    let count = 0;
    let spice = 0;
    let misses = 0;
    const teekha = flavour === 'teekha';
    ui.gameHud.show({
      // stock: "Teekha Golgappa Challenge"; a creator's mela: their challenge name and the option picked
      title: slotSet('game.golgappa.title') || slotSet(`menu.panipuri.${teekha ? 1 : 2}`) ? `${teekha ? '🌶️' : '🍯'} ${slot('game.golgappa.title')} · ${choice}` : teekha ? '🌶️ Teekha Golgappa Challenge' : '🍯 Meetha Golgappa Challenge',
      help: tk('Press E or tap to gulp each puri before it goes soggy. Press Q to say "Bas bhaiya!"', 'Tap “Gulp!” (or anywhere) before each puri goes soggy. Tap “Bas bhaiya!” to stop.'),
      exit: false,
    });
    const stats = () => {
      ui.gameHud.stats(`Golgappas <b>${count}</b> · Misses ${misses}/3 · Best ${best}`);
      ui.gameHud.bar(Math.min(1, spice / 100), { label: 'SPICE', hot: true });
    };
    stats();
    ui.bubble(keeperHead, teekha ? slot('shout.golgappa') : 'Ek ke baad ek! 😄', 2);
    await tasks.wait(0.8);

    let reason = 'bas';
    for (;;) {
      const puri = foodMesh('puri');
      await this.handOver(st, puri, 0.28);
      const window = Math.max(0.85, 2.0 - count * 0.07);
      ui.setPrompt('Gulp!');
      ui.setPrompt2('Bas bhaiya!');
      const r = await tasks.waitFor(
        () => (input.pressedAction('interact') || input.clicks.length ? 'eat' : input.pressedAction('use') ? 'stop' : null),
        window,
        (left) => ui.gameHud.timer(left / window)
      );
      ui.setPrompt(null);
      ui.setPrompt2(null);
      ui.gameHud.timer(null);

      if (r === 'stop') {
        player.discardHeld();
        break;
      }
      if (r === 'eat') {
        player.char.setAction('eat', 0, { snappy: true });
        await tasks.tween(0.16, (k) => (player.char.actionParam = k));
        audio.slurp();
        debris.burst(puri.position, { count: 8, colors: [0x9fd18b, 0xd9a441], speed: 1.2, up: 0.8, size: 0.02, life: 0.8, floor: player.pos.y });
        player.discardHeld();
        await tasks.tween(0.16, (k) => (player.char.actionParam = 1 - k));
        player.char.clearAction();
        count++;
        spice += teekha ? rand(7, 12) : rand(2.5, 5);
        player.char.setTint(Math.min(1, spice / 100));
        if (spice > 60) {
          player.headWorld(_v);
          debris.burst(_v, { count: 6, colors: [0xffffff, 0xdddddd], speed: 0.4, up: 1.6, size: 0.05, life: 1, gravity: -1.5, floor: -10 });
        }
        if (count % 5 === 0) ui.bubble(keeperHead, pick(['Ek aur? 😏', 'Wah! Champion!', teekha ? 'Aur teekha? 🌶️' : 'Shabash!']), 1.6);
        stats();
        if (spice >= 100) {
          reason = 'spicy';
          break;
        }
      } else {
        misses++;
        player.discardHeld();
        debris.burst(puri.position, { count: 12, colors: [0xd9a441, 0x9fd18b], speed: 1.5, up: 0.5, size: 0.025, life: 1.4, floor: player.pos.y });
        audio.splash();
        ui.bubble(playerHead, 'Oops! 💦', 1.2);
        stats();
        if (misses >= 3) {
          reason = 'misses';
          break;
        }
      }
      await tasks.wait(0.25);
    }

    player.char.holdR = null;
    if (reason === 'spicy') {
      player.char.setAction('fan');
      audio.hiss(null, 2.5, { freq: 3000, level: 0.1 });
      ui.bubble(playerHead, 'Paani! Paani! 🥵🔥', 2.5);
      for (let i = 0; i < 4; i++) {
        player.headWorld(_v);
        debris.burst(_v, { count: 8, colors: [0xffffff, 0xdddddd], speed: 0.6, up: 2, size: 0.06, life: 1.2, gravity: -1.5, floor: -10 });
        await tasks.wait(0.6);
      }
      player.char.clearAction();
    }
    ui.gameHud.hide();
    const newBest = count > best;
    if (newBest) {
      try {
        localStorage.setItem('golgappaBest', String(count));
      } catch {
        // ignore
      }
    }
    if (count > 0) passport.stamp('panipuri');
    if (count > 0) this.ctx.net?.submitScore('golgappa', count);
    if (newBest && count >= 5) audio.cheer();
    const tint = Math.min(1, spice / 100);
    tasks.tween(3, (k) => player.char.setTint(tint * (1 - k)));

    const lines = { spicy: 'Too teekha! Your face went red 🥵', misses: 'Three puris went soggy 💦', bas: '"Bas bhaiya!" Wise choice 😄' };
    await ui.result({
      icon: '🥟',
      title: `${count} golgappa${count === 1 ? '' : 's'}!`,
      text: `${lines[reason]}  ${count >= 10 && slotSet('game.golgappa.prize') ? `You win ${slot('game.golgappa.prize')}! 👑  ` : ''}${newBest ? 'New personal best! 🏆' : `Your best: ${best}`}`,
      buttons: [{ label: 'Done', value: 'ok', primary: true }],
    });
  }
}
