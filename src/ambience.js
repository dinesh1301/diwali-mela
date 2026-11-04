import * as THREE from 'three';
import { rand, pick } from './utils.js';
import { rampTo } from './audio.js';

/*
  Positional ambience, all synthesised: dhol at the gate, the jalebi kadhai sizzling, water
  lapping at the ghat, the giant wheel's hum, a generator chugging behind the stalls, temple
  bells and far-off crackers. Each source has a gain that follows the listener's distance; a
  source out of earshot is unplugged from the master bus, so the browser stops computing it.
  Also hosts the "mela band": a royalty-free dhol-and-drone loop that can replace the song; its
  nodes are only built the first time the band is chosen.
*/
const UNPLUG_S = 1.5; // silent this long (after the fade) before a source is disconnected
const _off = new THREE.Vector3();
const _v = new THREE.Vector3();
const PATTERN = ['BT', '', 'T', 'B', 'BT', '', 'T', 'T']; // dha . ta dhin dha . ta ta
const BPM = 112;

export class Ambience {
  constructor(audio) {
    this.audio = audio;
    this.sources = [];
    this.started = false;
    this.bandOn = false;
    this.oneShots = [];
  }

  start() {
    const { ctx, master } = this.audio;
    if (!ctx || this.started) return;
    this.started = true;
    const gainTo = (dest) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(dest);
      return g;
    };
    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.audio.noise;
      s.loop = true;
      s.start(0, Math.random());
      return s;
    };
    const filtered = (type, freq, q = 1) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const add = (this.addSource = (name, x, z, r0, r1, level, build) => {
      const out = gainTo(master);
      const src = { name, pos: new THREE.Vector3(x, 0, z), r0, r1, level, out, tick: build(out), plugged: true, quietFor: 0 };
      this.sources.push(src);
      return src;
    });

    // the kadhai at Jalebi Junction
    add('sizzle', -9.2, 37, 2, 11, 0.22, (out) => {
      const g = ctx.createGain();
      g.gain.value = 1;
      noise().connect(filtered('bandpass', 3400, 0.6)).connect(g).connect(out);
      return (dt, t) => (g.gain.value = 0.7 + 0.3 * Math.sin(t * 2.3) * Math.sin(t * 5.1));
    });
    // water against the ghat steps
    add('lapping', 0, -47, 8, 34, 0.32, (out) => {
      const g = ctx.createGain();
      noise().connect(filtered('lowpass', 520, 0.7)).connect(g).connect(out);
      return (dt, t) => (g.gain.value = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 1.6), 2) * (0.7 + 0.3 * Math.sin(t * 0.37)));
    });
    // the giant wheel's motor
    add('hum', -34, -26, 9, 32, 0.1, (out) => {
      const lp = filtered('lowpass', 320, 1.2);
      for (const f of [55, 110.3]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        o.start();
      }
      const g = ctx.createGain();
      lp.connect(g).connect(out);
      return (dt, t) => (g.gain.value = 0.8 + 0.2 * Math.sin(t * 3.1));
    });
    // a generator chugging behind the stalls
    add('generator', 12.6, 37, 2, 9, 0.09, (out) => {
      const g = ctx.createGain();
      noise().connect(filtered('lowpass', 180, 2)).connect(g).connect(out);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 23;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      o.connect(og).connect(g.gain);
      o.start();
      return () => {};
    });
    // the dhol party at the gate (a scheduled pattern)
    this.dhol = add('dhol', 0, 60, 7, 48, 0.55, (out) => this.makeDhol(out, 1));

    this.setBand(this.bandOn);

    this.nextBell = 8;
    this.nextCracker = 6;
  }

  /** A dhol pattern scheduled a little ahead of the clock. `withTin` adds a brighter tabla-ish voice. */
  makeDhol(out, level, withTin = false) {
    const { ctx } = this.audio;
    const step = 60 / BPM / 2;
    let next = ctx.currentTime + 0.1;
    let i = 0;
    const bass = (t) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(82, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9 * level, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    };
    const treble = (t, hi) => {
      const s = ctx.createBufferSource();
      s.buffer = this.audio.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = hi ? 3800 : 2100;
      f.Q.value = 2.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((hi ? 0.35 : 0.5) * level, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (hi ? 0.05 : 0.08));
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random());
      s.stop(t + 0.12);
    };
    // silent: keep the beat moving (so it comes back in time) without building any nodes
    return (dt, t, silent = false) => {
      while (next < ctx.currentTime + 0.35) {
        const p = PATTERN[i % 8];
        if (!silent) {
          if (p.includes('B')) bass(next);
          if (p.includes('T')) treble(next, false);
          if (withTin && i % 16 === 14) treble(next, true);
        }
        next += step;
        i++;
      }
    };
  }

  /** A tanpura-ish drone under the band. */
  makeDrone(out) {
    const { ctx } = this.audio;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.09;
    for (const f of [110, 110.6, 164.8, 220.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f > 200 ? 0.35 : 1;
      o.connect(og).connect(lp);
      o.start();
    }
    lp.connect(g).connect(out);
  }

  setBand(on) {
    this.bandOn = on;
    const { ctx, master } = this.audio;
    if (!this.started) return;
    if (on && !this.band) {
      // the band: not positional, replaces the song when chosen
      this.band = ctx.createGain();
      this.band.gain.value = 0;
      this.band.connect(master);
      this.bandDhol = this.makeDhol(this.band, 0.7, true);
      this.makeDrone(this.band);
    }
    if (!this.band) return;
    if (on) this.band.connect(master);
    this.band.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.5);
    clearTimeout(this.bandOff);
    // once faded out, unplug the drone so its oscillators stop costing anything
    if (!on) this.bandOff = setTimeout(() => !this.bandOn && this.band.disconnect(), 3000);
  }

  update(dt, t, listener) {
    if (!this.started) return;
    const { audio } = this;
    const now = audio.ctx.currentTime;
    for (const s of this.sources) {
      const d = _v.copy(listener).setY(0).distanceTo(s.pos);
      const k = Math.min(1, Math.max(0, 1 - (d - s.r0) / (s.r1 - s.r0)));
      const target = k * k * s.level;
      const heard = target > 0.001;
      s.quietFor = heard ? 0 : s.quietFor + dt;
      if (heard && !s.plugged) {
        s.out.connect(audio.master);
        s.plugged = true;
      }
      rampTo(s.out.gain, heard ? target : 0, now, 0.25, 0.002);
      if (s.plugged && s.quietFor > UNPLUG_S) {
        s.out.disconnect();
        s.plugged = false;
      }
      if (heard || s.quietFor < 1) s.tick(dt, t);
      else if (s.name === 'dhol') s.tick(dt, t, true);
    }
    if (this.bandOn) this.bandDhol();

    this.nextBell -= dt;
    if (this.nextBell <= 0) {
      this.nextBell = rand(14, 26);
      audio.templeBell(_v.set(-18, 2, -37));
    }
    this.nextCracker -= dt;
    if (this.nextCracker <= 0) {
      this.nextCracker = rand(5, 13);
      const a = rand(0, Math.PI * 2);
      const r = rand(70, 150);
      const p = _v.copy(listener).add(_off.set(Math.cos(a) * r, 0, Math.sin(a) * r));
      if (Math.random() < 0.5) audio.crackle(p, 10, 0.6);
      else audio.boom(p, pick([0.25, 0.35, 0.5]));
    }
  }
}
