/*
  Room chat, in a creator's mela: everyone on the same creator link can type to everyone else there.

  A 💬 button (with an unread badge) sits in the header next to the other icons. It opens a panel:
  a bottom sheet on phones, a side panel on wider screens, with the privacy line on top, the room's
  messages (name, time, text; ours on the right; "Asha joined" lines), a row of one-tap phrases and
  the input. Enter sends, Esc closes; on a desktop Enter also opens it. While the input has the
  keyboard the game takes no keys (input.typing), and on phones the sheet rides above the on-screen
  keyboard (visualViewport). While it is closed a new message peeks in for a few seconds, and every
  message also floats as a speech bubble over its sender's head (ui.bubble).

  The hub (server/realtime.mjs) cleans, filters and rate-limits messages, echoes ours back with the
  k we sent (that settles the greyed "sending" line), refuses with 'chatno', and hands a newcomer the
  room's recent history in its welcome ('chatlog').

  Cost: nothing per frame. The button and the peek are two small elements; the panel is built on
  its first open; visualViewport is only listened to while the panel is open.
*/
import { profile } from './profile.js';
import { track } from './track.js';

const KEEP = 150; // lines kept in the panel
const PEEK_MS = 4200;
const QUICK = ['🪔 Happy Diwali!', '👋 Hi!', '😂', '🎉'];
const BUBBLE_MAX = 70;

const two = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};

/**
 * The chat for a creator's mela; null where there is no room to chat in (the plain mela, a
 * director / capture page, ?nonet).
 */
export function createChat({ net, ui, input, player, title = '', enabled = true }) {
  if (!enabled || !net?.enabled) return null;

  const log = []; // { key, i?, at, id?, n, text, me, sys, pending, k, el }
  const seen = new Set(); // `${i}|${at}` of hub messages shown (history and live overlap on reconnect)
  const myIds = new Set(); // our socket ids this visit (a reconnect gets a new one)
  let unread = 0;
  let panel = null;
  let el = {};
  let open = false;
  let peekTimer = 0;
  let nonce = 0;

  // ---------- the button and the peek (always there, both tiny) ----------
  const btn = document.createElement('button');
  btn.id = 'chatBtn';
  btn.type = 'button';
  btn.className = 'icon chat-btn';
  btn.title = 'Chat with everyone here (Enter)';
  btn.setAttribute('aria-label', 'Chat');
  btn.innerHTML = '💬<span class="chat-badge hidden" aria-hidden="true"></span>';
  const badge = btn.querySelector('.chat-badge');
  const mic = document.querySelector('#micBtn');
  if (mic) mic.after(btn);
  else document.querySelector('.hud-icons')?.prepend(btn);
  document.body.classList.add('has-chat');
  btn.addEventListener('click', () => {
    btn.blur();
    if (open) close();
    else show('button');
  });

  const peek = document.createElement('button');
  peek.type = 'button';
  peek.className = 'chat-peek';
  peek.setAttribute('aria-live', 'polite');
  document.body.appendChild(peek);
  peek.addEventListener('click', () => {
    hidePeek();
    show('toast');
  });

  const setBadge = () => {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.classList.toggle('hidden', !unread);
  };

  function showPeek(line) {
    peek.textContent = '';
    const b = document.createElement('b');
    b.textContent = `${line.n}: `;
    peek.append(b, document.createTextNode(line.text));
    peek.classList.add('show');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(hidePeek, PEEK_MS);
  }
  function hidePeek() {
    clearTimeout(peekTimer);
    peek.classList.remove('show');
  }

  // ---------- the panel (built on first open) ----------
  function build() {
    panel = document.createElement('section');
    panel.className = 'chat-panel hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Mela chat');
    panel.innerHTML = `
      <header class="cp-head">
        <b class="cp-title"></b>
        <span class="cp-online"></span>
        <button type="button" class="cp-close" aria-label="Close chat">✕</button>
      </header>
      <p class="cp-note">🔒 Chat messages are stored for 30 days for safety. Be kind 🙏</p>
      <div class="cp-list" role="log" aria-live="polite"></div>
      <div class="cp-quick"></div>
      <form class="cp-form" autocomplete="off">
        <input class="cp-input" type="text" maxlength="200" enterkeyhint="send" autocomplete="off" autocorrect="on" spellcheck="true" placeholder="Say something to everyone here…" aria-label="Message" />
        <button type="submit" class="cp-send" aria-label="Send">➤</button>
      </form>`;
    document.body.appendChild(panel);
    const q = (s) => panel.querySelector(s);
    el = { title: q('.cp-title'), online: q('.cp-online'), list: q('.cp-list'), quick: q('.cp-quick'), form: q('.cp-form'), input: q('.cp-input'), send: q('.cp-send') };
    el.title.textContent = `💬 ${title || 'Mela'} chat`;
    for (const text of QUICK) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', () => send(text, 'quick'));
      el.quick.appendChild(b);
    }
    q('.cp-close').addEventListener('click', () => close());
    el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = el.input.value.trim();
      if (text && send(text, 'chat')) el.input.value = '';
      el.input.focus();
    });
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    // the keyboard belongs to the chat while its input has focus
    el.input.addEventListener('focus', () => {
      input.typing = true;
      input.releaseAll?.();
      panel.classList.add('typing');
      fit();
    });
    el.input.addEventListener('blur', () => {
      input.typing = false;
      panel.classList.remove('typing');
      // iOS can leave the page scrolled up after its keyboard goes
      setTimeout(() => {
        if (scrollY) scrollTo(0, 0);
        fit();
      }, 60);
    });
    // a tap or drag inside the panel is the panel's, not the camera's
    for (const ev of ['pointerdown', 'wheel', 'touchstart']) panel.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    for (const line of log) line.el = render(line);
    el.list.replaceChildren(...log.map((l) => l.el));
    online(net.online);
  }

  function render(line) {
    const d = document.createElement('div');
    if (line.sys) {
      d.className = 'cm sys';
      d.textContent = line.text;
      return d;
    }
    d.className = `cm${line.me ? ' me' : ''}${line.pending ? ' pending' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'cm-meta';
    const who = document.createElement('b');
    who.textContent = line.me ? 'You' : line.n;
    const time = document.createElement('time');
    time.textContent = line.pending ? 'sending…' : hhmm(line.at);
    meta.append(who, time);
    const text = document.createElement('div');
    text.className = 'cm-text';
    text.textContent = line.text;
    d.append(meta, text);
    return d;
  }

  const nearBottom = () => !el.list || el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 60;

  function add(line, { at = log.length } = {}) {
    log.splice(at, 0, line);
    if (!panel) {
      if (log.length > KEEP) log.splice(0, log.length - KEEP);
      return;
    }
    const stick = nearBottom();
    line.el = render(line);
    const next = log[at + 1]?.el;
    if (next) el.list.insertBefore(line.el, next);
    else el.list.appendChild(line.el);
    while (log.length > KEEP) log.shift().el?.remove();
    if (stick || line.me) el.list.scrollTop = el.list.scrollHeight;
  }

  const sys = (text) => add({ sys: true, text, at: Date.now() });

  function online(n) {
    if (el.online) el.online.textContent = net.connected ? (n > 1 ? `${n} here` : 'just you') : 'connecting…';
  }

  // ---------- open / close ----------
  function show(via) {
    if (!panel) build();
    if (open) return;
    open = true;
    panel.classList.remove('hidden');
    btn.classList.add('on');
    document.body.classList.add('chat-open');
    hidePeek();
    track('chat_open', { via, unread });
    unread = 0;
    setBadge();
    online(net.online);
    el.list.scrollTop = el.list.scrollHeight;
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    fit();
    // a desktop gets the cursor straight away; a phone waits for a tap (no surprise keyboard)
    if (!document.body.classList.contains('touch') || via === 'key') el.input.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    el.input.blur();
    input.typing = false;
    panel.classList.add('hidden');
    btn.classList.remove('on');
    document.body.classList.remove('chat-open');
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
  }

  // phones: keep the sheet (and so its input) above the on-screen keyboard
  const vv = window.visualViewport;
  function fit() {
    if (!panel || !open) return;
    const h = vv ? vv.height : innerHeight;
    const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    panel.style.setProperty('--kb', `${kb}px`);
    panel.style.setProperty('--vvh', `${Math.round(h)}px`);
    panel.classList.toggle('kb', kb > 80);
    if (nearBottom()) el.list.scrollTop = el.list.scrollHeight;
  }

  // Enter opens the chat (desktop), Esc closes it when the input is not focused
  addEventListener('keydown', (e) => {
    if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Enter' && !open && !ui.modalOpen && !input.capture) {
      e.preventDefault();
      show('key');
    } else if (e.key === 'Escape' && open) {
      close();
    }
  });

  // ---------- sending ----------
  function send(text, kind) {
    if (!net.connected) {
      sys('Not connected right now, trying again…');
      return false;
    }
    const k = `c${Date.now().toString(36)}${(nonce++).toString(36)}`;
    if (!net.sendChat(text, k, kind)) return false;
    add({ k, at: Date.now(), n: profile.name, text, me: true, pending: true });
    return true;
  }

  const bubbleText = (t) => (t.length > BUBBLE_MAX ? `${t.slice(0, BUBBLE_MAX - 1)}…` : t);

  // ---------- receiving ----------
  /** One hub message; `live` is false for history from a welcome. */
  function receive(m, k, live) {
    if (!m || typeof m.text !== 'string') return;
    const key = `${m.i}|${m.at}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (net.id) myIds.add(net.id);
    const me = myIds.has(m.id);
    // our own echo settles the pending line
    const pi = k ? log.findIndex((l) => l.pending && l.k === k) : -1;
    if (pi >= 0) {
      const line = log[pi];
      Object.assign(line, { i: m.i, at: m.at, text: m.text, pending: false });
      if (line.el) line.el.replaceWith((line.el = render(line)));
    } else {
      // history (oldest first) goes in time order before anything newer; live lines at the end
      const later = live ? -1 : log.findIndex((l) => l.at > m.at);
      add({ i: m.i, at: m.at, id: m.id, n: m.n || 'Visitor', text: m.text, me }, later < 0 ? {} : { at: later });
    }
    if (!live) return;
    if (me) {
      ui.bubble((o) => player.headWorld(o), bubbleText(m.text), 3);
      return;
    }
    const r = net.remote.get(m.id);
    if (r?.shown) ui.bubble((o) => r.char.headTop.getWorldPosition(o), bubbleText(m.text), 3.5);
    if (!open) {
      unread++;
      setBadge();
      if (!ui.modalOpen) showPeek({ n: m.n || 'Visitor', text: m.text });
    }
  }

  net.on('chat', (m, k) => receive(m, k, true));
  net.on('chatlog', (list) => {
    if (net.id) myIds.add(net.id);
    for (const m of list) receive(m, null, false);
  });
  net.on('chatno', (reason, k) => {
    const i = log.findIndex((l) => l.pending && l.k === k);
    let text = '';
    if (i >= 0) {
      text = log[i].text;
      log[i].el?.remove();
      log.splice(i, 1);
    }
    if (el.input && text && !el.input.value) el.input.value = text;
    sys(reason === 'dup' ? 'You just said that 🙂' : 'Slow down a little, then send again 🙂');
  });
  net.on('join', (p) => p?.n && p.n !== 'Visitor' && sys(`${p.n} joined`));
  net.on('leave', (_id, name) => name && name !== 'Visitor' && sys(`${name} left`));
  net.on('online', (n) => online(n));
  let wasConnected = false;
  net.on('status', (ok) => {
    if (!ok && wasConnected) {
      sys('Connection lost, reconnecting…');
      // pending lines will never be echoed now
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].pending) {
          log[i].el?.remove();
          log.splice(i, 1);
        }
      }
    }
    wasConnected = ok;
    online(net.online);
  });

  return {
    get open() {
      return open;
    },
    show,
    close,
  };
}
