import * as THREE from 'three';
import { DAY } from './utils.js';

/*
  The evening: visitors arrive at dusk, the string lights come on zone by zone over the first
  half minute, and the sky deepens into a moonless night over about two and a half minutes.
  One directional light plays the setting sun and then becomes a faint blue sky light, so the
  shadows swing from long and orange to soft and overhead.
*/
const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// A late, already-dim sunset: the sky still glows but the ground is in shadow, so the diyas and
// string lights read from the first second.
const DUSK = {
  top: new THREE.Color(0x2c2a62),
  horizon: new THREE.Color(0xd8663a),
  glow: new THREE.Color(0xc8743e),
  fog: new THREE.Color(0x4a2a40),
  fogDensity: 0.005,
  hemiSky: new THREE.Color(0x9a7ea0),
  hemiGround: new THREE.Color(0x4a2e22),
  hemi: 1.15,
  sun: new THREE.Color(0xffa055),
  sunI: 0.85,
  sunPos: new THREE.Vector3(-90, 14, 60),
};
// A Diwali night, not a dark one: a deep-blue sky (never black) over a warm orange haze from a
// whole city of lamps, fog that glows instead of swallowing the far stalls, and a sky light strong
// enough that the lanes read between the real lights.
const NIGHT = {
  top: new THREE.Color(0x0a1438),
  horizon: new THREE.Color(0x3a2448),
  glow: new THREE.Color(0xc0582a),
  fog: new THREE.Color(0x2c1a36),
  fogDensity: 0.0055,
  hemiSky: new THREE.Color(0x8e84cc),
  hemiGround: new THREE.Color(0x5a3a24),
  hemi: 1.25,
  sun: new THREE.Color(0x9fb2ff),
  sunI: 0.5,
  sunPos: new THREE.Vector3(40, 80, 30),
};
const LENGTH = 90; // seconds from dusk to full night (most of the darkening happens in the first 30)

export class DayNight {
  constructor({ scene, sky, hemi, sun, lightSystems = [] }) {
    this.scene = scene;
    this.sky = sky;
    this.hemi = hemi;
    this.sun = sun;
    this.lightSystems = lightSystems;
    this.T = 0;
    this.running = false;
    this.tmp = new THREE.Color();
    this.apply();
  }

  /** Begins the evening. `night` jumps straight to the end state. */
  start({ night = false } = {}) {
    this.running = true;
    if (night) this.T = 1e6;
  }

  get k() {
    return Math.pow(smooth(0, LENGTH, this.T), 0.55);
  }

  update(dt) {
    if (this.running) this.T += dt;
    this.apply();
  }

  apply() {
    const k = this.k;
    const T = this.T;
    const { sky, hemi, sun, scene, tmp } = this;
    sky.dome.uTop.value.copy(DUSK.top).lerp(NIGHT.top, k);
    sky.dome.uHorizon.value.copy(DUSK.horizon).lerp(NIGHT.horizon, k);
    sky.dome.uGlow.value.copy(DUSK.glow).lerp(NIGHT.glow, k);
    sky.dome.uSunGlow.value = (1 - smooth(0.0, 0.5, k)) * 0.55;
    sky.dome.uSunDir.value.set(-0.8, 0.02 - 0.3 * smooth(0, 0.6, k), 0.55).normalize();
    sky.stars.uAlpha.value = smooth(0.35, 0.9, k);
    if (scene.fog) {
      scene.fog.color.copy(DUSK.fog).lerp(NIGHT.fog, k);
      scene.fog.density = DUSK.fogDensity + (NIGHT.fogDensity - DUSK.fogDensity) * k;
    }
    hemi.color.copy(DUSK.hemiSky).lerp(NIGHT.hemiSky, k);
    hemi.groundColor.copy(DUSK.hemiGround).lerp(NIGHT.hemiGround, k);
    hemi.intensity = DUSK.hemi + (NIGHT.hemi - DUSK.hemi) * k;
    if (sun) {
      sun.color.copy(DUSK.sun).lerp(NIGHT.sun, k);
      sun.intensity = DUSK.sunI + (NIGHT.sunI - DUSK.sunI) * k;
      sun.position.copy(DUSK.sunPos).lerp(NIGHT.sunPos, k);
    }
    // the big rides' bulbs come on together once the bazaar is lit
    DAY.lights = smooth(14, 17, T);
    DAY.night = k;
    for (const s of this.lightSystems) s.setDay(T);
    void tmp;
  }
}
