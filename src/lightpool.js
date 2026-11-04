import * as THREE from 'three';

/*
  Every tier draws through a small, fixed set of real lights. Phones can't compile a lit shader for
  ~60 dynamic lights at all (when the shader fails every lit object silently vanishes), and on
  desktops 60 lights in every pixel of the main pass and the river reflection is the single biggest
  GPU cost. The pool hides all the scene's point and spot lights from the renderer (visible = false
  keeps them in the hierarchy, so moving ones like the boat's lantern still have a world position)
  and drives the proxies from whichever originals matter most near the player.

  - The light count never changes, so shaders compile once and stay valid.
  - Which lights are picked is decided a few times a second (and at once when a light switches on,
    so firework flashes are not late); the picked ones are copied every frame so moving and
    flickering lights stay smooth.
  - Lights picked last time get a score bonus, so two similar lights don't swap back and forth.
*/
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const PICK_EVERY = 1 / 8; // seconds between re-picks
const KEEP_BONUS = 1.5; // hysteresis: a picked light must be clearly beaten to lose its slot

export class LightPool {
  constructor(scene, focus, { points = 8, spots = 2 } = {}) {
    this.focus = focus; // () => Vector3, where the player is
    this.src = { point: [], spot: [] };
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (o.isPointLight) this.src.point.push(o);
      else if (o.isSpotLight) this.src.spot.push(o);
    });
    for (const o of [...this.src.point, ...this.src.spot]) o.visible = false;
    // one record per source light, allocated once
    this.rec = {
      point: this.src.point.map((o) => ({ o, score: 0, on: false, picked: false })),
      spot: this.src.spot.map((o) => ({ o, score: 0, on: false, picked: false })),
    };
    this.cand = { point: [], spot: [] };
    this.chosen = { point: [], spot: [] };
    this.proxies = {
      point: Array.from({ length: points }, () => new THREE.PointLight(0xffffff, 0, 0, 2)),
      spot: Array.from({ length: spots }, () => {
        const s = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.5, 1);
        scene.add(s.target);
        return s;
      }),
    };
    for (const l of [...this.proxies.point, ...this.proxies.spot]) scene.add(l);
    this.clock = 0;
    this.last = performance.now();
  }

  get count() {
    return this.src.point.length + this.src.spot.length;
  }

  pick(kind, f) {
    const cand = this.cand[kind];
    cand.length = 0;
    for (const r of this.rec[kind]) {
      const o = r.o;
      const wasPicked = r.picked;
      r.picked = false;
      if (!(o.intensity > 0)) continue;
      // a hidden parent (a parked car's headlight group, say) means the light is off
      let shown = true;
      for (let p = o.parent; p && shown; p = p.parent) if (!p.visible) shown = false;
      if (!shown) continue;
      o.getWorldPosition(_p);
      const d = _p.distanceTo(f);
      if (o.distance > 0 && d > o.distance + 25) continue; // can't reach anything near us
      r.score = (o.intensity / (1 + d * d)) * (wasPicked ? KEEP_BONUS : 1);
      cand.push(r);
    }
    cand.sort((a, b) => b.score - a.score);
    const chosen = this.chosen[kind];
    chosen.length = 0;
    for (let i = 0; i < this.proxies[kind].length && i < cand.length; i++) {
      cand[i].picked = true;
      chosen.push(cand[i]);
    }
  }

  /** True when a light switched on since the last frame (a firework flash, a headlight). */
  switchedOn() {
    let any = false;
    for (const kind of ['point', 'spot']) {
      for (const r of this.rec[kind]) {
        const on = r.o.intensity > 0;
        if (on && !r.on && !r.picked) any = true;
        r.on = on;
      }
    }
    return any;
  }

  update() {
    const now = performance.now();
    this.clock -= Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.switchedOn() || this.clock <= 0) {
      this.clock = PICK_EVERY;
      const f = this.focus();
      this.pick('point', f);
      this.pick('spot', f);
    }
    for (const kind of ['point', 'spot']) {
      const chosen = this.chosen[kind];
      const proxies = this.proxies[kind];
      for (let i = 0; i < proxies.length; i++) {
        const l = proxies[i];
        const o = chosen[i]?.o;
        if (!o || !(o.intensity > 0)) {
          l.intensity = 0;
          continue;
        }
        o.getWorldPosition(l.position);
        l.color.copy(o.color);
        l.intensity = o.intensity;
        l.distance = o.distance;
        l.decay = o.decay;
        if (kind === 'spot') {
          l.angle = o.angle;
          l.penumbra = o.penumbra;
          o.target.getWorldPosition(_t);
          l.target.position.copy(_t);
          l.target.updateMatrixWorld();
        }
      }
    }
  }
}
