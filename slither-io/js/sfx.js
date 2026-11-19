// ============================================================
// sfx.js — lo-fi sound effects, synthesized with WebAudio.
// No audio assets: short filtered blips through a quiet master
// bus + compressor so nothing ever peaks harshly.
//
//   SFX.eat(value)   soft pluck when the player eats a pellet
//   SFX.kill()       two-note chime when the player kills a snake
//   SFX.death()      low descending tone + thud, player died
//   SFX.spawn()      gentle rising blip on start / respawn
//   SFX.toggleMute() flip mute (also bound to the M key)
//
// The AudioContext is created lazily on first use — which always
// happens inside a user-gesture handler path (Play click, in-game
// events), so autoplay policies are satisfied. In environments
// without WebAudio (headless test harnesses) every call no-ops.
// ============================================================

"use strict";

const SFX = {
  ctx: null,          // AudioContext (lazy)
  master: null,       // master GainNode — deliberately quiet
  muted: false,
  VOL: 0.14,          // low-volume lo-fi mix
  lastEatAt: -1,      // rate limiter for eat blips

  ensure() {
    if (!this.ctx) {
      const AC = (typeof window !== "undefined") && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;                       // headless / unsupported → silent no-op
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.VOL;
        const comp = this.ctx.createDynamicsCompressor(); // tames any peak
        comp.threshold.value = -18;
        comp.knee.value = 24;
        comp.ratio.value = 6;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
        return false;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.VOL;
    return this.muted;
  },

  // One lo-fi tone: oscillator → lowpass → gain envelope → master.
  tone({ type = "triangle", f = 440, fEnd = null, dur = 0.12, vol = 0.5, delay = 0, lp = 2200 } = {}) {
    if (!this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    flt.type = "lowpass";
    flt.frequency.value = lp;

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, f), t0);
    if (fEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(30, fEnd), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);   // quick soft attack
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);  // smooth decay

    osc.connect(flt); flt.connect(g); g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },

  // Filtered noise burst (soft thud / impact body).
  noise({ dur = 0.25, vol = 0.4, lp = 500, delay = 0 } = {}) {
    if (!this.ensure()) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = "lowpass";
    flt.frequency.value = lp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t0);
  },

  // ---------- named events ----------

  // Soft pluck; pitch rises with pellet value, slight random detune keeps
  // it organic. Rate-limited so a pellet field doesn't machine-gun.
  eat(value) {
    const now = this.ctx ? this.ctx.currentTime : (typeof performance !== "undefined" ? performance.now() / 1000 : 0);
    if (now - this.lastEatAt < 0.07) return;
    this.lastEatAt = now;
    const f = 340 + Math.min(280, value * 30) + Math.random() * 55;
    this.tone({ type: "triangle", f, fEnd: f * 1.45, dur: 0.09, vol: 0.26 + Math.min(0.14, value * 0.03), lp: 1700 });
  },

  // Player got a kill — small bright two-note chime (C5 → G5).
  kill() {
    this.tone({ type: "sine", f: 523, dur: 0.11, vol: 0.4, lp: 2600 });
    this.tone({ type: "sine", f: 784, dur: 0.16, vol: 0.4, delay: 0.09, lp: 2600 });
  },

  // Player died — descending tone plus a dull thud.
  death() {
    this.tone({ type: "triangle", f: 210, fEnd: 58, dur: 0.55, vol: 0.6, lp: 900 });
    this.noise({ dur: 0.3, vol: 0.5, lp: 420 });
  },

  // Start / respawn — gentle rising pair.
  spawn() {
    this.tone({ type: "sine", f: 330, dur: 0.10, vol: 0.3, lp: 2000 });
    this.tone({ type: "sine", f: 495, dur: 0.14, vol: 0.3, delay: 0.08, lp: 2000 });
  }
};
