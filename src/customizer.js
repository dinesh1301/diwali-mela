import * as THREE from 'three';
import { Character, LOOK_OPTIONS, randomPlayerLook, resolveLook } from './character.js';

const HER_STYLES = new Set(['saree', 'lehenga', 'salwar', 'long']);
import { profile, normalizeHandle } from './profile.js';
import { pick } from './utils.js';
import { settings } from './settings.js';
import { track } from './track.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const $ = (s) => document.querySelector(s);

/*
  Among Us-style avatar editor: a live, spinning 3D preview on one side, palettes and toggles on
  the other, plus the visitor's name (required) and Topmate username (optional). Used for the
  intro and again from the HUD (👤) to change your look later.
*/
export class Customizer {
  constructor(cb) {
    this.cb = cb;
    this.el = $('#intro');
    this.mode = 'intro';
    this.look = { ...randomPlayerLook(), ...(profile.look || {}) };
    profile.look = this.look;
    this.nameEl = $('#custName');
    this.handleEl = $('#custHandle');
    this.statusEl = $('#custStatus');
    this.errorEl = $('#custError');
    this.enterBtn = $('#custEnter');

    this.setupPreview();
    this.buildControls();
    this.nameEl.value = profile.name;
    this.handleEl.value = profile.handle;
    this.nameEl.addEventListener('input', () => this.errorEl.classList.add('hidden'));
    this.handleEl.addEventListener('input', () => this.lookupSoon());
    this.handleEl.addEventListener('blur', () => this.lookup());
    $('#custRandom').addEventListener('click', () => this.randomize());
    this.enterBtn.addEventListener('click', () => this.submit());
    $('#custForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    $('#custClose').addEventListener('click', () => this.close());
    if (profile.handle) this.lookup();
  }

  // ---------- 3D preview ----------

  setupPreview() {
    this.canvas = $('#custPreview');
    // a second WebGL context next to the mela: a small canvas, so 1.5x is plenty; phones skip MSAA
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: settings.tier !== 'low' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.05, 3.6);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff0d0, 0x3a2030, 1.3));
    const key = new THREE.DirectionalLight(0xffe0b0, 2.4);
    key.position.set(2, 3, 3);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xff8a3c, 18, 8, 2);
    rim.position.set(-1.5, 1.8, -1.5);
    this.scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: 0x5a1f3a, transparent: true, opacity: 0.55 }));
    disc.rotation.x = -Math.PI / 2;
    this.scene.add(disc);
    this.stage = new THREE.Group();
    this.scene.add(this.stage);
    this.char = new Character(this.look, { ownMaterial: true });
    this.stage.add(this.char.root);
    this.spin = 0.35;
    this.dragging = null;
    this.idleTimer = 2.5;

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, id: e.pointerId };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      this.spin += (e.clientX - this.dragging.x) * 0.012;
      this.dragging.x = e.clientX;
    });
    const end = () => (this.dragging = null);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    // the stage's size follows the layout (portrait, landscape, phone toolbars), not just the window
    if (window.ResizeObserver) new ResizeObserver(() => this.fit()).observe(this.canvas);
    else addEventListener('resize', () => this.fit());
  }

  fit() {
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  loop = (now) => {
    if (this.el.classList.contains('hidden')) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    if (!this.dragging) this.spin += dt * 0.35;
    this.stage.rotation.y = this.spin;
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      this.idleTimer = 4 + Math.random() * 4;
      this.char.setAction(pick(['wave', 'namaste', 'cheer']));
      setTimeout(() => this.char.clearAction(), 1700);
    }
    this.char.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** A square head-and-shoulders render of the current look (used on the poster). */
  portrait() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    r.setPixelRatio(1);
    r.setSize(512, 512, false);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    cam.position.set(0, 1.52, 1.55);
    cam.lookAt(0, 1.42, 0);
    const rot = this.stage.rotation.y;
    this.stage.rotation.y = 0.15;
    r.render(this.scene, cam);
    const url = this.canvas.toDataURL('image/png');
    this.stage.rotation.y = rot;
    r.setPixelRatio(pr);
    r.setSize(size.x || 320, size.y || 400, false);
    return url;
  }

  // ---------- controls ----------

  buildControls() {
    const sw = (field, colors) => {
      const box = $(`.swatches[data-field="${field}"]`);
      box.innerHTML = colors.map((c) => `<button type="button" class="sw" data-v="${c}" style="--c:${hex(c)}" title="${hex(c)}"></button>`).join('');
      box.addEventListener('click', (e) => {
        const b = e.target.closest('.sw');
        if (b) this.apply({ [field]: Number(b.dataset.v) });
      });
    };
    sw('top', LOOK_OPTIONS.top);
    sw('skin', LOOK_OPTIONS.skin);
    sw('bottom', LOOK_OPTIONS.bottom);
    sw('accent', LOOK_OPTIONS.accent);
    const chips = (field, options) => {
      const box = $(`.chips[data-field="${field}"]`);
      box.innerHTML = options.map((o) => `<button type="button" class="chip" data-v="${o.id}"><span>${o.icon}</span>${o.label}</button>`).join('');
      box.addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        const v = b.dataset.v;
        if (field === 'extras') this.toggleExtra(v);
        else this.apply({ [field]: v });
      });
    };
    chips('body', LOOK_OPTIONS.body);
    chips('style', LOOK_OPTIONS.style);
    chips('hairStyle', LOOK_OPTIONS.hairStyle);
    chips('extras', LOOK_OPTIONS.extras);
    this.sync();
  }

  toggleExtra(id) {
    const L = this.look;
    if (id === 'dupatta' || id === 'bangles') this.apply({ [id]: L[id] ? null : L.accent });
    // a beard goes off -> dark -> grey -> off
    else if (id === 'beard') this.apply({ beard: !L.beard ? 'dark' : L.beard === 'grey' ? false : 'grey' });
    else this.apply({ [id]: !L[id] });
  }

  apply(partial) {
    const L = this.look;
    this.changes = (this.changes ?? 0) + 1;
    for (const k in partial) (this.fields ??= new Set()).add(k);
    const was = resolveLook(L).fem ? 'f' : 'm';
    Object.assign(L, partial);
    // the outfit decides the build (a saree, lehenga, salwar or anarkali is hers, a sherwani his;
    // a kurta or casual keeps the build there was); Him / Her is the explicit override, and swaps
    // an outfit that body does not wear
    if ('style' in partial) L.body = HER_STYLES.has(L.style) ? 'f' : L.style === 'sherwani' ? 'm' : was;
    else if ('hairStyle' in partial && !L.body) L.body = was;
    if ('body' in partial) {
      if (L.body === 'm' && HER_STYLES.has(L.style)) L.style = 'kurta';
      if (L.body === 'f' && L.style === 'sherwani') L.style = 'salwar';
      if (L.body === 'f') L.moustache = L.beard = false;
    }
    if ('accent' in partial) {
      L.turban = L.accent;
      if (L.dupatta) L.dupatta = L.accent;
      if (L.bangles) L.bangles = L.accent;
    }
    this.char.setLook(L);
    this.cb.onApply?.(L);
    this.sync();
  }

  sync() {
    const L = this.look;
    document.querySelectorAll('.swatches').forEach((box) => {
      const v = L[box.dataset.field];
      box.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v));
    });
    document.querySelectorAll('.chips').forEach((box) => {
      const f = box.dataset.field;
      box.querySelectorAll('.chip').forEach((b) => {
        const v = b.dataset.v;
        const cur = f === 'body' ? (resolveLook(L).fem ? 'f' : 'm') : f === 'style' ? resolveLook(L).style : L[f];
        b.classList.toggle('on', f === 'extras' ? !!L[v] : cur === v);
        if (f === 'extras' && v === 'beard') b.lastChild.textContent = L.beard === 'grey' ? 'Grey beard' : 'Beard';
      });
    });
  }

  randomize() {
    this.look = randomPlayerLook();
    profile.look = this.look;
    this.apply({});
    this.idleTimer = 0;
  }

  // ---------- name & Topmate ----------

  lookupSoon() {
    clearTimeout(this.lookupT);
    this.lookupT = setTimeout(() => this.lookup(), 650);
  }

  async lookup() {
    const h = normalizeHandle(this.handleEl.value);
    if (!h) {
      this.statusEl.textContent = '';
      this.statusEl.className = 'cust-status';
      return;
    }
    this.statusEl.textContent = 'Checking Topmate…';
    this.statusEl.className = 'cust-status';
    const data = await profile.fetchTopmate(h);
    if (normalizeHandle(this.handleEl.value) !== h) return;
    if (data?.found) {
      this.statusEl.innerHTML = `✓ <b>${data.name}</b>${data.headline ? ` · ${data.headline}` : ''}`;
      this.statusEl.className = 'cust-status ok';
      if (!this.nameEl.value.trim()) this.nameEl.value = data.name.slice(0, 24);
    } else {
      this.statusEl.textContent = 'Not found on Topmate — you can still enter without it';
      this.statusEl.className = 'cust-status warn';
    }
  }

  submit() {
    // the Enter button's click and the form's submit both land here: only the first one counts
    if (this.el.classList.contains('hidden')) return;
    const name = this.nameEl.value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) {
      this.errorEl.textContent = 'Please tell us your name so other visitors know who you are';
      this.errorEl.classList.remove('hidden');
      this.nameEl.classList.remove('shake');
      void this.nameEl.offsetWidth;
      this.nameEl.classList.add('shake');
      this.nameEl.focus();
      return;
    }
    profile.name = name.slice(0, 24);
    profile.handle = normalizeHandle(this.handleEl.value);
    profile.look = this.look;
    profile.save();
    if (profile.handle) profile.fetchTopmate();
    const mode = this.mode;
    const r = resolveLook(this.look);
    track('customize', { action: 'done', mode, changes: this.changes ?? 0, fields: [...(this.fields ?? [])], style: r.style, body: r.fem ? 'f' : 'm', name: profile.name, handle: profile.handle, topmate: !!profile.topmate?.found });
    this.changes = 0;
    this.fields = null;
    this.close();
    if (mode === 'intro') this.cb.onEnter?.();
    else this.cb.onDone?.();
  }

  open(mode = 'intro') {
    this.mode = mode;
    this.el.classList.toggle('edit', mode === 'edit');
    this.enterBtn.textContent = mode === 'intro' ? 'Enter the Mela' : 'Done';
    this.errorEl.classList.add('hidden');
    this.el.classList.remove('hidden');
    this.fit();
    this.last = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    this.cb.onOpen?.();
    if (!matchMedia('(pointer: coarse)').matches && !this.nameEl.value) setTimeout(() => this.nameEl.focus(), 50);
  }

  close() {
    this.el.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.nameEl.blur();
    this.handleEl.blur();
    this.cb.onClose?.();
  }
}
