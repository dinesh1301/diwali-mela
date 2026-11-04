import { tk } from './touch.js';
import * as THREE from 'three';
import { createStall, signTexture, STALL } from './stalls.js';
import { NameTag } from './nametag.js';
import { profile } from './profile.js';
import { canvasTexture, setLayer, WARM_PALETTE } from './utils.js';
import { CONFIG } from './config.js';

/*
  Creator Corner: a row of stalls just inside the entrance, each "rented" by a Topmate creator.
  Their name, headline and photo come live from topmate.io through the proxy; walking up and
  pressing E opens a card with a Book button.
*/
const PALETTES = [
  { c1: '#ff6d3a', c2: '#fff1d0', trim: '#ffd166', sign: '#7a2a10' },
  { c1: '#3a86ff', c2: '#ffffff', trim: '#ffd166', sign: '#13306b' },
  { c1: '#2a9d8f', c2: '#fff1d0', trim: '#ffb703', sign: '#0d4f4a' },
  { c1: '#8338ec', c2: '#ffd166', trim: '#ff8fab', sign: '#3c1361' },
];
const X0 = 10;
const GAP = 6.5;
const Z = 63;

function initialTexture(letter) {
  return canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#ff8a1c';
    c.fillRect(0, 0, w, w);
    c.fillStyle = '#fff';
    c.font = '700 150px Poppins, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(letter.toUpperCase(), w / 2, w / 2 + 8);
  });
}

/**
 * A creator photo square-cropped and scaled down to PHOTO px: profile pictures can be 1000s of
 * pixels, which is megabytes of GPU memory for a 1.1 m frame.
 */
const PHOTO = 256;
function photoTexture(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.min(w, h);
  return canvasTexture(PHOTO, PHOTO, (c) => {
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, PHOTO, PHOTO);
  });
}

export class Creators {
  constructor(ctx, lights) {
    this.ctx = ctx;
    const { scene, world, interactions, player } = ctx;
    const { W, D } = STALL;
    this.stalls = [];
    const handles = CONFIG.creators.slice(0, 4);

    handles.forEach((handle, i) => {
      const pal = PALETTES[i % PALETTES.length];
      const def = { name: `@${handle}`, sub: 'Topmate creator', goods: 'creator', ...pal };
      const stall = createStall(def);
      const g = stall.group;
      const x = X0 + i * GAP;
      g.position.set(x, 0, Z);
      scene.add(g);
      g.updateMatrixWorld(true);
      const w = (v) => g.localToWorld(v.clone());
      stall.strands.forEach(([a, b, sag]) => lights.addStrand(w(a), w(b), { sag, spacing: 0.32, wire: sag > 0, palette: WARM_PALETTE }));
      world.colliders.push({ type: 'box', minX: x - W / 2 - 0.3, maxX: x + W / 2 + 0.3, minZ: Z - D / 2, maxZ: Z + D / 2 });
      setLayer(g, 1);

      // photo frame on the back wall and a "Book a session" board on the counter
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 0.06), new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.6, roughness: 0.35 }));
      frame.position.set(0, 1.95, -D / 2 + 0.1);
      const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: initialTexture(handle[0]), color: new THREE.Color(1.1, 1.1, 1.1) }));
      photo.position.set(0, 1.95, -D / 2 + 0.14);
      g.add(frame, photo);
      const book = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.42), new THREE.MeshBasicMaterial({ map: signTexture('Book a session', tk('press E', 'tap the button'), '#5c0a10', '#ffe7a3', 512, 136), color: new THREE.Color(1.2, 1.2, 1.2) }));
      book.position.set(0, 1.5, D / 2 - 0.1);
      book.rotation.x = -0.35;
      g.add(book);
      const tag = new NameTag(stall.keeper.headTop, { name: handle, handle });

      const entry = { handle, def, stall, group: g, photo, tag, data: null, stand: w(new THREE.Vector3(0, 0, D / 2 + 1.1)), center: w(new THREE.Vector3(0, 0, 0)) };
      this.stalls.push(entry);
      interactions.add({
        pos: entry.stand,
        markAt: entry.center,
        markerHeight: 3.2,
        radius: 2.8,
        label: () => `Meet ${entry.data?.name || '@' + handle} · Topmate creator 🤝`,
        enabled: () => player.mode === 'walk',
        action: () => this.meet(entry),
      });
      this.load(entry);
    });

    // an arch sign over the row
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.8),
      new THREE.MeshBasicMaterial({ map: signTexture('Creator Corner', tk('Meet Topmate creators · press E at a stall', 'Meet Topmate creators · tap the button at a stall'), '#3c1361', '#ffe7a3', 1024, 288), color: new THREE.Color(1.2, 1.2, 1.2), side: THREE.DoubleSide })
    );
    sign.position.set(X0 + GAP, 5.2, Z + 0.5);
    scene.add(sign);
    const light = new THREE.PointLight(0xffb46b, 70, 22, 2);
    light.position.set(X0 + GAP, 4.5, Z + 3);
    scene.add(light);
  }

  async load(entry) {
    const data = await profile.fetchTopmate(entry.handle);
    if (!data?.found) return;
    entry.data = data;
    entry.tag.set({ name: data.name, handle: data.username });
    const sign = entry.stall.sign?.material;
    if (sign) {
      sign.map?.dispose();
      sign.map = signTexture(data.name, data.headline ? data.headline.slice(0, 48) : 'Topmate creator', entry.def.sign);
      sign.needsUpdate = true;
    }
    if (data.image) {
      new THREE.ImageLoader().load(data.image, (img) => {
        const mat = entry.photo.material;
        mat.map?.dispose(); // the initial-letter placeholder
        mat.map = photoTexture(img);
        mat.needsUpdate = true;
      });
    }
  }

  async meet(entry) {
    const { player, ui, passport, tasks } = this.ctx;
    player.setBusy(true);
    player.faceTowards(entry.center.x, entry.center.z);
    entry.stall.keeper.setAction('namaste');
    ui.bubble((o) => entry.stall.keeper.headTop.getWorldPosition(o), 'Namaste! Happy Diwali 🙏', 2.2);
    await tasks.wait(0.5);
    const d = entry.data;
    const choice = await ui.creatorCard({
      name: d?.name || `@${entry.handle}`,
      handle: d?.username || entry.handle,
      headline: d?.headline || 'Topmate creator',
      image: d?.image || null,
    });
    entry.stall.keeper.clearAction();
    player.setBusy(false);
    passport.stamp('creator');
    if (choice === 'book') window.open(`https://topmate.io/${encodeURIComponent(d?.username || entry.handle)}?utm_source=diwali_mela`, '_blank', 'noopener');
  }
}
