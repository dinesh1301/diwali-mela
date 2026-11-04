import * as THREE from 'three';
import { rand } from './utils.js';

const MUSIC_URL = `${import.meta.env.BASE_URL}audio/diwali-song.m4a`; // AAC 72 kbps (2.5 MB)
const MUSIC_LEVEL = 0.32;

/**
 * Background song plus synthesised effects (no other audio files). Effects are attenuated and
 * delayed by distance, so far-off bursts boom a moment after the flash.
 */
export class MelaAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.listener = new THREE.Vector3();
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startCrowd();
    this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  // ---------- background song ----------

  startMusic() {
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.songPlaying ? MUSIC_LEVEL : 0;
    this.musicGain.connect(this.master);
    if (this.songPlaying) this.songElement().play().catch(() => {});
  }

  /** The song is only downloaded once it is first played (band mode never fetches it). */
  songElement() {
    if (!this.music) {
      this.music = new Audio(MUSIC_URL);
      this.music.loop = true;
      this.ctx.createMediaElementSource(this.music).connect(this.musicGain);
    }
    return this.music;
  }

  /** The song plays only when music is on AND the mode is 'song' (the band is synthesised elsewhere). */
  get songPlaying() {
    return this.musicOn && (this.mode ?? 'song') === 'song';
  }

  setMusic(on) {
    this.musicOn = on;
    this.applySong();
  }

  setMode(mode) {
    this.mode = mode;
    this.applySong();
  }

  applySong() {
    if (!this.musicGain) return;
    const on = this.songPlaying;
    this.musicGain.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, this.ctx.currentTime, 0.2);
    if (on) this.songElement().play().catch(() => {});
    else if (this.music) setTimeout(() => !this.songPlaying && this.music.pause(), 600);
  }

  /** Lowers the song briefly so a moment (a win, a bell) can be heard. */
  duck(seconds = 2) {
    if (!this.musicGain || !this.songPlaying) return;
    const g = this.musicGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(MUSIC_LEVEL * 0.35, t, 0.08);
    g.setTargetAtTime(MUSIC_LEVEL, t + seconds, 0.4);
  }

  // ---------- building blocks ----------

  spatial(pos) {
    const d = pos ? this.listener.distanceTo(pos) : 0;
    return { gain: Math.min(1, 18 / (d + 6)), delay: d / 343 };
  }

  noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  envelope(t, peak, attack, release) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return g;
  }

  tone(freq, dur, { type = 'sine', level = 0.2, at = 0, to = null, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    osc.connect(this.envelope(t, level, attack, dur)).connect(this.master);
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
  }

  noiseHit({ at = 0, type = 'bandpass', freq = 1000, to = null, q = 1, level = 0.2, dur = 0.1, attack = 0.003 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at;
    const src = this.noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    src.connect(f).connect(this.envelope(t, level, attack, dur)).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + attack + dur + 0.05);
  }

  // ---------- fireworks ----------

  boom(pos, size = 1) {
    if (!this.ctx) return;
    const { gain, delay } = this.spatial(pos);
    const t = this.ctx.currentTime + delay;
    const src = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    src.connect(lp).connect(this.envelope(t, 0.9 * gain * size, 0.01, 1.6)).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 1.8);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    osc.connect(this.envelope(t, 0.8 * gain * size, 0.005, 0.5)).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  crackle(pos, count = 24, spread = 0.9, startDelay = 0) {
    if (!this.ctx) return;
    const { gain, delay } = this.spatial(pos);
    for (let i = 0; i < count; i++) {
      this.noiseHit({ at: delay + startDelay + Math.random() * spread, type: 'highpass', freq: 2500, level: 0.35 * gain, dur: 0.03 });
    }
  }

  whistle(pos) {
    if (!this.ctx) return;
    const { gain, delay } = this.spatial(pos);
    this.tone(2600, 1.4, { type: 'triangle', level: 0.04 * gain, at: delay, to: 900, attack: 0.05 });
    this.noiseHit({ at: delay, freq: 4000, level: 0.06 * gain, dur: 1.2, attack: 0.05 });
  }

  hiss(pos, duration, { freq = 3500, level = 0.15 } = {}) {
    if (!this.ctx) return;
    const { gain, delay } = this.spatial(pos);
    const t = this.ctx.currentTime + delay;
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * gain, t + 0.3);
    g.gain.setValueAtTime(level * gain, t + duration - 0.6);
    g.gain.linearRampToValueAtTime(0, t + duration);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.1);
  }

  // ---------- mela effects ----------

  crunch() {
    for (let i = 0; i < 3; i++) this.noiseHit({ at: i * 0.05 + Math.random() * 0.02, freq: rand(1200, 2600), q: 2, level: 0.22, dur: 0.05 });
  }

  slurp() {
    this.noiseHit({ freq: 900, to: 280, q: 4, level: 0.3, dur: 0.35 });
    this.tone(180, 0.25, { level: 0.1, to: 90, at: 0.2 });
  }

  pop() {
    this.noiseHit({ type: 'highpass', freq: 1500, level: 0.5, dur: 0.06 });
    this.tone(420, 0.08, { level: 0.2, to: 120 });
  }

  pew() {
    this.tone(900, 0.09, { type: 'square', level: 0.05, to: 260 });
  }

  ding(level = 0.25) {
    [[1046, 1.8], [2093, 1.2], [3136, 0.8]].forEach(([f, d], i) => this.tone(f, d, { level: level / (i + 1) }));
  }

  templeBell(pos = null) {
    if (!this.ctx) return;
    const { gain, delay } = this.spatial(pos);
    if (gain < 0.03) return;
    [[520, 2.6, 0.22], [523, 2.6, 0.16], [1040, 1.8, 0.1], [1404, 1.4, 0.07], [1976, 0.9, 0.05]].forEach(([f, d, l]) => this.tone(f, d, { level: l * gain, at: delay }));
    this.noiseHit({ at: delay, type: 'highpass', freq: 3000, level: 0.15 * gain, dur: 0.03 });
  }

  clank() {
    [620, 940, 1480].forEach((f, i) => this.tone(f, 0.25 - i * 0.05, { type: 'triangle', level: 0.09 }));
    this.noiseHit({ type: 'highpass', freq: 2000, level: 0.2, dur: 0.03 });
  }

  thud() {
    this.tone(110, 0.15, { level: 0.35, to: 55 });
    this.noiseHit({ type: 'lowpass', freq: 400, level: 0.25, dur: 0.08 });
  }

  whoosh() {
    this.noiseHit({ freq: 600, to: 2000, q: 1.5, level: 0.16, dur: 0.25, attack: 0.05 });
  }

  splash() {
    this.noiseHit({ type: 'lowpass', freq: 1400, to: 300, level: 0.3, dur: 0.45, attack: 0.01 });
  }

  chaChing() {
    this.tone(1568, 0.1, { type: 'triangle', level: 0.12 });
    this.tone(2093, 0.35, { type: 'triangle', level: 0.12, at: 0.09 });
  }

  cheer() {
    if (!this.ctx) return;
    this.duck(2.5);
    this.noiseHit({ freq: 1200, q: 0.5, level: 0.12, dur: 1.4, attack: 0.15 });
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, i === 3 ? 0.6 : 0.15, { type: 'triangle', level: 0.13, at: i * 0.12 }));
  }

  fail() {
    this.tone(392, 0.3, { type: 'triangle', level: 0.12, to: 370 });
    this.tone(330, 0.6, { type: 'triangle', level: 0.12, to: 290, at: 0.35 });
  }

  // ---------- vehicles & booth ----------

  /** A looping engine for the car, helicopter or plane; setEngine() steers pitch and loudness. */
  startEngine(kind) {
    if (!this.ctx) return;
    this.stopEngine();
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const e = { kind, gain, nodes: [] };
    if (kind === 'car') {
      e.osc = ctx.createOscillator();
      e.osc.type = 'sawtooth';
      e.osc2 = ctx.createOscillator();
      e.osc2.type = 'square';
      e.lp = ctx.createBiquadFilter();
      e.lp.type = 'lowpass';
      e.lp.Q.value = 2;
      const g2 = ctx.createGain();
      g2.gain.value = 0.5;
      e.osc.connect(e.lp);
      e.osc2.connect(g2).connect(e.lp);
      e.lp.connect(gain);
      e.nodes.push(e.osc, e.osc2);
    } else if (kind === 'heli') {
      const src = this.noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      const chop = ctx.createGain();
      chop.gain.value = 0.6;
      e.lfo = ctx.createOscillator();
      e.lfo.type = 'square';
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.4;
      e.lfo.connect(lfoG).connect(chop.gain);
      e.osc = ctx.createOscillator();
      e.osc.type = 'triangle';
      const og = ctx.createGain();
      og.gain.value = 0.25;
      src.connect(lp).connect(chop).connect(gain);
      e.osc.connect(og).connect(gain);
      e.nodes.push(src, e.lfo, e.osc);
    } else {
      e.osc = ctx.createOscillator();
      e.osc.type = 'sawtooth';
      e.osc2 = ctx.createOscillator();
      e.osc2.type = 'sawtooth';
      e.lp = ctx.createBiquadFilter();
      e.lp.type = 'lowpass';
      const src = this.noiseSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 0.7;
      const ng = ctx.createGain();
      ng.gain.value = 0.15;
      e.osc.connect(e.lp);
      e.osc2.connect(e.lp);
      e.lp.connect(gain);
      src.connect(bp).connect(ng).connect(gain);
      e.nodes.push(e.osc, e.osc2, src);
    }
    for (const n of e.nodes) n.start(0, n.buffer ? Math.random() : 0);
    this.engine = e;
    this.setEngine(0, 0);
  }

  /** throttle and speed are 0..1 */
  setEngine(throttle, speed) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    if (e.kind === 'car') {
      const f = 48 + throttle * 55 + speed * 150;
      e.osc.frequency.setTargetAtTime(f, t, 0.12);
      e.osc2.frequency.setTargetAtTime(f / 2, t, 0.12);
      e.lp.frequency.setTargetAtTime(380 + speed * 1200 + throttle * 300, t, 0.12);
      e.gain.gain.setTargetAtTime(0.05 + throttle * 0.09 + speed * 0.05, t, 0.1);
    } else if (e.kind === 'heli') {
      e.lfo.frequency.setTargetAtTime(5 + throttle * 7, t, 0.5);
      e.osc.frequency.setTargetAtTime(70 + throttle * 50, t, 0.5);
      e.gain.gain.setTargetAtTime(throttle * 0.26, t, 0.3);
    } else {
      const f = 55 + throttle * 130 + speed * 40;
      e.osc.frequency.setTargetAtTime(f, t, 0.3);
      e.osc2.frequency.setTargetAtTime(f * 1.02, t, 0.3);
      e.lp.frequency.setTargetAtTime(450 + throttle * 1600, t, 0.3);
      e.gain.gain.setTargetAtTime(0.04 + throttle * 0.16 + speed * 0.04, t, 0.3);
    }
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    e.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    setTimeout(() => {
      for (const n of e.nodes) {
        try {
          n.stop();
        } catch {
          // already stopped
        }
      }
      e.gain.disconnect();
    }, 700);
  }

  oar() {
    this.noiseHit({ type: 'lowpass', freq: 1100, to: 320, level: 0.1, dur: 0.32, attack: 0.03 });
  }

  doorClick() {
    this.noiseHit({ type: 'bandpass', freq: 900, q: 2, level: 0.3, dur: 0.05 });
    this.tone(160, 0.12, { type: 'triangle', level: 0.12, to: 90 });
  }

  lapBeep(best = false) {
    [880, 1175].forEach((f, i) => this.tone(f, 0.12, { type: 'square', level: 0.05, at: i * 0.12 }));
    if (best) this.tone(1568, 0.4, { type: 'triangle', level: 0.08, at: 0.26 });
  }

  horn() {
    [440, 554].forEach((f) => this.tone(f, 0.4, { type: 'square', level: 0.07, attack: 0.02 }));
  }

  shutter() {
    this.noiseHit({ type: 'highpass', freq: 2500, level: 0.35, dur: 0.03 });
    this.noiseHit({ at: 0.08, type: 'highpass', freq: 1800, level: 0.3, dur: 0.05 });
    this.tone(1200, 0.06, { level: 0.08, at: 0.08, to: 600 });
  }

  beep(high = false) {
    this.tone(high ? 1320 : 880, 0.12, { type: 'square', level: 0.05 });
  }

  /** k 0..1: how far another sound source (the Ramleela show) pushes the song down. */
  ambientDuck(k) {
    this.duckK = k;
    if (!this.musicGain || !this.songPlaying) return;
    this.musicGain.gain.setTargetAtTime(MUSIC_LEVEL * (1 - 0.92 * k), this.ctx.currentTime, 0.3);
  }

  /** A soft crowd murmur under everything. */
  startCrowd() {
    const ctx = this.ctx;
    const crowd = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 480;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.02;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(g.gain);
    crowd.connect(bp).connect(g).connect(this.master);
    crowd.start();
    lfo.start();
  }
}
