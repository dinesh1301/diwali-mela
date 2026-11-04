import * as THREE from 'three';

// The canvas never changes size: a GPU texture keeps its first dimensions, so redrawing into a
// resized canvas would silently leave the old image on screen.
const W = 512;
const H = 160;

/** A floating label over a character: the visitor's name and, if given, their Topmate handle. */
export class NameTag {
  constructor(parent, { name = '', handle = '' } = {}, { height = 0.42 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false }));
    this.sprite.center.set(0.5, 0); // anchor at the bottom, so the tag always sits just above the head
    this.sprite.position.y = height;
    this.sprite.renderOrder = 20;
    this.sprite.layers.set(1);
    const scale = 1.25;
    this.sprite.scale.set(scale, (scale * H) / W, 1);
    parent.add(this.sprite);
    this.set({ name, handle });
  }

  set({ name, handle }) {
    this.name = (name || '').trim().slice(0, 24);
    this.handle = (handle || '').trim().replace(/^@/, '').slice(0, 30);
    this.redraw();
  }

  /** Shows a 🎤 in front of the name while this person is talking. */
  setSpeaking(on) {
    if (!!on === !!this.speaking) return;
    this.speaking = !!on;
    this.redraw();
  }

  redraw() {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const title = (this.speaking ? '🎤 ' : '') + this.name;
    if (!this.name) {
      this.sprite.visible = false;
      this.texture.needsUpdate = true;
      return;
    }
    this.sprite.visible = true;

    const two = !!this.handle;
    const label = `topmate.io/${this.handle}`;
    const ph = two ? 150 : 96; // pill height
    const top = H - 4 - ph; // pill is drawn at the bottom of the canvas
    ctx.font = '600 46px Poppins, system-ui, sans-serif';
    const w1 = ctx.measureText(title).width;
    ctx.font = '500 30px Poppins, system-ui, sans-serif';
    const w2 = two ? ctx.measureText(label).width + 34 : 0;
    const pw = Math.min(W - 8, Math.max(w1, w2) + 56);
    const px = (W - pw) / 2;

    ctx.fillStyle = 'rgba(22, 8, 32, 0.78)';
    ctx.strokeStyle = 'rgba(255, 207, 92, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(px, top, pw, ph, 26);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff6e5';
    ctx.font = '600 46px Poppins, system-ui, sans-serif';
    ctx.fillText(title, W / 2, two ? top + 42 : top + ph / 2);
    if (two) {
      ctx.font = '500 30px Poppins, system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const x0 = W / 2 - (tw + 34) / 2;
      const y = top + 100;
      // a little diya-orange dot as a "verified on topmate" mark
      ctx.beginPath();
      ctx.arc(x0 + 12, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6d3a';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 16px Poppins, system-ui, sans-serif';
      ctx.fillText('t', x0 + 12, y + 1);
      ctx.fillStyle = '#ffcf5c';
      ctx.font = '500 30px Poppins, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, x0 + 34, y);
    }
    this.texture.needsUpdate = true;
  }

  setVisible(v) {
    this.sprite.visible = v && !!this.name;
  }

  /** Frees the label's texture and material (for visitors who leave). */
  dispose() {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.sprite.material.dispose();
    this.canvas.width = this.canvas.height = 0;
  }
}
