/** Who the visitor is: name, optional Topmate username, their look, and (fetched) Topmate details. */

const KEY = 'melaProfile';

/*
  Where the Topmate proxy lives. A static build (VITE_STATIC=1, e.g. GitHub Pages) has no proxy, so
  lookups are skipped unless VITE_API_BASE points at one (e.g. a Vercel deployment of api/).
*/
const ENV = import.meta.env ?? {};
const API_BASE = ENV.VITE_API_BASE || (ENV.VITE_STATIC ? '' : ENV.BASE_URL);

/** Accepts "priya", "@priya" or "https://topmate.io/priya" and returns "priya". */
export function normalizeHandle(raw) {
  let s = (raw || '').trim();
  s = s.replace(/^https?:\/\/(www\.)?topmate\.io\//i, '').replace(/^topmate\.io\//i, '').replace(/^@/, '');
  s = s.split(/[/?#\s]/)[0];
  return /^[a-z0-9_.-]{1,60}$/i.test(s) ? s : '';
}

export const profile = {
  name: '',
  handle: '',
  look: null,
  golden: false, // unlocked by arriving through a friend's invite link
  ref: '',
  topmate: null, // { found, name, headline, image }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        this.name = String(saved.name || '').slice(0, 24);
        this.handle = normalizeHandle(saved.handle);
        this.look = saved.look && typeof saved.look === 'object' ? saved.look : null;
        this.golden = !!saved.golden;
        this.ref = String(saved.ref || '').slice(0, 60);
      }
    } catch {
      // storage unavailable
    }
    return this;
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ name: this.name, handle: this.handle, look: this.look, golden: this.golden, ref: this.ref }));
    } catch {
      // ignore
    }
  },

  /** Looks the handle up through the same-origin proxy (see server/topmate.mjs). Cached per handle. */
  async fetchTopmate(handle = this.handle) {
    const h = normalizeHandle(handle);
    if (!h || !API_BASE) return null;
    this._cache ??= new Map();
    if (this._cache.has(h)) return this._cache.get(h);
    const base = API_BASE.endsWith('/') ? API_BASE : `${API_BASE}/`;
    const p = fetch(`${base}api/topmate?u=${encodeURIComponent(h)}`, { signal: AbortSignal.timeout(9000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        // the proxy returns a root-relative photo URL: resolve it against a cross-origin API base
        if (data?.image?.startsWith('/') && /^https?:/.test(base)) data.image = new URL(data.image, base).href;
        if (h === this.handle) this.topmate = data;
        return data;
      });
    this._cache.set(h, p);
    return p;
  },
};
