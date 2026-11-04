import { tk } from './touch.js';
import { settings } from './settings.js';

/*
  Proximity voice chat. Peer-to-peer WebRTC audio in a mesh (fine for a mela room of a dozen),
  signalled through the realtime socket. Each remote voice is spatialised with a PannerNode at
  that visitor's avatar, so people near you are loud and clear and the far side of the mela is a
  murmur. The mic stays off until the visitor turns it on; turning it off stops the track, so the
  browser's recording indicator goes away too. Whoever has a mic initiates the connection; the
  "perfect negotiation" pattern sorts out the case where both sides start at once.
*/
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const NEAR = 4; // full volume inside this radius (metres)
const FAR = 34; // silent beyond this
const MAX_PEERS = 12;
const SPEAK_RMS = 0.02;
const PLACE_S = 1 / 18; // listener and voice positions are pushed to Web Audio at ~18 Hz
const SMOOTH = 0.06; // ...and glide between updates

const rms = (analyser, buf) => {
  analyser.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    s += v * v;
  }
  return Math.sqrt(s / buf.length);
};

export class Voice {
  constructor(ctx, net) {
    this.ctx = ctx;
    this.net = net;
    net.voice = this;
    this.peers = new Map();
    this.stream = null;
    this.live = false; // our mic is on
    this.talking = false; // push-to-talk key held
    this.localTalking = false; // our own level is above the threshold
    this.listeners = {};
    this.levelT = 0;
    this.placeT = 0;
    this.buf = new Uint8Array(256);
    this.warnedPeers = false;
  }

  on(evt, fn) {
    (this.listeners[evt] ??= []).push(fn);
  }

  emit(evt, ...args) {
    for (const fn of this.listeners[evt] ?? []) fn(...args);
  }

  get ac() {
    return this.ctx.audio.ctx ?? null;
  }

  // ---------- the microphone ----------

  async enable() {
    const { ui } = this.ctx;
    if (this.live) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      ui.toast('🎤 This browser cannot use the microphone', 3500, { important: true });
      return false;
    }
    if (!window.isSecureContext) {
      ui.toast('🎤 Voice chat needs a secure (https) page', 3500, { important: true });
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch {
      ui.toast('🎤 Microphone permission was declined', 3500, { important: true });
      return false;
    }
    this.live = true;
    this.ac?.resume?.();
    if (this.ac) {
      this.localSource = this.ac.createMediaStreamSource(this.stream);
      this.localAnalyser = this.ac.createAnalyser();
      this.localAnalyser.fftSize = 256;
      this.localSource.connect(this.localAnalyser); // metered, never played back to ourselves
    }
    this.applyMute();
    for (const p of this.peers.values()) this.attachLocal(p);
    for (const id of this.net.remote.keys()) this.ensurePeer(id);
    this.announce();
    ui.toast(settings.voice === 'ptt' ? tk(`🎤 Mic ready: hold ${settings.keys.talk.replace('Key', '')} to talk. People within ~30 m hear you.`, '🎤 Mic ready: hold the 🎤 button to talk. People within ~30 m hear you.') : tk('🎤 Mic is live: people within ~30 m can hear you. Press V to switch it off.', '🎤 Mic is live: people within ~30 m can hear you. Tap 🎤 to switch it off.'), 4500, { important: true });
    return true;
  }

  disable() {
    if (!this.live) return;
    this.live = false;
    this.localTalking = false;
    for (const tr of this.stream?.getTracks() ?? []) tr.stop();
    this.localSource?.disconnect();
    this.localSource = null;
    this.localAnalyser = null;
    this.stream = null;
    for (const p of this.peers.values()) {
      const sender = p.pc.getSenders().find((s) => s.track);
      sender?.replaceTrack(null).catch(() => {});
    }
    this.announce();
    this.ctx.ui.toast('🎤 Mic off', 2000);
  }

  toggle() {
    return this.live ? this.disable() : this.enable();
  }

  /** The track is only enabled while we should be heard (open mic, or push-to-talk key held). */
  applyMute() {
    const heard = this.live && (settings.voice !== 'ptt' || this.talking);
    for (const tr of this.stream?.getAudioTracks() ?? []) tr.enabled = heard;
  }

  setTalking(v) {
    if (v === this.talking) return;
    this.talking = v;
    this.applyMute();
  }

  announce() {
    this.net.send({ t: 'mic', on: this.live });
    this.emit('state');
  }

  applySettings() {
    this.applyMute();
    for (const p of this.peers.values()) {
      if (p.gain) p.gain.gain.value = settings.voiceVolume;
      if (p.el && !p.gain) p.el.volume = settings.voiceVolume;
    }
  }

  // ---------- peers ----------

  peerJoined(id, hasMic) {
    if (this.live || hasMic) this.ensurePeer(id);
  }

  ensurePeer(id) {
    if (id === this.net.id) return null;
    const existing = this.peers.get(id);
    if (existing) return existing;
    if (this.peers.size >= MAX_PEERS) {
      if (!this.warnedPeers) {
        this.warnedPeers = true;
        this.ctx.ui.toast('🎤 Voice chat is full here (12 people); you may not hear everyone', 4000);
      }
      return null;
    }
    const pc = new RTCPeerConnection(ICE);
    const p = { id, pc, makingOffer: false, ignoreOffer: false, polite: this.net.id > id, remoteTracks: 0, speaking: false };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.send({ t: 'rtc', to: id, data: { candidate: e.candidate.toJSON() } });
    };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.net.send({ t: 'rtc', to: id, data: { description: pc.localDescription } });
      } catch {
        // the connection is going away
      } finally {
        p.makingOffer = false;
      }
    };
    pc.ontrack = (e) => {
      p.remoteTracks++;
      this.attachRemote(p, e.streams[0] ?? new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPeer(id);
      this.emit('state');
    };
    if (this.stream) this.attachLocal(p);
    return p;
  }

  attachLocal(p) {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    const tx = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
    if (tx) {
      tx.direction = 'sendrecv';
      tx.sender.replaceTrack(track).catch(() => {});
    } else {
      p.pc.addTrack(track, this.stream);
    }
  }

  attachRemote(p, stream) {
    // Chrome only pumps a remote MediaStream through Web Audio once something plays it, so the
    // (muted) element below stays even when the graph does the real playback.
    if (!p.el) {
      p.el = new Audio();
      p.el.autoplay = true;
      p.el.playsInline = true;
      document.body.appendChild(p.el);
      p.el.style.display = 'none';
    }
    p.el.srcObject = stream;
    const ac = this.ac;
    if (ac) {
      p.el.muted = true;
      p.source?.disconnect();
      p.source = ac.createMediaStreamSource(stream);
      if (!p.panner) {
        p.panner = ac.createPanner();
        // HRTF convolves every voice: phones get the cheap stereo pan instead
        p.panner.panningModel = settings.tier === 'low' ? 'equalpower' : 'HRTF';
        p.panner.distanceModel = 'linear';
        p.panner.refDistance = NEAR;
        p.panner.maxDistance = FAR;
        p.panner.rolloffFactor = 1;
        p.gain = ac.createGain();
        p.gain.gain.value = settings.voiceVolume;
        p.analyser = ac.createAnalyser();
        p.analyser.fftSize = 256;
        p.analyser.connect(p.panner).connect(p.gain).connect(this.ctx.audio.master);
      }
      p.source.connect(p.analyser);
    } else {
      p.el.muted = false;
      p.el.volume = settings.voiceVolume;
    }
    p.el.play().catch(() => {});
  }

  async onSignal(from, data) {
    const p = this.ensurePeer(from);
    if (!p) return;
    const pc = p.pc;
    try {
      if (data.description) {
        const collision = data.description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.net.send({ t: 'rtc', to: from, data: { description: pc.localDescription } });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!p.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('[voice] signalling', e?.message || e);
    }
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    try {
      p.pc.close();
    } catch {
      // ignore
    }
    p.source?.disconnect();
    p.analyser?.disconnect();
    p.gain?.disconnect();
    if (p.el) {
      p.el.srcObject = null;
      p.el.remove();
    }
    this.net.remote.get(id)?.tag.setSpeaking(false);
    this.emit('state');
  }

  // ---------- per frame ----------

  update(dt, camera) {
    const ac = this.ac;
    this.placeT += dt;
    if (ac && this.peers.size && this.placeT >= PLACE_S) {
      this.placeT = 0;
      const L = ac.listener;
      const pos = camera.position;
      const fwd = camera.getWorldDirection(this._fwd ??= pos.clone());
      if (L.positionX) {
        const t = ac.currentTime;
        L.positionX.setTargetAtTime(pos.x, t, SMOOTH);
        L.positionY.setTargetAtTime(pos.y, t, SMOOTH);
        L.positionZ.setTargetAtTime(pos.z, t, SMOOTH);
        L.forwardX.setTargetAtTime(fwd.x, t, SMOOTH);
        L.forwardY.setTargetAtTime(fwd.y, t, SMOOTH);
        L.forwardZ.setTargetAtTime(fwd.z, t, SMOOTH);
        if (!this.upSet) {
          // "up" never changes: set it once rather than scheduling it every update
          this.upSet = true;
          L.upX.value = 0;
          L.upY.value = 1;
          L.upZ.value = 0;
        }
      } else {
        L.setPosition(pos.x, pos.y, pos.z);
        L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
      }
      for (const p of this.peers.values()) {
        const r = this.net.remote.get(p.id);
        const x = r?.ready ? r.cur.x : 1e4;
        const y = r?.ready ? r.cur.y + 1.5 : 0;
        const z = r?.ready ? r.cur.z : 1e4;
        if (p.panner) {
          if (p.panner.positionX) {
            const t = ac.currentTime;
            p.panner.positionX.setTargetAtTime(x, t, SMOOTH);
            p.panner.positionY.setTargetAtTime(y, t, SMOOTH);
            p.panner.positionZ.setTargetAtTime(z, t, SMOOTH);
          } else p.panner.setPosition(x, y, z);
        } else if (p.el) {
          const d = Math.hypot(x - pos.x, z - pos.z);
          p.el.volume = settings.voiceVolume * Math.max(0, Math.min(1, 1 - (d - NEAR) / (FAR - NEAR)));
        }
      }
    }
    this.levelT += dt;
    if (this.levelT < 0.1) return;
    this.levelT = 0;
    if (this.localAnalyser) {
      const heard = this.live && (settings.voice !== 'ptt' || this.talking);
      const talking = heard && rms(this.localAnalyser, this.buf) > SPEAK_RMS;
      if (talking !== this.localTalking) {
        this.localTalking = talking;
        this.emit('level', talking);
      }
    }
    for (const p of this.peers.values()) {
      if (!p.analyser) continue;
      const speaking = rms(p.analyser, this.buf) > SPEAK_RMS;
      if (speaking !== p.speaking) {
        p.speaking = speaking;
        this.net.remote.get(p.id)?.tag.setSpeaking(speaking);
      }
    }
  }
}
