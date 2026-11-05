import { tk } from './touch.js';
import { settings } from './settings.js';
import { rampTo } from './audio.js';

/*
  Proximity voice chat. Peer-to-peer WebRTC audio in a mesh (fine for a mela room of a dozen),
  signalled through the realtime socket. Each remote voice is spatialised with a PannerNode at
  that visitor's avatar for direction, while the loudness follows voiceGain(): full and clear
  within ~1 m (an avatar is ~1.7 units tall, so a world unit is a metre), falling off fast, and
  silent by 5 m, like talking to the person next to you in a crowd. Beyond ~9 m we also stop
  sending our mic to that peer (replaceTrack(null), no renegotiation), so voices nobody can
  hear cost no bandwidth either way. The mic stays off until the visitor turns it on; turning it off stops the track, so the
  browser's recording indicator goes away too. Whoever has a mic initiates the connection; the
  "perfect negotiation" pattern sorts out the case where both sides start at once.
*/
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
export const VOICE_FULL = 1; // full volume inside this radius (metres)
export const VOICE_EDGE = 5; // silent from here
const SEND_OFF = 9; // stop sending our mic to a peer this far away...
const SEND_ON = 8; // ...and start again once they come this close (hysteresis)
const HEAD = 1.5; // mouth/ear height above an avatar's feet
const MAX_PEERS = 12;
const SPEAK_RMS = 0.02;
const PLACE_S = 1 / 18; // listener and voice positions are pushed to Web Audio at ~18 Hz
const SMOOTH = 0.06; // ...and glide between updates

/** How loud a voice is at distance d (metres): 1 inside VOICE_FULL, a quadratic fall to 0 at VOICE_EDGE. */
export function voiceGain(d) {
  if (d <= VOICE_FULL) return 1;
  if (d >= VOICE_EDGE) return 0;
  const k = 1 - (d - VOICE_FULL) / (VOICE_EDGE - VOICE_FULL);
  return k * k;
}

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
    this.bus = null; // every remote voice goes through this (the Voices volume slider)
    this._me = null;
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
    ui.toast(settings.voice === 'ptt' ? tk(`🎤 Mic ready: hold ${settings.keys.talk.replace('Key', '')} to talk. People right next to you hear you.`, '🎤 Mic ready: hold the 🎤 button to talk. People right next to you hear you.') : tk('🎤 Mic is live: people right next to you can hear you. Press V to switch it off.', '🎤 Mic is live: people right next to you can hear you. Tap 🎤 to switch it off.'), 4500, { important: true });
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
    // voice rides the creator room's socket: the plain mela is single-player, so there is no one to hear
    if (!this.live && !this.net.enabled) {
      this.ctx.ui.toast('🎤 Voice chat works in a creator’s mela, with their other visitors', 3000);
      return;
    }
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
    if (this.bus) this.bus.gain.setTargetAtTime(settings.voiceVolume, this.ac.currentTime, 0.03);
    // the <audio> fallback (no Web Audio) picks the new volume up on its next placement update
  }

  voiceBus(ac) {
    if (!this.bus) {
      this.bus = ac.createGain();
      this.bus.gain.value = settings.voiceVolume;
      this.bus.connect(this.ctx.audio.master);
    }
    return this.bus;
  }

  audioSender(p) {
    return p.pc.getTransceivers().find((t) => t.sender.track?.kind === 'audio' || t.receiver.track?.kind === 'audio')?.sender ?? null;
  }

  /** Sends our mic to a peer only while they are close enough to hear it. */
  syncSend(p) {
    const sender = this.audioSender(p);
    if (!sender) return;
    const track = p.far ? null : this.stream?.getAudioTracks()[0] ?? null;
    if (sender.track !== track) sender.replaceTrack(track).catch(() => {});
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
    const p = { id, pc, makingOffer: false, ignoreOffer: false, polite: this.net.id > id, remoteTracks: 0, speaking: false, far: false };
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
      tx.sender.replaceTrack(p.far ? null : track).catch(() => {});
    } else {
      // added even when far, so the audio m-line is negotiated; it goes quiet straight away
      const sender = p.pc.addTrack(track, this.stream);
      if (p.far) sender.replaceTrack(null).catch(() => {});
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
        // the panner only gives direction; loudness is voiceGain() on p.gain, so the curve is ours
        p.panner.distanceModel = 'linear';
        p.panner.rolloffFactor = 0;
        p.gain = ac.createGain();
        p.gain.gain.value = 0; // until the first placement update says how close they are
        p.analyser = ac.createAnalyser();
        p.analyser.fftSize = 256;
        p.analyser.connect(p.panner).connect(p.gain).connect(this.voiceBus(ac));
      }
      p.source.connect(p.analyser);
    } else {
      p.el.muted = false;
      p.el.volume = 0; // set from the distance on the next placement update
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
    if (this.peers.size && this.placeT >= PLACE_S) {
      this.placeT = 0;
      // we hear with our avatar's head (not the third-person camera, which trails metres behind);
      // the camera only sets which way is "ahead" for panning
      const me = (this._me ??= camera.position.clone());
      const root = this.ctx.player?.char?.root;
      if (root) root.getWorldPosition(me).setY(me.y + HEAD);
      else me.copy(camera.position);
      const fwd = camera.getWorldDirection(this._fwd ??= me.clone());
      const t = ac?.currentTime ?? 0;
      if (ac) {
        const L = ac.listener;
        if (L.positionX) {
          L.positionX.setTargetAtTime(me.x, t, SMOOTH);
          L.positionY.setTargetAtTime(me.y, t, SMOOTH);
          L.positionZ.setTargetAtTime(me.z, t, SMOOTH);
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
          L.setPosition(me.x, me.y, me.z);
          L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
        }
      }
      for (const p of this.peers.values()) {
        const r = this.net.remote.get(p.id);
        const x = r?.ready ? r.cur.x : 1e4;
        const y = r?.ready ? r.cur.y + HEAD : 0;
        const z = r?.ready ? r.cur.z : 1e4;
        const d = Math.hypot(x - me.x, y - me.y, z - me.z);
        p.dist = d;
        const g = voiceGain(d);
        if (p.far ? d < SEND_ON : d > SEND_OFF) {
          p.far = !p.far;
          this.syncSend(p);
        }
        if (p.panner) {
          if (p.panner.positionX) {
            p.panner.positionX.setTargetAtTime(x, t, SMOOTH);
            p.panner.positionY.setTargetAtTime(y, t, SMOOTH);
            p.panner.positionZ.setTargetAtTime(z, t, SMOOTH);
          } else p.panner.setPosition(x, y, z);
          rampTo(p.gain.gain, g, t, SMOOTH, 0.002);
        } else if (p.el) {
          p.el.volume = settings.voiceVolume * g;
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
      const speaking = !p.far && rms(p.analyser, this.buf) > SPEAK_RMS; // out of earshot: not metered
      if (speaking !== p.speaking) {
        p.speaking = speaking;
        this.net.remote.get(p.id)?.tag.setSpeaking(speaking);
      }
    }
  }
}
