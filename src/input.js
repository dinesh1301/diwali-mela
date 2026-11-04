import * as THREE from 'three';
import { settings } from './settings.js';

const isTyping = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

/**
 * One place for keyboard, mouse and touch. Per-frame edges (pressed keys, clicks, look deltas)
 * are cleared by endFrame() at the end of every frame. Game code asks for *actions*
 * ('interact', 'jump'…) which map to rebindable key codes in settings.
 */
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.down = new Set();
    this.pressed = new Set();
    this.look = { dx: 0, dy: 0 };
    this.wheel = 0;
    this.move = new THREE.Vector2(); // touch joystick
    this.pointer = { x: innerWidth / 2, y: innerHeight / 2, isDown: false };
    this.pointerPressed = false;
    this.pointerReleased = false;
    this.clicks = [];
    this.lookEnabled = true; // drag rotates the camera; off during aiming games
    this.blocked = false; // a modal is open
    this.lookPointer = null;
    this.joyPointer = null;
    this.joyEnabled = true; // the on-screen stick is shown (walking or driving, no modal)
    this.joyHome = null; // centre of the stick's resting place, measured lazily (and again after a resize)
    this.capture = null; // (code) => void, while rebinding a key

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (this.capture) {
        e.preventDefault();
        if (e.code !== 'Escape') this.capture(e.code);
        this.capture = null;
        return;
      }
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    // A key whose release never reaches the page stays "held" forever (the character keeps
    // running, or a stuck A cancels D). Releases go missing when focus leaves the page without a
    // clean blur: a right-click context menu, the snipping tool, an embedded frame, a hidden tab.
    const release = () => this.releaseAll();
    addEventListener('blur', release);
    addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', () => document.hidden && release());
    addEventListener('contextmenu', (e) => {
      release();
      if (e.target === dom) e.preventDefault(); // right-drag is camera, not a menu
    });
    addEventListener('focusout', (e) => {
      if (e.relatedTarget instanceof HTMLIFrameElement) release();
    });

    // iOS Safari ignores user-scalable=no: a two-finger walk + look would pinch-zoom the page
    for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

    this.joyEl = document.getElementById('joystick');
    this.knob = this.joyEl.querySelector('.knob');
    addEventListener('resize', () => (this.joyHome = null));
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e));
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaY;
      },
      { passive: false }
    );
  }

  releaseAll() {
    this.down.clear();
    this.pressed.clear();
  }

  // ---------- actions ----------

  codesFor(action) {
    const c = settings.keys[action];
    if (c === 'ShiftLeft' || c === 'ShiftRight') return ['ShiftLeft', 'ShiftRight'];
    if (c === 'ControlLeft' || c === 'ControlRight') return ['ControlLeft', 'ControlRight'];
    if (c === 'AltLeft' || c === 'AltRight') return ['AltLeft', 'AltRight'];
    return [c];
  }

  isAction(action) {
    return this.codesFor(action).some((c) => this.isDown(c));
  }

  pressedAction(action) {
    return this.codesFor(action).some((c) => this.wasPressed(c));
  }

  /** Marks an action's press as handled so nothing else reacts to it this frame. */
  consumeAction(action) {
    for (const c of this.codesFor(action)) this.pressed.delete(c);
  }

  /** The next key pressed becomes the binding for `action`. */
  rebind(action, done) {
    this.capture = (code) => {
      settings.keys[action] = code;
      settings.save();
      done?.(code);
    };
  }

  // ---------- raw keys ----------

  /** Lets on-screen buttons act like key presses. */
  press(code) {
    this.pressed.add(code);
  }

  consume(code) {
    this.pressed.delete(code);
  }

  /** Makes an on-screen button behave like a held key (or action) while it's pressed. */
  bindHold(el, codeOrAction) {
    const code = () => (codeOrAction in settings.keys ? settings.keys[codeOrAction] : codeOrAction);
    let held = null;
    const down = (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      held = code();
      if (!this.down.has(held)) this.pressed.add(held);
      this.down.add(held);
    };
    const up = () => {
      if (held) this.down.delete(held);
      held = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  isDown(code) {
    return !this.blocked && this.down.has(code);
  }

  wasPressed(code) {
    return !this.blocked && this.pressed.has(code);
  }

  // ---------- pointer ----------

  /** Shows or hides the touch stick; a hidden stick lets go of whatever thumb was on it. */
  setJoystick(on) {
    if (on === this.joyEnabled) return;
    this.joyEnabled = on;
    this.joyEl.classList.toggle('hidden', !on);
    document.body.classList.toggle('joy-off', !on); // the jump button goes with it
    if (!on && this.joyPointer !== null) this.onUp({ pointerId: this.joyPointer });
  }

  /** The stick's resting centre and radius on screen. */
  joyRest() {
    if (!this.joyHome) {
      const r = this.joyEl.getBoundingClientRect();
      if (!r.width) return null;
      this.joyHome = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    }
    return this.joyHome;
  }

  onDown(e) {
    if (this.blocked) return;
    // touch: a thumb anywhere in the lower-left quarter grabs the stick. On the stick itself it
    // pushes it straight away; elsewhere in the zone the stick jumps under the thumb (floating).
    if (e.pointerType === 'touch' && this.joyEnabled && this.joyPointer === null) {
      const home = this.joyRest();
      const near = home && Math.hypot(e.clientX - home.x, e.clientY - home.y) < home.r * 1.4;
      if (home && (near || (e.clientX < innerWidth * 0.45 && e.clientY > innerHeight * 0.4))) {
        this.joyPointer = e.pointerId;
        this.joyMax = home.r * 0.72;
        if (near) {
          this.joyOrigin = { x: home.x, y: home.y };
        } else {
          this.joyOrigin = { x: e.clientX, y: e.clientY };
          this.joyEl.style.transform = `translate(${e.clientX - home.x}px, ${e.clientY - home.y}px)`;
        }
        this.joyEl.classList.add('on');
        this.onMove(e);
        return;
      }
    }
    if (this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.last = { x: e.clientX, y: e.clientY };
      this.travel = 0;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.isDown = true;
      this.pointerPressed = true;
    }
  }

  onMove(e) {
    if (e.pointerType === 'mouse' || e.pointerId === this.lookPointer) {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
    }
    if (e.pointerId === this.joyPointer) {
      const max = this.joyMax;
      let dx = e.clientX - this.joyOrigin.x;
      let dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx *= max / len;
        dy *= max / len;
      }
      this.move.set(dx / max, dy / max);
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === this.lookPointer) {
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      this.travel += Math.abs(dx) + Math.abs(dy);
      if (this.lookEnabled) {
        const s = e.pointerType === 'touch' ? 1.5 : 1;
        this.look.dx += dx * s;
        this.look.dy += dy * s;
      }
      this.last = { x: e.clientX, y: e.clientY };
    }
  }

  onUp(e) {
    if (e.pointerId === this.joyPointer) {
      this.joyPointer = null;
      this.move.set(0, 0);
      this.knob.style.transform = '';
      this.joyEl.style.transform = '';
      this.joyEl.classList.remove('on');
    }
    if (e.pointerId === this.lookPointer) {
      if (this.travel < 8) this.clicks.push({ x: e.clientX, y: e.clientY });
      this.lookPointer = null;
      this.pointer.isDown = false;
      this.pointerReleased = true;
    }
  }

  /** Normalised device coords of the pointer, for raycasting. */
  ndc(out = new THREE.Vector2()) {
    return out.set((this.pointer.x / innerWidth) * 2 - 1, -(this.pointer.y / innerHeight) * 2 + 1);
  }

  endFrame() {
    // belt and braces: if the page isn't focused, nothing can still be held
    if (this.down.size && !document.hasFocus()) this.down.clear();
    this.pressed.clear();
    this.look.dx = this.look.dy = 0;
    this.wheel = 0;
    this.clicks.length = 0;
    this.pointerPressed = false;
    this.pointerReleased = false;
  }
}
