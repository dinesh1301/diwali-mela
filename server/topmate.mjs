/*
  Looks up a public Topmate profile (name, headline, photo) so the poster can show it. Runs in
  Node: as a Vite dev middleware (vite.config.js) and as serverless functions (api/). The photo is
  streamed through here because Topmate's image host sends no CORS headers, and a canvas can only
  export posters built from same-origin images.
*/

const UA = 'Mozilla/5.0 (compatible; TopmateDiwaliMela/1.0; +https://topmate.io)';
const TTL = 10 * 60 * 1000;
const cache = new Map();

export function normalizeHandle(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^https?:\/\/(www\.)?topmate\.io\//i, '').replace(/^topmate\.io\//i, '').replace(/^@/, '');
  s = s.split(/[/?#\s]/)[0];
  return /^[a-z0-9_.-]{1,60}$/i.test(s) ? s : '';
}

const decode = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function og(html, prop) {
  const a = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, 'i'));
  if (a) return decode(a[1]);
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, 'i'));
  return b ? decode(b[1]) : '';
}

export async function fetchProfile(raw) {
  const handle = normalizeHandle(raw);
  if (!handle) return null;
  const key = handle.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  let data = { found: false, username: handle, name: '', headline: '', image: null, picUrl: null };
  try {
    const res = await fetch(`https://topmate.io/${encodeURIComponent(handle)}`, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const title = og(html, 'title');
    const m = title.match(/^(.*?)\s*\(@([^)]+)\)\s*\|\s*Topmate/i);
    if (res.ok && m) {
      const desc = og(html, 'description').split(' · ');
      const pic = html.match(/profile_pic\\?":\\?"(https?:\/\/[^"\\]+)/)?.[1] ?? null;
      data = {
        found: true,
        username: m[2],
        name: m[1].trim(),
        headline: desc.length >= 2 ? desc[1].trim() : '',
        picUrl: pic,
        image: pic ? `/api/topmate/image?u=${encodeURIComponent(m[2])}` : null,
      };
    }
  } catch {
    // network trouble: report not found, don't cache for long
    cache.set(key, { at: Date.now() - TTL + 30000, data });
    return data;
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return 'image/jpeg';
}

export async function fetchImage(raw) {
  const p = await fetchProfile(raw);
  if (!p?.picUrl) return null;
  const res = await fetch(p.picUrl, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, type: sniff(buffer) };
}

/** One handler for both routes: /api/topmate?u=  and  /api/topmate/image?u= */
export async function handle(req, res, mountPath = '') {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(mountPath, '');
  const u = url.searchParams.get('u');
  res.setHeader('Cache-Control', 'public, max-age=300');
  // public profile data, no credentials: a static site on another origin (VITE_API_BASE) may read it
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (/\/?image$/.test(path)) {
      const img = await fetchImage(u);
      if (!img) {
        res.statusCode = 404;
        return res.end('no image');
      }
      res.setHeader('Content-Type', img.type);
      return res.end(img.buffer);
    }
    const data = await fetchProfile(u);
    res.setHeader('Content-Type', 'application/json');
    if (!data) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'bad handle' }));
    }
    const { picUrl, ...pub } = data;
    void picUrl;
    return res.end(JSON.stringify(pub));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
}
