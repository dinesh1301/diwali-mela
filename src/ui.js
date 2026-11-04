import * as THREE from 'three';
import { STAMPS } from './passport.js';
import { settings, keyLabel, KEY_LABELS, DEFAULT_KEYS } from './settings.js';
import { TOUCH, tk } from './touch.js';

const $ = (s) => document.querySelector(s);
const _v = new THREE.Vector3();
const DIGITS = { Digit1: 'rocket', Digit2: 'anaar', Digit3: 'chakri', Digit4: 'phuljhadi' };
const fmtLap = (ms) => {
  const s = ms / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
const RANKS = [[0.3, 'Kamzor'], [0.55, 'Theek-thaak'], [0.75, 'Taakatwar'], [0.92, 'Pehelwan'], [2, 'BAHUBALI']];
const rank = (p) => RANKS.find(([max]) => p < max)[1];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createUI(h) {
  if (TOUCH) document.body.classList.add('touch');
  // the header icons' tooltips name their shortcut keys; a phone has none
  if (TOUCH) document.querySelectorAll('#hud-top button[title]').forEach((b) => (b.title = b.title.replace(/ \([A-Z]\)$/, '')));

  const intro = $('#intro');
  const toastEl = $('#toast');
  let toastTimer = 0;
  let toastLock = 0;
  let modals = 0;
  const openModal = (el) => {
    el.classList.remove('hidden');
    modals++;
    h.onModal?.(true);
  };
  const closeModal = (el) => {
    if (el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    modals = Math.max(0, modals - 1);
    if (!modals) h.onModal?.(false);
  };

  // ---------- HUD buttons ----------

  document.querySelectorAll('#actionbar button').forEach((b) =>
    b.addEventListener('click', () => {
      b.blur();
      h.onAction(b.dataset.action);
    })
  );
  document.querySelectorAll('#places button').forEach((b) =>
    b.addEventListener('click', () => {
      b.blur();
      h.onPlace(b.dataset.place);
    })
  );
  const iconBtn = (sel, fn) =>
    $(sel).addEventListener('click', (e) => {
      e.currentTarget.blur();
      fn();
    });
  iconBtn('#muteBtn', () => h.onMute());
  iconBtn('#musicBtn', () => h.onMusic());
  iconBtn('#passportBtn', () => api.openPassport());
  iconBtn('#avatarBtn', () => h.onAvatar());
  iconBtn('#boardsBtn', () => api.openBoards());
  iconBtn('#settingsBtn', () => api.openSettings());
  // push-to-talk on a phone: hold the 🎤 button to talk; a quick tap still switches the mic on or off
  let micDownAt = 0;
  let micHeldLong = false;
  if (TOUCH) {
    const mic = $('#micBtn');
    const up = () => {
      if (!micDownAt) return;
      micHeldLong = performance.now() - micDownAt > 350;
      micDownAt = 0;
      api.micHeld = false;
    };
    mic.addEventListener('pointerdown', () => {
      micDownAt = performance.now();
      micHeldLong = false;
      api.micHeld = true;
    });
    mic.addEventListener('pointerup', up);
    mic.addEventListener('pointercancel', up);
    mic.addEventListener('pointerleave', up);
  }
  iconBtn('#micBtn', () => {
    if (TOUCH && micHeldLong && settings.voice === 'ptt') return; // that was a hold to talk, not a tap
    h.onMic();
  });
  $('#prompt').addEventListener('click', () => h.onPromptTap(settings.keys.interact));
  $('#prompt2').addEventListener('click', () => h.onPromptTap(settings.keys.use));
  $('#jumpBtn').addEventListener('click', () => h.onPromptTap(settings.keys.jump));
  $('#gameExit').addEventListener('click', () => h.onGameExit());
  const vehBtns = $('#vehicleBtns');
  h.input.bindHold($('#vehUp'), 'jump');
  h.input.bindHold($('#vehDown'), 'run');
  h.input.bindHold($('#vehHorn'), 'horn');

  // ---------- touch: first-run coach card ----------

  const coachEl = $('#coach');
  let coachDone = null;
  const hideCoach = (e) => {
    e?.preventDefault();
    coachEl.classList.add('hidden');
    document.body.classList.remove('coaching');
    const done = coachDone;
    coachDone = null;
    done?.();
    try {
      localStorage.setItem('melaCoach', '1');
    } catch {
      // ignore
    }
  };
  coachEl.addEventListener('pointerdown', hideCoach);

  // ---------- wish modal ----------

  const wish = $('#wishModal');
  const wishInput = $('#wishInput');
  let wishResolve = null;
  const closeWish = (text) => {
    closeModal(wish);
    wishInput.blur();
    wishResolve?.(text);
    wishResolve = null;
  };
  $('#wishForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = wishInput.value.trim() || 'Happy Diwali!';
    wishInput.value = '';
    closeWish(text);
  });
  $('#wishCancel').addEventListener('click', () => closeWish(null));

  // ---------- menu / result ----------

  const menuEl = $('#menu');
  let menuResolve = null;
  const closeMenu = (value) => {
    closeModal(menuEl);
    menuResolve?.(value);
    menuResolve = null;
  };
  menuEl.querySelector('[data-cancel]').addEventListener('click', () => closeMenu(null));

  const resultEl = $('#result');
  let resultResolve = null;
  const closeResult = (value) => {
    closeModal(resultEl);
    resultResolve?.(value);
    resultResolve = null;
  };

  // ---------- passport, boards, settings ----------

  const passportEl = $('#passport');
  passportEl.querySelector('[data-close]').addEventListener('click', () => closeModal(passportEl));
  const boardsEl = $('#boards');
  let boardsTab = 'golgappa';
  boardsEl.querySelector('[data-close]').addEventListener('click', () => closeModal(boardsEl));
  boardsEl.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    boardsTab = b.dataset.tab;
    renderBoards();
  });
  const settingsEl = $('#settingsPanel');
  settingsEl.querySelector('[data-close]').addEventListener('click', () => closeModal(settingsEl));
  // a tap on the dimmed backdrop (outside the card) closes these too
  for (const el of [passportEl, boardsEl, settingsEl]) el.addEventListener('click', (e) => e.target === el && closeModal(el));
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
      if (e.code === 'Escape') closeWish(null);
      return;
    }
    if (!menuEl.classList.contains('hidden')) {
      const n = Number(e.key);
      const opts = menuEl.querySelectorAll('.options button');
      if (n >= 1 && n <= opts.length) closeMenu(n - 1);
      if (e.code === 'Escape') closeMenu(null);
      return;
    }
    if (!resultEl.classList.contains('hidden')) {
      if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') resultEl.querySelector('button.primary')?.click();
      return;
    }
    for (const el of [passportEl, boardsEl, settingsEl]) {
      if (!el.classList.contains('hidden')) {
        if (e.code === 'Escape' || (el === passportEl && e.code === settings.keys.passport) || (el === boardsEl && e.code === settings.keys.board)) closeModal(el);
        return;
      }
    }
    if (!intro.classList.contains('hidden') || e.repeat || modals || h.input.capture) return;
    const k = settings.keys;
    if (e.code === 'KeyM') h.onMute();
    else if (e.code === 'KeyB') h.onMusic();
    else if (e.code === k.passport) api.openPassport();
    else if (e.code === k.look) h.onAvatar();
    else if (e.code === k.board) api.openBoards();
    else if (e.code === k.photo) h.onAction('photo');
    else if (e.code === k.lantern) h.onAction('lantern');
    else if (e.code === k.show) h.onAction('show');
    else if (DIGITS[e.code]) h.onAction(DIGITS[e.code]);
  });

  // ---------- bubbles ----------

  const bubbleLayer = $('#bubbles');
  const bubbles = [];

  // ---------- game HUD ----------

  const hud = $('#gameHud');
  const crosshair = $('#crosshair');
  // HUD parts are looked up once; per-frame setters write the DOM only when a value changes, and
  // the bars move by transform (no layout) rather than width
  const hudEl = {
    title: hud.querySelector('.gh-title'),
    help: hud.querySelector('.gh-help'),
    stats: hud.querySelector('.gh-stats'),
    bar: hud.querySelector('.gh-bar'),
    timer: hud.querySelector('.gh-timer'),
  };
  hudEl.barFill = hudEl.bar.querySelector('.fill');
  hudEl.barLabel = hudEl.bar.querySelector('.label');
  hudEl.zone = hudEl.bar.querySelector('.zone');
  hudEl.timerFill = hudEl.timer.querySelector('.fill');
  for (const f of [hudEl.barFill, hudEl.timerFill]) {
    f.style.width = '100%';
    f.style.transformOrigin = '0 50%';
    f.style.transform = 'scaleX(0)';
  }
  const hudLast = { stats: null, bar: undefined, barScale: -1, hot: null, label: null, zone: undefined, timer: undefined, timerScale: -1 };
  const prompts = {};
  const promptRef = (id) =>
    (prompts[id] ??= (() => {
      const el = $(id);
      return { el, span: el.querySelector('span'), kbd: el.querySelector('kbd'), text: undefined, key: undefined };
    })());
  const writePrompt = (id, text, code) => {
    const p = promptRef(id);
    if (text === p.text && (!text || code === p.key)) return;
    if (!text !== !p.text) p.el.classList.toggle('hidden', !text);
    p.text = text;
    if (text) {
      p.span.textContent = text;
      p.kbd.textContent = keyLabel(code);
      p.key = code;
    }
  };

  const renderBoards = () => {
    const boards = h.boards?.() ?? {};
    const wishes = h.wishes?.() ?? [];
    boardsEl.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === boardsTab));
    const body = boardsEl.querySelector('.board-body');
    if (boardsTab === 'wishes') {
      body.innerHTML = wishes.length
        ? `<ol class="wishlist">${[...wishes].reverse().slice(0, 30).map((w) => `<li>“${esc(w.text)}” <small>— ${esc(w.handle ? '@' + w.handle : w.name || 'a visitor')}</small></li>`).join('')}</ol>`
        : '<p class="muted">No wishes yet tonight. Release a lantern at the ghat!</p>';
      return;
    }
    const fmt = { golgappa: (v) => `${v} golgappas`, lap: (v) => fmtLap(v), striker: (v) => rank(v) }[boardsTab];
    const list = boards[boardsTab] ?? [];
    body.innerHTML = list.length
      ? `<ol class="ranklist">${list.slice(0, 20).map((e, i) => `<li class="${e.local ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="who">${esc(e.handle ? '@' + e.handle : e.name || 'Visitor')}</span><span class="val">${fmt(e.value)}</span></li>`).join('')}</ol>`
      : '<p class="muted">Nobody yet. Be the first!</p>';
  };

  const api = {
    get modalOpen() {
      return modals > 0 || !intro.classList.contains('hidden');
    },

    open(el) {
      openModal(el);
    },

    close(el) {
      closeModal(el);
    },

    toast(text, ms = 2800, { important = false } = {}) {
      const now = performance.now();
      if (!important && now < toastLock) return;
      if (important) toastLock = now + ms;
      toastEl.textContent = text;
      toastEl.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
    },

    stampToast(stamp, n, total) {
      const el = $('#stampToast');
      el.innerHTML = `<span class="st-icon">${stamp.icon}</span><div><small>New passport stamp · ${n}/${total}</small><b>${stamp.name}</b></div>`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), 3200);
    },

    setPrompt(text) {
      writePrompt('#prompt', text, settings.keys.interact);
    },

    setPrompt2(text) {
      writePrompt('#prompt2', text, settings.keys.use);
    },

    /**
     * lines: [[keysOrActions, label]]; action names are shown as their bound keys. A `{ key, tap }`
     * pair picks the touch lines on a phone, where the first item is an icon rather than keys.
     */
    setHelp(lines) {
      if (!Array.isArray(lines)) lines = TOUCH ? lines.tap : lines.key;
      const el = $('#ctxHelp');
      el.innerHTML = TOUCH
        ? lines.map(([icon, label]) => `<div><i>${icon}</i><span>${label}</span></div>`).join('')
        : lines
            .map(([k, label]) => `<div>${k.split(' ').map((x) => `<kbd>${x in settings.keys ? keyLabel(settings.keys[x]) : x}</kbd>`).join('')}<span>${label}</span></div>`)
            .join('');
      el.classList.toggle('empty', !lines.length);
    },

    /**
     * Touch: the first time someone plays on a phone, a card shows where the controls are. Returns
     * true when it is showing; `onDone` then runs once it is tapped away (toasts wait behind it).
     */
    showCoach(onDone) {
      if (!TOUCH) return false;
      try {
        if (localStorage.getItem('melaCoach')) return false;
      } catch {
        // no storage: show it anyway, it goes away on a tap
      }
      coachEl.classList.remove('hidden');
      document.body.classList.add('coaching');
      coachDone = onDone || null;
      return true;
    },

    get coachOpen() {
      return !coachEl.classList.contains('hidden');
    },

    micHeld: false,

    setMuted(m) {
      $('#muteBtn').textContent = m ? '🔇' : '🔊';
    },

    setMusic(on) {
      $('#musicBtn').classList.toggle('off', !on);
      $('#musicBtn').title = tk(on ? 'Music on (B)' : 'Music off (B)', on ? 'Music on' : 'Music off');
    },

    setMic(live, talking) {
      const b = $('#micBtn');
      b.classList.toggle('live', live);
      b.classList.toggle('talking', live && talking);
      const k = keyLabel(settings.keys.talk);
      b.title = live
        ? tk(`Mic on · ${k} to switch off`, settings.voice === 'ptt' ? 'Mic on · hold to talk, tap to switch off' : 'Mic on · tap to switch off')
        : tk(`Voice chat · ${k} to switch on`, 'Voice chat · tap to switch on');
    },

    /** Small status chips under the header: online count, Ravan countdown, buffs. */
    setChip(id, text) {
      let el = $(`#chips [data-chip="${id}"]`);
      if (!text) {
        el?.remove();
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = 'chip';
        el.dataset.chip = id;
        $('#chips').appendChild(el);
      }
      if (el.textContent !== text) el.textContent = text;
    },

    /** Touch buttons for whatever you're driving or flying (the stick steers); null hides them. */
    setVehicleButtons(kind) {
      vehBtns.classList.toggle('hidden', !kind);
      document.body.classList.toggle('veh-ui', !!kind);
      $('#jumpBtn').classList.toggle('veh-hidden', !!kind);
      // [up icon, up label, down icon, down label]
      const labels = { car: ['✋', 'Drift', '', ''], heli: ['▲', 'Up', '▼', 'Down'], plane: ['▲', 'Pull up', '▼', 'Dive'] }[kind] ?? ['▲', 'Up', '▼', 'Down'];
      $('#vehUp').innerHTML = `<b>${labels[0]}</b><small>${labels[1]}</small>`;
      $('#vehDown').classList.toggle('hidden', !labels[2]);
      $('#vehDown').innerHTML = `<b>${labels[2]}</b><small>${labels[3]}</small>`;
      $('#vehHorn').classList.toggle('hidden', kind !== 'car');
    },

    askWish() {
      openModal(wish);
      setTimeout(() => wishInput.focus(), 30);
      return new Promise((r) => (wishResolve = r));
    },

    /** Shows a choice panel; resolves with the chosen index or null. Keys 1–n pick too. */
    menu(title, sub, options) {
      menuEl.querySelector('h2').textContent = title;
      menuEl.querySelector('p').textContent = sub;
      const box = menuEl.querySelector('.options');
      box.innerHTML = '';
      options.forEach((o, i) => {
        const b = document.createElement('button');
        b.innerHTML = `<span class="o-icon">${o.icon}</span><span class="o-label">${o.label}</span>${o.sub ? `<span class="o-sub">${o.sub}</span>` : ''}<kbd>${i + 1}</kbd>`;
        b.addEventListener('click', () => closeMenu(i));
        box.appendChild(b);
      });
      openModal(menuEl);
      return new Promise((r) => (menuResolve = r));
    },

    result({ icon, title, text, buttons = [{ label: 'OK', value: 'ok', primary: true }] }) {
      resultEl.querySelector('.big').textContent = icon;
      resultEl.querySelector('h2').textContent = title;
      resultEl.querySelector('p').textContent = text;
      const row = resultEl.querySelector('.row');
      row.innerHTML = '';
      buttons.forEach((b) => {
        const el = document.createElement('button');
        el.className = b.primary ? 'primary small' : 'ghost';
        el.textContent = b.label;
        el.addEventListener('click', () => closeResult(b.value));
        row.appendChild(el);
      });
      openModal(resultEl);
      return new Promise((r) => (resultResolve = r));
    },

    openPassport() {
      const done = h.passportDone();
      passportEl.querySelector('.pp-progress').textContent = `${done.size} of ${STAMPS.length} stamps collected`;
      passportEl.querySelector('.stamps').innerHTML = STAMPS.map(
        (s) => `<div class="stamp ${done.has(s.id) ? 'done' : ''}"><span>${s.icon}</span><small>${s.name}</small></div>`
      ).join('');
      openModal(passportEl);
    },

    openBoards() {
      renderBoards();
      const n = h.online?.() ?? 1;
      boardsEl.querySelector('.online').textContent = n > 1 ? `👥 ${n} at the mela right now` : 'Scores and wishes are shared with everyone when the mela server is running.';
      openModal(boardsEl);
    },

    refreshBoards() {
      if (!boardsEl.classList.contains('hidden')) renderBoards();
    },

    openSettings() {
      const box = settingsEl.querySelector('.settings-body');
      const keysHtml = Object.keys(DEFAULT_KEYS)
        .map((a) => `<div class="keyrow"><span>${KEY_LABELS[a]}</span><button type="button" class="keybtn" data-action="${a}">${keyLabel(settings.keys[a])}</button></div>`)
        .join('');
      box.innerHTML = `
        <label class="srow"><span>Graphics</span>
          <select data-set="quality"><option value="auto">Auto (${settings.detected})</option><option value="high">High · shadows & reflections</option><option value="low">Low · phones</option></select></label>
        <label class="srow"><span>Music</span>
          <select data-set="music"><option value="song">Diwali song</option><option value="band">Mela band (royalty-free)</option></select></label>
        <label class="srow check"><input type="checkbox" data-set="reduceMotion" /><span>Reduce motion (gentler camera and rides)</span></label>
        <label class="srow"><span>Voice chat</span>
          <select data-set="voice"><option value="open">Open mic (voice activated)</option><option value="ptt">${tk('Push to talk (hold the Talk key)', 'Push to talk (hold the 🎤 button)')}</option></select></label>
        <label class="srow"><span>Voice volume</span><input type="range" min="0" max="1" step="0.05" data-set="voiceVolume" /></label>
        <div class="keys desktop-only"><div class="keys-title">Key bindings <button type="button" class="ghost tiny" data-resetkeys>Reset</button></div>${keysHtml}
          <p class="muted small">Movement is W A S D or the arrow keys. Click a key to change it, then press the new key.</p></div>
        <p class="srow-note muted small" data-note></p>`;
      box.querySelector('[data-set="quality"]').value = settings.quality;
      box.querySelector('[data-set="music"]').value = settings.music;
      box.querySelector('[data-set="reduceMotion"]').checked = settings.reduceMotion;
      box.querySelector('[data-set="voice"]').value = settings.voice;
      box.querySelector('[data-set="voiceVolume"]').value = settings.voiceVolume;
      box.querySelectorAll('[data-set]').forEach((el) =>
        el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
          const key = el.dataset.set;
          settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
          settings.save();
          const note = h.onSettings?.(key);
          box.querySelector('[data-note]').textContent = note || '';
        })
      );
      box.querySelectorAll('.keybtn').forEach((b) =>
        b.addEventListener('click', () => {
          b.textContent = 'press a key…';
          b.classList.add('waiting');
          h.input.rebind(b.dataset.action, (code) => {
            b.textContent = keyLabel(code);
            b.classList.remove('waiting');
            h.onSettings?.('keys');
          });
        })
      );
      box.querySelector('[data-resetkeys]').addEventListener('click', () => {
        settings.resetKeys();
        h.onSettings?.('keys');
        closeModal(settingsEl);
        api.openSettings();
      });
      openModal(settingsEl);
    },

    bubble(getPos, text, seconds = 2.5) {
      const el = document.createElement('div');
      el.className = 'bubble';
      el.textContent = text;
      bubbleLayer.appendChild(el);
      bubbles.push({ el, getPos, until: performance.now() + seconds * 1000 });
    },

    updateBubbles(camera) {
      const now = performance.now();
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        if (now > b.until) {
          b.el.remove();
          bubbles.splice(i, 1);
          continue;
        }
        b.getPos(_v);
        _v.y += 0.35;
        _v.project(camera);
        const visible = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
        b.el.style.display = visible ? '' : 'none';
        b.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * innerWidth}px, ${(-_v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
        b.el.style.opacity = Math.min(1, (b.until - now) / 300);
      }
    },

    gameHud: {
      show({ title, help, exit = true }) {
        hud.classList.remove('hidden');
        hudEl.title.textContent = title;
        hudEl.help.textContent = help;
        api.gameHud.stats('');
        $('#gameExit').classList.toggle('hidden', !exit);
        // a booth game (one you can leave): phones clear the nav and the fireworks bar out of its way
        document.body.classList.toggle('in-booth', exit);
        api.gameHud.bar(null);
        api.gameHud.timer(null);
      },
      stats(html) {
        if (html === hudLast.stats) return;
        hudLast.stats = html;
        hudEl.stats.innerHTML = html;
      },
      bar(value, { label = '', zone = null, hot = false } = {}) {
        const el = hudEl.bar;
        if ((value === null) !== (hudLast.bar === null)) el.classList.toggle('hidden', value === null);
        hudLast.bar = value;
        if (value === null) return;
        if (hot !== hudLast.hot) el.classList.toggle('hot', (hudLast.hot = hot));
        const sc = Math.round(value * 100) / 100;
        if (sc !== hudLast.barScale) hudEl.barFill.style.transform = `scaleX(${(hudLast.barScale = sc)})`;
        if (label !== hudLast.label) hudEl.barLabel.textContent = hudLast.label = label;
        const zk = zone ? `${zone[0]},${zone[1]}` : '';
        if (zk !== hudLast.zone) {
          hudLast.zone = zk;
          const z = hudEl.zone;
          z.style.display = zone ? '' : 'none';
          if (zone) {
            z.style.left = `${zone[0] * 100}%`;
            z.style.width = `${(zone[1] - zone[0]) * 100}%`;
          }
        }
      },
      timer(value) {
        const el = hudEl.timer;
        if ((value === null) !== (hudLast.timer === null)) el.classList.toggle('hidden', value === null);
        hudLast.timer = value;
        if (value === null) return;
        const sc = Math.round(Math.max(0, value) * 1000) / 1000;
        if (sc !== hudLast.timerScale) hudEl.timerFill.style.transform = `scaleX(${(hudLast.timerScale = sc)})`;
      },
      hide() {
        hud.classList.add('hidden');
        document.body.classList.remove('in-booth');
      },
    },

    crosshair(x, y) {
      crosshair.classList.toggle('hidden', x === null);
      if (x !== null) crosshair.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    },
  };

  return api;
}
