import * as THREE from 'three';
import { beam, hdr } from './utils.js';
import { restockStall } from './stalls.js';
import { STALL_THEMES, themedGoods } from './stallThemes.js';
import { Garlands } from './garlands.js';
import { mergeStatic } from './merge.js';

/*
  Creator personalisation: a creator's own mela. Their name and photo are painted on "their"
  bazaar stall (a big hand-painted board over the counter) and on a crowd banner at the Ravan
  Dahan, the way a local sponsor's face greets you at every real mela.

  Config comes from ?cfg=<base64url JSON> (director / capture), or ?c=<slug>, a global
  window.__MELA_CREATOR__ = '<slug>', or <meta name="mela-creator" content="<slug>"> (the
  launch service's /<slug> page), fetched from `${VITE_CREATOR_API}/api/creators/<slug>.json`.

  CreatorConfig = {
    slug, name, first, photoUrl, stallNo,
    stallTitle?: string,   // the stall sign, e.g. "Aishwarya ki AI Dukaan" (default: "{name} ka Stall")
    stallTheme?: 'books' | 'tech' | 'fitness' | 'food' | 'finance' | 'fashion' | 'art' | 'music' | 'travel' | 'career' | 'general',
    wallPosts?: string[],  // up to 4 image URLs (4:5) for the Wall of Fame next to the stall
    knownFor?: string,     // a short phrase, e.g. "Data science"; painted small on the stall sign
  }
*/

const SLUG_RE = /^[a-z0-9._-]{1,40}$/;

function decodeB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encodes a config for ?cfg= (handy for tools and tests). */
export function encodeCreatorConfig(cfg) {
  const bytes = new TextEncoder().encode(JSON.stringify(cfg));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  const slug = String(raw.slug ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'creator';
  const first = String(raw.first ?? '').trim().slice(0, 24) || name.split(/\s+/)[0];
  const stallNo = Math.max(1, Math.floor(Number(raw.stallNo) || 1));
  const photoUrl = typeof raw.photoUrl === 'string' ? raw.photoUrl : '';
  // collapse whitespace; an over-long phrase is cut at a word boundary, never mid-word
  const text = (v, n) => {
    const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    if (t.length <= n) return t;
    const cut = t.slice(0, n + 1).lastIndexOf(' ');
    return (cut > n * 0.5 ? t.slice(0, cut) : t.slice(0, n)).replace(/[\s,;:·-]+$/, '');
  };
  const stallTitle = text(raw.stallTitle, 48);
  const stallTheme = STALL_THEMES.includes(raw.stallTheme) ? raw.stallTheme : 'general';
  const knownFor = text(raw.knownFor, 40);
  const wallPosts = (Array.isArray(raw.wallPosts) ? raw.wallPosts : [])
    .filter((u) => typeof u === 'string' && /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(u))
    .slice(0, 4);
  return { slug, name, first, photoUrl, stallNo, stallTitle, stallTheme, knownFor, wallPosts };
}

function slugFromPage(params) {
  const fromParam = params.get('c');
  if (fromParam) return fromParam;
  if (typeof window !== 'undefined' && typeof window.__MELA_CREATOR__ === 'string') return window.__MELA_CREATOR__;
  return document.querySelector('meta[name="mela-creator"]')?.getAttribute('content') || '';
}

/** Reads the creator for this page, or null when the page is the plain mela. Never throws. */
export async function loadCreatorConfig(params) {
  try {
    const cfg = params.get('cfg');
    if (cfg) return normalise(JSON.parse(decodeB64url(cfg)));
    const slug = slugFromPage(params).toLowerCase();
    if (!slug || !SLUG_RE.test(slug)) return null;
    const base = import.meta.env.VITE_CREATOR_API ?? '';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(`${base}/api/creators/${encodeURIComponent(slug)}.json`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return normalise({ slug, ...(await res.json()) });
  } catch {
    return null;
  }
}

/** Which bazaar stall (0-based) a stall number lands on: 1 is nearest the entrance. */
export function stallIndexFor(stallNo, count) {
  return (((Math.floor(stallNo) || 1) - 1) % count + count) % count;
}

// ---------- painting ----------

const YATRA = '"Yatra One", "Poppins", serif';
const POP = 'Poppins, sans-serif';

/** Loads the photo; resolves null on any failure (404, CORS, timeout). */
function loadPhoto(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => resolve(null), 10000);
    img.onload = () => {
      clearTimeout(timer);
      // a tainted canvas would throw on readback during capture; probe once
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 4;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 4, 4);
        x.getImageData(0, 0, 1, 1);
        resolve(img.naturalWidth > 8 ? img : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/** A cheap deterministic hash so colours / grain are the same on every capture. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AVATAR_COLORS = ['#c1121f', '#7b2cbf', '#0b6e4f', '#d1495b', '#1d4e89', '#b5651d'];

/** Circle portrait: the photo (center-cropped) or an illustrated initial. */
function drawPortrait(c, img, cfg, cx, cy, r) {
  c.save();
  // gold ring with a dark outline, like a painted medallion
  c.beginPath();
  c.arc(cx, cy, r + r * 0.13, 0, Math.PI * 2);
  c.fillStyle = '#3b1d0b';
  c.fill();
  const ring = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, '#fff0a8');
  ring.addColorStop(0.45, '#e2a72e');
  ring.addColorStop(1, '#9c6a12');
  c.beginPath();
  c.arc(cx, cy, r + r * 0.1, 0, Math.PI * 2);
  c.fillStyle = ring;
  c.fill();
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.closePath();
  c.clip();
  if (img) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2;
    const sy = (img.naturalHeight - s) / 2.6; // portraits: keep a little more of the top (faces)
    c.drawImage(img, sx, Math.max(0, sy), s, s, cx - r, cy - r, r * 2, r * 2);
    // a warm wash and soft vignette so the photo sits in the painting instead of on it
    c.globalCompositeOperation = 'soft-light';
    c.fillStyle = 'rgba(255,170,80,0.35)';
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
    c.globalCompositeOperation = 'source-over';
    const v = c.createRadialGradient(cx, cy, r * 0.6, cx, cy, r);
    v.addColorStop(0, 'rgba(40,10,0,0)');
    v.addColorStop(1, 'rgba(40,10,0,0.35)');
    c.fillStyle = v;
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
  } else {
    const bg = AVATAR_COLORS[hash(cfg.slug) % AVATAR_COLORS.length];
    const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(0.18, bg);
    g.addColorStop(1, '#2a0a06');
    c.fillStyle = g;
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
    // little painted rangoli dots around the letter
    c.fillStyle = 'rgba(255,220,140,0.55)';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      c.beginPath();
      c.arc(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, r * 0.045, 0, Math.PI * 2);
      c.fill();
    }
    const letter = [...cfg.name.trim()][0]?.toUpperCase() || '?';
    c.font = `${Math.round(r * 1.15)}px ${YATRA}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillText(letter, cx + r * 0.05, cy + r * 0.12);
    c.fillStyle = '#ffe7a3';
    c.fillText(letter, cx, cy + r * 0.07);
  }
  c.restore();
}

/** A string of marigolds along a path of points (painted, not modelled). */
function marigoldLine(c, pts, size, rnd) {
  const cols = ['#ff8c00', '#ffb000', '#ff6d00', '#ffc300'];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const col = cols[Math.floor(rnd() * cols.length)];
    c.fillStyle = 'rgba(70,20,0,0.45)';
    c.beginPath();
    c.arc(x + size * 0.12, y + size * 0.15, size, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = col;
    c.beginPath();
    c.arc(x, y, size, 0, Math.PI * 2);
    c.fill();
    // petals: a few darker ticks
    c.strokeStyle = 'rgba(160,50,0,0.55)';
    c.lineWidth = Math.max(1, size * 0.14);
    for (let k = 0; k < 6; k++) {
      const a = rnd() * Math.PI * 2;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * size * 0.25, y + Math.sin(a) * size * 0.25);
      c.lineTo(x + Math.cos(a) * size * 0.85, y + Math.sin(a) * size * 0.85);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,240,170,0.6)';
    c.beginPath();
    c.arc(x - size * 0.25, y - size * 0.25, size * 0.25, 0, Math.PI * 2);
    c.fill();
  }
}

function framePoints(x0, y0, x1, y1, step) {
  const pts = [];
  const w = x1 - x0;
  const h = y1 - y0;
  const nx = Math.max(1, Math.round(w / step));
  const ny = Math.max(1, Math.round(h / step));
  for (let i = 0; i < nx; i++) pts.push([x0 + (w * i) / nx, y0]);
  for (let i = 0; i < ny; i++) pts.push([x1, y0 + (h * i) / ny]);
  for (let i = 0; i < nx; i++) pts.push([x1 - (w * i) / nx, y1]);
  for (let i = 0; i < ny; i++) pts.push([x0, y1 - (h * i) / ny]);
  return pts;
}

/** Brush-like grain over everything: makes flat fills read as paint on wood/cloth. */
function grain(c, w, h, rnd, alpha = 0.06, n = 9000) {
  c.save();
  for (let i = 0; i < n; i++) {
    c.globalAlpha = alpha * (0.4 + rnd());
    c.fillStyle = rnd() > 0.5 ? '#fff' : '#000';
    c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1);
  }
  c.restore();
}

/** Fits text to a width by shrinking the font; returns the size used. */
function fitFont(c, text, family, weight, size, maxW, min = 18) {
  let s = size;
  c.font = `${weight}${s}px ${family}`;
  while (c.measureText(text).width > maxW && s > min) {
    s -= 2;
    c.font = `${weight}${s}px ${family}`;
  }
  return s;
}

/** Painted lettering: a dark offset shadow, a dark outline, then the fill. */
function paintText(c, text, x, y, { fill = '#ffe7a3', stroke = '#2a0c04', shadow = 'rgba(0,0,0,0.45)', lw = 8, off = 5 } = {}) {
  c.lineJoin = 'round';
  c.fillStyle = shadow;
  c.fillText(text, x + off, y + off);
  c.strokeStyle = stroke;
  c.lineWidth = lw;
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

/**
 * The creator's own stall name ("Aishwarya ki AI Dukaan"): one big line when it fits, else two
 * lines broken at the word nearest the middle, the second in saffron like a sign-painter's "ka Stall".
 */
function paintStallTitle(c, cfg, h, tcx, maxW) {
  const title = cfg.stallTitle;
  const one = fitFont(c, title, YATRA, '', Math.round(h * 0.2), maxW, 20);
  const words = title.split(' ');
  if (one >= Math.round(h * 0.15) || words.length < 2) {
    paintText(c, title, tcx, h * 0.56, { fill: '#ffe7a3', lw: 9, off: 5 });
    return;
  }
  // break so the first line is the longer (the name), e.g. "Aishwarya ki" / "AI Dukaan"
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const d = Math.abs(a - b) + (a < b ? 0.5 : 0);
    if (d < bestD) [best, bestD] = [i, d];
  }
  const l1 = words.slice(0, best).join(' ');
  const l2 = words.slice(best).join(' ');
  const s1 = fitFont(c, l1, YATRA, '', Math.round(h * 0.2), maxW, 20);
  const s2 = fitFont(c, l2, YATRA, '', Math.round(h * 0.2), maxW, 20);
  const size = Math.min(s1, s2);
  c.font = `${size}px ${YATRA}`;
  paintText(c, l1, tcx, h * 0.43, { fill: '#ffe7a3', lw: 9, off: 5 });
  paintText(c, l2, tcx, h * 0.43 + size * 1.02, { fill: '#ffb000', lw: 9, off: 5 });
}

/** The stall board: carved wood frame, maroon painted panel, marigolds, portrait, name. */
function paintStallBoard(c, w, h, cfg, img) {
  const rnd = prng(hash(cfg.slug) ^ 0x51a11);
  c.clearRect(0, 0, w, h);
  // wood frame with grain
  const wood = c.createLinearGradient(0, 0, 0, h);
  wood.addColorStop(0, '#7a4a22');
  wood.addColorStop(0.5, '#5a3216');
  wood.addColorStop(1, '#3e220e');
  c.fillStyle = wood;
  c.beginPath();
  c.roundRect(0, 0, w, h, 26);
  c.fill();
  c.strokeStyle = 'rgba(30,12,2,0.35)';
  c.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const y = rnd() * h;
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(w * 0.3, y + rnd() * 10 - 5, w * 0.7, y + rnd() * 10 - 5, w, y + rnd() * 6 - 3);
    c.stroke();
  }
  // painted panel
  const m = 30;
  const panel = c.createLinearGradient(0, m, 0, h - m);
  panel.addColorStop(0, '#8e1422');
  panel.addColorStop(1, '#5c0a14');
  c.fillStyle = panel;
  c.beginPath();
  c.roundRect(m, m, w - 2 * m, h - 2 * m, 16);
  c.fill();
  // thin yellow pinstripe + a green inner stripe, the sign-painter's trademark
  c.strokeStyle = '#ffd166';
  c.lineWidth = 5;
  c.beginPath();
  c.roundRect(m + 14, m + 14, w - 2 * m - 28, h - 2 * m - 28, 12);
  c.stroke();
  c.strokeStyle = '#2d8a4e';
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(m + 24, m + 24, w - 2 * m - 48, h - 2 * m - 48, 10);
  c.stroke();
  // corner paisleys (simple painted teardrops)
  c.fillStyle = '#ffb000';
  for (const [x, y, a] of [[m + 48, m + 48, 0.8], [w - m - 48, m + 48, 2.4], [w - m - 48, h - m - 48, 3.9], [m + 48, h - m - 48, 5.5]]) {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.beginPath();
    c.ellipse(0, 0, 9, 15, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // portrait on the left
  const r = h * 0.3;
  const pcx = m + 40 + r * 1.12;
  const pcy = h / 2;
  drawPortrait(c, img, cfg, pcx, pcy, r);

  // lettering on the right
  const tx0 = pcx + r * 1.25 + 18;
  const tx1 = w - m - 40;
  const tcx = (tx0 + tx1) / 2;
  const maxW = tx1 - tx0;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  if (cfg.stallTitle) paintStallTitle(c, cfg, h, tcx, maxW);
  else {
    fitFont(c, cfg.name, YATRA, '', Math.round(h * 0.25), maxW, 30);
    paintText(c, cfg.name, tcx, h * 0.48, { fill: '#ffe7a3', lw: 9, off: 5 });
    const sub = 'ka Stall';
    fitFont(c, sub, YATRA, '', Math.round(h * 0.15), maxW, 20);
    paintText(c, sub, tcx, h * 0.665, { fill: '#ffb000', lw: 7, off: 4 });
  }
  const small = cfg.knownFor ? `${cfg.knownFor}  ·  Stall No. ${cfg.stallNo}` : `Stall No. ${cfg.stallNo}  ·  Topmate Diwali Mela`;
  fitFont(c, small, POP, '600 ', Math.round(h * 0.068), maxW, 14);
  c.fillStyle = 'rgba(255,231,163,0.85)';
  c.fillText(small, tcx, h * 0.8);

  marigoldLine(c, framePoints(m - 6, m - 6, w - m + 6, h - m + 6, 26), 11, rnd);
  grain(c, w, h, rnd);
}

/** The crowd banner: saffron cloth, a red border, the creator's portrait, a sponsor's greeting. */
function paintBanner(c, w, h, cfg, img) {
  const rnd = prng(hash(cfg.slug) ^ 0xba22e5);
  c.clearRect(0, 0, w, h);
  const cloth = c.createLinearGradient(0, 0, 0, h);
  cloth.addColorStop(0, '#ffb43a');
  cloth.addColorStop(0.55, '#ff8a1f');
  cloth.addColorStop(1, '#e8650c');
  c.fillStyle = cloth;
  c.fillRect(0, 0, w, h);
  // weave
  c.globalAlpha = 0.05;
  c.fillStyle = '#000';
  for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
  for (let x = 0; x < w; x += 4) c.fillRect(x, 0, 1, h);
  c.globalAlpha = 1;
  // border: maroon band with a gold zigzag
  const b = 34;
  c.fillStyle = '#8e1422';
  c.fillRect(0, 0, w, b);
  c.fillRect(0, h - b, w, b);
  c.fillRect(0, 0, b, h);
  c.fillRect(w - b, 0, b, h);
  c.strokeStyle = '#ffd166';
  c.lineWidth = 4;
  for (const y of [b / 2, h - b / 2]) {
    c.beginPath();
    for (let x = 0; x <= w; x += 20) c.lineTo(x, y + ((x / 20) % 2 ? -7 : 7));
    c.stroke();
  }
  for (const x of [b / 2, w - b / 2]) {
    c.beginPath();
    for (let y = 0; y <= h; y += 20) c.lineTo(x + ((y / 20) % 2 ? -7 : 7), y);
    c.stroke();
  }
  // a toran of marigolds swagging along the top
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    for (let k = 0; k < 9; k++) {
      const u = k / 9;
      const x = b + ((i + u) * (w - 2 * b)) / 6;
      if (x > w - b) break;
      pts.push([x, b + 8 + Math.sin(u * Math.PI) * 26]);
    }
  }
  marigoldLine(c, pts, 10, rnd);

  // portrait large on the left
  const r = h * 0.3;
  const pcx = b + 50 + r * 1.1;
  const pcy = h * 0.55;
  drawPortrait(c, img, cfg, pcx, pcy, r);

  const tx0 = pcx + r * 1.25 + 20;
  const tx1 = w - b - 40;
  const tcx = (tx0 + tx1) / 2;
  const maxW = tx1 - tx0;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  fitFont(c, 'Topmate Diwali Mela', POP, '700 ', Math.round(h * 0.07), maxW, 14);
  c.fillStyle = '#5c0a14';
  c.fillText('TOPMATE DIWALI MELA', tcx, h * 0.27);
  fitFont(c, cfg.name, YATRA, '', Math.round(h * 0.2), maxW, 30);
  paintText(c, cfg.name, tcx, h * 0.49, { fill: '#7a0c18', stroke: '#fff1c4', shadow: 'rgba(90,20,0,0.35)', lw: 9, off: 4 });
  fitFont(c, 'ki or se', YATRA, '', Math.round(h * 0.11), maxW, 18);
  paintText(c, 'ki or se', tcx, h * 0.635, { fill: '#3a0508', stroke: 'rgba(255,240,200,0.8)', shadow: 'rgba(0,0,0,0)', lw: 5, off: 0 });
  fitFont(c, 'Diwali ki Hardik Shubhkamnayein!', YATRA, '', Math.round(h * 0.1), maxW, 18);
  paintText(c, 'Diwali ki Hardik Shubhkamnayein!', tcx, h * 0.8, { fill: '#fff1c4', stroke: '#7a0c18', lw: 9, off: 4 });
  grain(c, w, h, rnd, 0.05, 7000);
}

// ---------- the Wall of Fame ----------

/*
  A carved wooden hoarding beside the creator's stall: an arched board with their reels/posts in
  wood-and-gold frames (2 x 2, 4:5), a hand-painted header "{First} ke Hits", marigold strings
  and fairy lights. All the painting is one canvas on one plane; frames, posts and the board are
  merged; marigolds and bulbs are one instanced mesh each.
*/
const WALL = {
  PW: 1.0, // poster (4:5)
  PH: 1.25,
  GAP: 0.16,
  MX: 0.17, // side margin
  Y0: 0.8, // board bottom
  PX: 400, // canvas px per metre
};
WALL.BW = 2 * WALL.PW + WALL.GAP + 2 * WALL.MX; // 2.5
WALL.ROW1 = WALL.Y0 + 0.17; // bottom row's lower edge
WALL.ROW2 = WALL.ROW1 + WALL.PH + WALL.GAP;
WALL.HEAD0 = WALL.ROW2 + WALL.PH + 0.07; // header band
WALL.HEAD1 = WALL.HEAD0 + 0.62;
WALL.TOP = WALL.HEAD1 + 0.3; // crest of the arch
WALL.BH = WALL.TOP - WALL.Y0;

/** Poster rects in wall-local metres: [x0, y0] lower-left, top row first (reading order). */
function posterRects() {
  const { PW, PH, GAP, ROW1, ROW2 } = WALL;
  const xs = [-GAP / 2 - PW, GAP / 2];
  return [ROW2, ROW1].flatMap((y) => xs.map((x) => [x, y]));
}

/** The board outline in canvas px: a rectangle with a cusped (Mughal-style) arch on top. */
function boardPath(c, w, h, inset = 0) {
  const { PX, HEAD1, TOP, Y0 } = WALL;
  const shoulder = h - (HEAD1 - Y0) * PX; // canvas y where the arch starts
  const crest = (TOP - Y0) * PX;
  const i = inset;
  c.beginPath();
  c.moveTo(i, h - i);
  c.lineTo(i, shoulder + i * 0.5);
  c.bezierCurveTo(w * 0.18, shoulder + i * 0.5, w * 0.3, h - crest * 0.985 + i, w / 2, h - crest + i);
  c.bezierCurveTo(w * 0.7, h - crest * 0.985 + i, w * 0.82, shoulder + i * 0.5, w - i, shoulder + i * 0.5);
  c.lineTo(w - i, h - i);
  c.closePath();
}

/** Draws an image cover-cropped into a rect, with the warm wash that sits it into the painting. */
function drawCover(c, img, x, y, w, h) {
  const r = w / h;
  const ir = img.naturalWidth / img.naturalHeight;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (ir > r) sw = sh * r;
  else sh = sw / r;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  c.save();
  c.globalCompositeOperation = 'soft-light';
  c.fillStyle = 'rgba(255,175,90,0.22)';
  c.fillRect(x, y, w, h);
  c.restore();
}

const PLACEHOLDER = [
  ['#5c0a14', '#c1121f'],
  ['#13306b', '#3a86ff'],
  ['#0d4f2b', '#1f9d55'],
  ['#3c1361', '#7b2cbf'],
];

/** A painted placeholder for a poster that is missing or failed to load: a diya on a rangoli. */
function paintPlaceholder(c, x, y, w, h, i, rnd) {
  const [a, b] = PLACEHOLDER[i % PLACEHOLDER.length];
  const g = c.createRadialGradient(x + w / 2, y + h * 0.55, w * 0.05, x + w / 2, y + h / 2, w * 0.8);
  g.addColorStop(0, b);
  g.addColorStop(1, a);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h * 0.56;
  // rangoli petals in rings
  const rings = [[w * 0.36, 16, '#ffd166'], [w * 0.27, 12, '#ff8fab'], [w * 0.18, 8, '#ffffff']];
  for (const [r, n, col] of rings) {
    c.fillStyle = col;
    c.globalAlpha = 0.75;
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2;
      c.beginPath();
      c.ellipse(cx + Math.cos(t) * r, cy + Math.sin(t) * r * 0.9, w * 0.035, w * 0.016, t, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  // the diya
  c.fillStyle = '#b5562b';
  c.beginPath();
  c.ellipse(cx, cy + w * 0.03, w * 0.13, w * 0.06, 0, 0, Math.PI);
  c.fill();
  c.fillStyle = '#7a3412';
  c.fillRect(cx - w * 0.13, cy + w * 0.02, w * 0.26, w * 0.02);
  const f = c.createRadialGradient(cx, cy - w * 0.06, 2, cx, cy - w * 0.04, w * 0.16);
  f.addColorStop(0, 'rgba(255,250,210,1)');
  f.addColorStop(0.25, 'rgba(255,190,60,0.9)');
  f.addColorStop(1, 'rgba(255,120,0,0)');
  c.fillStyle = f;
  c.beginPath();
  c.arc(cx, cy - w * 0.05, w * 0.16, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff3c4';
  c.beginPath();
  c.ellipse(cx, cy - w * 0.045, w * 0.022, w * 0.05, 0, 0, Math.PI * 2);
  c.fill();
  grain(c, w, h, rnd, 0.04, 600);
}

function paintWall(c, w, h, cfg, imgs) {
  const { PX, Y0, PW, PH, HEAD0, HEAD1 } = WALL;
  const rnd = prng(hash(cfg.slug) ^ 0xfa4e);
  c.clearRect(0, 0, w, h);
  const Y = (m) => h - (m - Y0) * PX; // wall metres -> canvas y
  const X = (m) => w / 2 + m * PX;

  // carved wood border, then the painted panel
  boardPath(c, w, h);
  const wood = c.createLinearGradient(0, 0, w, 0);
  wood.addColorStop(0, '#4a2810');
  wood.addColorStop(0.5, '#7a4a22');
  wood.addColorStop(1, '#4a2810');
  c.fillStyle = wood;
  c.fill();
  boardPath(c, w, h, 26);
  const panel = c.createLinearGradient(0, 0, 0, h);
  panel.addColorStop(0, '#8e1422');
  panel.addColorStop(0.5, '#6a0e1a');
  panel.addColorStop(1, '#4a0912');
  c.fillStyle = panel;
  c.fill();
  // a damask of tiny gold buti over the panel
  c.save();
  boardPath(c, w, h, 26);
  c.clip();
  c.fillStyle = 'rgba(255,209,102,0.13)';
  for (let yy = 30; yy < h; yy += 46)
    for (let xx = (yy / 46) % 2 ? 23 : 0; xx < w; xx += 46) {
      c.beginPath();
      c.ellipse(xx, yy, 5, 9, 0.6, 0, Math.PI * 2);
      c.fill();
    }
  c.restore();
  c.strokeStyle = '#ffd166';
  c.lineWidth = 5;
  boardPath(c, w, h, 40);
  c.stroke();
  c.strokeStyle = '#2d8a4e';
  c.lineWidth = 3;
  boardPath(c, w, h, 50);
  c.stroke();

  // header: "{First} ke Hits" in sign-painter's lettering
  const hasPosts = imgs.some(Boolean);
  const title = hasPosts ? `${cfg.first} ke Hits` : 'Shubh Deepavali';
  const hy = (Y(HEAD0) + Y(HEAD1)) / 2;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  fitFont(c, title, YATRA, '', 150, w - 200, 40);
  paintText(c, title, w / 2, hy + 6, { fill: '#ffe7a3', lw: 12, off: 6 });
  // little diyas flanking the header, and a star at the crest
  for (const s of [-1, 1]) {
    const x = w / 2 + s * (w / 2 - 92);
    c.fillStyle = '#ffb000';
    c.beginPath();
    c.ellipse(x, hy + 22, 26, 11, 0, 0, Math.PI);
    c.fill();
    c.fillStyle = '#fff3c4';
    c.beginPath();
    c.ellipse(x, hy + 4, 7, 17, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.font = `64px ${YATRA}`;
  paintText(c, '✦', w / 2, Y(WALL.TOP) + 70, { fill: '#ffd166', lw: 6, off: 3 });

  // posters
  posterRects().forEach(([x0, y0], i) => {
    const x = X(x0);
    const y = Y(y0 + PH);
    const pw = PW * PX;
    const ph = PH * PX;
    // a soft shadow of the frame on the board
    c.fillStyle = 'rgba(20,4,0,0.55)';
    c.fillRect(x - 18, y - 10, pw + 44, ph + 44);
    const img = imgs[i];
    if (img) drawCover(c, img, x, y, pw, ph);
    else paintPlaceholder(c, x, y, pw, ph, i, rnd);
    // inner shadow under the frame lip, and a faint glass sheen
    const sh = c.createLinearGradient(x, y, x, y + 40);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sh;
    c.fillRect(x, y, pw, 40);
    const gl = c.createLinearGradient(x, y, x + pw, y + ph);
    gl.addColorStop(0, 'rgba(255,255,255,0)');
    gl.addColorStop(0.42, 'rgba(255,255,255,0)');
    gl.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    gl.addColorStop(0.58, 'rgba(255,255,255,0)');
    c.fillStyle = gl;
    c.fillRect(x, y, pw, ph);
  });
  grain(c, w, h, rnd, 0.035, 6000);
}

/**
 * Builds the Wall of Fame in the gap beside the stall (towards the entrance).
 * Returns { group, center (world, the middle of the posters), paint(imgs), update(t) }.
 */
function buildWall(scene, stallAnchor, cfg, colliders) {
  const { BW, BH, Y0, TOP, PW, PH } = WALL;
  const sg = stallAnchor.group;
  sg.updateMatrixWorld(true);
  const out = new THREE.Vector3(0, 0, 1).transformDirection(sg.matrixWorld).setY(0).normalize();
  const grp = new THREE.Group();
  grp.name = 'creatorWall';
  // in the gap towards the gate, set back a little from the counters; kept just clear of the
  // stall's roof so the aisle's light pole (1 m past the gap's middle) never stands in front of it
  grp.position.copy(sg.position).addScaledVector(out, 0.7);
  grp.position.z += 4.4;
  grp.position.y = 0;
  grp.rotation.y = Math.atan2(out.x, out.z);
  scene.add(grp);

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b3d1c, roughness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3e220e, roughness: 0.8 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe0b04a, roughness: 0.3, metalness: 0.8 });
  const statics = new THREE.Group();
  grp.add(statics);
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    statics.add(m);
    return m;
  };

  // the arched backing board, extruded from the same outline the canvas paints
  const sh = new THREE.Shape();
  const hw = BW / 2;
  const shoulder = WALL.HEAD1;
  sh.moveTo(-hw, Y0);
  sh.lineTo(hw, Y0);
  sh.lineTo(hw, shoulder);
  const c2 = TOP - 0.015 * (TOP - Y0);
  sh.bezierCurveTo(BW * 0.32, shoulder, BW * 0.2, c2, 0, TOP);
  sh.bezierCurveTo(-BW * 0.2, c2, -BW * 0.32, shoulder, -hw, shoulder);
  sh.closePath();
  const back = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false, curveSegments: 10 }), darkMat);
  back.position.z = -0.1;
  statics.add(back);

  // two carved posts with brass finials, and plinths
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.09);
    box(0.16, TOP + 0.15, 0.16, woodMat, x, (TOP + 0.15) / 2, -0.04);
    box(0.26, 0.3, 0.26, darkMat, x, 0.15, -0.04);
    for (const y of [1.0, 2.4, 3.8]) box(0.2, 0.06, 0.2, goldMat, x, y, -0.04);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), goldMat);
    fin.position.set(x, TOP + 0.22, -0.04);
    statics.add(fin);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 10), goldMat);
    tip.position.set(x, TOP + 0.38, -0.04);
    statics.add(tip);
  }
  // a little ledge with diyas at the foot of the board
  box(BW + 0.1, 0.05, 0.22, woodMat, 0, Y0 - 0.02, 0.04);

  // carved frames: a wood moulding with a gold fillet inside, standing proud of the board
  const FW = 0.07;
  for (const [x0, y0] of posterRects()) {
    const cx = x0 + PW / 2;
    const cy = y0 + PH / 2;
    box(PW + 2 * FW, FW, 0.06, woodMat, cx, y0 + PH + FW / 2, 0.03);
    box(PW + 2 * FW, FW, 0.06, woodMat, cx, y0 - FW / 2, 0.03);
    box(FW, PH, 0.06, woodMat, x0 - FW / 2, cy, 0.03);
    box(FW, PH, 0.06, woodMat, x0 + PW + FW / 2, cy, 0.03);
    box(PW + 0.02, 0.018, 0.02, goldMat, cx, y0 + PH - 0.004, 0.012);
    box(PW + 0.02, 0.018, 0.02, goldMat, cx, y0 + 0.004, 0.012);
    box(0.018, PH, 0.02, goldMat, x0 + 0.004, cy, 0.012);
    box(0.018, PH, 0.02, goldMat, x0 + PW - 0.004, cy, 0.012);
  }
  mergeStatic(statics);

  // the painting
  const tex = makeCanvasTex(Math.round(BW * WALL.PX), Math.round(BH * WALL.PX));
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: tex.tex, transparent: true, alphaTest: 0.05 }));
  plane.position.set(0, Y0 + BH / 2, -0.015);
  plane.name = 'creatorWallPainting';
  grp.add(plane);

  // marigolds: a swag over the header and drops down both posts
  const gar = new Garlands(grp);
  gar.addSwag(V(-hw - 0.09, TOP + 0.05, 0.08), V(hw + 0.09, TOP + 0.05, 0.08), 0.42, 0.075);
  for (const s of [-1, 1]) gar.addDrop(V(s * (hw + 0.09), TOP - 0.05, 0.1), TOP - 1.0, 0.075);
  for (const s of [-1, 1]) gar.addSwag(V(s * (hw + 0.09), WALL.HEAD0 + 0.02, 0.09), V(0, WALL.HEAD0 - 0.01, 0.09), 0.05, 0.075);
  gar.build();

  // fairy lights along the arch and down the posts
  const bulbs = [];
  const arch = new THREE.CubicBezierCurve3(V(hw, shoulder, 0.02), V(BW * 0.32, shoulder, 0.02), V(BW * 0.2, TOP, 0.02), V(0, TOP, 0.02));
  for (let i = 0; i <= 10; i++) {
    const p = arch.getPoint(i / 10);
    bulbs.push(p.clone().add(V(0, 0.06, 0.02)), p.clone().setX(-p.x).add(V(0, 0.06, 0.02)));
  }
  for (const s of [-1, 1]) for (let y = 0.5; y < shoulder - 0.1; y += 0.28) bulbs.push(V(s * (hw + 0.17), y, 0.06));
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length);
  const d = new THREE.Object3D();
  bulbs.forEach((p, i) => {
    d.position.copy(p);
    d.updateMatrix();
    bulbMesh.setMatrixAt(i, d.matrix);
  });
  const WARM = [0xffd08a, 0xffb347, 0xfff1c4, 0xff8fab];
  const base = bulbs.map((_, i) => hdr(WARM[i % WARM.length], 2.2));
  const col = new THREE.Color();
  const twinkle = (t) => {
    base.forEach((c, i) => {
      const k = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.2 + i * 1.7));
      bulbMesh.setColorAt(i, col.copy(c).multiplyScalar(k));
    });
    bulbMesh.instanceColor.needsUpdate = true;
  };
  twinkle(0);
  bulbMesh.computeBoundingSphere();
  grp.add(bulbMesh);

  grp.traverse((o) => o.layers.set(1));
  grp.updateMatrixWorld(true);

  if (colliders) {
    const w = grp.position;
    const ex = Math.abs(out.x) > 0.5 ? 0.3 : hw + 0.2;
    const ez = Math.abs(out.x) > 0.5 ? hw + 0.2 : 0.3;
    colliders.push({ type: 'box', minX: w.x - ex, maxX: w.x + ex, minZ: w.z - ez, maxZ: w.z + ez });
  }

  return {
    group: grp,
    center: grp.localToWorld(V(0, (WALL.ROW1 + WALL.HEAD0) / 2, 0)),
    paint: (imgs) => {
      paintWall(tex.ctx, tex.canvas.width, tex.canvas.height, cfg, imgs);
      tex.tex.needsUpdate = true;
    },
    update: (t) => twinkle(t),
  };
}

function makeCanvasTex(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

/**
 * Dresses the mela for one creator.
 *  stallAnchor: an entry of world.stalls ({ group, ... }); the board goes over its counter.
 *  ravanAnchor: { pos: Vector3, facing: radians } for the crowd banner (faces along +z rotated by facing).
 *  colliders / diyas: the world's, so the Wall of Fame blocks walking and a re-stocked diya stall's diyas go.
 * Returns { stallBoard, banner, wall, ready (photo and posts painted), update(dt, t) }.
 */
export function applyCreator(scene, cfg, { stallAnchor, ravanAnchor, colliders, diyas } = {}) {
  const out = { cfg, stallBoard: null, banner: null, wall: null, ready: Promise.resolve(), update() {} };
  if (!cfg) return out;

  // ---- the stall stocked for their niche ----
  const goods = stallAnchor?.group && themedGoods(cfg.stallTheme, hash(cfg.slug));
  if (goods) {
    restockStall(stallAnchor, goods);
    diyas?.hideAt(stallAnchor.diyaSpots);
  }

  // ---- stall board ----
  const board = makeCanvasTex(1280, 480);
  let stallBoard = null;
  if (stallAnchor?.group) {
    const g = stallAnchor.group;
    // the stall's own name sign (kept out of the static merge) gives way to the creator's board
    const sign = stallAnchor.sign ?? g.children.find((o) => o.isMesh && o.geometry?.parameters?.width === 3.6 && o.geometry?.parameters?.height === 1.0);
    if (sign) sign.visible = false;
    stallBoard = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.8), new THREE.MeshBasicMaterial({ map: board.tex, color: new THREE.Color(1.02, 1.02, 1.02), transparent: true, alphaTest: 0.02, side: THREE.DoubleSide }));
    stallBoard.position.set(0, 3.55, 2.15); // stall local: above the counter, in front of the valance
    stallBoard.name = 'creatorStallBoard';
    g.add(stallBoard);
    // two little lamps aimed at the board, as a stall-wala would rig
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.8) });
    for (const s of [-1, 1]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), lampMat);
      bulb.position.set(s * 2.55, 4.5, 2.25);
      g.add(bulb);
    }
    g.updateMatrixWorld(true);
  }

  // ---- crowd banner on bamboo poles ----
  const ban = makeCanvasTex(1280, 720);
  let banner = null;
  let banGeo = null;
  let banBase = null;
  if (ravanAnchor?.pos) {
    const grp = new THREE.Group();
    grp.position.copy(ravanAnchor.pos);
    grp.rotation.y = ravanAnchor.facing ?? 0;
    const W = 5.2;
    const H = 2.92;
    const Y = 2.65;
    banGeo = new THREE.PlaneGeometry(W, H, 32, 6);
    banBase = banGeo.attributes.position.array.slice();
    banner = new THREE.Mesh(banGeo, new THREE.MeshBasicMaterial({ map: ban.tex, color: new THREE.Color(0.95, 0.95, 0.95), side: THREE.DoubleSide }));
    banner.position.set(0, Y, 0);
    banner.name = 'creatorBanner';
    grp.add(banner);
    const bamboo = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.8 });
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const s of [-1, 1]) {
      grp.add(beam(V(s * (W / 2 + 0.12), 0, -0.05), V(s * (W / 2 + 0.12), Y + H / 2 + 0.9, -0.05), 0.08, bamboo, 8));
      // guy ropes
      grp.add(beam(V(s * (W / 2 + 0.12), Y + H / 2 + 0.6, -0.05), V(s * (W / 2 + 1.6), 0, -1.4), 0.015, new THREE.MeshStandardMaterial({ color: 0x8a7a5a })));
    }
    grp.add(beam(V(-W / 2 - 0.2, Y + H / 2 + 0.04, -0.03), V(W / 2 + 0.2, Y + H / 2 + 0.04, -0.03), 0.05, bamboo, 8));
    // a string of bulbs along the top
    const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.2) });
    const bulbGeo = new THREE.SphereGeometry(0.06, 8, 6);
    for (let i = 0; i <= 16; i++) {
      const b = new THREE.Mesh(bulbGeo, bulbMat);
      b.position.set(-W / 2 + (W * i) / 16, Y + H / 2 + 0.16, 0.05);
      grp.add(b);
    }
    scene.add(grp);
    out.bannerGroup = grp;
  }

  // ---- Wall of Fame beside the stall ----
  let wall = null;
  let wallReady = Promise.resolve();
  if (stallAnchor?.group) {
    wall = buildWall(scene, stallAnchor, cfg, colliders);
    wall.paint([]);
    wallReady = Promise.all(cfg.wallPosts.map(loadPhoto)).then((imgs) => {
      out.postsLoaded = imgs.filter(Boolean).length;
      wall.paint(imgs);
    });
  }

  const paint = (img) => {
    paintStallBoard(board.ctx, board.canvas.width, board.canvas.height, cfg, img);
    board.tex.needsUpdate = true;
    paintBanner(ban.ctx, ban.canvas.width, ban.canvas.height, cfg, img);
    ban.tex.needsUpdate = true;
  };
  paint(null); // initial-letter avatar straight away; the photo replaces it when it arrives
  out.ready = Promise.all([
    loadPhoto(cfg.photoUrl).then((img) => {
      out.photoLoaded = !!img;
      if (img) paint(img);
    }),
    wallReady,
  ]);

  out.update = (dt, t) => {
    wall?.update(t);
    if (!banGeo) return;
    // the cloth breathes in the evening breeze, pinned along the top edge
    const pos = banGeo.attributes.position;
    const a = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const x = banBase[i * 3];
      const y = banBase[i * 3 + 1];
      const free = (1.46 - y) / 2.92; // 0 at the top, 1 at the bottom
      a[i * 3 + 2] = banBase[i * 3 + 2] + free * (Math.sin(t * 1.7 + x * 0.9) * 0.09 + Math.sin(t * 2.9 + x * 2.1 + y) * 0.03);
    }
    pos.needsUpdate = true;
  };

  out.stallBoard = stallBoard;
  out.banner = banner;
  out.wall = wall;
  return out;
}

/** The welcome copy on the intro card. */
export function personaliseIntro(cfg) {
  if (!cfg) return;
  const h1 = document.querySelector('#intro h1');
  if (h1) h1.textContent = `Welcome to ${cfg.name}'s Mela`;
  document.title = `${cfg.name}'s Diwali Mela · Topmate`;
}
