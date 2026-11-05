import * as THREE from 'three';

/*
  One painted texture for every person in the mela: a 4x6 atlas of 256 px cells, drawn once on a
  canvas at startup. Twelve cells are faces (painted in head units, mapped by a front projection of
  the head: man, woman, kids, teens, elders, and bearded men dark or grey), the rest are fabric and
  hair details (zari borders, butis, plackets, saree pleats, hair strands) that tile round a part.
  Every cell is transparent where the vertex colour (skin, cloth) should show through, so one
  texture serves every skin tone and every fabric colour, and a whole person stays one draw call.
*/

export const CELL = {
  man: 0, woman: 1, boy: 2, girl: 3, elderM: 4, elderF: 5, teenM: 6, teenF: 7,
  buti: 8, skirt: 9, pallu: 10, kurta: 11, sherwani: 12, tee: 13, lehenga: 14, floral: 15,
  pleats: 16, frock: 17, hair: 18, curls: 19, manBeard: 20, manBeardGrey: 21, elderMBeard: 22, elderMBeardDark: 23,
};
/** Rows of cells in the atlas (four columns each); the shader needs it to find a cell. */
export const ROWS = 6;
// the face projection: head-local x in [-FACE_W, FACE_W] and y in [-FACE_H, FACE_H] fill a cell
export const FACE_W = 0.125;
export const FACE_H = 0.14;
// the torso-front projection used by the kurta / sherwani / tee cells (body space, adult rig)
export const FRONT_W = 0.2;
export const FRONT_Y0 = 0.45;
export const FRONT_H = 1.2;

const SIZE = 1024;
const C = 256;
const H = C * ROWS;
let texture = null;

const GOLD = '#e8b84a';
// the painted hairline's colour: the crowd's dark hair, or an elder's grey
const INK = '#1a100a';
const INK_GREY = '#aaa399';
const GOLD_DK = '#b07a1e';

/** The shared character texture (created on first use). */
export function charAtlas() {
  if (texture) return texture;
  const cv = document.createElement('canvas');
  cv.width = SIZE;
  cv.height = H;
  const g = cv.getContext('2d');
  // cell c sits at column c % 4, row floor(c / 4) counted from the bottom (the texture is flipped)
  const cell = (c, draw, { face = false, front = false } = {}) => {
    const x0 = (c % 4) * C;
    const y0 = H - (Math.floor(c / 4) + 1) * C;
    g.save();
    g.beginPath();
    g.rect(x0, y0, C, C);
    g.clip();
    // faces draw in head units (y up); patterns in cell units 0..1 (v up)
    if (face) g.setTransform(C / (2 * FACE_W), 0, 0, -C / (2 * FACE_H), x0 + C / 2, y0 + C / 2);
    else if (front) g.setTransform(C / (2 * FRONT_W), 0, 0, -C / FRONT_H, x0 + C / 2, y0 + C + (FRONT_Y0 * C) / FRONT_H);
    else g.setTransform(C, 0, 0, -C, x0, y0 + C);
    draw(g);
    g.restore();
  };

  const faces = {
    // adults' eyes sit about 10% smaller than the kids' so close-ups never read as bobbleheads
    man: { hl: 'm', eye: 0.9, lash: 0, brow: 0.0085, browC: '#24160d', lip: null, blush: 0.12, smile: 0.9 },
    woman: { hl: 'f', eye: 0.97, lash: 1, brow: 0.0062, browC: '#24160d', lip: '#b8434e', blush: 0.2, smile: 1 },
    boy: { hl: 'm', eye: 1.22, lash: 0, brow: 0.006, browC: '#2b1a10', lip: null, blush: 0.26, smile: 1.15, open: true, kid: true },
    girl: { hl: 'f', eye: 1.25, lash: 1, brow: 0.0055, browC: '#2b1a10', lip: '#c9555e', blush: 0.3, smile: 1.1, open: true, kid: true },
    elderM: { hl: 'm', ink: INK_GREY, eye: 0.83, lash: 0, brow: 0.009, browC: '#9a948c', lip: null, blush: 0.08, smile: 0.95, lines: true },
    elderF: { hl: 'f', ink: INK_GREY, eye: 0.86, lash: 1, brow: 0.0058, browC: '#8f8880', lip: '#a4505a', blush: 0.14, smile: 1, lines: true },
    teenM: { hl: 'm', eye: 0.97, lash: 0, brow: 0.0075, browC: '#24160d', lip: null, blush: 0.14, smile: 0.85 },
    teenF: { hl: 'f', eye: 1.04, lash: 1, brow: 0.006, browC: '#24160d', lip: '#c24a58', blush: 0.24, smile: 1 },
  };
  const DARK = 'rgba(28,17,10,0.93)';
  const GREYB = 'rgba(214,208,198,0.96)';
  faces.manBeard = { ...faces.man, beard: DARK };
  faces.manBeardGrey = { ...faces.man, beard: GREYB, browC: '#8f8a82' };
  faces.elderMBeard = { ...faces.elderM, beard: GREYB };
  faces.elderMBeardDark = { ...faces.elderM, beard: DARK, browC: '#24160d', ink: INK };
  for (const [k, f] of Object.entries(faces)) cell(CELL[k], (g) => paintFace(g, f), { face: true });

  cell(CELL.buti, (g) => butis(g, 0.12, 0.92, 7, 0.022));
  cell(CELL.skirt, (g) => {
    zari(g, 0.0, 0.15);
    band(g, 0.19, 0.205, GOLD);
    butis(g, 0.28, 0.95, 6, 0.024);
  });
  cell(CELL.pallu, (g) => {
    zari(g, 0.0, 0.2);
    zari(g, 0.8, 1.0, true);
    butis(g, 0.3, 0.72, 3, 0.03);
  });
  cell(CELL.lehenga, (g) => {
    zari(g, 0.0, 0.2);
    mirrors(g, 0.04, 0.16);
    band(g, 0.23, 0.245, GOLD);
    zari(g, 0.5, 0.58);
    butis(g, 0.3, 0.46, 2, 0.026);
    butis(g, 0.64, 0.96, 3, 0.022);
  });
  cell(CELL.floral, (g) => flowers(g));
  // saree pleats: one wrap of the skirt (u = 0 and 1 at the front), folds fanned at the front
  cell(CELL.pleats, (g) => {
    zari(g, 0.0, 0.13);
    band(g, 0.16, 0.172, GOLD);
    for (let i = 0; i < 28; i++) {
      const k = (i + 0.5) / 28;
      const u = k < 0.5 ? k * 0.3 : 1 - (1 - k) * 0.3; // within ~55 degrees either side of the front
      const w = 0.0045 + 0.004 * Math.abs(Math.sin(i * 1.7));
      g.fillStyle = i % 2 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.13)';
      g.fillRect(u - w / 2, 0.0, w, 1.0);
    }
    // the fold shadow where the pleats tuck in at the waist
    const gr = g.createLinearGradient(0, 1, 0, 0.82);
    gr.addColorStop(0, 'rgba(0,0,0,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(-0.01, 0.82, 1.02, 0.18);
    for (let row = 0; row < 6; row++) {
      for (let c = 0; c < 14; c++) {
        const u = (c + (row % 2 ? 0.5 : 0) + 0.5) / 14;
        const v = 0.26 + row * 0.13;
        g.fillStyle = 'rgba(232,184,74,0.9)';
        g.beginPath();
        g.ellipse(u, v, 0.007, 0.012, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
  // a frock: a smocked yoke below the waist, little flowers and a ribbon at the hem
  cell(CELL.frock, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(-0.01, 0.06, 1.02, 0.05);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(-0.01, 0.0, 1.02, 0.035);
    for (let i = 0; i < 24; i++) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(i / 24, 0.86, 0.008, 0.14);
    }
    flowers(g, 0.25, 0.75, 3);
  });
  // hair strands: fine streaks running from the crown, a sheen band, darker roots at the parting
  cell(CELL.hair, (g) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const u = rnd();
      const w = 0.003 + rnd() * 0.006;
      const dark = rnd() < 0.55;
      g.fillStyle = dark ? `rgba(0,0,0,${0.16 + rnd() * 0.18})` : `rgba(255,236,210,${0.05 + rnd() * 0.07})`;
      g.fillRect(u, 0, w, 1);
    }
    // the sheen: a soft band of light across the crown, broken by the strands
    const gr = g.createLinearGradient(0, 0.58, 0, 0.82);
    gr.addColorStop(0, 'rgba(255,230,200,0)');
    gr.addColorStop(0.5, 'rgba(255,230,200,0.16)');
    gr.addColorStop(1, 'rgba(255,230,200,0)');
    g.fillStyle = gr;
    g.fillRect(-0.01, 0.58, 1.02, 0.24);
  });
  // curls: overlapping rings of light and shade
  cell(CELL.curls, (g) => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = rnd();
      const y = rnd();
      const r = 0.025 + rnd() * 0.025;
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 0.008;
      g.beginPath();
      g.arc(x, y, r, 0.3, Math.PI * 1.6);
      g.stroke();
      g.strokeStyle = 'rgba(255,236,210,0.12)';
      g.lineWidth = 0.006;
      g.beginPath();
      g.arc(x + 0.004, y + 0.006, r * 0.7, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
  });
  // front cells draw in body metres: x across the chest, y the height above the ground (adult rig)
  cell(CELL.kurta, (g) => {
    const ny = 0.95 + 0.505;
    g.strokeStyle = GOLD;
    g.lineWidth = 0.006;
    g.beginPath();
    g.ellipse(0, ny + 0.012, 0.055, 0.03, 0, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
    g.lineWidth = 0.012;
    g.beginPath();
    g.moveTo(0, ny - 0.016);
    g.lineTo(0, ny - 0.2);
    g.stroke();
    g.fillStyle = '#fff4d6';
    for (let i = 0; i < 4; i++) dot(g, 0, ny - 0.04 - i * 0.042, 0.0055);
  }, { front: true });
  cell(CELL.sherwani, (g) => {
    const ny = 0.95 + 0.5;
    // a gold-edged placket with buttons from the collar to the hem, a breast-pocket line
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(-0.003, 0.3, 0.006, ny - 0.3);
    g.strokeStyle = GOLD;
    g.lineWidth = 0.005;
    g.beginPath();
    g.moveTo(-0.014, ny);
    g.lineTo(-0.014, 0.4);
    g.moveTo(0.014, ny);
    g.lineTo(0.014, 0.4);
    g.stroke();
    for (let i = 0; i < 9; i++) {
      const y = ny - 0.05 - i * 0.065;
      g.fillStyle = GOLD_DK;
      dot(g, 0, y, 0.0085);
      g.fillStyle = '#ffe7a0';
      dot(g, -0.002, y + 0.002, 0.0038);
    }
    g.fillStyle = 'rgba(240,200,110,0.85)';
    g.fillRect(0.06, ny - 0.16, 0.06, 0.007);
  }, { front: true });
  cell(CELL.tee, (g) => {
    // a little diya print on the chest
    const y = 1.24;
    g.fillStyle = '#fff6e0';
    dot(g, 0, y, 0.048);
    g.fillStyle = '#ff8a1e';
    g.beginPath();
    g.moveTo(0, y + 0.036);
    g.quadraticCurveTo(0.018, y + 0.0, 0, y - 0.008);
    g.quadraticCurveTo(-0.018, y + 0.0, 0, y + 0.036);
    g.fill();
    g.fillStyle = '#c0391b';
    g.beginPath();
    g.ellipse(0, y - 0.016, 0.026, 0.012, 0, Math.PI, 0);
    g.fill();
  }, { front: true });

  texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true; // clean filtering at feature edges (the shader blends premultiplied)
  texture.anisotropy = 4;
  return texture;
}

function dot(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function band(g, v0, v1, color) {
  g.fillStyle = color;
  g.fillRect(-0.01, v0, 1.02, v1 - v0);
}

/** A zari (gold brocade) border between v0 and v1, tiling in u. */
function zari(g, v0, v1, flip = false) {
  const h = v1 - v0;
  g.fillStyle = 'rgba(214,160,52,0.96)';
  g.fillRect(-0.01, v0, 1.02, h);
  g.fillStyle = 'rgba(255,226,140,0.95)';
  g.fillRect(-0.01, flip ? v0 + h * 0.08 : v1 - h * 0.16, 1.02, h * 0.08);
  g.fillRect(-0.01, flip ? v1 - h * 0.16 : v0 + h * 0.08, 1.02, h * 0.08);
  // a row of little paisley-ish motifs in deep red
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n;
    const y = v0 + h * 0.5;
    g.fillStyle = '#8f1a1a';
    g.beginPath();
    g.ellipse(x, y, 0.06, h * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffe08a';
    dot(g, x, y, Math.min(0.025, h * 0.12));
  }
}

function mirrors(g, v0, v1) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    dot(g, (i + 0.5) / n, (v0 + v1) / 2, 0.018);
  }
}

/** Staggered gold butis (small dots with a petal ring) between v0 and v1. */
function butis(g, v0, v1, rows, r) {
  const cols = 4;
  for (let row = 0; row < rows; row++) {
    const v = rows === 1 ? (v0 + v1) / 2 : v0 + ((v1 - v0) * row) / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = (c + (row % 2 ? 0.5 : 0) + 0.25) / cols;
      g.fillStyle = 'rgba(230,180,70,0.95)';
      for (let p = 0; p < 4; p++) {
        const a = (p / 4) * Math.PI * 2;
        dot(g, u + Math.cos(a) * r * 0.9, v + Math.sin(a) * r * 0.9, r * 0.55);
      }
      g.fillStyle = 'rgba(255,240,190,0.95)';
      dot(g, u, v, r * 0.45);
    }
  }
}

function flowers(g, v0 = 0.08, v1 = 0.93, rows = 6) {
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < 4; c++) {
      const u = (c + (row % 2 ? 0.5 : 0) + 0.25) / 4;
      const v = v0 + (row * (v1 - v0)) / (rows - 1);
      g.fillStyle = 'rgba(255,250,240,0.85)';
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        dot(g, u + Math.cos(a) * 0.03, v + Math.sin(a) * 0.03, 0.02);
      }
      g.fillStyle = 'rgba(240,180,40,0.95)';
      dot(g, u, v, 0.014);
    }
  }
}

/*
  A face in head units: x right (the character's left), y up, 0 at the head's centre. Big, warm,
  readable eyes with whites, iris, pupil and a catch-light; brows; a nose hint; a smile.
*/
function paintFace(g, f) {
  paintHairline(g, f);
  const s = f.eye;
  const ex = f.kid ? 0.039 : 0.041;
  const ey = f.kid ? -0.008 : 0.002;
  const ew = 0.0205 * s;
  const eh = (f.kid ? 0.0195 : 0.0165) * s;

  // soft cheeks
  if (f.blush) {
    for (const sx of [-1, 1]) {
      const gr = g.createRadialGradient(sx * 0.064, -0.034, 0, sx * 0.064, -0.034, 0.03);
      gr.addColorStop(0, `rgba(225,70,70,${f.blush})`);
      gr.addColorStop(1, 'rgba(225,70,70,0)');
      g.fillStyle = gr;
      g.fillRect(sx * 0.064 - 0.03, -0.064, 0.06, 0.06);
    }
  }
  // a soft shade under the brow ridge and beside the nose gives the flat front some depth
  for (const sx of [-1, 1]) {
    const gr = g.createRadialGradient(sx * ex, ey + eh * 1.6, 0, sx * ex, ey + eh * 1.6, 0.03);
    gr.addColorStop(0, 'rgba(60,20,10,0.10)');
    gr.addColorStop(1, 'rgba(60,20,10,0)');
    g.fillStyle = gr;
    g.fillRect(sx * ex - 0.03, ey + eh * 1.6 - 0.03, 0.06, 0.06);
  }

  for (const sx of [-1, 1]) {
    const x = sx * ex;
    // eye white with a slight almond tilt
    g.save();
    g.beginPath();
    g.ellipse(x, ey, ew, eh, sx * -0.08, 0, Math.PI * 2);
    g.fillStyle = '#fbf7f0';
    g.fill();
    g.clip();
    // iris (warm brown with a darker rim), pupil, catch-lights
    const ir = eh * 0.98;
    const ix = x - sx * 0.0015;
    const iy = ey - eh * 0.06;
    const gr = g.createRadialGradient(ix, iy - ir * 0.3, ir * 0.1, ix, iy, ir);
    gr.addColorStop(0, '#8a5530');
    gr.addColorStop(0.65, '#5a3218');
    gr.addColorStop(1, '#2a160a');
    g.fillStyle = gr;
    dot(g, ix, iy, ir);
    g.fillStyle = '#120905';
    dot(g, ix, iy, ir * 0.5);
    // upper-lid shadow on the eyeball
    g.fillStyle = 'rgba(70,30,15,0.18)';
    g.fillRect(x - ew, ey + eh * 0.45, ew * 2, eh);
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    dot(g, ix + 0.0055 * s, iy + 0.0062 * s, 0.0036 * s);
    dot(g, ix - 0.004 * s, iy - 0.005 * s, 0.0016 * s);

    // the upper lash line: thick, dark, a little longer at the outer corner
    g.strokeStyle = '#1a0f09';
    g.lineCap = 'round';
    g.lineWidth = f.lash ? 0.0056 : 0.0042;
    g.beginPath();
    g.ellipse(x, ey - eh * 0.05, ew * 1.04, eh * 1.08, sx * -0.08, Math.PI * 0.08, Math.PI * 0.92);
    g.stroke();
    if (f.lash) {
      g.lineWidth = 0.0042;
      g.beginPath();
      g.moveTo(x + sx * ew * 0.95, ey + eh * 0.35);
      g.lineTo(x + sx * (ew + 0.008), ey + eh * 0.85);
      g.stroke();
    }
    // a faint lower lid
    g.strokeStyle = 'rgba(60,25,12,0.35)';
    g.lineWidth = 0.0022;
    g.beginPath();
    g.ellipse(x, ey + eh * 0.05, ew * 0.95, eh, sx * -0.08, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();

    // brows: a soft arch, thicker towards the nose
    g.strokeStyle = f.browC;
    g.lineWidth = f.brow;
    g.beginPath();
    const by = ey + eh + (f.kid ? 0.017 : 0.015);
    g.moveTo(x - sx * 0.019, by - 0.002);
    g.quadraticCurveTo(x + sx * 0.002, by + 0.009, x + sx * 0.025, by - 0.003);
    g.stroke();

    if (f.lines) {
      g.strokeStyle = 'rgba(70,30,15,0.22)';
      g.lineWidth = 0.0024;
      g.beginPath();
      g.moveTo(x + sx * 0.025, ey + 0.002);
      g.lineTo(x + sx * 0.032, ey - 0.006);
      g.moveTo(x + sx * 0.024, ey - 0.004);
      g.lineTo(x + sx * 0.031, ey - 0.012);
      g.stroke();
    }
  }

  // nose: a soft shadow under the tip and two nostril hints
  const ny = f.kid ? -0.036 : -0.036;
  const gr = g.createRadialGradient(0, ny - 0.004, 0, 0, ny - 0.004, 0.018);
  gr.addColorStop(0, 'rgba(70,25,10,0.28)');
  gr.addColorStop(1, 'rgba(70,25,10,0)');
  g.fillStyle = gr;
  g.fillRect(-0.02, ny - 0.024, 0.04, 0.04);
  g.fillStyle = 'rgba(60,20,10,0.45)';
  g.beginPath();
  g.ellipse(-0.0075, ny, 0.0038, 0.0022, 0.3, 0, Math.PI * 2);
  g.ellipse(0.0075, ny, 0.0038, 0.0022, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,240,225,0.18)';
  g.beginPath();
  g.ellipse(0, ny + 0.017, 0.004, 0.012, 0, 0, Math.PI * 2);
  g.fill();

  // mouth: a warm smile
  const my = f.kid ? -0.066 : -0.068;
  const mw = 0.02 * f.smile;
  if (f.open) {
    g.fillStyle = '#6e2420';
    g.beginPath();
    g.moveTo(-mw, my + 0.004);
    g.quadraticCurveTo(0, my - 0.003, mw, my + 0.004);
    g.quadraticCurveTo(0, my - 0.022, -mw, my + 0.004);
    g.fill();
    g.fillStyle = '#fffaf2';
    g.beginPath();
    g.moveTo(-mw * 0.8, my + 0.002);
    g.quadraticCurveTo(0, my - 0.003, mw * 0.8, my + 0.002);
    g.quadraticCurveTo(0, my - 0.007, -mw * 0.8, my + 0.002);
    g.fill();
    g.fillStyle = 'rgba(230,110,110,0.8)';
    g.beginPath();
    g.ellipse(0, my - 0.012, mw * 0.45, 0.004, 0, 0, Math.PI * 2);
    g.fill();
  } else if (f.lip) {
    g.fillStyle = f.lip;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(-mw, my + 0.002);
    g.quadraticCurveTo(-mw * 0.4, my + 0.009, 0, my + 0.005);
    g.quadraticCurveTo(mw * 0.4, my + 0.009, mw, my + 0.002);
    g.quadraticCurveTo(0, my - 0.014, -mw, my + 0.002);
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(90,25,25,0.8)';
    g.lineWidth = 0.0026;
    g.beginPath();
    g.moveTo(-mw, my + 0.002);
    g.quadraticCurveTo(0, my - 0.005, mw, my + 0.002);
    g.stroke();
  } else {
    g.strokeStyle = 'rgba(105,40,30,0.9)';
    g.lineCap = 'round';
    g.lineWidth = 0.0036;
    g.beginPath();
    g.moveTo(-mw, my + 0.004);
    g.quadraticCurveTo(0, my - 0.008, mw, my + 0.004);
    g.stroke();
    g.strokeStyle = 'rgba(105,40,30,0.25)';
    g.lineWidth = 0.003;
    g.beginPath();
    g.moveTo(-mw * 0.5, my - 0.012);
    g.quadraticCurveTo(0, my - 0.016, mw * 0.5, my - 0.012);
    g.stroke();
  }
  if (f.lines) {
    g.strokeStyle = 'rgba(70,30,15,0.2)';
    g.lineWidth = 0.0028;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * 0.018, ny + 0.002);
      g.quadraticCurveTo(sx * 0.03, my, sx * 0.026, my - 0.012);
      g.stroke();
      // soft bags under the eyes
      g.strokeStyle = 'rgba(70,30,15,0.16)';
      g.lineWidth = 0.0022;
      g.beginPath();
      g.ellipse(sx * ex, ey - eh * 0.2, ew * 0.85, eh * 1.25, 0, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
      g.strokeStyle = 'rgba(70,30,15,0.2)';
      g.lineWidth = 0.0028;
    }
    // two gentle lines across the forehead
    g.strokeStyle = 'rgba(70,30,15,0.17)';
    g.lineWidth = 0.0024;
    for (const y of [0.052, 0.064]) {
      g.beginPath();
      g.moveTo(-0.034, y - 0.002);
      g.quadraticCurveTo(0, y + 0.004, 0.034, y - 0.002);
      g.stroke();
    }
  }
  if (f.beard) paintBeard(g, f.beard, my);
}

/*
  The hairline, painted where the hair meets the forehead so it is a shaped, soft edge instead of
  the straight step between two rings of the head: a man's with set-back temples and sideburns, a
  woman's swept from a centre parting to frame the face. The hair shell rises from just above it.
*/
function paintHairline(g, f) {
  const ink = f.ink ?? INK;
  const kid = !!f.kid;
  const elder = !!f.lines;
  const top = 0.15;
  g.save();
  g.fillStyle = ink;
  const path = (k) => {
    g.beginPath();
    if (f.hl === 'm') {
      // about one nose-length above the brows, the temples set back a touch, then down the sides
      // to the sideburns
      const c = (kid ? 0.098 : elder ? 0.112 : 0.103) + k;
      const tmp = (kid ? 0.104 : elder ? 0.122 : 0.11) + k;
      g.moveTo(-0.13, top);
      g.lineTo(-0.13, 0.05);
      g.quadraticCurveTo(-0.1 + k, 0.058, -0.094 + k, 0.08);
      g.bezierCurveTo(-0.09 + k, tmp, -0.075 + k, tmp + 0.002, -0.056, tmp);
      g.quadraticCurveTo(-0.025, c - 0.001, 0, c);
      g.quadraticCurveTo(0.025, c - 0.001, 0.056, tmp);
      g.bezierCurveTo(0.075 - k, tmp + 0.002, 0.09 - k, tmp, 0.094 - k, 0.08);
      g.quadraticCurveTo(0.1 - k, 0.058, 0.13, 0.05);
      g.lineTo(0.13, top);
      g.closePath();
    } else {
      // swept from a centre parting down to frame the face
      const c = (kid ? 0.094 : 0.104) + k;
      for (const sx of [-1, 1]) {
        g.moveTo(sx * 0.0045, top);
        g.lineTo(sx * 0.0045, c + 0.004);
        g.bezierCurveTo(sx * 0.03, c, sx * 0.068, c - 0.01 - k, sx * 0.084 - sx * k, 0.045);
        g.quadraticCurveTo(sx * 0.093 - sx * k, 0.015, sx * 0.097 - sx * k, -0.01);
        g.lineTo(sx * 0.13, -0.01);
        g.lineTo(sx * 0.13, top);
        g.closePath();
      }
    }
  };
  // a soft fringe of baby hairs, then the hair itself
  g.globalAlpha = 0.3;
  path(-0.004);
  g.fill();
  g.globalAlpha = 1;
  path(0);
  g.fill();
  // strands: light and dark, combed back from the hairline
  g.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    const x = -0.085 + i * 0.0081;
    const sx = f.hl === 'f' ? Math.sign(x || 1) : 1;
    g.strokeStyle = i % 3 ? 'rgba(0,0,0,0.25)' : 'rgba(255,232,205,0.16)';
    g.lineWidth = 0.0022;
    g.beginPath();
    const y0 = f.hl === 'm' ? 0.108 + Math.abs(x) * 0.1 : 0.108 - Math.abs(x) * 0.35;
    g.moveTo(x, y0);
    g.quadraticCurveTo(x + sx * 0.01, y0 + 0.02, x + sx * 0.02, top);
    g.stroke();
  }
  g.restore();
}

/* A full beard along the jaw and round the chin, leaving the lips clear (head units). */
function paintBeard(g, color, my) {
  const shape = (grow) => {
    g.beginPath();
    g.moveTo(-0.098 - grow, 0.004);
    g.quadraticCurveTo(-0.096 - grow, -0.09, -0.045, -0.13 - grow);
    g.quadraticCurveTo(0, -0.15 - grow, 0.045, -0.13 - grow);
    g.quadraticCurveTo(0.096 + grow, -0.09, 0.098 + grow, 0.004);
    g.lineTo(0.082 - grow, 0.004);
    g.quadraticCurveTo(0.074 - grow, -0.04, 0.042, my - 0.004 + grow);
    g.quadraticCurveTo(0.022, my - 0.02 + grow, 0, my - 0.018 + grow);
    g.quadraticCurveTo(-0.022, my - 0.02 + grow, -0.042, my - 0.004 + grow);
    g.quadraticCurveTo(-0.074 + grow, -0.04, -0.082 + grow, 0.004);
    g.closePath();
  };
  // a soft stubble edge, then the beard itself
  g.globalAlpha = 0.35;
  g.fillStyle = color;
  shape(0.006);
  g.fill();
  g.globalAlpha = 1;
  shape(0);
  g.fill();
  // a few strands so it reads as hair, not paint
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 0.0018;
  for (let i = 0; i < 16; i++) {
    const x = -0.07 + i * 0.0094;
    g.beginPath();
    g.moveTo(x, my - 0.03 - Math.abs(x) * 0.2);
    g.lineTo(x * 0.92, my - 0.055 - (0.07 - Math.abs(x)) * 0.25);
    g.stroke();
  }
}
