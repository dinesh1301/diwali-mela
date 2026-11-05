/*
  Player settings that persist in the browser: graphics tier, reduced motion, music mode and
  key bindings, and the Voices / Music volumes. `tier` is what the rest of the app reads; 'auto' resolves from the device.
*/
const KEY = 'melaSettings';

export const DEFAULT_KEYS = {
  interact: 'KeyE',
  use: 'KeyQ',
  jump: 'Space',
  run: 'ShiftLeft',
  photo: 'KeyF',
  lantern: 'KeyL',
  show: 'KeyG',
  passport: 'KeyP',
  look: 'KeyC',
  horn: 'KeyH',
  board: 'KeyT',
  talk: 'KeyV',
};

export const KEY_LABELS = {
  interact: 'Interact',
  use: 'Use / secondary',
  jump: 'Jump · ascend · drift',
  run: 'Run · descend',
  photo: 'Take a photo',
  lantern: 'Wish lantern',
  show: 'Grand fireworks show',
  passport: 'Passport',
  look: 'Change your look',
  horn: 'Horn',
  board: 'Leaderboard',
  talk: 'Voice chat · toggle mic (hold to talk in push-to-talk)',
};

/** A short human name for a KeyboardEvent.code. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', Backquote: '`' };
  return map[code] ?? code;
}

export const settings = {
  quality: 'auto', // auto | high | low
  reduceMotion: false,
  music: 'song', // song | band (the synthesised, royalty-free mela band)
  keys: { ...DEFAULT_KEYS },
  voice: 'open', // open (voice-activated) | ptt (hold the Talk key)
  voiceVolume: 1, // the Voices slider: voice chat and the Tambola caller
  musicVolume: 1, // the Music slider: the Diwali song or the mela band (effects stay as they are)
  detected: 'high',
  midGpu: false, // high tier, but start at a lower pixel ratio

  get tier() {
    return this.quality === 'auto' ? this.detected : this.quality;
  },

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') {
        if (['auto', 'high', 'low'].includes(s.quality)) this.quality = s.quality;
        this.reduceMotion = !!s.reduceMotion;
        if (['song', 'band'].includes(s.music)) this.music = s.music;
        if (['open', 'ptt'].includes(s.voice)) this.voice = s.voice;
        if (typeof s.voiceVolume === 'number') this.voiceVolume = Math.max(0, Math.min(1, s.voiceVolume));
        if (typeof s.musicVolume === 'number') this.musicVolume = Math.max(0, Math.min(1, s.musicVolume));
        if (s.keys && typeof s.keys === 'object') for (const k of Object.keys(DEFAULT_KEYS)) if (typeof s.keys[k] === 'string') this.keys[k] = s.keys[k];
      }
    } catch {
      // storage unavailable
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches && localStorage.getItem(KEY) === null) this.reduceMotion = true;
    return this;
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ quality: this.quality, reduceMotion: this.reduceMotion, music: this.music, keys: this.keys, voice: this.voice, voiceVolume: this.voiceVolume, musicVolume: this.musicVolume }));
    } catch {
      // ignore
    }
  },

  resetKeys() {
    this.keys = { ...DEFAULT_KEYS };
    this.save();
  },

  /** Guesses a graphics tier from the device: phones and integrated GPUs get 'low'. */
  detect(renderer) {
    let gpu = '';
    try {
      const gl = renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    } catch {
      // ignore
    }
    const coarse = matchMedia('(pointer: coarse)').matches;
    const weakCpu = (navigator.hardwareConcurrency || 8) <= 4;
    const weakMem = (navigator.deviceMemory || 8) <= 4;
    const weakGpu = /Mali|Adreno|PowerVR|Apple GPU|Intel\(R\) (UHD|HD|Iris)|Intel.*(UHD|HD) Graphics|Iris\(R\) Xe|SwiftShader|llvmpipe|softpipe|Microsoft Basic Render|Immortalis|Xclipse|Maleoon|Vivante|Tegra/i.test(gpu);
    // newer integrated GPUs (Intel Arc / "Intel(R) Graphics", Apple M-series through ANGLE) cope with
    // the high tier but not at a retina pixel ratio: they start lower and the governor raises it
    this.midGpu = !weakGpu && /Intel.*(Arc|\(R\) Graphics)|ANGLE Metal Renderer: Apple M|Apple M\d/i.test(gpu);
    let fewUniforms = false;
    try {
      const gl = renderer.getContext();
      fewUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) < 700;
    } catch {
      // ignore
    }
    this.detected = coarse || weakGpu || fewUniforms || (weakCpu && weakMem) ? 'low' : 'high';
    this.gpu = gpu;
    return this.detected;
  },
};
