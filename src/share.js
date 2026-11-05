/*
  Share, in a creator's mela: a bright "Share" pill in the header and the popup it opens.

  The popup looks like the trailer generator's result screen (same paper board, fonts and colours):
    - the creator (the visitor whose mela_vid asked for this trailer, per GET /api/creators/<slug>/share):
      "Your Diwali Mela is live!", the trailer inline and every way to post it;
    - anyone else: "Share <First>'s Diwali Mela", the same actions for that mela, plus "Make your own
      Diwali Mela", which opens the generator (the landing page, framed same-origin) inside the popup.
  Without a trailer only the link is shared. Native share sends the video FILE where the device takes
  files (navigator.canShare), downloading it on that tap with a progress bar; the inline preview is a
  plain streaming <video preload="metadata">, so nothing big is fetched unless a file share asks for it.

  Cost: nothing per frame. The pill is one static button; the popup DOM is built on the first open;
  the pulse that nudges people (once ~45 s in, and after a game or ride) is a 3-beat CSS animation
  that stops for good once the popup has been opened.
*/
import { track, onTrackType } from './track.js';

const ICON = {
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 12v7h12v-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  whatsapp:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.6 8.2c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.5l.7 1.7c.1.2 0 .4-.1.6l-.5.6c-.1.1-.2.3 0 .5.5.9 1.4 1.8 2.4 2.3.2.1.4.1.5 0l.7-.8c.2-.2.4-.2.6-.1l1.6.8c.2.1.4.2.4.4 0 .4-.1 1.1-.6 1.5-.5.4-1.4.7-2.4.4-2.4-.8-4.4-2.8-5.2-5.1-.3-1 0-1.9.4-2.3Z" fill="currentColor"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>',
  linkedin:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h4.4L20 20h-4.4ZM19.6 4l-6.4 7.2M4.4 20l6.4-7.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SEEN_KEY = 'mela.shareSeen';
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

const filesShareable = () => {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob()], 'x.mp4', { type: 'video/mp4' })] }));
  } catch {
    return false;
  }
};

/**
 * The Share pill + popup for a creator's mela. Returns null on the plain mela (no creator).
 * ui: createUI()'s api (open/close count as a modal, so the game's input pauses while it is up).
 * onTrailerSound(on): the trailer is playing with sound; the mela's own audio should hush.
 */
export function createShare({ cfg, ui, onTrailerSound }) {
  const slug = cfg?.slug;
  if (!slug) return null;
  const base = import.meta.env.VITE_CREATOR_API ?? '';
  const sameOrigin = !base || (() => {
    try {
      return new URL(base, location.href).origin === location.origin;
    } catch {
      return false;
    }
  })();
  const origin = sameOrigin ? location.origin : new URL(base, location.href).origin;

  // ---------- the pill ----------
  const btn = document.createElement('button');
  btn.id = 'shareBtn';
  btn.type = 'button';
  btn.className = 'share-pill';
  btn.title = 'Share this mela';
  btn.innerHTML = `${ICON.share}<span>Share</span>`;
  const hud = document.querySelector('#hud-top');
  hud?.appendChild(btn);
  document.body.classList.add('has-share');
  // On narrow phones (390 px iPhones) the header wraps to three rows, and status chips at a fixed
  // 122 px slid under the places strip and the pill. Publish the header's bottom edge as
  // --hud-bottom so the chips sit below it (CSS). Re-measured on resize only, never per frame.
  if (hud && typeof ResizeObserver !== 'undefined') {
    const setHudBottom = () => document.body.style.setProperty('--hud-bottom', `${Math.round(hud.getBoundingClientRect().bottom)}px`);
    new ResizeObserver(setHudBottom).observe(hud);
    addEventListener('resize', setHudBottom, { passive: true });
    setHudBottom();
  }

  let seen = readSeen();
  let lastNudge = -1e9;
  const nudge = () => {
    if (seen || isOpen()) return;
    const now = performance.now();
    if (now - lastNudge < 60_000) return; // at most once a minute
    lastNudge = now;
    btn.classList.remove('nudge');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('nudge');
  };
  btn.addEventListener('animationend', (e) => e.animationName === 'shareNudge' && btn.classList.remove('nudge'));
  // just finished a game or got off a ride: a good moment to tell friends
  onTrackType(['ride_end', 'game_score'], () => setTimeout(nudge, 1200));

  let info = null; // GET /api/creators/<slug>/share
  let infoReq = null;
  const fallback = () => ({ slug, name: cfg.name || slug, first: cfg.first || cfg.name || slug, melaUrl: `${origin}/${slug}`, videoUrl: null, downloadUrl: null, isOwner: false });
  const loadInfo = () =>
    (infoReq ??= fetch(`${base}/api/creators/${encodeURIComponent(slug)}/share`, { credentials: sameOrigin ? 'same-origin' : 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => (info = j && j.melaUrl ? { ...fallback(), ...j } : fallback())));
  btn.addEventListener('pointerdown', () => loadInfo(), { passive: true }); // a head start on the tap
  btn.addEventListener('click', () => {
    btn.blur();
    open('button');
  });

  // ---------- the popup (built on first open) ----------
  let pop = null;
  let el = {};
  let pushed = false;
  let shareFile = null;
  let soundOn = false;
  const isOpen = () => !!pop && !pop.classList.contains('hidden');

  function build() {
    pop = document.createElement('div');
    pop.id = 'sharePop';
    pop.className = 'share-pop hidden';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-labelledby', 'spTitle');
    pop.innerHTML = `
      <div class="sp-card">
        <button type="button" class="sp-close" aria-label="Close">✕</button>
        <div class="sp-main">
          <p class="sp-kicker"></p>
          <h2 class="sp-sign" id="spTitle"></h2>
          <p class="sp-lede"></p>
          <div class="sp-body">
            <div class="sp-player">
              <video muted playsinline loop preload="metadata" disablepictureinpicture></video>
              <button type="button" class="sp-sound">🔇 Sound</button>
            </div>
            <div class="sp-side">
              <button type="button" class="sp-btn sp-native">${ICON.share}<span class="sp-lbl">Share</span><span class="sp-prog" aria-hidden="true"></span></button>
              <div class="sp-ch" role="group" aria-label="Share on">
                <button type="button" data-ch="whatsapp" class="c-wa">${ICON.whatsapp}<span>WhatsApp</span></button>
                <button type="button" data-ch="instagram" class="c-ig">${ICON.instagram}<span>Instagram</span></button>
                <button type="button" data-ch="linkedin" class="c-li">${ICON.linkedin}<span>LinkedIn</span></button>
                <button type="button" data-ch="x" class="c-x">${ICON.x}<span>X</span></button>
                <button type="button" data-ch="copy" class="c-copy">${ICON.copy}<span>Copy link</span></button>
                <button type="button" data-ch="download" class="c-dl">${ICON.download}<span>Download</span></button>
              </div>
              <div class="sp-link"><span class="sp-url"></span><button type="button" data-ch="copy">Copy</button></div>
              <p class="sp-toast" role="status" aria-live="polite"></p>
              <div class="sp-own">
                <div class="sp-own-txt"><b>Make your own Diwali Mela</b><span>Get a free personalised trailer starring you, ready in about 3 minutes.</span></div>
                <button type="button" class="sp-btn sp-own-btn">Make mine, free →</button>
              </div>
            </div>
          </div>
        </div>
        <div class="sp-gen hidden">
          <div class="sp-genbar"><button type="button" class="sp-back">← Back</button><span>Make your own mela</span></div>
          <div class="sp-frame"></div>
        </div>
      </div>`;
    document.body.appendChild(pop);
    const q = (s) => pop.querySelector(s);
    el = {
      card: q('.sp-card'),
      main: q('.sp-main'),
      kicker: q('.sp-kicker'),
      title: q('.sp-sign'),
      lede: q('.sp-lede'),
      player: q('.sp-player'),
      video: q('video'),
      sound: q('.sp-sound'),
      native: q('.sp-native'),
      lbl: q('.sp-lbl'),
      prog: q('.sp-prog'),
      url: q('.sp-url'),
      toast: q('.sp-toast'),
      own: q('.sp-own'),
      gen: q('.sp-gen'),
      frame: q('.sp-frame'),
    };
    q('.sp-close').addEventListener('click', () => close());
    pop.addEventListener('click', (e) => e.target === pop && close()); // a tap outside the card
    el.sound.addEventListener('click', toggleSound);
    el.video.addEventListener('click', toggleSound);
    el.native.addEventListener('click', () => nativeShare('native'));
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ch]');
      if (b) channel(b.dataset.ch);
    });
    q('.sp-own-btn').addEventListener('click', openGenerator);
    q('.sp-back').addEventListener('click', () => showGenerator(false));
    // Esc closes it (before the game's own key handling sees the key)
    addEventListener(
      'keydown',
      (e) => {
        if (!isOpen() || e.code !== 'Escape') return;
        e.stopImmediatePropagation();
        e.preventDefault();
        close();
      },
      true
    );
    // the phone's Back button closes the popup instead of leaving the mela
    addEventListener('popstate', () => {
      if (pushed && isOpen()) {
        pushed = false;
        close({ fromHistory: true });
      }
    });
  }

  const shareText = () => {
    const url = info.melaUrl;
    return info.isOwner
      ? `Mere Diwali Mela mein aaiye! 🪔 Games, rides, Ramleela aur hum sab live — ${url}`
      : `${info.first} ke Diwali Mela mein aaiye! 🪔 Games, rides, Ramleela aur hum sab live — ${url}`;
  };

  function render() {
    const owner = !!info.isOwner;
    const hasVideo = !!info.videoUrl;
    pop.classList.toggle('owner', owner);
    pop.classList.toggle('no-video', !hasVideo);
    el.kicker.textContent = owner ? `Happy Diwali, ${info.first}!` : 'Spread the Diwali light';
    el.title.textContent = owner ? 'Your Diwali Mela is live!' : `Share ${info.first}’s Diwali Mela`;
    el.lede.textContent = owner
      ? 'Share it with your followers. They tap the link and walk straight into your mela.'
      : 'Bring your friends along: games, rides, the Ramleela and everyone live.';
    el.url.textContent = info.melaUrl.replace(/^https?:\/\//, '');
    el.own.hidden = owner;
    el.player.hidden = !hasVideo;
    el.files = hasVideo && filesShareable();
    el.native.hidden = !navigator.share;
    setLabel();
    pop.querySelector('.c-dl').hidden = !hasVideo;
    if (hasVideo && el.video.dataset.src !== info.videoUrl) {
      el.video.dataset.src = info.videoUrl;
      el.video.src = `${base}${info.videoUrl}`;
    }
  }

  const setLabel = (text, pct) => {
    el.lbl.textContent = text ?? (el.files ? (info.isOwner ? 'Share your trailer' : 'Share the trailer') : 'Share the link');
    el.prog.style.transform = `scaleX(${pct == null ? 0 : pct / 100})`;
  };

  let toastT = 0;
  const toast = (msg, ms = 3800) => {
    el.toast.textContent = msg;
    clearTimeout(toastT);
    toastT = setTimeout(() => (el.toast.textContent = ''), ms);
  };

  const ev = (ch, outcome, extra = {}) => track('share', { channel: ch, outcome, owner: !!info?.isOwner, video: !!info?.videoUrl, ...extra });

  function toggleSound() {
    const v = el.video;
    soundOn = v.muted;
    v.muted = !soundOn;
    if (soundOn && v.paused) v.play().catch(() => {});
    el.sound.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound';
    el.sound.classList.toggle('on', soundOn);
    onTrailerSound?.(soundOn);
  }

  async function open(via = 'button') {
    if (!pop) build();
    if (isOpen()) return;
    ui.open(pop); // counts as a modal: the game's input pauses
    pop.classList.add('loading');
    showGenerator(false, { silent: true });
    try {
      history.pushState({ melaShare: 1 }, '');
      pushed = true;
    } catch {
      pushed = false;
    }
    if (!seen) {
      seen = true;
      btn.classList.remove('nudge');
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        // no storage: it simply nudges again next visit
      }
    }
    await loadInfo();
    if (!isOpen()) return;
    pop.classList.remove('loading');
    render();
    track('share_open', { owner: !!info.isOwner, video: !!info.videoUrl, via });
    if (info.videoUrl) {
      el.video.muted = true;
      soundOn = false;
      el.sound.textContent = '🔇 Sound';
      el.sound.classList.remove('on');
      el.video.play().catch(() => {}); // muted autoplay; if refused, the first frame still shows
    }
  }

  function close({ fromHistory = false } = {}) {
    if (!isOpen()) return;
    el.video.pause();
    if (soundOn) {
      soundOn = false;
      el.video.muted = true;
      onTrailerSound?.(false);
    }
    ui.close(pop);
    if (pushed && !fromHistory) {
      pushed = false;
      try {
        history.back();
      } catch {
        // ignore
      }
    }
  }

  // ---------- sharing ----------
  /** The trailer as a File: fetched once, on the tap that asks for it, with a percentage on the button. */
  async function videoFile(onPct) {
    if (shareFile) return shareFile;
    const res = await fetch(`${base}${info.videoUrl}`);
    if (!res.ok) throw new Error(String(res.status));
    const total = Number(res.headers.get('content-length')) || 0;
    let blob;
    if (res.body && total) {
      const reader = res.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        onPct(Math.min(99, Math.round((got / total) * 100)));
      }
      blob = new Blob(parts, { type: 'video/mp4' });
    } else blob = await res.blob();
    return (shareFile = new File([blob], `${slug}-diwali-mela.mp4`, { type: 'video/mp4' }));
  }

  async function nativeShare(ch) {
    if (!info || el.native.disabled) return;
    const text = shareText();
    if (!el.files) {
      try {
        await navigator.share({ title: info.isOwner ? 'My Diwali Mela' : `${info.first}’s Diwali Mela`, text, url: info.melaUrl });
        ev(ch === 'native' ? 'native_url' : ch, 'ok', { method: 'native_url' });
      } catch (err) {
        ev(ch === 'native' ? 'native_url' : ch, err?.name === 'AbortError' ? 'cancel' : 'error', { method: 'native_url' });
        if (err?.name !== 'AbortError') toast('Couldn’t open sharing here. Copy the link instead.');
      }
      return;
    }
    // Safari only opens the sheet from a fresh tap: if the download used up this tap, the
    // video is kept and the next tap shares it at once.
    let file;
    el.native.disabled = true;
    try {
      file = await videoFile((pct) => setLabel(`Getting the video ready… ${pct}%`, pct));
    } catch {
      ev(ch === 'native' ? 'native_file' : ch, 'load_error', { method: 'native_file' });
      toast('Couldn’t load the video. Share the link instead.');
      return;
    } finally {
      el.native.disabled = false;
      setLabel();
    }
    try {
      await navigator.share({ files: [file], text });
      ev(ch === 'native' ? 'native_file' : ch, 'ok', { method: 'native_file' });
    } catch (err) {
      ev(ch === 'native' ? 'native_file' : ch, err?.name === 'AbortError' ? 'cancel' : err?.name === 'NotAllowedError' ? 'needs_tap' : 'error', { method: 'native_file' });
      if (err?.name === 'NotAllowedError') {
        setLabel('Video ready · Tap to share');
        toast('The video is ready! Tap Share once more.');
      } else if (err?.name !== 'AbortError') toast('Couldn’t share the video. Try the link instead.');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(info.melaUrl);
      return true;
    } catch {
      // clipboard API refused (permissions, http, older in-app browsers): the old selection copy
      try {
        const ta = document.createElement('textarea');
        ta.value = info.melaUrl;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
        pop.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function download() {
    const a = document.createElement('a');
    a.href = `${base}${info.downloadUrl}`;
    a.download = `${slug}-diwali-mela.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function channel(ch) {
    if (!info) return;
    const url = info.melaUrl;
    const go = (href) => {
      ev(ch, 'ok');
      window.open(href, '_blank', 'noopener');
    };
    if (ch === 'whatsapp') return go(`https://wa.me/?text=${encodeURIComponent(shareText())}`);
    if (ch === 'linkedin') return go(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
    if (ch === 'x') return go(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText().replace(/ — \S+$/, ''))}&url=${encodeURIComponent(url)}`);
    if (ch === 'copy') {
      const ok = await copy();
      ev('copy', ok ? 'ok' : 'prompt');
      if (ok) toast('Mela link copied!');
      else prompt('The mela link:', url);
      return;
    }
    if (ch === 'download') {
      ev('download', 'ok');
      download();
      toast('Saving the trailer to your phone…');
      return;
    }
    if (ch === 'instagram') {
      // Instagram has no web share: the video goes through the share sheet (pick Instagram), or
      // is saved to post by hand; the link goes in the bio / a story link sticker
      if (info.videoUrl && el.files && navigator.share) {
        toast('Pick Instagram in the share sheet, then Reel or Story.');
        return nativeShare('instagram');
      }
      const copied = await copy();
      if (info.videoUrl) {
        ev('instagram', 'download');
        download();
        toast(`Saving the trailer. Post it on Instagram as a Reel or Story${copied ? '; the mela link is copied for your bio or a link sticker' : ''}.`, 6000);
      } else {
        ev('instagram', copied ? 'copy' : 'prompt');
        if (copied) toast('Mela link copied. Add it to your Instagram Story with a link sticker.', 6000);
        else prompt('The mela link:', url);
      }
    }
  }

  // ---------- "Make your own": the generator inside the popup ----------
  function openGenerator() {
    track('make_own_open', { via: 'share', owner: !!info?.isOwner });
    const src = `${base}/?from=mela&ref=${encodeURIComponent(slug)}`;
    if (!sameOrigin) {
      window.open(src, '_blank', 'noopener'); // another origin: framing it would lose its cookie
      return;
    }
    if (!el.frame.firstChild) {
      const f = document.createElement('iframe');
      f.title = 'Make your own Diwali Mela trailer';
      f.allow = 'web-share; clipboard-write; autoplay; fullscreen';
      f.src = `/?from=mela&ref=${encodeURIComponent(slug)}&embed=1`;
      el.frame.appendChild(f);
    }
    showGenerator(true);
  }

  function showGenerator(on, { silent = false } = {}) {
    if (!pop) return;
    el.gen.classList.toggle('hidden', !on);
    el.main.classList.toggle('hidden', on);
    pop.classList.toggle('gen', on);
    if (on) {
      el.video.pause();
      if (soundOn) toggleSound();
    } else if (!silent && info?.videoUrl) el.video.play().catch(() => {});
  }

  return {
    /** The visitor walked in: one gentle nudge ~45 s later. */
    entered() {
      setTimeout(nudge, 45_000);
    },
    nudge,
    open,
    close,
    get isOpen() {
      return isOpen();
    },
  };
}
