/*
  Visit analytics: a tiny batched tracker. track('zone', { zone: 'bazaar' }) queues a 'mela.zone'
  event; the queue goes to the same-origin service at POST /api/t every 5 s (fetch, keepalive) and,
  when the tab is hidden or closed, through navigator.sendBeacon. Every event carries the visitor
  (a random id in localStorage 'mela.visitor', shared with the landing site), the session (one per
  page load), the room and the creator slug. The server adds the hashed IP, country and user agent.

  Off (every call a no-op) in director / capture pages and with ?nonet. A page that is not served by
  the mela service (static dev, GitHub Pages) gets 404s: after a few failed sends it stops trying.
  No per-frame work: callers fire on state changes only.
*/
const ENDPOINT = '/api/t';
const FLUSH_MS = 5000;
const MAX_QUEUE = 200; // a stuck queue drops the oldest
const MAX_BATCH = 50;
const MAX_FAILS = 3;

const rid = () => {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  } catch {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 20);
  }
};

function visitorId() {
  try {
    // the service's mela_vid cookie (set with the page) wins: its server rows then join these events
    const c = /(?:^|;\s*)mela_vid=([A-Za-z0-9_-]{6,64})(?:;|$)/.exec(document.cookie)?.[1];
    if (c) {
      try {
        localStorage.setItem('mela.visitor', c);
      } catch {
        /* storage blocked: the cookie still holds it */
      }
      return c;
    }
    let v = localStorage.getItem('mela.visitor');
    if (!v || v.length > 64) {
      v = rid();
      localStorage.setItem('mela.visitor', v);
    }
    return v;
  } catch {
    return '';
  }
}

let on = false;
let q = [];
let base = {};
let fails = 0;
let errs = 0;
const endHooks = [];
const hideHooks = [];
const errSeen = new Set();
export const session = rid();

/** True on pages that must never report anything (trailer capture, offline tests). */
export function trackingOff(params = new URLSearchParams(location.search)) {
  const env = import.meta.env ?? {};
  return params.has('director') || params.has('nonet') || params.has('capture') || typeof window.__director !== 'undefined' || (env.VITE_STATIC && !env.VITE_API_BASE);
}

/** Starts the tracker for this page: room is the realtime room, slug the creator's ('' on the plain mela). */
export function initTrack({ room, slug }) {
  if (on || trackingOff()) return;
  on = true;
  base = { session, visitor: visitorId(), room, slug, path: location.pathname };
  setInterval(() => flush(false), FLUSH_MS);
  addEventListener('pagehide', () => {
    for (const fn of endHooks.splice(0)) fn();
    flush(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    for (const fn of hideHooks) fn();
    flush(true); // phones often never fire pagehide: what is queued goes now
  });
  addEventListener('error', (e) => trackError(e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : '', e.error?.stack));
  addEventListener('unhandledrejection', (e) => trackError(String(e.reason?.message ?? e.reason), 'promise', e.reason?.stack));
}

const typeHooks = [];
/** fn() runs whenever track(<one of types>) is called, even with tracking off (UI nudges, not analytics). */
export const onTrackType = (types, fn) => typeHooks.push([types, fn]);

/** Queues 'mela.<type>' with props (small, JSON-safe). */
export function track(type, props) {
  for (let i = 0; i < typeHooks.length; i++) if (typeHooks[i][0].includes(type)) typeHooks[i][1]();
  if (!on) return;
  q.push({ type: `mela.${type}`, ts: Date.now(), ...base, props: props ?? {} });
  if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
  if (q.length >= MAX_BATCH) flush(false);
}

/** Ids for the realtime URL (?vid=&sid=) so the server's rt.* rows join this session; null when off. */
export const trackIds = () => (on ? { vid: base.visitor, sid: session } : null);

/** fn runs once when the page goes away (pagehide), before the last send: for 'session_end'. */
export const onTrackEnd = (fn) => endHooks.push(fn);
/** fn runs whenever the tab is hidden, before the send. */
export const onTrackHide = (fn) => hideHooks.push(fn);

/** ms since the navigation started */
export const sinceLoad = () => Math.round(performance.now());

/** At most 5 distinct errors per session. */
function trackError(msg, where, stack) {
  const key = `${msg}|${where}`;
  if (errs >= 5 || errSeen.has(key)) return;
  errSeen.add(key);
  errs++;
  track('error', { msg: String(msg).slice(0, 300), where, stack: String(stack ?? '').slice(0, 800) });
}

function flush(beacon) {
  if (!on || !q.length || fails >= MAX_FAILS) return;
  const batch = q.splice(0, MAX_BATCH);
  const body = JSON.stringify(batch);
  if (beacon && navigator.sendBeacon) {
    // a string is sent as text/plain: no preflight, survives the page going away
    if (navigator.sendBeacon(ENDPOINT, body)) return q.length && flush(true);
  }
  fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true })
    // no service here (static dev, another host): stop after a few; anything else just drops the batch
    .then((r) => (r.status === 404 || r.status === 405 ? fails++ : (fails = 0)))
    .catch(() => {});
  if (beacon && q.length) flush(true);
}
